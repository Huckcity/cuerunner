// The MIDI file player, driven by hand: a clock that moves only when a case moves it, and a
// sink that writes down every message with the moment it arrived. What each case reads is
// the order and the time of the bytes — the two things an audience hears.

import { describe, expect, it } from 'vitest'
import type { SmfEvent } from '../../shared/smf'
import { MIDI_FILE_IDENTITY_MAP, type MidiFileOptions } from '../../shared/midiFile'
import { MidiFilePlayer, type MidiFileClock, type MidiFileSource } from './midiFilePlayer'

/** A clock that only moves when told, and fires each wake when its moment is passed. */
class FakeClock implements MidiFileClock {
  t = 1000
  /** How late each wake fires after its moment, ms: 0 is a perfect timer. */
  late: () => number = () => 0
  private wakes: { fire: number; wake: () => void; cancelled: boolean; seq: number }[] = []
  private seq = 0

  now(): number {
    return this.t
  }

  wakeAt(atMs: number, wake: () => void): () => void {
    const entry = { fire: Math.max(atMs, this.t) + this.late(), wake, cancelled: false, seq: this.seq++ }
    this.wakes.push(entry)
    return () => { entry.cancelled = true }
  }

  /** Moves the clock on `ms`, firing every wake that falls inside, in order. */
  advance(ms: number): void {
    const end = this.t + ms
    for (;;) {
      const due = this.wakes
        .filter(entry => !entry.cancelled && entry.fire <= end)
        .sort((a, b) => a.fire - b.fire || a.seq - b.seq)[0]
      if (due === undefined) break
      this.wakes.splice(this.wakes.indexOf(due), 1)
      this.t = Math.max(this.t, due.fire)
      due.wake()
    }
    this.t = end
  }

  pending(): number {
    return this.wakes.filter(entry => !entry.cancelled).length
  }
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

function source(durationMs: number, ...timed: [number, ...number[]][]): MidiFileSource {
  const events: SmfEvent[] = timed.map(([ms, ...data]) => ({ ms, track: 0, data }))
  return { events, durationMs }
}

interface Rig {
  clock: FakeClock
  player: MidiFilePlayer
  /** Every message the sink was given, as [ms since the start, …bytes]. */
  sent: number[][]
  ended: string[]
}

function rig(file: MidiFileSource, over: Partial<MidiFileOptions> = {}, sinkFails?: (message: number[]) => boolean): Rig {
  const clock = new FakeClock()
  const origin = clock.t
  const sent: number[][] = []
  const ended: string[] = []
  const player = new MidiFilePlayer({
    source: file,
    options: options(over),
    clock,
    sink: message => {
      if (sinkFails?.(message)) throw new Error('the port went away')
      sent.push([clock.t - origin, ...message])
    },
    onEnd: (state, error) => ended.push(error === null ? state : `${state}: ${error}`)
  })
  return { clock, player, sent, ended }
}

// A short phrase: two notes, a controller between them, a release, and a silent tail.
const phrase = (): MidiFileSource => source(
  1000,
  [0, 0x90, 60, 100],
  [250, 0xb0, 7, 90],
  [500, 0x80, 60, 0],
  [500, 0x90, 64, 100],
  [750, 0x80, 64, 0]
)

describe('playing a file', () => {
  it('sends every message in order, each at its own moment', () => {
    const { clock, player, sent, ended } = rig(phrase())
    player.start()
    clock.advance(2000)
    expect(sent).toEqual([
      [0, 0x90, 60, 100],
      [250, 0xb0, 7, 90],
      [500, 0x80, 60, 0],
      [500, 0x90, 64, 100],
      [750, 0x80, 64, 0],
      // Its end is the file's, after the tail: nothing was left down, and the pedal is lifted
      // on the channel it played on.
      [1000, 0xb0, 64, 0]
    ])
    expect(ended).toEqual(['ended'])
    expect(player.remainingMs()).toBe(0)
  })

  it('does not drift: a late wake makes one message late, not every message after it', () => {
    const many: [number, ...number[]][] = []
    for (let i = 0; i < 400; i++) many.push([i * 10, 0xb0, 1, i % 128])
    const { clock, player, sent } = rig(source(4000, ...many))
    // A timer that is up to 3 ms late, every time: a chain of relative delays would end 400
    // wakes × ~1.5 ms ≈ 600 ms late; scheduling against the anchor ends on time.
    let n = 0
    clock.late = () => [0, 3, 1, 2, 0.5][n++ % 5]
    player.start()
    clock.advance(5000)
    const controllers = sent.filter(message => message[1] === 0xb0 && message[2] === 1)
    expect(controllers).toHaveLength(400)
    controllers.forEach((message, i) => {
      expect(message[0]).toBeGreaterThanOrEqual(i * 10 - 1)
      expect(message[0]).toBeLessThanOrEqual(i * 10 + 3)
    })
  })

  it('plays at the rate it is given, and says the run is that much shorter', () => {
    const { clock, player, sent } = rig(phrase(), { rate: 2 })
    expect(player.totalMs).toBe(500)
    player.start()
    clock.advance(1000)
    expect(sent.map(message => message[0])).toEqual([0, 125, 250, 250, 375, 500])
  })

  it('reads a start offset as played time, so the rate is applied once', () => {
    // At 2x, 250 ms in is half a second into the file: the note at 500 is the next thing.
    const { clock, player, sent } = rig(phrase(), { rate: 2 })
    player.start(250)
    // The controller before the place is chased; the note struck before it is not, and nor is
    // that note's release, since this run never struck it. What is written at the place
    // itself plays at once, in its turn.
    expect(sent).toEqual([[0, 0xb0, 7, 90], [0, 0x90, 64, 100]])
    clock.advance(1000)
    expect(sent[2]).toEqual([125, 0x80, 64, 0])
    expect(player.state).toBe('ended')
  })

  it('applies the channel map and the transposition to what it sends, and releases what it sent', () => {
    const channelMap = [...MIDI_FILE_IDENTITY_MAP]
    channelMap[0] = 3
    const { clock, player, sent } = rig(source(1000, [0, 0x90, 60, 100]), { channelMap, transpose: 5 })
    player.start()
    clock.advance(100)
    player.stop()
    expect(sent).toEqual([[0, 0x92, 65, 100], [100, 0x82, 65, 0], [100, 0xb2, 64, 0]])
  })
})

describe('the region and loops', () => {
  it('plays only between its start and end, with the channels put where the file had them at the start', () => {
    const file = source(
      2000,
      [0, 0xc0, 12],
      [100, 0x90, 50, 100],
      [600, 0x90, 60, 100],
      [900, 0x80, 60, 0],
      [1500, 0x90, 70, 100]
    )
    const { clock, player, sent, ended } = rig(file, { startMs: 500, endMs: 1000 })
    expect(player.totalMs).toBe(500)
    player.start()
    clock.advance(1000)
    expect(sent).toEqual([
      [0, 0xc0, 12],
      [100, 0x90, 60, 100],
      [400, 0x80, 60, 0],
      [500, 0xb0, 64, 0]
    ])
    expect(ended).toEqual(['ended'])
  })

  it('loops the region as often as it is told, each pass from the state the region starts in', () => {
    const file = source(1000, [0, 0xc0, 1], [0, 0x90, 60, 100], [600, 0xc0, 2])
    const { clock, player, sent, ended } = rig(file, { loopCount: 1 })
    expect(player.totalMs).toBe(2000)
    player.start()
    clock.advance(3000)
    expect(sent).toEqual([
      [0, 0xc0, 1],
      [0, 0x90, 60, 100],
      [600, 0xc0, 2],
      // The seam: the held note is released rather than carried into the next pass.
      [1000, 0x80, 60, 0],
      [1000, 0xc0, 1],
      [1000, 0x90, 60, 100],
      [1600, 0xc0, 2],
      [2000, 0x80, 60, 0],
      [2000, 0xb0, 64, 0]
    ])
    expect(ended).toEqual(['ended'])
  })

  it('loops until stopped when told to, and says it has no end', () => {
    const { clock, player, sent } = rig(source(100, [0, 0x90, 60, 100], [50, 0x80, 60, 0]), { loopCount: -1 })
    expect(player.totalMs).toBeNull()
    player.start()
    clock.advance(1000)
    // A pass every 100 ms, the eleventh beginning as the second runs out.
    expect(sent.filter(message => message[1] === 0x90)).toHaveLength(11)
    expect(player.remainingMs()).toBeNull()
    expect(player.state).toBe('playing')
    player.stop()
    expect(clock.pending()).toBe(0)
  })

  it('chases a region that starts past state set in front of it, on the first pass and every loop', () => {
    const file = source(1000, [0, 0xb0, 0, 3], [0, 0xc0, 40], [100, 0xe0, 0, 80], [500, 0x90, 60, 100], [700, 0xc0, 41])
    const { clock, player, sent } = rig(file, { startMs: 400, endMs: 800, loopCount: 1 })
    player.start()
    clock.advance(1000)
    expect(sent).toEqual([
      [0, 0xb0, 0, 3], [0, 0xc0, 40], [0, 0xe0, 0, 80],
      [100, 0x90, 60, 100],
      [300, 0xc0, 41],
      [400, 0x80, 60, 0],
      [400, 0xb0, 0, 3], [400, 0xc0, 40], [400, 0xe0, 0, 80],
      [500, 0x90, 60, 100],
      [700, 0xc0, 41],
      [800, 0x80, 60, 0],
      [800, 0xb0, 64, 0]
    ])
  })
})

describe('pause, resume and seek', () => {
  it('holds the file where it is, silent, and plays on from there when resumed', () => {
    const { clock, player, sent } = rig(phrase())
    player.start()
    clock.advance(300)
    player.pause()
    expect(player.state).toBe('paused')
    // The note that was sounding is released at the pause.
    expect(sent.slice(-1)).toEqual([[300, 0x80, 60, 0]])
    const before = sent.length
    clock.advance(5000)
    expect(sent).toHaveLength(before)
    expect(player.remainingMs()).toBe(700)
    player.resume()
    // The channel goes back where it was, and the file goes on 200 ms later — not at once.
    expect(sent.slice(before)).toEqual([[5300, 0xb0, 7, 90]])
    clock.advance(199)
    expect(sent).toHaveLength(before + 1)
    clock.advance(1)
    // The file's own release of the note the pause already let go is not sent a second time.
    expect(sent.slice(before + 1)).toEqual([[5500, 0x90, 64, 100]])
    clock.advance(1000)
    expect(player.state).toBe('ended')
  })

  it('lifts a pedal it put down when it is paused', () => {
    const { clock, player, sent } = rig(source(1000, [0, 0xb0, 64, 127], [10, 0x90, 60, 100]))
    player.start()
    clock.advance(20)
    player.pause()
    expect(sent.slice(-2)).toEqual([[20, 0x80, 60, 0], [20, 0xb0, 64, 0]])
  })

  it('moves to a place, chasing every channel to it without striking the notes already sounding', () => {
    const file = source(
      2000,
      [0, 0xb0, 0, 1], [0, 0xc0, 20], [0, 0x90, 48, 100],
      [100, 0xb1, 7, 70], [200, 0xe1, 0, 90], [300, 0x91, 55, 100],
      [1000, 0x80, 48, 0], [1000, 0x81, 55, 0], [1500, 0x90, 52, 100]
    )
    const { clock, player, sent } = rig(file)
    player.start()
    clock.advance(50)
    sent.length = 0
    player.seek(1200)
    expect(sent).toEqual([
      // What this run had sounding is released before the jump.
      [50, 0x80, 48, 0],
      // Then each channel, as the file had it at 1200.
      [50, 0xb0, 0, 1], [50, 0xc0, 20],
      [50, 0xb1, 7, 70], [50, 0xe1, 0, 90]
    ])
    clock.advance(300)
    expect(sent.slice(-1)).toEqual([[350, 0x90, 52, 100]])
  })

  it('seeks a held run without waking it, and chases when it resumes', () => {
    const { clock, player, sent } = rig(phrase())
    player.start()
    clock.advance(100)
    player.pause()
    player.seek(600)
    const before = sent.length
    clock.advance(1000)
    expect(sent).toHaveLength(before)
    player.resume()
    expect(sent.slice(before)).toEqual([[1100, 0xb0, 7, 90]])
    clock.advance(400)
    // The note at 500 sounds across the place it moved to and is not struck again, so its
    // release at 750 is not this run's to send; the run ends at the file's end, pedal lifted.
    expect(sent.slice(before)).toEqual([[1100, 0xb0, 7, 90], [1500, 0xb0, 64, 0]])
  })
})

describe('releases', () => {
  it('sends a release only for a note this run struck, so a stray Note Off never reaches the port', () => {
    const file = source(1000, [0, 0x90, 60, 100], [100, 0x80, 60, 0], [200, 0x80, 61, 0], [300, 0x90, 62, 0])
    const { clock, player, sent } = rig(file)
    player.start()
    clock.advance(1000)
    // The release of 60, which it struck, goes; the releases of 61 and 62 — never struck, the
    // second written as a Note On at velocity 0 — do not.
    expect(sent).toEqual([[0, 0x90, 60, 100], [100, 0x80, 60, 0], [1000, 0xb0, 64, 0]])
  })

  it('releases a note struck twice once for each strike, and no more', () => {
    const file = source(1000, [0, 0x90, 60, 100], [10, 0x90, 60, 90], [20, 0x80, 60, 0], [30, 0x80, 60, 0], [40, 0x80, 60, 0])
    const { clock, player, sent } = rig(file)
    player.start()
    clock.advance(1000)
    expect(sent.filter(message => message[1] === 0x80)).toEqual([[20, 0x80, 60, 0], [30, 0x80, 60, 0]])
  })
})

describe('stopping', () => {
  it('releases every note it started, as many times as each was struck, and lifts the pedal on every channel it used', () => {
    const file = source(
      5000,
      [0, 0x90, 60, 100], [0, 0x90, 60, 90], [0, 0x93, 40, 100], [0, 0xb3, 64, 127], [10, 0x95, 70, 100],
      [20, 0x85, 70, 0]
    )
    const { clock, player, sent } = rig(file)
    player.start()
    clock.advance(100)
    sent.length = 0
    player.stop()
    expect(sent).toEqual([
      [100, 0x80, 60, 0], [100, 0x80, 60, 0],
      [100, 0x83, 40, 0],
      [100, 0xb0, 64, 0], [100, 0xb3, 64, 0], [100, 0xb5, 64, 0]
    ])
    expect(player.state).toBe('stopped')
    expect(clock.pending()).toBe(0)
    clock.advance(10_000)
    expect(sent).toHaveLength(6)
  })

  it('says All Notes Off on the channels it used as well, when the stop is a panic', () => {
    const { clock, player, sent } = rig(source(5000, [0, 0x90, 60, 100], [0, 0x92, 60, 100]))
    player.start()
    clock.advance(1)
    sent.length = 0
    player.stop(true)
    expect(sent).toEqual([
      [1, 0x80, 60, 0], [1, 0x82, 60, 0],
      [1, 0xb0, 64, 0], [1, 0xb2, 64, 0],
      [1, 0xb0, 123, 0], [1, 0xb2, 123, 0]
    ])
  })

  it('stops by itself, and says why, when the port stops taking messages', () => {
    let fail = false
    const { clock, player, sent, ended } = rig(phrase(), {}, () => fail)
    player.start()
    clock.advance(300)
    fail = true
    clock.advance(1000)
    expect(player.state).toBe('failed')
    expect(player.error).toBe('the port went away')
    expect(ended).toEqual(['failed: the port went away'])
    expect(sent).toHaveLength(2)
    expect(clock.pending()).toBe(0)
  })

  it('ends at once when started at or past its end', () => {
    const { player, sent, ended } = rig(phrase())
    player.start(5000)
    expect(player.state).toBe('ended')
    expect(ended).toEqual(['ended'])
    expect(sent).toEqual([])
  })
})
