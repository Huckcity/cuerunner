// The runner's half of the audio work: a live input goes out with its absolute time and is
// stopped over its own fade; a cue plays through its patch's slot, with its slices and its
// drawn fade shapes; a devamp can end its target at the end of the pass; and a show-wide
// pause holds a live input with everything else.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import type { AudioCue, ControlCue, Cue, DevampCue, FadeCue, InputCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'
import { resetAudioRoutingSync, syncAudioRouting } from './audioRouting'
import { bakeShape } from '../../../shared/fadeShape'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)
const runners: CueEngine[] = []

function setup(cues: Cue[]): CueEngine {
  const runner = new CueEngine()
  runner.init({
    getCues: () => cues,
    getSelected: () => cues[0]?.id ?? null,
    setSelected: vi.fn(),
    setRunning: vi.fn(),
    clearAllRunning: vi.fn(),
    syncCueDuration: vi.fn(),
    setLastRun: vi.fn(),
    appendLog: vi.fn(),
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD
  })
  runners.push(runner)
  return runner
}

function input(overrides: Partial<InputCue> = {}): InputCue {
  return { ...(createCue('input') as InputCue), id: 'in1', device: 'test:tone', inputChannels: [0, 1], ...overrides }
}

function audio(overrides: Partial<AudioCue> = {}): AudioCue {
  return { ...(createCue('audio') as AudioCue), id: 'a1', filePath: '/song.wav', duration: 6000, ...overrides }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetAudioRoutingSync()
})
afterEach(() => {
  for (const runner of runners.splice(0)) runner.dispose()
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('a live input cue', () => {
  it('goes out with its device, its channels and its level, at its own time', async () => {
    const firedAt = Date.now()
    const runner = setup([input({ volume: 0.7, pan: -0.5, fadeInDuration: 120 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.startInput).toHaveBeenCalledTimes(1)
    const [cueId, at, device, channels, options] = engine.startInput.mock.calls[0]
    expect([cueId, at, device, channels]).toEqual(['in1', firedAt, 'test:tone', [0, 1]])
    expect(options).toMatchObject({ volume: 0.7, pan: -0.5, fadeInDuration: 120, outputs: null })
    expect(options).not.toHaveProperty('patch')
  })

  it('runs until it is stopped, and a stop closes it over its own fade-out', async () => {
    const runner = setup([input({ fadeOutDuration: 300 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(5000)
    expect(engine.stop).not.toHaveBeenCalled()
    runner.stop('in1')
    expect(engine.stop).toHaveBeenCalledWith('in1', 300)
  })

  it('given a length, closes itself at the end of it', async () => {
    const runner = setup([input({ duration: 1000, fadeOutDuration: 200 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(1100)
    expect(engine.stop).toHaveBeenCalledWith('in1', 200)
  })

  it('with no channels chosen says so rather than opening anything', async () => {
    const setLastRun = vi.fn()
    const runner = setup([input({ inputChannels: [] })])
    ;(runner as unknown as { deps: { setLastRun: typeof setLastRun } }).deps.setLastRun = setLastRun
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.startInput).not.toHaveBeenCalled()
    expect(setLastRun).toHaveBeenCalledWith('in1', expect.objectContaining({ outcome: 'error', error: 'no input channels chosen' }))
  })

  it('is held by a show-wide pause and let go on resume', async () => {
    const runner = setup([input()])
    runner.go()
    await vi.advanceTimersByTimeAsync(100)
    runner.pauseAll()
    expect(engine.pause).toHaveBeenCalledWith('in1')
    runner.resumeAll()
    expect(engine.resume).toHaveBeenCalledWith('in1')
  })
})

describe('a cue through a patch, with slices and drawn fades', () => {
  it('plays through the slot its patch is on', async () => {
    await syncAudioRouting({
      outputDeviceId: 'default',
      outputPatches: [
        { id: 'mains', name: 'Mains', deviceId: '', channels: [0, 1], gainDb: 0, muted: false },
        { id: 'fold', name: 'Foldback', deviceId: '', channels: [4, 5], gainDb: -6, muted: false }
      ]
    })
    const runner = setup([audio({ outputPatchId: 'fold' })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.start.mock.calls[0][2]).toMatchObject({ patch: 1 })
  })

  it('plays on the device\'s own channels when its patch is gone', async () => {
    const runner = setup([audio({ outputPatchId: 'nowhere' })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.start.mock.calls[0][2]).not.toHaveProperty('patch')
  })

  it('sends its slices cut to its region, and plans its end from their counts', async () => {
    const runner = setup([audio({ duration: 6000, slices: { markers: [1000, 2000], playCounts: [2, 1, 1] } })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const options = engine.start.mock.calls[0][2]
    expect(options.slices).toEqual([
      { startTime: 0, endTime: 1000, playCount: 2 },
      { startTime: 1000, endTime: 2000, playCount: 1 },
      { startTime: 2000, endTime: 1e12, playCount: 1 }
    ])
    // 1 s twice, 1 s, then 4 s to the end of the file: the run is planned at 7 s.
    const setLastRun = vi.fn()
    ;(runner as unknown as { deps: { setLastRun: typeof setLastRun } }).deps.setLastRun = setLastRun
    await vi.advanceTimersByTimeAsync(6800)
    expect(setLastRun).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(400)
    expect(setLastRun).toHaveBeenCalled()
  })

  it('sends its fade-in\'s shape as the table the engine reads, and its fade-out\'s on the fade', async () => {
    const shape = { kind: 'preset' as const, preset: 'equalPower' as const }
    const runner = setup([audio({ duration: 2000, fadeInDuration: 300, fadeInShape: shape, fadeOutDuration: 500, fadeOutShape: shape })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.start.mock.calls[0][2].fadeInShape).toEqual(bakeShape(shape))
    await vi.advanceTimersByTimeAsync(1600)
    const fade = engine.fade.mock.calls.find(call => call[0] === 'a1' && call[1] === 'volume' && call[2] === 0)
    expect(fade?.[6]).toEqual(bakeShape(shape))
  })

  it('leaves a cue with none of it sending the start it always did', async () => {
    const runner = setup([audio()])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const options = engine.start.mock.calls[0][2]
    expect(Object.keys(options).sort()).toEqual(
      ['endTime', 'fadeInDuration', 'loopCount', 'outputs', 'pan', 'rate', 'startTime', 'trim', 'volume']
    )
  })
})

describe('a fade cue and a devamp cue', () => {
  it('a fade cue with a drawn shape sends its table', async () => {
    const shape = { kind: 'bezier' as const, x1: 0.1, y1: 0.9, x2: 0.3, y2: 1 }
    const fade: FadeCue = { ...(createCue('fade') as FadeCue), id: 'f1', targetCueId: 'a1', targetCueIds: ['a1'], duration: 1000, shape }
    const runner = setup([fade])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const call = engine.fade.mock.calls.find(entry => entry[0] === 'a1')
    expect(call?.[6]).toEqual(bakeShape(shape))
  })

  it('a fade of several targets sends the shape to every sound it moves, a live input among them', async () => {
    const shape = { kind: 'preset' as const, preset: 'exponential' as const }
    const fade: FadeCue = {
      ...(createCue('fade') as FadeCue), id: 'f1', targetCueId: '', targetCueIds: ['a1', 'in1'], duration: 1000, shape
    }
    const runner = setup([fade, audio(), input()])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    for (const id of ['a1', 'in1']) {
      const call = engine.fade.mock.calls.find(entry => entry[0] === id)
      expect(call?.[6], id).toEqual(bakeShape(shape))
    }
  })

  it('a Control cue starts, pauses, resumes and stops a live input', async () => {
    const control = (action: ControlCue['action']): ControlCue =>
      ({ ...(createCue('control') as ControlCue), id: `c-${action}`, action, targetCueIds: ['in1'] })
    const cues: Cue[] = [control('start'), control('pause'), control('resume'), control('stop'), input()]
    const runner = setup(cues)
    runner.goById('c-start')
    await vi.advanceTimersByTimeAsync(100)
    expect(engine.startInput).toHaveBeenCalledTimes(1)
    runner.goById('c-pause')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.pause).toHaveBeenCalledWith('in1')
    runner.goById('c-resume')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.resume).toHaveBeenCalledWith('in1')
    runner.goById('c-stop')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.stop).toHaveBeenCalledWith('in1', 200)
  })

  it('a devamp set to stop ends its target at the end of the pass', async () => {
    const devamp: DevampCue = { ...(createCue('devamp') as DevampCue), id: 'd1', targetCueId: 'a1', devampMode: 'stop' }
    engine.release = vi.fn(() => Promise.resolve({ ok: true as const, at: 0, applied: true })) as unknown as typeof engine.release
    const runner = setup([devamp, audio({ loopCount: -1 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.release).toHaveBeenCalledWith('a1', undefined, undefined, true)
  })
})
