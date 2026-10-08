// The runner's half of round two's pictures: a camera cue's picture and its refusals, a fade
// cue moving a picture's place, and the next GO taking down what is set to go — held to the
// commands that leave for the outputs, with the outputs and the engine faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine } from './CueEngine'
import { visualCues } from './visualCues'
import type { Cue, FadeCue, WaitCue } from '../../../shared/cue'
import type { CameraCue, PictureSettings, TextCue } from '../../../shared/visual'
import { createOutput, defaultGeometry } from '../../../shared/visual'
import type { LayerCommand } from '../../../shared/ipc/output'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))
vi.mock('./audioEngineClient')
vi.mock('./networkClient', () => ({ network: { request: vi.fn(), cancel: vi.fn() } }))

const runners: CueEngine[] = []
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
})

const base = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  advance: 'none' as const, isArmed: true, notes: ''
}
const picture = {
  outputId: '', layer: 1, opacity: 1, fadeInDuration: 0, fadeOutDuration: 0, crossfade: false
}

function makeCamera(overrides: Partial<CameraCue> = {}): CameraCue {
  return {
    ...base, ...picture, id: 'c1', number: '1', name: 'Stage cam', type: 'camera', duration: 0,
    source: 'device', deviceName: 'HD Webcam', url: '', geometry: defaultGeometry(),
    ...overrides
  }
}

function makeText(overrides: Partial<TextCue> = {}): TextCue {
  return {
    ...base, ...picture, id: 't1', number: '2', name: 'Caption', type: 'text', duration: 0,
    text: 'Act One', fontFamily: 'IBM Plex Sans', fontSize: 96, color: '#ffffff', bold: false, italic: false,
    position: 'center', geometry: defaultGeometry(),
    ...overrides
  }
}

function makeFade(overrides: Partial<FadeCue> = {}): FadeCue {
  return {
    ...base, id: 'f1', number: '3', name: 'Move', type: 'fade', duration: 1000, targetCueId: 't1',
    fadeProperty: 'geometry', targetValue: 0, curve: 'sCurve', stopTargetWhenDone: false,
    ...overrides
  }
}

function makeWait(id: string): WaitCue {
  return { ...base, id, number: id, name: id, type: 'wait', duration: 100 }
}

function setup(cues: Cue[], settings: PictureSettings = { stopOnNextGo: false }) {
  const runner = new CueEngine()
  let selected: string | null = cues[0]?.id ?? null
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => selected,
    setSelected: (id: string | null) => { selected = id },
    setRunning: vi.fn(),
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => ({ ...DEFAULT_TRIGGER_GUARD, windowMs: 0 }),
    getPictureSettings: () => settings,
    getVideoOutputs: () => [createOutput('o1', 'Stage')],
    isPro: () => false
  })
  runners.push(runner)
  return { runner, setLastRun, appendLog, select: (id: string) => { selected = id } }
}

const layer = (): Mock => window.cuerunner.output.layer as unknown as Mock
const sent = (): LayerCommand[] => layer().mock.calls.map(call => call[0] as LayerCommand)

describe('CueEngine — round two\'s pictures', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    layer().mockClear()
    layer().mockImplementation(() => Promise.resolve({ ok: true }))
    visualCues.forgetAll()
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('puts a camera\'s live picture up, free, until it is stopped — its device named, never this machine\'s id', async () => {
    const { runner, setLastRun } = setup([makeCamera({ blendMode: 'screen' })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const play = sent().find(command => command.op === 'play')
    expect(play?.op === 'play' && play.layer.kind).toBe('camera')
    expect(play?.op === 'play' && play.layer.camera).toEqual({ source: 'device', deviceId: '', deviceName: 'HD Webcam', url: '' })
    expect(play?.op === 'play' && play.layer.blend).toBe('screen')
    expect(play?.op === 'play' && play.layer.displayMs).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setLastRun).not.toHaveBeenCalled()
    runner.stop('c1')
    expect(sent().some(command => command.op === 'stop' && command.cueId === 'c1')).toBe(true)
  })

  it('refuses a camera with nothing chosen, or an RTSP address, rather than putting up black', async () => {
    for (const cue of [makeCamera({ deviceName: '' }), makeCamera({ source: 'url', url: 'rtsp://cam/1' })]) {
      layer().mockClear()
      const { runner, setLastRun } = setup([cue])
      runner.go()
      await vi.advanceTimersByTimeAsync(50)
      expect(sent().some(command => command.op === 'play')).toBe(false)
      expect(setLastRun).toHaveBeenCalledWith('c1', expect.objectContaining({ outcome: 'error' }))
    }
  })

  it('moves a picture\'s place with a fade cue, on the fade\'s time and curve, and leaves its level alone', async () => {
    const target = { x: 0.25, scale: 0.5 }
    const { runner, select } = setup([makeText(), makeFade({ geometryTarget: target })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    select('f1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const move = sent().find(command => command.op === 'move')
    expect(move).toEqual(expect.objectContaining({ op: 'move', cueId: 't1', to: target, durationMs: 1000, curve: 'sCurve' }))
    expect(sent().some(command => command.op === 'fade')).toBe(false)
  })

  it('moves a picture\'s place and its level together when the fade does both', async () => {
    const { runner, select } = setup([makeText(), makeFade({ fadeProperty: 'opacity', targetValue: 0.4, geometryTarget: { rotation: 90 } })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    select('f1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(sent().map(command => command.op)).toEqual(expect.arrayContaining(['fade', 'move']))
  })

  it('takes a picture set to go down on the next GO, over its fade out, and leaves one that is not', async () => {
    const { runner, select } = setup([
      makeText({ stopOnNextGo: true, fadeOutDuration: 300 }),
      makeText({ id: 't2', number: '4', layer: 2 }),
      makeWait('w1')
    ])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    select('t2')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    // t2's own GO takes t1 down; nothing takes t2 down.
    expect(sent().filter(command => command.op === 'stop')).toEqual([expect.objectContaining({ cueId: 't1', fadeMs: 300 })])
    select('w1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(sent().filter(command => command.op === 'stop').map(command => command.op === 'stop' && command.cueId)).toEqual(['t1'])
  })

  it('follows the show\'s default where the picture leaves it, from a trigger as from the button', async () => {
    const { runner } = setup([makeText(), makeWait('w1')], { stopOnNextGo: true })
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    // A press from a trigger is a GO too.
    runner.goById('w1')
    await vi.advanceTimersByTimeAsync(50)
    expect(sent().filter(command => command.op === 'stop')).toEqual([expect.objectContaining({ cueId: 't1' })])
  })
})
