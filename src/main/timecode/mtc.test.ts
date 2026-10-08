import { describe, expect, it } from 'vitest'
import {
  MtcClock,
  MtcDecoder,
  decodeFullFrame,
  encodeFullFrame,
  encodeQuarterFrame,
  type MtcSink
} from './mtc'
import { TimecodeFollower } from './follower'
import {
  TIMECODE_RATES,
  framesToTimecode,
  parseTimecodeFrames,
  rateInfo,
  timecodeToFrames,
  type TimecodeRate
} from '../../shared/timecode'

interface Heard {
  running: Array<{ frames: number; rate: TimecodeRate; at: number; direction: 1 | -1 }>
  located: Array<{ frames: number; rate: TimecodeRate; at: number }>
}

function recorder(): { sink: MtcSink; heard: Heard } {
  const heard: Heard = { running: [], located: [] }
  return {
    heard,
    sink: {
      running: (frames, rate, at, direction) => heard.running.push({ frames, rate, at, direction }),
      located: (frames, rate, at) => heard.located.push({ frames, rate, at }),
      alive: () => {}
    }
  }
}

/** The messages of a clock run from `from` for `ms`, each with the moment it was due. */
function runClock(rate: TimecodeRate, from: number, ms: number, stepMs = 1): Array<{ at: number; bytes: number[] }> {
  const clock = new MtcClock(rate, from, 0)
  const out: Array<{ at: number; bytes: number[] }> = []
  for (let now = 0; now <= ms; now += stepMs) {
    for (const bytes of clock.due(now)) out.push({ at: now, bytes })
  }
  return out
}

describe('MTC quarter frames', () => {
  it('round-trips a position through the eight pieces at every rate', () => {
    for (const rate of TIMECODE_RATES) {
      for (const label of ['00:00:00:00', '01:02:03:04', '23:59:58:10', '10:09:00:02']) {
        const frames = parseTimecodeFrames(label, rate)!
        const tc = framesToTimecode(frames, rate)
        const { sink, heard } = recorder()
        const decoder = new MtcDecoder(sink)
        for (let piece = 0; piece < 8; piece++) decoder.message(encodeQuarterFrame(tc, rate, piece), piece)
        expect(heard.running).toHaveLength(1)
        // 29.97 non-drop has no code of its own and is heard as 30; the labels count the same.
        expect(heard.running[0].rate).toBe(rate === '29.97' ? '30' : rate)
        expect(heard.running[0].frames).toBeCloseTo(frames + 1.75, 9)
        expect(heard.running[0].direction).toBe(1)
      }
    }
  })

  it('reports nothing from pieces stitched across a jump', () => {
    const { sink, heard } = recorder()
    const decoder = new MtcDecoder(sink)
    const tc = framesToTimecode(1000, '25')
    for (const piece of [0, 1, 2, 3, 5, 6, 7]) decoder.quarterFrame(encodeQuarterFrame(tc, '25', piece)[1], piece)
    expect(heard.running).toHaveLength(0)
  })

  it('hears a stream running backwards', () => {
    const { sink, heard } = recorder()
    const decoder = new MtcDecoder(sink)
    const tc = framesToTimecode(5000, '30')
    for (let piece = 7; piece >= 0; piece--) decoder.quarterFrame(encodeQuarterFrame(tc, '30', piece)[1], 7 - piece)
    expect(heard.running).toHaveLength(1)
    expect(heard.running[0].direction).toBe(-1)
    expect(heard.running[0].frames).toBeCloseTo(5000 - 0.75, 9)
  })
})

describe('MTC full frame', () => {
  it('round-trips a locate at every rate, with or without its delimiters', () => {
    for (const rate of TIMECODE_RATES) {
      const tc = framesToTimecode(parseTimecodeFrames('17:42:13:05', rate)!, rate)
      const bytes = encodeFullFrame(tc, rate)
      expect(bytes).toHaveLength(10)
      const decoded = decodeFullFrame(bytes)!
      expect(decoded.tc).toEqual(tc)
      expect(decodeFullFrame(bytes.slice(1, -1))!.tc).toEqual(tc)
    }
    // A show control message is SysEx too, and is not a locate.
    expect(decodeFullFrame([0xf0, 0x7f, 0x7f, 0x02, 0x01, 0x01, 0xf7])).toBeNull()
  })

  it('reports a locate and breaks the run of pieces', () => {
    const { sink, heard } = recorder()
    const decoder = new MtcDecoder(sink)
    const tc = framesToTimecode(200, '25')
    for (let piece = 0; piece < 4; piece++) decoder.quarterFrame(encodeQuarterFrame(tc, '25', piece)[1], piece)
    expect(decoder.message(encodeFullFrame(framesToTimecode(900, '25'), '25'), 10)).toBe(true)
    for (let piece = 4; piece < 8; piece++) decoder.quarterFrame(encodeQuarterFrame(tc, '25', piece)[1], piece)
    expect(heard.located).toEqual([{ frames: 900, rate: '25', at: 10 }])
    expect(heard.running).toHaveLength(0)
  })
})

describe('the generator', () => {
  it('sends four pieces a frame, sets starting on even frames, and the decoder follows it', () => {
    for (const rate of TIMECODE_RATES) {
      const start = parseTimecodeFrames('01:00:00:00', rate)! + 1 // an odd frame
      const messages = runClock(rate, start, 2000)
      const fps = rateInfo(rate).fps
      // Four a frame, give or take the one in flight at either end.
      expect(Math.abs(messages.length - (2000 * fps * 4) / 1000)).toBeLessThanOrEqual(2)
      const { sink, heard } = recorder()
      const decoder = new MtcDecoder(sink)
      for (const { at, bytes } of messages) decoder.message(bytes, at)
      expect(heard.running.length).toBeGreaterThan(20)
      for (const report of heard.running) {
        // The position assembled is where the clock is when the eighth piece lands.
        const expected = start + (report.at * fps) / 1000
        expect(Math.abs(report.frames - expected)).toBeLessThan(0.5)
      }
      // The first piece out is piece 4 of the set that began a frame before.
      expect(messages[0].bytes[1] >> 4).toBe(4)
    }
  })

  it('says where it is with a full frame when it was starved, rather than replaying the gap', () => {
    const clock = new MtcClock('25', 100, 0)
    clock.due(0)
    const late = clock.due(1000)
    expect(late[0][0]).toBe(0xf0)
    const located = decodeFullFrame(late[0])!
    expect(timecodeToFrames(located.tc, located.rate)).toBe(125)
    expect(late.length).toBeLessThan(4)
  })
})

describe('following MTC through a dropout', () => {
  function follow(_rate: TimecodeRate, holdMs: number) {
    const follower = new TimecodeFollower('mtc', { rate: 'auto', holdMs, offsetFrames: 0 })
    const decoder = new MtcDecoder({
      running: (frames, declared, at, direction) => follower.running(frames, declared, at, direction),
      located: (frames, declared, at) => follower.located(frames, declared, at),
      alive: at => follower.alive(at)
    })
    return { follower, decoder }
  }

  it('locks, freewheels through a gap shorter than the hold, and relocks', () => {
    const rate: TimecodeRate = '25'
    const { follower, decoder } = follow(rate, 1000)
    const messages = runClock(rate, 90_000, 4000)
    let now = 0
    for (const { at, bytes } of messages) {
      // The cable comes out between 1.5 s and 2.1 s.
      if (at >= 1500 && at < 2100) continue
      decoder.message(bytes, at)
      now = at
      if (at === 1000) expect(follower.state(at)).toBe('locked')
      if (at === 1490) {
        // And carries on past the last message on its own.
        expect(follower.state(1700)).toBe('freewheel')
        const status = follower.status(1700)
        expect(Math.abs(status.frames! - (90_000 + 1.7 * 25))).toBeLessThan(0.5)
      }
    }
    expect(follower.state(now)).toBe('locked')
    expect(Math.abs(follower.status(now).frames! - (90_000 + (now * 25) / 1000))).toBeLessThan(0.5)
  })

  it('calls the stream lost once the hold runs out, and stops the position where it ran out', () => {
    const { follower, decoder } = follow('30', 500)
    for (const { at, bytes } of runClock('30', 0, 1000)) decoder.message(bytes, at)
    expect(follower.state(1150)).toBe('freewheel')
    expect(follower.state(1700)).toBe('lost')
    const a = follower.status(1700).frames!
    const b = follower.status(5000).frames!
    expect(a).toBe(b)
    expect(Math.abs(a - 1.5 * 30)).toBeLessThan(1)
  })

  it('stands still on a locate', () => {
    const { follower, decoder } = follow('25', 1000)
    decoder.message(encodeFullFrame(framesToTimecode(4321, '25'), '25'), 0)
    expect(follower.state(10)).toBe('stopped')
    expect(follower.status(5000).frames).toBe(4321)
  })

  it('measures 29.97 non-drop out of a stream that declares 30', () => {
    const { follower, decoder } = follow('29.97', 1000)
    for (const { at, bytes } of runClock('29.97', 0, 6000)) decoder.message(bytes, at)
    expect(follower.status(6000).declaredRate).toBe('30')
    expect(follower.rate()).toBe('29.97')
    expect(follower.status(6000).rateDetected).toBe(true)

    const thirty = follow('30', 1000)
    for (const { at, bytes } of runClock('30', 0, 6000)) thirty.decoder.message(bytes, at)
    expect(thirty.follower.rate()).toBe('30')
  })

  it('applies the offset to every position it reports', () => {
    const follower = new TimecodeFollower('mtc', { rate: '25', holdMs: 1000, offsetFrames: -250 })
    follower.located(1000, '25', 0)
    expect(follower.status(0).frames).toBe(750)
  })
})
