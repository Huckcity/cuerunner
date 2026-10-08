// The held show clock: while a show is paused the show clock stands still, and when it is let
// go it carries on from where it stood — with the engine's own clock having run on, so a time
// on the show clock maps to an engine time that is the held time later.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AudioEngineClient } from './audioEngineClient'
import type { AudioEngineBridge } from '../../../shared/audio'

function bridge(clockMs: () => number): AudioEngineBridge {
  const fake = {
    clock: vi.fn(async () => ({ clockMs: clockMs(), sessionId: 'session-a' })),
    start: vi.fn(async (cueId: string, startAtMs: number) => ({ cueId, runId: 'r1', state: 'playing', startAtMs })),
    pause: vi.fn(async () => ({ ok: true, at: clockMs(), applied: true })),
    resume: vi.fn(async () => ({ ok: true, at: clockMs(), applied: true })),
    progress: vi.fn(async () => null),
    onEvents: vi.fn(() => () => {})
  } as unknown as AudioEngineBridge
  window.cuerunner.audio = fake
  return fake
}

describe('the held show clock', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('stands still while held, and carries on from there when let go', async () => {
    const start = Date.now()
    bridge(() => 10_000 + (Date.now() - start))
    const client = new AudioEngineClient()
    await client.syncClock()

    vi.advanceTimersByTime(500)
    client.holdClock()
    expect(client.clockHeld()).toBe(true)
    const heldAt = client.nowMs()
    vi.advanceTimersByTime(3000)
    expect(client.nowMs()).toBe(heldAt)

    client.releaseClock()
    expect(client.clockHeld()).toBe(false)
    expect(client.nowMs()).toBeCloseTo(heldAt, 0)
    vi.advanceTimersByTime(200)
    expect(client.nowMs()).toBeCloseTo(heldAt + 200, 0)
  })

  it('sends a time named after the hold as the engine time the held time later', async () => {
    const start = Date.now()
    const fake = bridge(() => 10_000 + (Date.now() - start))
    const client = new AudioEngineClient()
    await client.syncClock()
    const before = client.nowMs()

    client.holdClock()
    vi.advanceTimersByTime(2000)
    client.releaseClock()

    await client.start('a1', before + 100, {
      startTime: 0, endTime: null, loopCount: 0, rate: 1, trim: 1, volume: 1, pan: 0, fadeInDuration: 0, outputs: null
    })
    const [, engineAt] = vi.mocked(fake.start).mock.calls[0]
    // Show time `before + 100` is 100 ms after the hold began; the engine ran 2 s meanwhile.
    expect(engineAt).toBeCloseTo(10_000 + 2100, 0)
  })

  it('takes a hold once and a release once', async () => {
    bridge(() => 1000)
    const client = new AudioEngineClient()
    await client.syncClock()
    client.holdClock()
    const heldAt = client.nowMs()
    vi.advanceTimersByTime(100)
    client.holdClock()
    expect(client.nowMs()).toBe(heldAt)
    client.releaseClock()
    client.releaseClock()
    expect(client.clockHeld()).toBe(false)
  })
})
