// The Standard MIDI File reader, held true on files built here byte by byte.
//
// No fixture files: each case writes the bytes the format describes, so what a case reads is
// on the page beside it — the header's division, the delta times, the tempo in microseconds
// — and a case for a refusal is the one damaged byte that earns it.

import { describe, expect, it } from 'vitest'
import { parseSmf, summarizeSmf, SMF_MAX_BYTES, SMF_MAX_EVENTS, type SmfResult, type SmfSong } from './smf'

/** A variable-length quantity, as the format writes delta times and lengths. */
function vlq(value: number): number[] {
  const bytes = [value & 0x7f]
  let rest = Math.floor(value / 128)
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80)
    rest = Math.floor(rest / 128)
  }
  return bytes
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

function chunk(id: string, body: number[]): number[] {
  return [...[...id].map(c => c.charCodeAt(0)), ...u32(body.length), ...body]
}

type Ev = [delta: number, ...bytes: number[]]

/** A track chunk from (delta, bytes…) events, ended with End of Track unless told not to. */
function track(events: Ev[], end: { delta?: number; omit?: boolean } = {}): number[] {
  const body: number[] = []
  for (const [delta, ...bytes] of events) body.push(...vlq(delta), ...bytes)
  if (!end.omit) body.push(...vlq(end.delta ?? 0), 0xff, 0x2f, 0x00)
  return chunk('MTrk', body)
}

function header(format: number, tracks: number, division: number): number[] {
  return chunk('MThd', [format >> 8, format & 0xff, tracks >> 8, tracks & 0xff, division >> 8, division & 0xff])
}

function smf(format: number, division: number, ...tracks: number[][]): Uint8Array {
  return Uint8Array.from([...header(format, tracks.length, division), ...tracks.flat()])
}

const tempo = (usPerQuarter: number): number[] =>
  [0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff]
const name = (text: string): number[] => [0xff, 0x03, ...vlq(text.length), ...[...text].map(c => c.charCodeAt(0))]
const on = (channel: number, note: number, velocity = 100): number[] => [0x90 | (channel - 1), note, velocity]
const off = (channel: number, note: number): number[] => [0x80 | (channel - 1), note, 0]

function song(result: SmfResult): SmfSong {
  if (!result.ok) throw new Error(`refused: ${result.error}`)
  return result.song
}

/** Each event as [ms, …bytes], with the times rounded to a thousandth. */
function timeline(result: SmfResult): number[][] {
  return song(result).events.map(event => [Math.round(event.ms * 1000) / 1000, ...event.data])
}

function refusal(result: SmfResult): string {
  if (result.ok) throw new Error('the file was read')
  return result.code
}

describe('reading time', () => {
  it('plays a file at 120 BPM until it says otherwise, and its length runs to its End of Track', () => {
    // 480 ticks a quarter note at the default 500000 µs a quarter: a tick is 1/960 s.
    const result = parseSmf(smf(0, 480, track([[0, ...on(1, 60)], [480, ...off(1, 60)]], { delta: 960 })))
    expect(timeline(result)).toEqual([[0, 0x90, 60, 100], [500, 0x80, 60, 0]])
    // The silent tail before End of Track is part of the file.
    expect(song(result).durationMs).toBe(1500)
    expect(song(result).initialBpm).toBe(120)
    expect(song(result).tempoChanges).toBe(0)
  })

  it('moves every later event when a Set Tempo arrives part-way through', () => {
    const result = parseSmf(smf(0, 480, track([
      [0, ...tempo(500_000)],
      [0, ...on(1, 60)],
      // Two beats at 120 BPM: 1000 ms. Then twice as fast.
      [960, ...tempo(250_000)],
      // Two more beats at 240 BPM: 500 ms.
      [960, ...off(1, 60)]
    ])))
    expect(timeline(result)).toEqual([[0, 0x90, 60, 100], [1500, 0x80, 60, 0]])
    expect(song(result).tempoChanges).toBe(2)
    expect(song(result).initialBpm).toBe(120)
  })

  it('reads the conductor track’s tempo map into every other track of a format 1 file', () => {
    const conductor = track([[0, ...name('Conductor')], [0, ...tempo(600_000)], [480, ...tempo(1_000_000)]])
    const keys = track([[0, ...on(2, 64)], [960, ...off(2, 64)]])
    const result = parseSmf(smf(1, 480, conductor, keys))
    // One beat at 100 BPM (600 ms), one at 60 BPM (1000 ms).
    expect(timeline(result)).toEqual([[0, 0x91, 64, 100], [1600, 0x81, 64, 0]])
    expect(song(result).initialBpm).toBe(100)
    expect(song(result).tracks.map(t => t.name)).toEqual(['Conductor', ''])
  })

  it('applies a tempo change wherever in a format 1 file it is written', () => {
    // Not the conventional place for it, and still the file's tempo: every track follows it.
    const keys = track([[0, ...on(1, 60)], [480, ...off(1, 60)]])
    const later = track([[240, ...tempo(250_000)], [240, ...on(3, 48)]])
    const result = parseSmf(smf(1, 480, keys, later))
    expect(timeline(result)).toEqual([[0, 0x90, 60, 100], [375, 0x80, 60, 0], [375, 0x92, 48, 100]])
  })

  it('merges the tracks by time, and keeps track order for events at the same moment', () => {
    const a = track([[0, ...on(1, 60)], [100, ...off(1, 60)]])
    const b = track([[50, ...on(2, 62)], [50, ...off(2, 62)]])
    const result = parseSmf(smf(1, 480, a, b))
    expect(timeline(result).map(event => event.slice(0, 2))).toEqual([
      [0, 0x90], [52.083, 0x91], [104.167, 0x80], [104.167, 0x81]
    ])
  })

  it('plays the tracks of a format 2 file one after another, each with its own tempo', () => {
    const first = track([[0, ...tempo(250_000)], [0, ...on(1, 60)], [480, ...off(1, 60)]])
    const second = track([[0, ...on(1, 67)], [480, ...off(1, 67)]])
    const result = parseSmf(smf(2, 480, first, second))
    // The first lasts a beat at 240 BPM; the second starts there, at the default tempo.
    expect(timeline(result)).toEqual([
      [0, 0x90, 60, 100], [250, 0x80, 60, 0], [250, 0x90, 67, 100], [750, 0x80, 67, 0]
    ])
    expect(song(result).durationMs).toBe(750)
    expect(song(result).tracks.map(t => t.endMs)).toEqual([250, 750])
  })

  it('counts SMPTE time in frames and ignores any tempo the file names', () => {
    // −25 frames a second, 40 ticks a frame: a tick is a millisecond.
    const division = ((256 - 25) << 8) | 40
    const result = parseSmf(smf(0, division, track([[0, ...tempo(250_000)], [0, ...on(1, 60)], [500, ...off(1, 60)]])))
    expect(timeline(result)).toEqual([[0, 0x90, 60, 100], [500, 0x80, 60, 0]])
    expect(song(result).timing).toEqual({ kind: 'smpte', framesPerSecond: 25, ticksPerFrame: 40 })
    expect(song(result).initialBpm).toBeNull()
  })

  it('reads the file’s 29 as drop-frame 29.97', () => {
    const division = ((256 - 29) << 8) | 100
    const result = parseSmf(smf(0, division, track([[3000, ...on(1, 60)]])))
    // Thirty frames at 30000/1001 frames a second take 1001 ms, where at 30 they take 1000.
    expect(timeline(result)[0][0]).toBe(1001)
  })
})

describe('reading events', () => {
  it('expands running status into whole messages', () => {
    const result = parseSmf(smf(0, 480, track([
      [0, 0x90, 60, 100],
      // The same status again, unwritten.
      [0, 64, 100],
      [480, 60, 0],
      [0, 64, 0]
    ])))
    expect(timeline(result)).toEqual([
      [0, 0x90, 60, 100], [0, 0x90, 64, 100], [500, 0x90, 60, 0], [500, 0x90, 64, 0]
    ])
    // A Note On at velocity 0 is a release, not a note.
    expect(song(result).tracks[0].notes).toBe(2)
    expect(song(result).tracks[0].channelEvents).toBe(4)
  })

  it('reads one-data-byte messages — program and pressure — at their own length', () => {
    const result = parseSmf(smf(0, 480, track([[0, 0xc0, 5], [0, 0xd0, 90], [0, 0xe0, 0, 64]])))
    expect(timeline(result)).toEqual([[0, 0xc0, 5], [0, 0xd0, 90], [0, 0xe0, 0, 64]])
  })

  it('frames a SysEx with its F0, and keeps meta events off the wire', () => {
    const result = parseSmf(smf(0, 480, track([
      [0, ...name('Piano')],
      [0, 0xf0, 0x05, 0x7e, 0x7f, 0x09, 0x01, 0xf7],
      [0, 0xff, 0x01, 0x04, 0x61, 0x62, 0x63, 0x64],
      [0, ...on(1, 60)]
    ])))
    expect(timeline(result)).toEqual([[0, 0xf0, 0x7e, 0x7f, 0x09, 0x01, 0xf7], [0, 0x90, 60, 100]])
    expect(song(result).tracks[0]).toMatchObject({ name: 'Piano', sysex: 1, meta: 3 })
  })

  it('joins a SysEx sent in packets and sends it whole when its first packet is due', () => {
    const result = parseSmf(smf(0, 480, track([
      [0, 0xf0, 0x03, 0x43, 0x12, 0x00],
      [240, 0xf7, 0x03, 0x01, 0x02, 0xf7],
      [240, ...on(1, 60)]
    ])))
    expect(timeline(result)).toEqual([[0, 0xf0, 0x43, 0x12, 0x00, 0x01, 0x02, 0xf7], [500, 0x90, 60, 100]])
  })

  it('sends the escape form’s bytes exactly as written', () => {
    // A song position pointer, which a file can only carry escaped.
    const result = parseSmf(smf(0, 480, track([[0, 0xf7, 0x03, 0xf2, 0x00, 0x00]])))
    expect(timeline(result)).toEqual([[0, 0xf2, 0x00, 0x00]])
  })

  it('cancels running status after a SysEx or a meta event', () => {
    const result = parseSmf(smf(0, 480, track([[0, 0x90, 60, 100], [0, ...name('x')], [0, 64, 100]])))
    expect(refusal(result)).toBe('running-status-missing')
  })

  it('names each track by its first name, and says which channels each uses', () => {
    const result = parseSmf(smf(1, 480,
      track([[0, ...name('Bass')], [0, ...name('ignored')], [0, ...on(2, 40)], [0, 0xb3, 7, 100]]),
      track([[0, ...on(10, 36)], [0, ...on(10, 38)]])
    ))
    const read = song(result)
    expect(read.tracks.map(t => [t.name, t.channels, t.notes, t.channelEvents])).toEqual([
      ['Bass', [2, 4], 1, 2],
      ['', [10], 2, 2]
    ])
    expect(read.channels).toEqual([2, 4, 10])
    expect(summarizeSmf(read)).not.toHaveProperty('events')
    expect(summarizeSmf(read).eventCount).toBe(4)
  })

  it('stops a track at its End of Track, whatever follows it in the chunk', () => {
    const body = track([[0, ...on(1, 60)]])
    // Bytes after End of Track, inside the chunk's length.
    const padded = [...body.slice(0, 4), ...u32(body.length - 8 + 3), ...body.slice(8), 0x00, 0x90, 0x40]
    const result = parseSmf(Uint8Array.from([...header(0, 1, 480), ...padded]))
    expect(timeline(result)).toEqual([[0, 0x90, 60, 100]])
  })

  it('ends a track with no End of Track at its last event, as players read one', () => {
    const result = parseSmf(smf(0, 480, track([[0, ...on(1, 60)], [480, ...off(1, 60)]], { omit: true })))
    expect(song(result).durationMs).toBe(500)
  })

  it('skips a chunk type it does not know', () => {
    const bytes = [...header(1, 1, 480), ...chunk('XFIH', [1, 2, 3, 4]), ...track([[0, ...on(1, 60)]])]
    expect(timeline(parseSmf(Uint8Array.from(bytes)))).toEqual([[0, 0x90, 60, 100]])
  })

  it('reads the MIDI file inside a RIFF RMID wrapper', () => {
    const inner = [...smf(0, 480, track([[0, ...on(1, 60)]]))]
    const data = [...'data'].map(c => c.charCodeAt(0))
    const le = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
    const body = [...'RMID'].map(c => c.charCodeAt(0)).concat(data, le(inner.length), inner)
    const riff = [...'RIFF'].map(c => c.charCodeAt(0)).concat(le(body.length), body)
    expect(timeline(parseSmf(Uint8Array.from(riff)))).toEqual([[0, 0x90, 60, 100]])
  })
})

describe('refusing a file', () => {
  const good = track([[0, ...on(1, 60)]])

  it('refuses a file larger than the bound before reading any of it', () => {
    expect(refusal(parseSmf(new Uint8Array(SMF_MAX_BYTES + 1)))).toBe('too-large')
  })

  it('refuses bytes that do not begin with a MIDI header', () => {
    expect(refusal(parseSmf(Uint8Array.from([...'RIFF....WAVE'].map(c => c.charCodeAt(0)))))).toBe('not-midi')
    expect(refusal(parseSmf(new Uint8Array(0)))).toBe('not-midi')
  })

  it('refuses a header shorter than the format’s six bytes', () => {
    expect(refusal(parseSmf(Uint8Array.from([...chunk('MThd', [0, 0, 0, 1]), ...good])))).toBe('header-short')
  })

  it('refuses a format the specification does not have', () => {
    expect(refusal(parseSmf(Uint8Array.from([...header(3, 1, 480), ...good])))).toBe('format-unknown')
  })

  it('refuses a format 0 file that declares more than its one track', () => {
    expect(refusal(parseSmf(Uint8Array.from([...header(0, 2, 480), ...good, ...good])))).toBe('format0-tracks')
  })

  it('refuses a file that declares no tracks', () => {
    expect(refusal(parseSmf(Uint8Array.from(header(1, 0, 480))))).toBe('no-tracks')
  })

  it('refuses a file that declares more tracks than the bound', () => {
    expect(refusal(parseSmf(Uint8Array.from([...header(1, 1025, 480), ...good])))).toBe('too-many-tracks')
  })

  it('refuses a timing a file cannot have', () => {
    expect(refusal(parseSmf(smf(0, 0, good)))).toBe('division-invalid')
    expect(refusal(parseSmf(smf(0, ((256 - 23) << 8) | 40, good)))).toBe('division-invalid')
    expect(refusal(parseSmf(smf(0, ((256 - 25) << 8) | 0, good)))).toBe('division-invalid')
  })

  it('refuses a file that ends before the tracks its header declares', () => {
    expect(refusal(parseSmf(Uint8Array.from([...header(1, 2, 480), ...good])))).toBe('tracks-missing')
  })

  it('refuses a track that says it is longer than the file', () => {
    const bytes = [...header(0, 1, 480), ...good]
    bytes[header(0, 1, 480).length + 7] += 10
    expect(refusal(parseSmf(Uint8Array.from(bytes)))).toBe('track-truncated')
  })

  it('refuses an event that runs past the end of its track', () => {
    expect(refusal(parseSmf(smf(0, 480, chunk('MTrk', [0x00, 0x90, 60]))))).toBe('event-truncated')
    expect(refusal(parseSmf(smf(0, 480, chunk('MTrk', [0x00, 0xf0, 0x05, 1, 2]))))).toBe('event-truncated')
  })

  it('refuses a length written in more than four bytes', () => {
    expect(refusal(parseSmf(smf(0, 480, chunk('MTrk', [0x81, 0x80, 0x80, 0x80, 0x00, 0x90, 60, 100]))))).toBe('length-too-long')
  })

  it('refuses data with no status byte before it', () => {
    expect(refusal(parseSmf(smf(0, 480, track([[0, 60, 100]]))))).toBe('running-status-missing')
  })

  it('refuses a status byte a file cannot carry', () => {
    const result = parseSmf(smf(0, 480, track([[0, 0xf4]])))
    expect(refusal(result)).toBe('status-invalid')
    expect(result.ok ? '' : result.error).toContain('0xF4')
  })

  it('refuses a data byte above 127', () => {
    expect(refusal(parseSmf(smf(0, 480, chunk('MTrk', [0x00, 0x90, 60, 0x90]))))).toBe('data-invalid')
  })

  it('refuses a Set Tempo that is not three bytes, or that sets no tempo', () => {
    expect(refusal(parseSmf(smf(0, 480, track([[0, 0xff, 0x51, 0x02, 0x07, 0xa1]]))))).toBe('tempo-invalid')
    expect(refusal(parseSmf(smf(0, 480, track([[0, ...tempo(0)]]))))).toBe('tempo-invalid')
  })

  it('refuses a file with more events than the bound, without reading the rest', () => {
    // Running status keeps each event to three bytes: a delta of 0 and two data bytes.
    const count = SMF_MAX_EVENTS + 1
    const body = new Uint8Array(4 + (count - 1) * 3)
    body.set([0x00, 0x90, 60, 100])
    for (let i = 1; i < count; i++) body.set([0x00, 60, 100], 1 + i * 3)
    const bytes = new Uint8Array(14 + 8 + body.length)
    bytes.set(header(0, 1, 480))
    bytes.set([...chunk('MTrk', []).slice(0, 4), ...u32(body.length)], 14)
    bytes.set(body, 22)
    expect(refusal(parseSmf(bytes))).toBe('too-many-events')
  })

  it('answers every damaged copy of a good file with a song or a refusal, never a throw', () => {
    const original = [...smf(1, 480,
      track([[0, ...name('Conductor')], [0, ...tempo(500_000)], [960, ...tempo(400_000)]]),
      track([[0, 0xb0, 0, 1], [0, 0xc0, 4], [0, ...on(1, 60)], [0, 64, 90], [240, 0xf0, 0x02, 0x10, 0xf7], [240, ...off(1, 60)]])
    )]
    // A fixed sequence of damage, so a failure here is a case that can be read again.
    let seed = 0x2545f491
    const next = (): number => {
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) / 0x100000000
    }
    for (let round = 0; round < 3000; round++) {
      const bytes = [...original]
      const hits = 1 + Math.floor(next() * 4)
      for (let hit = 0; hit < hits; hit++) {
        const at = Math.floor(next() * bytes.length)
        const kind = next()
        if (kind < 0.6) bytes[at] = Math.floor(next() * 256)
        else if (kind < 0.8) bytes.splice(at, 1)
        else bytes.length = at
      }
      const result = parseSmf(Uint8Array.from(bytes))
      expect(typeof result.ok).toBe('boolean')
    }
  })
})
