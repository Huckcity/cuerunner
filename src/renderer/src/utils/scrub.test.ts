// Where a point on an active cue's bar puts its playhead: in the cue's own region, never past it.
import { describe, it, expect } from 'vitest'
import { scrubbableRegion, scrubPositionMs } from './scrub'

describe('scrubbableRegion', () => {
  it('spans the cue’s in point to its out point, or to the end of its file', () => {
    expect(scrubbableRegion({ startTime: 2000, endTime: 8000, duration: 10_000 })).toEqual({ startMs: 2000, endMs: 8000 })
    expect(scrubbableRegion({ startTime: 0, endTime: null, duration: 10_000 })).toEqual({ startMs: 0, endMs: 10_000 })
  })

  it('has nothing to span for a file nobody has measured', () => {
    expect(scrubbableRegion({ startTime: 0, endTime: null, duration: 0 })).toBeNull()
    expect(scrubbableRegion({ startTime: 5000, endTime: 5000, duration: 9000 })).toBeNull()
  })
})

describe('scrubPositionMs', () => {
  const region = { startMs: 2000, endMs: 12_000 }

  it('maps the bar onto the region', () => {
    expect(scrubPositionMs(region, 0)).toBe(2000)
    expect(scrubPositionMs(region, 0.5)).toBe(7000)
  })

  it('holds the right edge back from the end, so a drag there still plays something', () => {
    expect(scrubPositionMs(region, 1)).toBe(11_750)
    expect(scrubPositionMs({ startMs: 0, endMs: 1000 }, 1)).toBe(900)
  })

  it('clamps a pointer that left the bar', () => {
    expect(scrubPositionMs(region, -0.3)).toBe(2000)
    expect(scrubPositionMs(region, 1.7)).toBe(11_750)
  })
})
