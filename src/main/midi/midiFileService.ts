// The MIDI files that are playing, one per cue, and the reads that put them there.
//
// It lives in main because the ports do: the window asks for a cue's file to be played and
// is answered with how long that will take, which is what lets the cue end and the show
// follow on by itself. What it answers "no" to — a file that is not there or not MIDI, a
// region with nothing in it, a port that is not plugged in — is a refusal with its sentence
// (AD-4), raised here where it is found.
//
// Panic reaches it from main's own safety net as well as from the window, so a show whose
// window has died still has every note it started released.

import { open, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { parseSmf, summarizeSmf, SMF_MAX_BYTES, type SmfSong, type SmfSummary } from '../../shared/smf'
import { midiFileOptionsProblem, midiFileRegion, type MidiFileOptions } from '../../shared/midiFile'
import { Refusal } from '../ipc/refusal'
import { MidiFilePlayer, type MidiFileClock } from './midiFilePlayer'

/** Sends bytes to a port by name; the answer says whether the port took them. */
export type MidiFileOutput = (portName: string, messages: number[][]) => { ok: boolean; error?: string }

/** Parsed files kept, so a cue fired again does not read and parse its file again. */
const CACHE_LIMIT = 16

/** A pass shorter than this is a region nobody meant: a loop of it would be a buzz. */
const MIN_PASS_MS = 1

export interface MidiFilePlayRequest {
  cueId: string
  filePath: string
  portName: string
  options: MidiFileOptions
  /** How far into the run to start, ms of played time: a timeline seek, a takeover. */
  offsetMs: number
}

export interface MidiFileStarted {
  /** How long the run has left from where it started, ms; null for one that loops on. */
  remainingMs: number | null
  /** One pass of the region at the cue's rate, ms. */
  passMs: number
}

export interface MidiFileServiceOptions {
  clock: MidiFileClock
  output?: MidiFileOutput
}

interface Cached {
  size: number
  mtimeMs: number
  song: SmfSong
}

export class MidiFileService {
  private readonly clock: MidiFileClock
  private output: MidiFileOutput | null
  private readonly players = new Map<string, MidiFilePlayer>()
  private readonly cache = new Map<string, Cached>()
  // Bumped for a cue by every play and stop of it, and for all of them by a stop-all: a play
  // that was still reading its file when the cue was stopped or fired again must not start.
  private readonly requests = new Map<string, number>()
  private epoch = 0

  constructor(options: MidiFileServiceOptions) {
    this.clock = options.clock
    this.output = options.output ?? null
  }

  /** The port the players send through, bound once the MIDI engine exists. */
  useOutput(output: MidiFileOutput): void {
    this.output = output
  }

  /** What a file holds, for the inspector: its tracks, channels, tempo and length. */
  async inspect(filePath: string): Promise<SmfSummary> {
    return summarizeSmf(await this.load(filePath))
  }

  async play(request: MidiFilePlayRequest): Promise<MidiFileStarted> {
    const { cueId, filePath, portName, options } = request
    const ticket = this.bump(cueId)
    const epoch = this.epoch
    this.stop(cueId, false)

    const problem = midiFileOptionsProblem(options)
    if (problem !== null) throw new Refusal(problem)
    const song = await this.load(filePath)
    const region = midiFileRegion(song.durationMs, options)
    if (region === null) {
      throw new Refusal('the cue starts at or after the end of its file, so there is nothing to play')
    }
    if ((region.endMs - region.startMs) / options.rate < MIN_PASS_MS) {
      throw new Refusal('the part of the file the cue plays is too short to play')
    }
    // Taken away while the file was being read: stopped, fired again, or a panic.
    if (this.requests.get(cueId) !== ticket || this.epoch !== epoch) {
      throw new Refusal('the cue was stopped before its file started')
    }

    const output = this.output
    if (output === null) throw new Refusal('MIDI is unavailable')
    // Asking for the port with nothing to send is how its presence is checked: a cue aimed at
    // a port that is not plugged in says so now, rather than playing to nothing for minutes.
    const reachable = output(portName, [])
    if (!reachable.ok) throw new Refusal(reachable.error ?? 'the MIDI port did not answer')

    const player = new MidiFilePlayer({
      source: song,
      options,
      clock: this.clock,
      sink: message => {
        const sent = output(portName, [message])
        if (!sent.ok) throw new Error(sent.error ?? 'the MIDI port stopped taking messages')
      },
      onEnd: () => {
        if (this.players.get(cueId) === player) this.players.delete(cueId)
      }
    })
    this.players.set(cueId, player)
    player.start(Math.max(0, request.offsetMs))
    if (player.state === 'failed') {
      this.players.delete(cueId)
      throw new Refusal(player.error ?? 'the MIDI port stopped taking messages')
    }
    return { remainingMs: player.remainingMs(), passMs: player.passMs }
  }

  /** Stops a cue's file, releasing what it holds. False when it was not playing. */
  stop(cueId: string, takeBack = true): boolean {
    if (takeBack) this.bump(cueId)
    const player = this.players.get(cueId)
    if (player === undefined) return false
    this.players.delete(cueId)
    player.stop()
    return true
  }

  /** Holds a cue's file where it is. Its notes are released while it is held. */
  pause(cueId: string): { positionMs: number } {
    const player = this.playing(cueId)
    player.pause()
    return { positionMs: player.position() }
  }

  /** Plays a held file on, with its channels put back where the file had them. */
  resume(cueId: string): { remainingMs: number | null } {
    const player = this.playing(cueId)
    player.resume()
    return { remainingMs: player.remainingMs() }
  }

  /** Moves a cue's file to `positionMs` of played time, its channels chased there. */
  seek(cueId: string, positionMs: number): { remainingMs: number | null } {
    const player = this.playing(cueId)
    player.seek(positionMs)
    return { remainingMs: player.remainingMs() }
  }

  /**
   * Stops every file. A panic also says All Notes Off on every channel each one played on,
   * which an ordinary stop leaves to the notes it can name.
   */
  stopAll(panic = false): number {
    this.epoch++
    const players = [...this.players.values()]
    this.players.clear()
    for (const player of players) player.stop(panic)
    return players.length
  }

  /** Whether a file is playing or held: what the watchdog asks before it decides to act. */
  isPlaying(): boolean {
    for (const player of this.players.values()) {
      if (player.state === 'playing' || player.state === 'paused') return true
    }
    return false
  }

  private playing(cueId: string): MidiFilePlayer {
    const player = this.players.get(cueId)
    if (player === undefined || (player.state !== 'playing' && player.state !== 'paused')) {
      throw new Refusal('that cue’s MIDI file is not playing')
    }
    return player
  }

  private bump(cueId: string): number {
    const next = (this.requests.get(cueId) ?? 0) + 1
    this.requests.set(cueId, next)
    return next
  }

  /**
   * The file at `filePath`, parsed. Bounded before it is read — the size is checked first,
   * and the read takes no more than the bound plus one byte however the file grows meanwhile
   * — and kept while its size and time are unchanged.
   */
  private async load(filePath: string): Promise<SmfSong> {
    if (typeof filePath !== 'string' || filePath === '') throw new Refusal('no MIDI file is chosen')
    const name = basename(filePath)
    let info
    try {
      info = await stat(filePath)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') throw new Refusal(`${name} is not there`)
      throw new Refusal(`${name} cannot be read: ${(error as Error).message}`)
    }
    if (!info.isFile()) throw new Refusal(`${name} is not a file`)
    if (info.size > SMF_MAX_BYTES) {
      throw new Refusal(`${name}: the file is larger than ${SMF_MAX_BYTES / (1024 * 1024)} MB, which no MIDI file a show plays is`)
    }
    const cached = this.cache.get(filePath)
    if (cached !== undefined && cached.size === info.size && cached.mtimeMs === info.mtimeMs) {
      // Most recently used goes to the back, so the oldest is the one let go.
      this.cache.delete(filePath)
      this.cache.set(filePath, cached)
      return cached.song
    }

    let bytes: Uint8Array
    const handle = await open(filePath, 'r').catch((error: Error) => {
      throw new Refusal(`${name} cannot be read: ${error.message}`)
    })
    try {
      const buffer = Buffer.alloc(Math.min(info.size, SMF_MAX_BYTES) + 1)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      bytes = buffer.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }

    const parsed = parseSmf(bytes)
    if (!parsed.ok) throw new Refusal(`${name}: ${parsed.error}`)
    this.cache.set(filePath, { size: info.size, mtimeMs: info.mtimeMs, song: parsed.song })
    while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!)
    return parsed.song
  }
}
