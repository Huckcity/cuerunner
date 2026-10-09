// A Fade and a Stop that name several cues, groups among them, in either spelling a show can
// carry them in — and an OSC cue that sends several messages, each to its patch or its host.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CueEngine } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import { visualCues } from './visualCues'
import { defaultGeometry, type ImageCue, type TextCue, type VideoCue } from '../../../shared/visual'
import type { AudioCue, Cue, FadeCue, GroupCue, LightCue, OscCue, OscPatch, StopCue, WaitCue } from '../../../shared/cue'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'
import { createCue } from '../utils/cueDefaults'
import type { CueRunResult, RunningCue } from '../store'

vi.mock('./audioEngineClient')

const engine = vi.mocked(audioEngine)
const runners: CueEngine[] = []
afterEach(() => { for (const runner of runners.splice(0)) runner.dispose() })

function setup(cues: Cue[], patches: OscPatch[] = []) {
  const runner = new CueEngine()
  const running = new Map<string, RunningCue>()
  const lastRuns = new Map<string, CueRunResult>()
  runner.init({
    getCues: () => cues,
    getSelected: () => cues[0].id,
    setSelected: vi.fn(),
    setRunning: (id, state) => { if (state === null) running.delete(id); else running.set(id, state) },
    clearAllRunning: () => running.clear(),
    syncCueDuration: vi.fn(),
    setLastRun: (id, result) => { lastRuns.set(id, result) },
    appendLog: vi.fn(),
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    getRunning: () => running,
    isPro: () => true,
    getOscPatches: () => patches
  })
  runners.push(runner)
  return { runner, running, lastRuns }
}

const tone = (id: string, parentId: string | null = null): AudioCue =>
  ({ ...(createCue('audio', id) as AudioCue), id, filePath: `/${id}.wav`, duration: 20_000, parentId })
const wait = (id: string, parentId: string | null = null): WaitCue =>
  ({ ...(createCue('wait', id) as WaitCue), id, duration: 5000, parentId })
const group = (id: string, mode: GroupCue['mode'] = 'timeline'): GroupCue =>
  ({ ...(createCue('group', id) as GroupCue), id, mode })
const fade = (patch: Partial<FadeCue>): FadeCue =>
  ({ ...(createCue('fade', 'f') as FadeCue), id: 'f', duration: 1000, ...patch })
const stop = (patch: Partial<StopCue>): StopCue => {
  const cue = { ...(createCue('stop', 's') as StopCue), id: 's', ...patch }
  if ('targetCueIds' in patch) delete cue.targetCueId
  return cue
}

describe('a fade that names several cues', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('ramps every sound it names together, with one time and curve', () => {
    const { runner } = setup([fade({ targetCueIds: ['a1', 'a2'], targetValue: 0.25 }), tone('a1'), tone('a2')])
    const at = Date.now()
    runner.go()
    expect(engine.fade).toHaveBeenCalledWith('a1', 'volume', 0.25, 1000, 'linear', at)
    expect(engine.fade).toHaveBeenCalledWith('a2', 'volume', 0.25, 1000, 'linear', at)
  })

  it('reaches every sound inside a group it names, however deep', () => {
    const cues: Cue[] = [
      fade({ targetCueIds: ['g'] }),
      group('g'), tone('a1', 'g'), group('h'), wait('w', 'g'),
      { ...group('inner'), parentId: 'g' }, tone('deep', 'inner'),
      tone('outside')
    ]
    const { runner } = setup(cues)
    runner.go()
    const faded = engine.fade.mock.calls.map(call => call[0])
    expect(faded.sort()).toEqual(['a1', 'deep'])
  })

  it('reads a show saved with one target, in the single field, as a list of one', () => {
    const legacy = fade({ targetCueId: 'a1' })
    delete legacy.targetCueIds
    const { runner } = setup([legacy, tone('a1'), tone('a2')])
    runner.go()
    expect(engine.fade.mock.calls.map(call => call[0])).toEqual(['a1'])
  })

  it('moves a light’s intensity and a sound’s level in the same fade', async () => {
    const light = { ...(createCue('light', 'l1') as LightCue), id: 'l1' }
    const command = vi.fn(() => Promise.resolve({ ok: true }))
    ;(window.cuerunner as unknown as { show: { command: typeof command } }).show.command = command
    const { runner } = setup([fade({ targetCueIds: ['a1', 'l1'], targetValue: 0.5 }), tone('a1'), light])
    runner.go()
    expect(engine.fade).toHaveBeenCalledWith('a1', 'volume', 0.5, 1000, 'linear', expect.any(Number))
    expect(engine.fade).not.toHaveBeenCalledWith('l1', expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything())
    expect(command).toHaveBeenCalledWith('dmx', 'level', expect.objectContaining({ cueId: 'l1', level: 0.5 }))
  })

  it('stops each target when it is done, and a group it names whole', async () => {
    const cues: Cue[] = [
      fade({ targetCueIds: ['a1', 'g'], stopTargetWhenDone: true }),
      tone('a1'), group('g', 'sequence'), wait('gw', 'g'), wait('gw2', 'g')
    ]
    const { runner, running } = setup(cues)
    runner.goById('g')
    await vi.advanceTimersByTimeAsync(50)
    runner.goById('f')
    await vi.advanceTimersByTimeAsync(1100)
    expect(engine.stop).toHaveBeenCalledWith('a1', 0)
    // The sequence does not step on to its next child: the group was stopped whole.
    expect(running.has('g')).toBe(false)
    expect(running.has('gw')).toBe(false)
    expect(running.has('gw2')).toBe(false)
  })

  it('takes its time and says so when it names nothing, or only cues the show has lost', async () => {
    const { runner, lastRuns } = setup([fade({ targetCueIds: [] }), fade({ id: 'g2', targetCueIds: ['gone', 'gone2'] })])
    runner.goById('f')
    runner.goById('g2')
    await vi.advanceTimersByTimeAsync(1100)
    expect(lastRuns.get('f')).toMatchObject({ outcome: 'error', error: 'no cue chosen to fade', durationMs: 1000 })
    expect(lastRuns.get('g2')).toMatchObject({ outcome: 'error', error: 'the cues it fades are not in the show' })
  })
})

describe('a stop that names several cues', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('stops every cue it names, with its fade, and leaves the rest playing', async () => {
    const cues: Cue[] = [stop({ targetCueIds: ['a1', 'w1'], fadeOut: true, fadeOutDuration: 800 }), tone('a1'), wait('w1'), tone('a2')]
    const { runner, running, lastRuns } = setup(cues)
    for (const id of ['a1', 'w1', 'a2']) runner.goById(id)
    await vi.advanceTimersByTimeAsync(100)
    runner.goById('s')
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.stop).toHaveBeenCalledWith('a1', 800)
    expect(running.has('w1')).toBe(false)
    expect(engine.stop).not.toHaveBeenCalledWith('a2', expect.anything())
    expect(engine.stopAll).not.toHaveBeenCalled()
    expect(lastRuns.get('s')).toMatchObject({ outcome: 'success' })
  })

  it('stops a group it names before a child it names, so the group does not step on', async () => {
    const cues: Cue[] = [stop({ targetCueIds: ['gw', 'g'] }), group('g', 'sequence'), wait('gw', 'g'), wait('gw2', 'g')]
    const { runner, running } = setup(cues)
    runner.goById('g')
    await vi.advanceTimersByTimeAsync(50)
    runner.goById('s')
    await vi.advanceTimersByTimeAsync(50)
    expect(running.has('gw2')).toBe(false)
    expect(running.has('g')).toBe(false)
  })

  it('reads "all" in the single field as everything, as it always has', async () => {
    const { runner } = setup([stop({}), tone('a1')])
    runner.goById('a1')
    await vi.advanceTimersByTimeAsync(50)
    runner.goById('s')
    expect(engine.stopAll).toHaveBeenCalled()
  })

  it('reads a show saved with one target as a list of one', async () => {
    const { runner, running } = setup([stop({ targetCueId: 'w1' }), wait('w1'), wait('w2')])
    runner.goById('w1')
    runner.goById('w2')
    await vi.advanceTimersByTimeAsync(50)
    runner.goById('s')
    expect(running.has('w1')).toBe(false)
    expect(running.has('w2')).toBe(true)
  })

  it('says how many of its targets are gone, and that an empty list stops nothing', async () => {
    const { runner, lastRuns } = setup([
      stop({ targetCueIds: ['w1', 'gone'] }),
      stop({ id: 's2', targetCueIds: [] }),
      wait('w1')
    ])
    runner.goById('s')
    runner.goById('s2')
    await vi.advanceTimersByTimeAsync(50)
    expect(lastRuns.get('s')).toMatchObject({ outcome: 'error', error: '1 of the cues it stops is not in the show' })
    expect(lastRuns.get('s2')).toMatchObject({ outcome: 'error', error: 'no cue chosen to stop' })
    expect(engine.stopAll).not.toHaveBeenCalled()
  })
})

describe('an OSC cue that sends several messages', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  const send = (): ReturnType<typeof vi.fn> => window.cuerunner.osc.send as unknown as ReturnType<typeof vi.fn>

  it('sends them in order, each to its patch or its own host', async () => {
    const patches: OscPatch[] = [{ id: 'p', name: 'Desk', host: '10.0.0.30', port: 8000 }]
    const osc: OscCue = {
      ...(createCue('osc', '1') as OscCue),
      id: 'o',
      messages: [
        { patchId: 'p', host: '', port: 0, address: '/eos/cue/1/fire', args: [] },
        { patchId: '', host: '10.0.0.40', port: 9000, address: '/video/go', args: [{ type: 'i', value: 3 }] }
      ]
    }
    send().mockClear()
    const { runner, lastRuns } = setup([osc], patches)
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(send().mock.calls.map(call => call[0])).toEqual([
      { host: '10.0.0.30', port: 8000, address: '/eos/cue/1/fire', args: [] },
      { host: '10.0.0.40', port: 9000, address: '/video/go', args: [{ type: 'i', value: 3 }] }
    ])
    expect(lastRuns.get('o')).toMatchObject({ outcome: 'success' })
  })

  it('sends a cue saved with one message on itself, as it always did', async () => {
    const legacy = { ...(createCue('osc', '1') as OscCue), id: 'o', host: '10.0.0.5', port: 7000, address: '/go', args: [] }
    delete legacy.messages
    send().mockClear()
    const { runner } = setup([legacy])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(send().mock.calls.map(call => call[0])).toEqual([{ host: '10.0.0.5', port: 7000, address: '/go', args: [] }])
  })

  it('sends the rest when one fails, and says which one did', async () => {
    const osc: OscCue = {
      ...(createCue('osc', '1') as OscCue),
      id: 'o',
      messages: [
        { patchId: 'deleted', host: '', port: 0, address: '/a', args: [] },
        { patchId: '', host: '10.0.0.40', port: 9000, address: '/b', args: [] }
      ]
    }
    send().mockClear()
    const { runner, lastRuns } = setup([osc])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(send().mock.calls.map(call => call[0].address)).toEqual(['/b'])
    expect(lastRuns.get('o')).toMatchObject({ outcome: 'error', error: 'message 1 (/a): its OSC patch is not in this show' })
  })
})

describe('a fade and a control cue on picture cues', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); vi.restoreAllMocks() })

  const picture = { outputId: '', layer: 1, opacity: 1, fadeInDuration: 0, fadeOutDuration: 0, crossfade: false, geometry: defaultGeometry() }
  const video = (id: string): VideoCue => ({
    ...(createCue('wait', id) as WaitCue), ...picture, id, type: 'video', duration: 10_000, filePath: `/${id}.mp4`,
    startTime: 0, endTime: null, loopCount: 0, holdLastFrame: false, volume: 1, pan: 0, outputs: null
  } as VideoCue)
  const image = (id: string): ImageCue => ({ ...(createCue('wait', id) as WaitCue), ...picture, id, type: 'image', filePath: `/${id}.png` } as ImageCue)
  const text = (id: string): TextCue => ({
    ...(createCue('wait', id) as WaitCue), ...picture, id, type: 'text', text: 'Act One', fontFamily: 'IBM Plex Sans',
    fontSize: 96, color: '#ffffff', bold: false, italic: false, position: 'center'
  } as TextCue)

  it('fades the opacity of every picture it names, a group’s included, and no sound', () => {
    const fadeSpy = vi.spyOn(visualCues, 'fade').mockImplementation(() => {})
    const cues: Cue[] = [
      fade({ targetCueIds: ['v1', 'g'], fadeProperty: 'opacity', targetValue: 0.2 }),
      video('v1'), group('g'), { ...image('i1'), parentId: 'g' }, { ...text('t1'), parentId: 'g' }, tone('a1', 'g')
    ]
    const { runner } = setup(cues)
    runner.go()
    expect(fadeSpy.mock.calls.map(call => call[0]).sort()).toEqual(['i1', 't1', 'v1'])
    expect(engine.fade).not.toHaveBeenCalled()
  })

  it('fades a video’s sound and an audio cue’s together on volume, and leaves images alone', () => {
    const fadeSpy = vi.spyOn(visualCues, 'fade').mockImplementation(() => {})
    const { runner } = setup([fade({ targetCueIds: ['v1', 'a1', 'i1'], targetValue: 0 }), video('v1'), tone('a1'), image('i1')])
    runner.go()
    expect(engine.fade.mock.calls.map(call => call[0]).sort()).toEqual(['a1', 'v1'])
    expect(fadeSpy).not.toHaveBeenCalled()
  })

  it('takes the pictures away when it is done, when it was asked to', async () => {
    const stopSpy = vi.spyOn(visualCues, 'stop').mockImplementation(() => {})
    vi.spyOn(visualCues, 'fade').mockImplementation(() => {})
    const { runner } = setup([fade({ targetCueIds: ['i1', 't1'], fadeProperty: 'opacity', stopTargetWhenDone: true }), image('i1'), text('t1')])
    runner.go()
    await vi.advanceTimersByTimeAsync(1100)
    expect(stopSpy).toHaveBeenCalledWith('i1', 0)
    expect(stopSpy).toHaveBeenCalledWith('t1', 0)
  })

  it('stops several pictures with a stop’s fade-out', async () => {
    const stopSpy = vi.spyOn(visualCues, 'stop').mockImplementation(() => {})
    const { runner } = setup([stop({ targetCueIds: ['i1', 'v1'], fadeOut: true, fadeOutDuration: 700 }), image('i1'), video('v1')])
    runner.goById('s')
    await vi.advanceTimersByTimeAsync(50)
    expect(stopSpy).toHaveBeenCalledWith('i1', 700)
    expect(stopSpy).toHaveBeenCalledWith('v1', 700)
  })

  it('readies a picture on its output when a control cue loads it', async () => {
    const prepareSpy = vi.spyOn(visualCues, 'prepare').mockImplementation(() => {})
    const control = { ...(createCue('control', 'c')), id: 'c', action: 'load', targetCueIds: ['v1', 'i1'], loadToMs: 4000 } as Cue
    const { runner } = setup([control, video('v1'), image('i1')])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(prepareSpy.mock.calls.map(call => call[0].id)).toEqual(['v1', 'i1'])
    expect(runner.loadedOffset('v1')).toBe(4000)
  })
})
