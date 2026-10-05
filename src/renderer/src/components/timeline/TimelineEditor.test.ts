import { describe, expect, it } from 'vitest'
import { fmtTime } from './TimelineEditor'

describe('the timeline\'s times', () => {
  it('reads milliseconds, then tenths, then minutes and whole seconds', () => {
    expect(fmtTime(0)).toBe('0')
    expect(fmtTime(250)).toBe('250ms')
    expect(fmtTime(2000)).toBe('2s')
    expect(fmtTime(2500)).toBe('2.5s')
    expect(fmtTime(90_000)).toBe('1:30')
  })

  it('never writes a sixtieth second', () => {
    // 59.96 s rounds to a minute, and 1:59.6 to two: each used to round inside the part it
    // had already been split into, and read "60s" and "1:60".
    expect(fmtTime(59_960)).toBe('1:00')
    expect(fmtTime(119_600)).toBe('2:00')
    expect(fmtTime(59_940)).toBe('59.9s')
  })
})
