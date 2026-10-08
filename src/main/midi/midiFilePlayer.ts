// Plays one parsed MIDI file to one sink, on a clock it is given.
//
// Time is absolute. Every message's moment is worked out from the run's anchor — the clock
// reading at which the run's played position was zero — and the player wakes for that moment,
// sends everything that is due, and asks to be woken for the next. A late wake makes that one
// message late; it does not make every message after it late, which is what a chain of
// relative delays does, and what drifts a four-minute file audibly off the band.
//
// The clock is a parameter so the tests drive it by hand: what they read is the order and the
// moment of every byte the sink was given, with no real time passing.

import type { SmfEvent } from '../../shared/smf'
import {
  midiFilePassMs,
  midiFileRegion,
  midiFileTotalMs,
  type MidiFileOptions
} from '../../shared/midiFile'
import { chaseMessages, midiFileTransform, type MidiFileTransform } from './midiFilePlan'

/** Where the player reads the time and asks to be woken. Milliseconds, monotonic. */
export interface MidiFileClock {
  now(): number
  /** Calls `wake` once, at or after `atMs`. Returns the function that cancels it. */
  wakeAt(atMs: number, wake: () => void): () => void
}

/** Where messages go. A throw is a port that has stopped taking them. */
export type MidiFileSink = (message: number[]) => void

/** What a parsed file gives the player: its messages in order, and how long it is. */
export interface MidiFileSource {
  events: readonly SmfEvent[]
  durationMs: number
}

export type MidiFilePlayerState = 'idle' | 'playing' | 'paused' | 'ended' | 'stopped' | 'failed'

/**
 * How early a message may go out with the ones before it, ms. Two messages a fraction of a
 * millisecond apart are one wake rather than two, and no ear hears the half millisecond.
 */
const SEND_EARLY_MS = 1

const SUSTAIN = 64
const ALL_NOTES_OFF = 123

interface Timed {
  /** When in its pass it plays, ms of played time from the start of the pass. */
  at: number
  data: number[]
}

export interface MidiFilePlayerInit {
  source: MidiFileSource
  options: MidiFileOptions
  sink: MidiFileSink
  clock: MidiFileClock
  /** Called once when the run is over by itself: it reached its end, or the port failed. */
  onEnd?: (state: 'ended' | 'failed', error: string | null) => void
}

export class MidiFilePlayer {
  readonly passMs: number
  /** Every pass together, or null for a run that loops until it is stopped. */
  readonly totalMs: number | null

  private readonly source: MidiFileSource
  private readonly options: MidiFileOptions
  private readonly sink: MidiFileSink
  private readonly clock: MidiFileClock
  private readonly onEnd: MidiFilePlayerInit['onEnd']
  private readonly transform: MidiFileTransform
  private readonly regionStartMs: number
  private readonly pass: Timed[]

  private stateValue: MidiFilePlayerState = 'idle'
  private errorValue: string | null = null
  /** The clock reading at which played position 0 was, while playing. */
  private anchor = 0
  /** Where a paused run is held, played ms. */
  private heldAt = 0
  private passIndex = 0
  private cursor = 0
  private cancelWake: (() => void) | null = null

  /** Notes this run started and has not released, by output channel and key, with how many. */
  private readonly sounding = new Map<number, number>()
  /** Output channels whose sustain pedal this run left down. */
  private readonly pedalDown = new Set<number>()
  /** Every output channel this run has sent anything on. */
  private readonly used = new Set<number>()

  constructor(init: MidiFilePlayerInit) {
    this.source = init.source
    this.options = init.options
    this.sink = init.sink
    this.clock = init.clock
    this.onEnd = init.onEnd
    this.transform = midiFileTransform(init.options)
    const region = midiFileRegion(init.source.durationMs, init.options)
    this.regionStartMs = region?.startMs ?? 0
    this.passMs = midiFilePassMs(init.source.durationMs, init.options)
    this.totalMs = midiFileTotalMs(init.source.durationMs, init.options)
    const rate = init.options.rate
    this.pass = region === null
      ? []
      : init.source.events
        .filter(event => event.ms >= region.startMs && event.ms < region.endMs)
        .map(event => ({ at: (event.ms - region.startMs) / rate, data: event.data }))
  }

  get state(): MidiFilePlayerState {
    return this.stateValue
  }

  /** Why the port stopped taking messages, once it has. */
  get error(): string | null {
    return this.errorValue
  }

  /** Where the run is, ms of played time from its start, every pass counted. */
  position(): number {
    if (this.stateValue === 'playing') return Math.max(0, this.clock.now() - this.anchor)
    return this.heldAt
  }

  /** How much of the run is left to play, ms, or null for one that loops until stopped. */
  remainingMs(): number | null {
    if (this.totalMs === null) return null
    if (this.stateValue === 'ended' || this.stateValue === 'stopped' || this.stateValue === 'failed') return 0
    return Math.max(0, this.totalMs - this.position())
  }

  /**
   * Starts the run `offsetMs` into it — played time, so the rate is applied once: at 2x, an
   * offset of 500 ms is a second into the file. A start part-way puts every channel where the
   * file had it there before the first message plays.
   */
  start(offsetMs = 0): void {
    if (this.stateValue !== 'idle') return
    const at = Math.max(0, offsetMs)
    this.stateValue = 'playing'
    this.anchor = this.clock.now() - at
    if (!this.enter(at)) return
    this.pump()
  }

  /**
   * Holds the run where it is. What is sounding is released and any pedal lifted, because a
   * held run that kept its notes down would be a chord nobody asked for, droning; resuming
   * puts the channels back and plays on from the same place.
   */
  pause(): void {
    if (this.stateValue !== 'playing') return
    this.heldAt = this.position()
    this.clearWake()
    this.stateValue = 'paused'
    this.releaseNotes()
    this.liftPedals(false)
  }

  resume(): void {
    if (this.stateValue !== 'paused') return
    this.stateValue = 'playing'
    this.anchor = this.clock.now() - this.heldAt
    if (!this.enter(this.heldAt)) return
    this.pump()
  }

  /** Moves the run to `positionMs` of played time, with the channels chased to it. */
  seek(positionMs: number): void {
    if (this.stateValue !== 'playing' && this.stateValue !== 'paused') return
    const at = Math.max(0, positionMs)
    this.clearWake()
    this.releaseNotes()
    this.liftPedals(false)
    if (this.stateValue === 'paused') {
      // The chase happens when it resumes, from wherever it is held then.
      this.heldAt = this.totalMs === null ? at : Math.min(at, this.totalMs)
      return
    }
    this.anchor = this.clock.now() - at
    if (!this.enter(at)) return
    this.pump()
  }

  /**
   * Ends the run. Every note it started is released and the sustain pedal is lifted on every
   * channel it played on — whether or not it put one down, because a pedal the file pressed
   * before a seek is a pedal this run inherited. A panic says All Notes Off on those channels
   * as well, for whatever a release cannot reach; an ordinary stop does not, because another
   * source on the same channel of a shared port is not this cue's to silence.
   */
  stop(panic = false): void {
    if (this.stateValue === 'stopped' || this.stateValue === 'ended' || this.stateValue === 'failed') return
    this.heldAt = this.position()
    this.clearWake()
    this.stateValue = 'stopped'
    this.releaseNotes()
    this.liftPedals(true)
    if (panic) for (const channel of this.used) this.emit([0xb0 | channel, ALL_NOTES_OFF, 0])
  }

  /** Puts the run at `positionMs`: which pass, which message next, and the channels chased. */
  private enter(positionMs: number): boolean {
    if (this.passMs <= 0) {
      this.finish()
      return false
    }
    if (this.totalMs !== null && positionMs >= this.totalMs) {
      this.finish()
      return false
    }
    this.passIndex = Math.floor(positionMs / this.passMs)
    const within = positionMs - this.passIndex * this.passMs
    this.cursor = this.firstAtOrAfter(within)
    this.chase(this.regionStartMs + within * this.options.rate)
    return this.stateValue === 'playing'
  }

  private chase(fileMs: number): void {
    for (const message of chaseMessages(this.source.events, fileMs)) {
      this.send(message)
      if (this.stateValue !== 'playing') return
    }
  }

  private firstAtOrAfter(within: number): number {
    let lo = 0
    let hi = this.pass.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (this.pass[mid].at < within) lo = mid + 1
      else hi = mid
    }
    return lo
  }

  /** Sends everything due, then sleeps until the next thing is. */
  private pump(): void {
    this.cancelWake = null
    while (this.stateValue === 'playing') {
      const position = this.clock.now() - this.anchor
      const passStart = this.passIndex * this.passMs
      if (this.cursor < this.pass.length) {
        const due = passStart + this.pass[this.cursor].at
        if (due > position + SEND_EARLY_MS) {
          this.sleepUntil(due)
          return
        }
        this.send(this.pass[this.cursor].data)
        this.cursor++
        continue
      }
      // Every message of this pass has gone; the pass itself ends at its region's end, which
      // may be some silence later.
      const passEnd = passStart + this.passMs
      if (passEnd > position + SEND_EARLY_MS) {
        this.sleepUntil(passEnd)
        return
      }
      // A pass ends with its notes: a note held over a loop's seam would never be released.
      this.releaseNotes()
      this.liftPedals(false)
      const loops = this.options.loopCount
      if (loops >= 0 && this.passIndex >= loops) {
        this.finish()
        return
      }
      this.passIndex++
      this.cursor = 0
      // Back at the region's start, the channels go back to where the file had them there.
      this.chase(this.regionStartMs)
    }
  }

  private sleepUntil(dueMs: number): void {
    this.cancelWake = this.clock.wakeAt(this.anchor + dueMs, () => this.pump())
  }

  private clearWake(): void {
    this.cancelWake?.()
    this.cancelWake = null
  }

  private finish(): void {
    this.clearWake()
    this.heldAt = this.totalMs ?? this.position()
    this.releaseNotes()
    this.liftPedals(true)
    if (this.stateValue === 'failed') return
    this.stateValue = 'ended'
    this.onEnd?.('ended', null)
  }

  /** One of the file's messages, through the cue's map, onto the port. */
  private send(data: number[]): void {
    const message = this.transform(data)
    if (message === null) return
    const status = message[0]
    if (status < 0xf0) {
      const channel = status & 0x0f
      const kind = status & 0xf0
      this.used.add(channel)
      if (kind === 0x90 || kind === 0x80) {
        const key = channel * 128 + message[1]
        const held = this.sounding.get(key) ?? 0
        if (kind === 0x90 && message[2] > 0) {
          this.sounding.set(key, held + 1)
        } else if (held === 0) {
          // A release for a note this run is not sounding: one struck before a seek or a
          // start part-way, or one a hold already let go. Sent, it would be a stray Note Off
          // on the port — and on a shared channel it would cut another source's note.
          return
        } else if (held > 1) {
          this.sounding.set(key, held - 1)
        } else {
          this.sounding.delete(key)
        }
      }
      if (kind === 0xb0 && message[1] === SUSTAIN) {
        if (message[2] >= 64) this.pedalDown.add(channel)
        else this.pedalDown.delete(channel)
      }
    }
    this.emit(message)
  }

  /** Bytes onto the port. A port that throws has gone: the run stops sending and says so. */
  private emit(message: number[]): void {
    if (this.stateValue === 'failed') return
    try {
      this.sink(message)
    } catch (error) {
      this.clearWake()
      this.stateValue = 'failed'
      this.errorValue = error instanceof Error ? error.message : String(error)
      this.heldAt = Math.max(0, this.clock.now() - this.anchor)
      this.onEnd?.('failed', this.errorValue)
    }
  }

  /** A Note Off for every note this run has sounding — once for each time it was struck. */
  private releaseNotes(): void {
    const keys = [...this.sounding.entries()].sort((a, b) => a[0] - b[0])
    this.sounding.clear()
    for (const [key, count] of keys) {
      const channel = Math.floor(key / 128)
      const note = key % 128
      for (let i = 0; i < count; i++) this.emit([0x80 | channel, note, 0])
    }
  }

  /** The sustain pedal up: where this run put it down, or on every channel it played on. */
  private liftPedals(everyChannel: boolean): void {
    const channels = everyChannel ? [...this.used] : [...this.pedalDown]
    this.pedalDown.clear()
    for (const channel of channels.sort((a, b) => a - b)) this.emit([0xb0 | channel, SUSTAIN, 0])
  }
}
