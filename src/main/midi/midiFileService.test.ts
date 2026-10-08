// The MIDI File service: real files on disk, a port that writes down what it is sent, and a
// clock moved by hand. What it holds true is the channel's half of the cue — what is read,
// what is refused and in what words, and that every way a run can end lets go of its notes.

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIDI_FILE_IDENTITY_MAP, type MidiFileOptions } from '../../shared/midiFile'
import { SMF_MAX_BYTES } from '../../shared/smf'
import { isRefusal } from '../ipc/refusal'
import { MidiFileService } from './midiFileService'
import type { MidiFileClock } from './midiFilePlayer'

const dir = mkdtempSync(join(tmpdir(), 'cuerunner-feat-midi-file-cue-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

class FakeClock implements MidiFileClock {
  t = 0
  private wakes: { at: number; wake: () => void; cancelled: boolean }[] = []
  now(): number { return this.t }
  wakeAt(atMs: number, wake: () => void): () => void {
    const entry = { at: atMs, wake, cancelled: false }
    this.wakes.push(entry)
    return () => { entry.cancelled = true }
  }
  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const due = this.wakes.filter(entry => !entry.cancelled && entry.at <= end).sort((a, b) => a.at - b.at)[0]
      if (due === undefined) break
      this.wakes.splice(this.wakes.indexOf(due), 1)
      this.t = Math.max(this.t, due.at)
      due.wake()
    }
    this.t = end
  }
}

/** A one-track file, 480 ticks a quarter at 120 BPM: a note on 60 for a beat, then a beat of tail. */
function writeMidi(name: string): string {
  const body = [
    0x00, 0xff, 0x03, 0x05, ...[...'Piano'].map(c => c.charCodeAt(0)),
    0x00, 0x90, 60, 100,
    0x83, 0x60, 0x80, 60, 0,
    0x83, 0x60, 0xff, 0x2f, 0x00
  ]
  const bytes = [
    ...[...'MThd'].map(c => c.charCodeAt(0)), 0, 0, 0, 6, 0, 0, 0, 1, 0x01, 0xe0,
    ...[...'MTrk'].map(c => c.charCodeAt(0)), 0, 0, 0, body.length, ...body
  ]
  const path = join(dir, name)
  writeFileSync(path, Uint8Array.from(bytes))
  return path
}

const options = (over: Partial<MidiFileOptions> = {}): MidiFileOptions => ({
  rate: 1,
  startMs: 0,
  endMs: null,
  loopCount: 0,
  channelMap: [...MIDI_FILE_IDENTITY_MAP],
  transpose: 0,
  transposeDrums: false,
  ...over
})

let clock: FakeClock
let sent: { port: string; bytes: number[] }[]
let ports: string[]
let service: MidiFileService

beforeEach(() => {
  clock = new FakeClock()
  sent = []
  ports = ['cuerunner-feat-midi-file-cue']
  service = new MidiFileService({
    clock,
    output: (port, messages) => {
      if (!ports.includes(port)) return { ok: false, error: `No MIDI output port named "${port}"` }
      for (const bytes of messages) sent.push({ port, bytes })
      return { ok: true }
    }
  })
})

/** The sentence a refusal carries, or a failure if the call did not refuse. */
async function refusalOf(call: () => Promise<unknown> | unknown): Promise<string> {
  try {
    await call()
  } catch (error) {
    if (isRefusal(error)) return error.message
    throw error
  }
  throw new Error('it did not refuse')
}

const play = (filePath: string, over: Partial<MidiFileOptions> = {}, portName = 'cuerunner-feat-midi-file-cue') =>
  service.play({ cueId: 'c1', filePath, portName, options: options(over), offsetMs: 0 })

describe('reading a file for the inspector', () => {
  it('says what a file holds: its tracks, its tempo and its length', async () => {
    const summary = await service.inspect(writeMidi('inspect.mid'))
    expect(summary).toMatchObject({ format: 0, durationMs: 1000, initialBpm: 120, channels: [1], eventCount: 2 })
    expect(summary.tracks).toEqual([{ name: 'Piano', channelEvents: 2, notes: 1, sysex: 0, meta: 2, channels: [1], endMs: 1000 }])
  })

  it('refuses a file that is not there, naming it', async () => {
    expect(await refusalOf(() => service.inspect(join(dir, 'gone.mid')))).toBe('gone.mid is not there')
  })

  it('refuses a file that is not MIDI, naming it and saying why', async () => {
    const path = join(dir, 'notes.mid')
    writeFileSync(path, 'these are my notes, not a MIDI file')
    expect(await refusalOf(() => service.inspect(path))).toBe('notes.mid: this is not a MIDI file: it does not begin with a MIDI header')
  })

  it('refuses a file over the size bound without reading it', async () => {
    const path = join(dir, 'huge.mid')
    writeFileSync(path, '')
    truncateSync(path, SMF_MAX_BYTES + 1)
    expect(await refusalOf(() => service.inspect(path))).toMatch(/^huge\.mid: the file is larger than 16 MB/)
  })

  it('reads a file again once it has changed on disk', async () => {
    const path = writeMidi('changing.mid')
    expect((await service.inspect(path)).durationMs).toBe(1000)
    writeFileSync(path, 'not any more')
    utimesSync(path, new Date(), new Date(Date.now() + 5000))
    expect(await refusalOf(() => service.inspect(path))).toMatch(/not a MIDI file/)
  })
})

describe('playing a cue’s file', () => {
  it('plays to its port and says how long the run has left', async () => {
    const started = await play(writeMidi('play.mid'), { rate: 2 })
    expect(started).toEqual({ remainingMs: 500, passMs: 500 })
    expect(service.isPlaying()).toBe(true)
    clock.advance(1000)
    expect(sent.map(message => message.bytes)).toEqual([[0x90, 60, 100], [0x80, 60, 0], [0xb0, 64, 0]])
    expect(service.isPlaying()).toBe(false)
  })

  it('says a run that loops until stopped has no end', async () => {
    expect(await play(writeMidi('loop.mid'), { loopCount: -1 })).toEqual({ remainingMs: null, passMs: 1000 })
  })

  it('refuses a port that is not there before playing anything', async () => {
    const message = await refusalOf(() => play(writeMidi('port.mid'), {}, 'Nowhere'))
    expect(message).toBe('No MIDI output port named "Nowhere"')
    expect(sent).toEqual([])
    expect(service.isPlaying()).toBe(false)
  })

  it('refuses options outside their bounds, and a region with nothing in it', async () => {
    const path = writeMidi('bounds.mid')
    expect(await refusalOf(() => play(path, { rate: 9 }))).toMatch(/rate/)
    expect(await refusalOf(() => play(path, { startMs: 1000 })))
      .toBe('the cue starts at or after the end of its file, so there is nothing to play')
  })

  it('does not start a file whose cue was stopped while it was being read', async () => {
    const pending = play(writeMidi('raced.mid'))
    service.stop('c1')
    expect(await refusalOf(() => pending)).toBe('the cue was stopped before its file started')
    clock.advance(1000)
    expect(sent).toEqual([])
  })

  it('replaces a cue’s run when the cue is played again, releasing the first', async () => {
    const path = writeMidi('again.mid')
    await play(path)
    clock.advance(100)
    await play(path)
    expect(sent.map(message => message.bytes)).toEqual([
      [0x90, 60, 100], [0x80, 60, 0], [0xb0, 64, 0], [0x90, 60, 100]
    ])
  })

  it('stops, releasing what it holds, and says whether anything was playing', async () => {
    await play(writeMidi('stop.mid'))
    clock.advance(100)
    expect(service.stop('c1')).toBe(true)
    expect(sent.slice(-2).map(message => message.bytes)).toEqual([[0x80, 60, 0], [0xb0, 64, 0]])
    expect(service.stop('c1')).toBe(false)
  })

  it('holds and resumes a run, and refuses either for a cue that is not playing', async () => {
    await play(writeMidi('hold.mid'))
    clock.advance(400)
    expect(service.pause('c1')).toEqual({ positionMs: 400 })
    clock.advance(10_000)
    expect(service.resume('c1')).toEqual({ remainingMs: 600 })
    expect(await refusalOf(() => service.pause('other'))).toBe('that cue’s MIDI file is not playing')
    expect(await refusalOf(() => service.resume('other'))).toBe('that cue’s MIDI file is not playing')
  })

  it('stops every file on a panic, with All Notes Off on the channels they used', async () => {
    await play(writeMidi('panic.mid'))
    clock.advance(10)
    expect(service.stopAll(true)).toBe(1)
    expect(sent.slice(-3).map(message => message.bytes)).toEqual([[0x80, 60, 0], [0xb0, 64, 0], [0xb0, 123, 0]])
    expect(service.isPlaying()).toBe(false)
  })

  it('says a port that stops taking messages mid-file, and stops sending to it', async () => {
    await play(writeMidi('unplugged.mid'))
    ports = []
    clock.advance(1000)
    expect(service.isPlaying()).toBe(false)
    expect(sent).toHaveLength(1)
  })
})
