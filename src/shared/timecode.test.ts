import { describe, expect, it } from 'vitest'
import {
  TIMECODE_RATES,
  convertFrames,
  formatFrames,
  formatTimecode,
  framesPerDay,
  framesToMs,
  framesToTimecode,
  isValidTimecode,
  msToFrames,
  normalizeTimecodeSettings,
  parseTimecode,
  parseTimecodeFrames,
  positionAt,
  rateCode,
  rateFromCode,
  rateInfo,
  refineRate,
  timecodeToFrames,
  wrapFrames,
  defaultTimecodeSettings,
  type Timecode,
  type TimecodeReceiverStatus
} from './timecode'

const tc = (hours: number, minutes: number, seconds: number, frames: number): Timecode =>
  ({ hours, minutes, seconds, frames })

describe('drop-frame arithmetic, exhaustively', () => {
  // Every frame of a day, at every rate: the label it reads as is a label the rate has,
  // the label comes back to the same frame, and consecutive frames read as consecutive
  // labels — no label skipped that should not be, none repeated.
  for (const rate of TIMECODE_RATES) {
    it(`round-trips every frame of a day at ${rate}`, () => {
      const day = framesPerDay(rate)
      const info = rateInfo(rate)
      let previous: Timecode | null = null
      for (let n = 0; n < day; n++) {
        const label = framesToTimecode(n, rate)
        if (!isValidTimecode(label, rate)) throw new Error(`frame ${n} reads as invalid ${formatTimecode(label, rate)}`)
        if (timecodeToFrames(label, rate) !== n) throw new Error(`frame ${n} came back as ${timecodeToFrames(label, rate)}`)
        if (previous !== null) {
          // The next label after `previous`: a frame on, carrying into the seconds.
          let { hours, minutes, seconds, frames } = previous
          frames++
          if (frames === info.nominal) { frames = 0; seconds++ }
          if (seconds === 60) { seconds = 0; minutes++ }
          if (minutes === 60) { minutes = 0; hours++ }
          if (info.dropFrame && seconds === 0 && frames === 0 && minutes % 10 !== 0) frames = 2
          if (label.hours !== hours || label.minutes !== minutes || label.seconds !== seconds || label.frames !== frames) {
            throw new Error(`frame ${n} reads as ${formatTimecode(label, rate)} after ${formatTimecode(previous, rate)}`)
          }
        }
        previous = label
      }
      expect(formatTimecode(previous!, rate)).toBe(info.dropFrame ? '23:59:59;29' : `23:59:59:${String(info.nominal - 1)}`)
    })
  }

  it('counts every valid drop-frame label exactly once', () => {
    let labels = 0
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m++) for (let s = 0; s < 60; s++) for (let f = 0; f < 30; f++) {
      if (isValidTimecode(tc(h, m, s, f), '29.97df')) labels++
    }
    expect(labels).toBe(framesPerDay('29.97df'))
  })

  it('skips frames 00 and 01 at the top of every minute but each tenth', () => {
    expect(isValidTimecode(tc(0, 1, 0, 0), '29.97df')).toBe(false)
    expect(isValidTimecode(tc(0, 1, 0, 1), '29.97df')).toBe(false)
    expect(isValidTimecode(tc(0, 1, 0, 2), '29.97df')).toBe(true)
    expect(isValidTimecode(tc(0, 10, 0, 0), '29.97df')).toBe(true)
    expect(isValidTimecode(tc(0, 1, 1, 0), '29.97df')).toBe(true)
    // Non-drop 29.97 keeps every label.
    expect(isValidTimecode(tc(0, 1, 0, 0), '29.97')).toBe(true)
    expect(formatFrames(1799, '29.97df')).toBe('00:00:59;29')
    expect(formatFrames(1800, '29.97df')).toBe('00:01:00;02')
    expect(formatFrames(17982, '29.97df')).toBe('00:10:00;00')
    expect(formatFrames(17981, '29.97df')).toBe('00:09:59;29')
  })

  it('keeps an hour of drop-frame on the wall clock to within a frame', () => {
    const hour = timecodeToFrames(tc(1, 0, 0, 0), '29.97df')
    expect(hour).toBe(107892)
    expect(Math.abs(framesToMs(hour, '29.97df') - 3_600_000)).toBeLessThan(1000 / 29.97)
    // Non-drop drifts: its hour label is 3.6 s late on the wall clock.
    expect(framesToMs(timecodeToFrames(tc(1, 0, 0, 0), '29.97'), '29.97') - 3_600_000).toBeCloseTo(3600, 0)
  })
})

describe('labels', () => {
  it('formats with a semicolon for drop-frame', () => {
    expect(formatTimecode(tc(1, 2, 3, 4), '25')).toBe('01:02:03:04')
    expect(formatTimecode(tc(1, 2, 3, 4), '29.97df')).toBe('01:02:03;04')
  })

  it('parses the separators a keypad and a script use, filling from the right', () => {
    expect(parseTimecode('01:00:00:00', '25')).toEqual(tc(1, 0, 0, 0))
    expect(parseTimecode('01:00:00;00', '29.97df')).toEqual(tc(1, 0, 0, 0))
    expect(parseTimecode('1.2.3.4', '30')).toEqual(tc(1, 2, 3, 4))
    expect(parseTimecode('10:00', '25')).toEqual(tc(0, 0, 10, 0))
    expect(parseTimecode(' 5 ', '25')).toEqual(tc(0, 0, 0, 5))
  })

  it('refuses what the rate does not have', () => {
    expect(parseTimecode('', '25')).toBeNull()
    expect(parseTimecode('00:00:00:25', '25')).toBeNull()
    expect(parseTimecode('00:00:00:24', '24')).toBeNull()
    expect(parseTimecode('24:00:00:00', '25')).toBeNull()
    expect(parseTimecode('00:01:00;00', '29.97df')).toBeNull()
    expect(parseTimecode('1:2:3:4:5', '25')).toBeNull()
    expect(parseTimecode('aa:00', '25')).toBeNull()
    expect(parseTimecode('123:00', '25')).toBeNull()
    expect(parseTimecodeFrames('00:00:01:00', '25')).toBe(25)
  })
})

describe('real time', () => {
  it('converts frames and ms both ways at every rate', () => {
    for (const rate of TIMECODE_RATES) {
      for (const n of [0, 1, 29, 1799, 1800, 17982, 107892, framesPerDay(rate) - 1]) {
        expect(msToFrames(framesToMs(n, rate), rate)).toBe(n)
      }
    }
    expect(framesToMs(25, '25')).toBe(1000)
    expect(framesToMs(30, '29.97')).toBeCloseTo(1001, 6)
    expect(msToFrames(999.9, '25')).toBe(24)
  })

  it('wraps at midnight in both directions', () => {
    expect(wrapFrames(framesPerDay('25'), '25')).toBe(0)
    expect(wrapFrames(-1, '25')).toBe(framesPerDay('25') - 1)
    expect(formatFrames(-1, '29.97df')).toBe('23:59:59;29')
  })

  it('reads one moment at another rate', () => {
    expect(convertFrames(25, '25', '30')).toBe(30)
    expect(convertFrames(30, '30', '30')).toBe(30)
  })
})

describe('rate codes', () => {
  it('maps each rate to the two-bit code MTC and Art-Net carry', () => {
    expect(TIMECODE_RATES.map(rateCode)).toEqual([0, 1, 2, 3, 3])
    expect([0, 1, 2, 3].map(rateFromCode)).toEqual(['24', '25', '29.97df', '30'])
  })

  it('tells 29.97 non-drop from 30 only by measuring', () => {
    expect(refineRate('30', null)).toBe('30')
    expect(refineRate('30', 29.97)).toBe('29.97')
    expect(refineRate('30', 30.001)).toBe('30')
    // A code that is not ambiguous is not second-guessed by a measurement.
    expect(refineRate('25', 29.97)).toBe('25')
  })
})

describe('settings', () => {
  it('holds every field to what it may be', () => {
    expect(normalizeTimecodeSettings(null)).toEqual(defaultTimecodeSettings())
    const odd = normalizeTimecodeSettings({ source: 'radio', holdMs: 99_999, ltcChannel: -3, rate: '23.976', toleranceFrames: 2.6, chase: 'yes' })
    expect(odd.source).toBe('none')
    expect(odd.holdMs).toBe(10_000)
    expect(odd.ltcChannel).toBe(0)
    expect(odd.rate).toBe('auto')
    expect(odd.toleranceFrames).toBe(3)
    expect(odd.chase).toBe(false)
  })
})

describe('positionAt', () => {
  const status = (patch: Partial<TimecodeReceiverStatus>): TimecodeReceiverStatus => ({
    source: 'mtc', state: 'locked', frames: 100, at: 1000, rate: '25', declaredRate: '25',
    measuredFps: null, rateDetected: false, direction: 1, detail: '', ...patch
  })

  it('carries a running clock on at its rate, and leaves a stopped one where it is', () => {
    expect(positionAt(status({}), 2000)).toBe(125)
    expect(positionAt(status({ state: 'freewheel' }), 1400)).toBe(110)
    expect(positionAt(status({ direction: -1 }), 2000)).toBe(75)
    expect(positionAt(status({ state: 'stopped' }), 9000)).toBe(100)
    expect(positionAt(status({ frames: null }), 9000)).toBeNull()
  })
})
