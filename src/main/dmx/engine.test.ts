// The lighting state on a fake clock: every call names its own `now`, so a fade is read at
// the millisecond it is meant to be at rather than whenever a timer got round to it.
import { describe, expect, it } from 'vitest'
import { DmxEngine, IDENTIFY_FLASH_MS, PANIC_RELEASE_MS } from './engine'
import type { DmxAddress, DmxValue } from '../../shared/dmx'
import type { DmxGo } from '../../shared/dmxWire'

const DIMMER: DmxAddress = { u: 1, s: 0, f: null, i: true, h: 0 }
const RED: DmxAddress = { u: 1, s: 1, f: null, i: false, h: 0 }
const PAN16: DmxAddress = { u: 1, s: 10, f: 11, i: false, h: 0.5 }
const OTHER_UNIVERSE: DmxAddress = { u: 2, s: 0, f: null, i: true, h: 0 }

function at(address: DmxAddress, v: number): DmxValue {
  return { ...address, v }
}

function go(cueId: string, values: DmxValue[], fadeMs = 0, extra: Partial<DmxGo> = {}): DmxGo {
  return { cueId, values, fadeMs, curve: 'linear', htp: false, effects: [], ...extra }
}

describe('a Light cue’s fade', () => {
  it('moves from where the slot is to where the cue says, on the clock', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)], 1000), 0)
    expect(engine.render(1, 0)[0]).toBe(0)
    expect(engine.render(1, 250)[0]).toBe(64)
    expect(engine.render(1, 500)[0]).toBe(128)
    expect(engine.render(1, 1000)[0]).toBe(255)
    expect(engine.render(1, 5000)[0]).toBe(255)
  })

  it('takes the curve the cue names', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)], 1000, { curve: 'sCurve' }), 0)
    // 3t² − 2t³ at a quarter is 0.15625 of the way.
    expect(engine.render(1, 250)[0]).toBe(Math.round(0.15625 * 255))
  })

  it('writes a 16-bit parameter as a coarse and a fine byte', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(PAN16, 0.25)]), 0)
    const frame = engine.render(1, 0)
    // 0.25 × 65535 = 16383.75 → 16384 = 0x4000.
    expect([frame[10], frame[11]]).toEqual([0x40, 0x00])
  })
})

describe('tracking and latest takes precedence', () => {
  it('keeps what a later cue does not change: a cue that only moves the colour leaves the intensity', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1), at(RED, 1)]), 0)
    engine.go(go('b', [at(RED, 0)]), 10)
    const frame = engine.render(1, 20)
    expect(frame[0]).toBe(255)
    expect(frame[1]).toBe(0)
  })

  it('hands a slot to the newest cue, from wherever the old fade had reached', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)], 1000), 0)
    engine.go(go('b', [at(DIMMER, 0)], 1000), 500)
    // b starts at a's 0.5 and is halfway down at 1000.
    expect(engine.render(1, 1000)[0]).toBe(64)
    expect(engine.render(1, 1500)[0]).toBe(0)
    // a's release reaches nothing: the slot is b's now.
    engine.release('a', 0, 'linear', 1600)
    engine.go(go('c', [at(RED, 1)]), 1600)
    expect(engine.render(1, 1700)[0]).toBe(0)
    expect(engine.holding().sort()).toEqual(['b', 'c'])
  })
})

describe('highest takes precedence for intensity', () => {
  it('shows the highest of every HTP cue and the tracked value', () => {
    const engine = new DmxEngine()
    engine.go(go('base', [at(DIMMER, 0.3)]), 0)
    engine.go(go('a', [at(DIMMER, 0.6)], 0, { htp: true }), 0)
    engine.go(go('b', [at(DIMMER, 0.4)], 0, { htp: true }), 0)
    expect(engine.render(1, 0)[0]).toBe(Math.round(0.6 * 255))
    // Releasing the highest leaves the next highest; releasing both leaves the tracked level.
    engine.release('a', 1000, 'linear', 100)
    expect(engine.render(1, 600)[0]).toBe(Math.round(0.4 * 255))
    engine.release('b', 0, 'linear', 1200)
    engine.tick(1200)
    expect(engine.render(1, 1200)[0]).toBe(Math.round(0.3 * 255))
  })

  it('applies only to intensity: a colour from an HTP cue is still latest takes precedence', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(RED, 0.8)]), 0)
    engine.go(go('b', [at(RED, 0.2)], 0, { htp: true }), 0)
    expect(engine.render(1, 0)[1]).toBe(Math.round(0.2 * 255))
  })
})

describe('stop, release and level', () => {
  it('stops a fade where it is and keeps holding it', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)], 1000), 0)
    engine.stop('a', 500)
    expect(engine.render(1, 2000)[0]).toBe(128)
    expect(engine.holding()).toEqual(['a'])
  })

  it('releases a cue’s slots to their home values over the release time', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1), at(PAN16, 1)]), 0)
    engine.release('a', 1000, 'linear', 0)
    const half = engine.render(1, 500)
    expect(half[0]).toBe(128)
    const done = engine.render(1, 1000)
    expect(done[0]).toBe(0)
    // Pan rests in the middle: 0.5 × 65535 → 32768.
    expect([done[10], done[11]]).toEqual([0x80, 0x00])
    expect(engine.holding()).toEqual([])
  })

  it('scales the intensity a cue set, leaving its colour alone', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 0.8), at(RED, 1)]), 0)
    engine.level('a', 0.5, 1000, 'linear', 0)
    expect(engine.render(1, 500)[0]).toBe(Math.round(0.6 * 255))
    const frame = engine.render(1, 1000)
    expect(frame[0]).toBe(Math.round(0.4 * 255))
    expect(frame[1]).toBe(255)
    // And back up: the level is a share of what the cue set, not of where it is now.
    engine.level('a', 1, 0, 'linear', 1000)
    expect(engine.render(1, 1000)[0]).toBe(Math.round(0.8 * 255))
  })
})

describe('effects', () => {
  it('moves a parameter between its low and high, at its rate', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [], 0, {
      effects: [{ ...DIMMER, shape: 'sine', rate: 1, low: 0, high: 1, phase: 0 }]
    }), 0)
    expect(engine.render(1, 0)[0]).toBe(0)
    // A quarter of a cycle is halfway up the wave, give or take the rounding of a cosine.
    expect(Math.abs(engine.render(1, 250)[0] - 127.5)).toBeLessThanOrEqual(0.5)
    expect(engine.render(1, 500)[0]).toBe(255)
    expect(engine.render(1, 1000)[0]).toBe(0)
  })

  it('chases when each member starts at its own phase', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [], 0, {
      effects: [
        { ...DIMMER, shape: 'square', rate: 1, low: 0, high: 1, phase: 0 },
        { ...RED, shape: 'square', rate: 1, low: 0, high: 1, phase: 0.5 }
      ]
    }), 0)
    const first = engine.render(1, 100)
    expect([first[0], first[1]]).toEqual([255, 0])
    const second = engine.render(1, 600)
    expect([second[0], second[1]]).toEqual([0, 255])
  })

  it('ends when a later cue takes the slot, and freezes when its cue is stopped', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [], 0, { effects: [{ ...DIMMER, shape: 'saw', rate: 1, low: 0, high: 1, phase: 0 }] }), 0)
    engine.stop('a', 500)
    expect(engine.render(1, 900)[0]).toBe(128)
    engine.go(go('a', [], 0, { effects: [{ ...DIMMER, shape: 'saw', rate: 1, low: 0, high: 1, phase: 0 }] }), 1000)
    engine.go(go('b', [at(DIMMER, 0.2)]), 1100)
    expect(engine.render(1, 1700)[0]).toBe(Math.round(0.2 * 255))
  })
})

describe('what a hand puts over the cues', () => {
  it('holds the faders over every cue until they are cleared', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)]), 0)
    engine.program([{ ...at(DIMMER, 0.5), fixtureId: 'f1', param: 'dimmer' }])
    expect(engine.render(1, 0)[0]).toBe(128)
    expect(engine.programmerValues()).toHaveLength(1)
    engine.clearProgrammer()
    expect(engine.render(1, 0)[0]).toBe(255)
  })

  it('flashes an identify on and off, and lets it go when its time is up', () => {
    const engine = new DmxEngine()
    engine.identify([at(DIMMER, 1), at(PAN16, 0.5)], 1000, 0)
    expect(engine.render(1, 0)[0]).toBe(255)
    const off = engine.render(1, IDENTIFY_FLASH_MS)
    expect(off[0]).toBe(0)
    // The head stays pointed through the off half.
    expect(off[10]).toBe(0x80)
    expect(engine.render(1, IDENTIFY_FLASH_MS * 2)[0]).toBe(255)
    engine.tick(1000)
    expect(engine.render(1, 1000)[0]).toBe(0)
  })

  it('blacks out every slot and gives them back unchanged', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1), at(PAN16, 0.25)]), 0)
    engine.setBlackout(true)
    expect([...engine.render(1, 0)].every(byte => byte === 0)).toBe(true)
    engine.setBlackout(false)
    expect(engine.render(1, 0)[0]).toBe(255)
  })

  it('merges a console it listens to, highest takes precedence, under the faders', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 0.5), at(RED, 0.5)]), 0)
    const heard = new Uint8Array(512)
    heard[0] = 200
    heard[1] = 10
    heard[300] = 77
    const merged = engine.render(1, 0, { data: heard, merge: true })
    expect([merged[0], merged[1], merged[300]]).toEqual([200, 128, 77])
    // Watching is not merging.
    expect(engine.render(1, 0, { data: heard, merge: false })[300]).toBe(0)
  })
})

describe('panic', () => {
  it('holds by default: what is moving stops where it is', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)], 1000), 0)
    engine.identify([at(RED, 1)], 5000, 0)
    engine.panic('hold', 500)
    const frame = engine.render(1, 3000)
    expect(frame[0]).toBe(128)
    expect(frame[1]).toBe(0)
  })

  it('releases everything home when the show says so', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)]), 0)
    engine.panic('release', 0)
    expect(engine.render(1, PANIC_RELEASE_MS / 2)[0]).toBe(128)
    expect(engine.render(1, PANIC_RELEASE_MS)[0]).toBe(0)
  })

  it('blacks out when the show says so', () => {
    const engine = new DmxEngine()
    engine.go(go('a', [at(DIMMER, 1)]), 0)
    engine.panic('blackout', 0)
    expect(engine.blackout).toBe(true)
    expect(engine.render(1, 0)[0]).toBe(0)
  })
})

describe('the engine’s bound', () => {
  it('refuses a command that would reach past the universe bound, and applies none of it', () => {
    const engine = new DmxEngine()
    const values = Array.from({ length: 64 }, (_, index) => at({ ...DIMMER, u: index + 1 }, 1))
    engine.go(go('a', values), 0)
    expect(() => engine.go(go('b', [at({ ...DIMMER, u: 65 }, 1), at(OTHER_UNIVERSE, 0)]), 0)).toThrow(/64 universes/)
    expect(engine.render(2, 0)[0]).toBe(255)
    expect(engine.universes()).toHaveLength(64)
  })
})
