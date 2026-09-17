// The show has to stop when the window cannot ask it to. These are the main-process
// paths that silence the engine on their own: the menu, a dead renderer, and a renderer
// that has gone quiet while something is playing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PlaybackSafety, type PlaybackSafetyState } from './PlaybackSafety'
import { PANIC_FADE_MS } from '../../shared/playback'
import type { PlaybackPanic } from '../../shared/playback'

describe('PlaybackSafety', () => {
  let panics: number[]
  let broadcasts: PlaybackPanic[]
  let playing: boolean
  let safety: PlaybackSafety

  function build(overrides: { timeoutMs?: number; checkMs?: number } = {}): PlaybackSafety {
    return new PlaybackSafety({
      engine: { panic: fadeMs => { panics.push(fadeMs) } },
      isPlaying: () => playing,
      broadcast: panic => { broadcasts.push(panic) },
      ...overrides
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
    panics = []
    broadcasts = []
    playing = false
    safety = build()
  })

  afterEach(() => {
    safety.close()
    vi.useRealTimers()
  })

  it('silences the engine itself, before the renderer is told', () => {
    playing = true

    const panic = safety.panic('menu', 'Panic from the menu')

    expect(panics).toEqual([PANIC_FADE_MS])
    expect(broadcasts).toEqual([panic])
    expect(panic).toMatchObject({ source: 'menu', reason: 'Panic from the menu', fadeMs: 200 })
  })

  it('still panics when the engine call fails, and when the renderer is gone', () => {
    safety = new PlaybackSafety({
      engine: { panic: () => { throw new Error('service not loaded') } },
      isPlaying: () => true,
      broadcast: () => { throw new Error('no window') }
    })

    expect(() => safety.panic('watchdog', 'test')).not.toThrow()
  })

  it('keeps what the engine reported stopping, as evidence the sound actually stopped', async () => {
    safety = new PlaybackSafety({
      engine: { panic: () => Promise.resolve({ ok: true, at: 1, stoppedVoices: 3 }) },
      isPlaying: () => true,
      broadcast: () => {}
    })

    safety.panic('menu', 'test')
    await vi.advanceTimersByTimeAsync(0)

    const state: PlaybackSafetyState = safety.state()
    expect(state.lastStoppedVoices).toBe(3)
  })

  describe('watchdog', () => {
    it('panics when the renderer goes quiet while playback is active', () => {
      playing = true
      safety.noteHeartbeat()

      vi.advanceTimersByTime(2000)
      expect(panics).toEqual([])

      vi.advanceTimersByTime(1500)

      expect(panics).toEqual([PANIC_FADE_MS])
      expect(broadcasts[0].source).toBe('watchdog')
      expect(broadcasts[0].reason).toContain('no heartbeat for')
    })

    it('does not fire while the renderer keeps answering', () => {
      playing = true

      for (let i = 0; i < 10; i++) {
        safety.noteHeartbeat()
        vi.advanceTimersByTime(1000)
      }

      expect(panics).toEqual([])
    })

    it('never panics on an idle desk, however long the renderer is silent', () => {
      playing = false
      safety.noteHeartbeat()

      vi.advanceTimersByTime(60_000)

      expect(panics).toEqual([])
      expect(safety.state().lastPanic).toBeNull()
    })

    it('gives the window time to load before it expects a heartbeat', () => {
      // Playing with no heartbeat yet: the renderer has not loaded, and there is no
      // cue stack for it to have started, so silence here is startup, not a lost show.
      playing = true

      vi.advanceTimersByTime(30_000)

      expect(panics).toEqual([])
    })

    it('panics once, not on every tick, and forgives a renderer that comes back', () => {
      playing = true
      safety.noteHeartbeat()
      vi.advanceTimersByTime(4000)

      expect(panics).toHaveLength(1)

      safety.noteHeartbeat()
      vi.advanceTimersByTime(4000)

      // The heartbeat was late, but it arrived: the latch is cleared, so the watchdog
      // is armed again rather than permanently tripped.
      expect(panics).toHaveLength(2)
    })
  })

  describe('renderer failure', () => {
    it('panics when the renderer process is gone, even with nothing playing', () => {
      playing = false

      safety.noteRendererGone('crashed')

      expect(panics).toEqual([PANIC_FADE_MS])
      expect(broadcasts[0].source).toBe('renderer-crash')
      expect(broadcasts[0].reason).toContain('crashed')
    })

    it('panics when the window stops answering mid-show, and stays quiet when idle', () => {
      playing = false
      safety.noteRendererUnresponsive()
      expect(panics).toEqual([])

      playing = true
      safety.noteRendererUnresponsive()
      expect(panics).toEqual([PANIC_FADE_MS])
      expect(broadcasts[0].source).toBe('renderer-unresponsive')
    })

    it('is not re-armed by its own panic while the renderer is still dead', () => {
      playing = true
      safety.noteHeartbeat()
      safety.noteRendererGone('crashed')

      vi.advanceTimersByTime(10_000)

      expect(panics).toHaveLength(1)
    })
  })

  it('reports what it knows, for the main-process log and the dev harness', () => {
    playing = true
    safety.noteHeartbeat()
    expect(safety.state()).toMatchObject({ playing: true, rendererResponding: true })

    vi.advanceTimersByTime(4000)
    expect(safety.state().rendererResponding).toBe(false)
    expect(safety.state().lastPanic?.source).toBe('watchdog')
  })

  it('stops watching the heartbeat once closed', () => {
    playing = true
    safety.noteHeartbeat()
    safety.close()

    vi.advanceTimersByTime(30_000)

    expect(panics).toEqual([])
  })
})
