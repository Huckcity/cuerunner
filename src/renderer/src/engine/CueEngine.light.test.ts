// Light cues through the runner: GO resolves the look against the show's rig and hands main
// the slots; a Fade cue and a Stop cue reach a Light cue the way they reach a sound; STOP
// freezes a light mid-fade and PANIC hands the lights the show's own rule. What main does with
// those is the lighting engine's tests' business (src/main/dmx/engine.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import { useStore } from '../store'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import type { Cue, FadeCue, LightCue, StopCue } from '../../../shared/cue'
import { builtinFixtureTypes, defaultLightingSettings } from '../../../shared/dmx'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))
vi.mock('./audioEngineClient')
vi.mock('./networkClient', () => ({ network: { request: vi.fn(), cancel: vi.fn() } }))

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
  vi.useRealTimers()
})

const BASE = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  advance: 'none' as const, isArmed: true, notes: ''
}

function light(overrides: Partial<LightCue> = {}): LightCue {
  return {
    ...BASE, id: 'lx1', number: '1', name: 'Warm wash', type: 'light', duration: 2000,
    look: [
      { target: 'group', id: 'wash', param: 'dimmer', value: 0.8 },
      { target: 'fixture', id: 'par-1', param: 'red', value: 1 }
    ],
    effects: [],
    curve: 'sCurve',
    intensity: 'ltp',
    ...overrides
  }
}

function setup(cues: Cue[], licensed = true): { runner: CueEngine; setLastRun: Mock; appendLog: Mock } {
  const runner = new CueEngine()
  let selected: string | null = cues[0]?.id ?? null
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => selected,
    setSelected: vi.fn((id: string | null) => { selected = id }),
    setRunning: vi.fn(),
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    isPro: () => licensed
  })
  runners.push(runner)
  return { runner, setLastRun, appendLog }
}

const command = (): Mock => vi.mocked(window.cuerunner.show.command)

function sent(action: string): unknown[] {
  return command().mock.calls.filter(call => call[0] === 'dmx' && call[1] === action).map(call => call[2])
}

beforeEach(() => {
  vi.clearAllMocks()
  command().mockResolvedValue({ ok: true })
  // Two pars in a wash: dimmer + RGB at 1/1 and 1/5.
  useStore.setState({
    lighting: {
      ...defaultLightingSettings(),
      types: builtinFixtureTypes(),
      fixtures: [
        { id: 'par-1', name: 'Par 1', typeId: 'builtin:dimmer-rgb', mode: '4 channel', universe: 1, address: 1 },
        { id: 'par-2', name: 'Par 2', typeId: 'builtin:dimmer-rgb', mode: '4 channel', universe: 1, address: 5 }
      ],
      groups: [{ id: 'wash', name: 'Wash', fixtureIds: ['par-1', 'par-2'] }]
    }
  })
})

describe('a Light cue', () => {
  it('hands main its look resolved to slots, and ends when its fade does', async () => {
    vi.useFakeTimers()
    const { runner, setLastRun } = setup([light()])
    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent('go')).toEqual([{
      cueId: 'lx1',
      values: [
        { u: 1, s: 0, f: null, i: true, h: 0, v: 0.8 },
        { u: 1, s: 4, f: null, i: true, h: 0, v: 0.8 },
        { u: 1, s: 1, f: null, i: false, h: 0, v: 1 }
      ],
      fadeMs: 2000,
      curve: 'sCurve',
      htp: false,
      effects: []
    }])
    expect(setLastRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(2000)
    expect(setLastRun).toHaveBeenCalledWith('lx1', expect.objectContaining({ outcome: 'success' }))
  })

  it('spreads an effect across a group’s members, which is a chase', async () => {
    vi.useFakeTimers()
    const { runner } = setup([light({
      look: [],
      effects: [{ target: 'group', id: 'wash', param: 'dimmer', shape: 'square', rate: 2, low: 0, high: 1, spread: 1 }],
      intensity: 'htp'
    })])
    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    const go = sent('go')[0] as { effects: Array<{ s: number; phase: number }>; htp: boolean }
    expect(go.htp).toBe(true)
    expect(go.effects.map(effect => [effect.s, effect.phase])).toEqual([[0, 0], [4, 0.5]])
  })

  it('reports what main refused, on the cue', async () => {
    command().mockResolvedValue({ ok: false, error: 'the lighting reaches more than 64 universes' })
    const { runner, setLastRun, appendLog } = setup([light()])
    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())
    expect(setLastRun).toHaveBeenCalledWith('lx1', expect.objectContaining({
      outcome: 'error', error: 'the lighting reaches more than 64 universes'
    }))
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ level: 'error' })])
  })

  it('is refused without a licence, and main is not asked', async () => {
    const { runner, setLastRun, appendLog } = setup([light()], false)
    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())
    expect(sent('go')).toEqual([])
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ message: 'light cues need Cuerunner Pro' })])
  })
})

describe('the cues that act on a Light cue', () => {
  it('a Fade cue scales the cue’s intensity, and releases it when asked to stop it', async () => {
    vi.useFakeTimers()
    const fade: FadeCue = {
      ...BASE, id: 'f1', number: '2', name: 'Fade wash', type: 'fade', duration: 1500,
      targetCueId: 'lx1', fadeProperty: 'volume', targetValue: 0.25, curve: 'linear', stopTargetWhenDone: true
    }
    const { runner } = setup([fade, light()])
    runner.go()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent('level')).toEqual([{ cueId: 'lx1', level: 0.25, fadeMs: 1500, curve: 'linear' }])
    expect(sent('release')).toEqual([])
    await vi.advanceTimersByTimeAsync(1500)
    expect(sent('release')).toEqual([{ cueId: 'lx1', fadeMs: 0, curve: 'linear' }])
  })

  it('a Stop cue with a fade-out stops the fade and releases what the cue holds over the fade-out', async () => {
    const stop: StopCue = {
      ...BASE, id: 's1', number: '3', name: 'Lights out', type: 'stop', duration: 0,
      targetCueId: 'lx1', fadeOut: true, fadeOutDuration: 3000, waitForFade: false
    }
    const { runner } = setup([stop, light()])
    runner.go()
    await vi.waitFor(() => expect(sent('release')).toHaveLength(1))
    expect(sent('stop')).toEqual([{ cueId: 'lx1' }])
    expect(sent('release')).toEqual([{ cueId: 'lx1', fadeMs: 3000, curve: 'linear' }])
  })

  it('a Stop cue without one leaves the light on where it is', async () => {
    const stop: StopCue = {
      ...BASE, id: 's1', number: '3', name: 'Freeze', type: 'stop', duration: 0,
      targetCueId: 'lx1', fadeOut: false, fadeOutDuration: 0, waitForFade: false
    }
    const { runner, setLastRun } = setup([stop, light()])
    runner.go()
    await vi.waitFor(() => expect(setLastRun).toHaveBeenCalled())
    expect(sent('stop')).toEqual([{ cueId: 'lx1' }])
    expect(sent('release')).toEqual([])
  })

  it('STOP freezes a light mid-fade; PANIC hands the lights the show’s rule', async () => {
    vi.useFakeTimers()
    const { runner } = setup([light()])
    runner.go()
    await vi.advanceTimersByTimeAsync(500)
    runner.stop()
    await vi.advanceTimersByTimeAsync(0)
    expect(sent('stop')).toEqual([{ cueId: 'lx1' }])
    runner.panic()
    await vi.advanceTimersByTimeAsync(0)
    expect(command()).toHaveBeenCalledWith('dmx', 'panic', undefined)
  })
})
