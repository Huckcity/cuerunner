// The runner's half of a picture cue: what it tells the outputs, what it tells the engine
// for a video's sound, and how the run ends — held to the commands that leave, with the
// outputs and the engine faked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { CueEngine, videoSound } from './CueEngine'
import { audioEngine } from './audioEngineClient'
import { visualCues } from './visualCues'
import type { Cue, FadeCue, StopCue, DevampCue } from '../../../shared/cue'
import type { ImageCue, TextCue, VideoCue } from '../../../shared/visual'
import { defaultGeometry } from '../../../shared/visual'
import type { LayerCommand, OutputEvent } from '../../../shared/ipc/output'
import { DEFAULT_TRIGGER_GUARD } from '../../../shared/workspace'

vi.mock('./scriptHost', () => ({
  scriptHost: { run: vi.fn(), cancel: vi.fn(), cancelAll: vi.fn() },
  ScriptCancelledError: class ScriptCancelledError extends Error {}
}))
vi.mock('./audioEngineClient')
vi.mock('./networkClient', () => ({ network: { request: vi.fn(), cancel: vi.fn() } }))

const engine = vi.mocked(audioEngine)
engine.release = vi.fn(() => Promise.resolve({ ok: true, at: 0, applied: true })) as unknown as typeof engine.release

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

function makeVideo(overrides: Partial<VideoCue> = {}): VideoCue {
  return {
    ...base, ...picture, id: 'v1', number: '1', name: 'Clip', type: 'video', duration: 2000,
    filePath: '/clip.mp4', startTime: 0, endTime: null, loopCount: 0, holdLastFrame: false,
    volume: 1, pan: 0, outputs: null, geometry: defaultGeometry(),
    ...overrides
  }
}

function makeImage(overrides: Partial<ImageCue> = {}): ImageCue {
  return {
    ...base, ...picture, id: 'i1', number: '2', name: 'Still', type: 'image', duration: 0,
    filePath: '/still.png', geometry: defaultGeometry(),
    ...overrides
  }
}

function makeText(overrides: Partial<TextCue> = {}): TextCue {
  return {
    ...base, ...picture, id: 't1', number: '3', name: 'Title', type: 'text', duration: 1500,
    text: 'Act One', fontFamily: 'IBM Plex Sans', fontSize: 96, color: '#ffffff', bold: false, italic: false,
    position: 'center', geometry: defaultGeometry(),
    ...overrides
  }
}

function setup(cues: Cue[]) {
  const runner = new CueEngine()
  let selected: string | null = cues[0]?.id ?? null
  const setRunning = vi.fn()
  const setLastRun = vi.fn()
  const appendLog = vi.fn()
  const syncCueDuration = vi.fn()
  runner.init({
    getCues: () => cues,
    getSelected: () => selected,
    setSelected: (id: string | null) => { selected = id },
    setRunning,
    clearAllRunning: vi.fn(),
    syncCueDuration,
    setLastRun,
    appendLog,
    getWorkspacePath: () => null,
    getMidiDefaultPort: () => '',
    getTriggerGuard: () => DEFAULT_TRIGGER_GUARD,
    isPro: () => true
  })
  runners.push(runner)
  return { runner, setRunning, setLastRun, appendLog, syncCueDuration, select: (id: string) => { selected = id } }
}

const layer = (): Mock => window.cuerunner.output.layer as unknown as Mock

/** The picture commands the runner sent, in order. */
function sent(): LayerCommand[] {
  return layer().mock.calls.map(call => call[0] as LayerCommand)
}

function sentOps(cueId?: string): string[] {
  return sent()
    .filter(command => cueId === undefined || ('cueId' in command ? command.cueId === cueId : 'layer' in command && command.layer.cueId === cueId))
    .map(command => command.op)
}

/** Hands output events to the runner, as the bridge does. */
function hear(events: OutputEvent[]): void {
  visualCues.handle(events)
}

describe('CueEngine — picture cues', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    layer().mockClear()
    layer().mockImplementation(() => Promise.resolve({ ok: true }))
    visualCues.forgetAll()
  })
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks() })

  it('puts an image up at its moment and holds it, its run open until it is stopped', async () => {
    const { runner, setLastRun } = setup([makeImage()])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const play = sent().find(command => command.op === 'play')
    expect(play?.op === 'play' && play.layer.kind).toBe('image')
    expect(play?.op === 'play' && play.layer.src).toBe('cuerunner-media://file/%2Fstill.png')
    expect(play?.op === 'play' && play.layer.displayMs).toBeNull()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(setLastRun).not.toHaveBeenCalled()
    runner.stop('i1')
    expect(sentOps('i1')).toContain('stop')
  })

  it('ends a text cue after its display time, the fade-out landing on that end', async () => {
    const { runner, setLastRun } = setup([makeText({ fadeOutDuration: 500 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const play = sent().find(command => command.op === 'play')
    expect(play?.op === 'play' && play.layer.displayMs).toBe(1500)
    expect(play?.op === 'play' && play.layer.fadeOutMs).toBe(500)
    expect(play?.op === 'play' && play.layer.text?.text).toBe('Act One')
    await vi.advanceTimersByTimeAsync(1600)
    expect(setLastRun).toHaveBeenCalledWith('t1', expect.objectContaining({ outcome: 'success' }))
  })

  it('says a picture cue that has nowhere to go failed, in the output\'s own words', async () => {
    layer().mockImplementation(() => Promise.resolve({ ok: false, error: 'the show has no video output — add one in the Outputs panel' }))
    const { runner, setLastRun, appendLog } = setup([makeImage()])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(setLastRun).toHaveBeenCalledWith('i1', expect.objectContaining({ outcome: 'error', error: expect.stringContaining('no video output') }))
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ level: 'error', message: expect.stringContaining('no video output') })])
  })

  it('starts a video\'s picture and its sound for the same instant, the sound as the cue\'s own voice', async () => {
    const video = makeVideo({ volume: 0.5, pan: -0.25, outputs: [{ inputChannel: 0, outputChannel: 3, gain: 1 }] })
    const { runner } = setup([video])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const play = sent().find(command => command.op === 'play')
    expect(play?.op === 'play' && play.layer.kind).toBe('video')
    expect(engine.start).toHaveBeenCalledTimes(1)
    const [cueId, whenMs, options] = engine.start.mock.calls[0]
    expect(cueId).toBe('v1')
    // One clock: the picture's moment is the sound's.
    expect(play?.op === 'play' && play.layer.at).toBe(whenMs)
    expect(options).toEqual(expect.objectContaining({ volume: 0.5, pan: -0.25, outputs: [{ inputChannel: 0, outputChannel: 3, gain: 1 }], rate: 1 }))
  })

  it('ends a video run with its sound, and holds a last frame until it is stopped', async () => {
    const plain = setup([makeVideo({ id: 'v1', duration: 2000 })])
    plain.runner.go()
    await vi.advanceTimersByTimeAsync(2100)
    expect(plain.setLastRun).toHaveBeenCalledWith('v1', expect.objectContaining({ outcome: 'success' }))

    const held = setup([makeVideo({ id: 'v2', duration: 2000, holdLastFrame: true })])
    held.runner.go()
    await vi.advanceTimersByTimeAsync(5000)
    expect(held.setLastRun).not.toHaveBeenCalledWith('v2', expect.anything())
  })

  it('fades a video\'s sound out onto its end with its picture, and not one that holds its last frame', async () => {
    const { runner } = setup([makeVideo({ duration: 4000, fadeOutDuration: 1000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const play = sent().find(command => command.op === 'play')
    const start = play?.op === 'play' ? play.layer.at : 0
    await vi.advanceTimersByTimeAsync(3000)
    expect(engine.fade).toHaveBeenCalledWith('v1', 'volume', 0, 1000, 'linear', start + 3000)

    engine.fade.mockClear()
    const held = setup([makeVideo({ id: 'v2', duration: 4000, fadeOutDuration: 1000, holdLastFrame: true })])
    held.runner.go()
    await vi.advanceTimersByTimeAsync(5000)
    expect(engine.fade).not.toHaveBeenCalled()
  })

  it('plays a video with no sound as its picture alone, ending where the picture says', async () => {
    engine.prepare.mockRejectedValueOnce(Object.assign(new Error('this video has no sound track'), { code: 'no-audio' }))
    const { runner, setLastRun } = setup([makeVideo({ duration: 0 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.start).not.toHaveBeenCalled()
    expect(setLastRun).not.toHaveBeenCalled()
    // The output measures the file and plays it out.
    hear([{ kind: 'media', cueId: 'v1', outputId: 'o1', durationMs: 1000, width: 64, height: 36 }])
    await vi.advanceTimersByTimeAsync(1100)
    expect(setLastRun).toHaveBeenCalledWith('v1', expect.objectContaining({ outcome: 'success' }))
  })

  it('plays the picture of a video whose sound this machine cannot decode, and says the sound will not', async () => {
    engine.prepare.mockRejectedValueOnce(Object.assign(new Error('no decoder'), { code: 'format-unavailable' }))
    const { runner, setLastRun, appendLog } = setup([makeVideo({ duration: 1000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.start).not.toHaveBeenCalled()
    expect(appendLog).toHaveBeenCalledWith([expect.objectContaining({ level: 'error', message: expect.stringContaining('picture plays silent') })])
    await vi.advanceTimersByTimeAsync(1100)
    expect(setLastRun).toHaveBeenCalledWith('v1', expect.objectContaining({ outcome: 'success' }))
  })

  it('fails a video whose file cannot be read at all', async () => {
    engine.prepare.mockRejectedValueOnce(Object.assign(new Error('file not found'), { code: 'decode' }))
    const { runner, setLastRun } = setup([makeVideo()])
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(setLastRun).toHaveBeenCalledWith('v1', expect.objectContaining({ outcome: 'error', error: 'file not found' }))
  })

  it('takes a picture down with a stop cue\'s fade, and everything with a stop of all', async () => {
    const stopOne: StopCue = { ...base, id: 's1', number: '9', name: 'Stop', type: 'stop', duration: 0, targetCueId: 'i1', fadeOut: true, fadeOutDuration: 750, waitForFade: false }
    const { runner, select } = setup([makeImage(), stopOne])
    runner.go()
    await vi.advanceTimersByTimeAsync(400)
    select('s1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const stop = sent().find(command => command.op === 'stop')
    expect(stop?.op === 'stop' && stop.fadeMs).toBe(750)

    runner.stop()
    expect(sent().at(-1)).toEqual(expect.objectContaining({ op: 'clear', fadeMs: 0 }))
  })

  it('fades a picture\'s opacity with a fade cue, and its sound with the same cue\'s volume', async () => {
    const fadeOpacity: FadeCue = {
      ...base, id: 'f1', number: '5', name: 'Fade', type: 'fade', duration: 1000,
      targetCueId: 'v1', fadeProperty: 'opacity', targetValue: 0.25, curve: 'sCurve', stopTargetWhenDone: false
    }
    const { runner, select } = setup([makeVideo({ duration: 10_000 }), fadeOpacity])
    runner.go()
    await vi.advanceTimersByTimeAsync(400)
    select('f1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    const fade = sent().find(command => command.op === 'fade')
    expect(fade).toEqual(expect.objectContaining({ op: 'fade', cueId: 'v1', to: 0.25, durationMs: 1000, curve: 'sCurve' }))
    expect(engine.fade).not.toHaveBeenCalled()
  })

  it('lets a devamp release a looping video\'s picture with its sound', async () => {
    const devamp: DevampCue = { ...base, id: 'd1', number: '6', name: 'Devamp', type: 'devamp', duration: 0, targetCueId: 'v1' }
    const { runner, select, setLastRun } = setup([makeVideo({ loopCount: -1 }), devamp])
    runner.go()
    await vi.advanceTimersByTimeAsync(400)
    select('d1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    expect(engine.release).toHaveBeenCalledWith('v1')
    expect(sentOps('v1')).toContain('release')
    expect(setLastRun).toHaveBeenCalledWith('d1', expect.objectContaining({ outcome: 'success' }))
  })

  it('pauses a video — picture frozen, sound taken — and resumes it where it stood', async () => {
    const { runner } = setup([makeVideo({ duration: 4000, loopCount: 2 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(1000)
    expect(runner.pauseCue('v1')).toBe(true)
    expect(sentOps('v1')).toContain('pause')
    expect(engine.stop).toHaveBeenCalledWith('v1', 15)
    expect(runner.isPaused('v1')).toBe(true)
    // Paused for a long time: nothing ends, nothing hands on.
    await vi.advanceTimersByTimeAsync(20_000)
    expect(runner.isPaused('v1')).toBe(true)

    engine.start.mockClear()
    expect(runner.resumeCue('v1')).toBe(true)
    expect(sentOps('v1')).toContain('resume')
    await vi.advanceTimersByTimeAsync(10)
    expect(engine.start).toHaveBeenCalledTimes(1)
    const [, , options] = engine.start.mock.calls[0]
    // It stood in its first pass: all three passes are still to play, with no fade over it.
    expect(options).toEqual(expect.objectContaining({ loopCount: 2, fadeInDuration: 0 }))
    await vi.advanceTimersByTimeAsync(10)
    expect(engine.seek).toHaveBeenCalledWith('v1', expect.any(Number))
    const [, position] = engine.seek.mock.calls.at(-1)!
    expect(position).toBeGreaterThanOrEqual(950)
    expect(position).toBeLessThanOrEqual(1100)
  })

  it('stops a cue whose picture a dissolve took, and takes its sound down with the dissolve', async () => {
    const outgoing = makeVideo({ id: 'v1', duration: 60_000 })
    const incoming = makeImage({ id: 'i1', crossfade: true, fadeInDuration: 2000 })
    const { runner, select, setRunning } = setup([outgoing, incoming])
    runner.go()
    await vi.advanceTimersByTimeAsync(400)
    select('i1')
    runner.go()
    await vi.advanceTimersByTimeAsync(50)
    hear([{ kind: 'first-frame', cueId: 'i1', outputId: 'o1', at: Date.now(), outgoing: ['v1'] }])
    expect(engine.fade).toHaveBeenCalledWith('v1', 'volume', 0, 2000, 'linear', expect.any(Number))
    hear([
      { kind: 'gone', cueId: 'v1', outputId: 'o1' },
      { kind: 'dissolved', cueId: 'i1', outputId: 'o1', removed: ['v1'] }
    ])
    expect(engine.stop).toHaveBeenCalledWith('v1', 0)
    expect(setRunning).toHaveBeenCalledWith('v1', null)
  })

  it('answers the timers with the run that has an end and started last', async () => {
    const { runner, select } = setup([makeVideo({ id: 'v1', duration: 5000 }), makeText({ id: 't1', duration: 3000 })])
    runner.go()
    await vi.advanceTimersByTimeAsync(400)
    select('t1')
    runner.go()
    await vi.advanceTimersByTimeAsync(400)
    const ends = runner.runningEnds()
    expect(ends.map(entry => entry.cueId)).toEqual(['t1', 'v1'])
    expect(ends[0].label).toBe('3 · Title')
    expect(ends[0].endAt - ends[0].startAt).toBe(3000)
  })

  it('makes the video\'s sound an audio cue in all but name', () => {
    const sound = videoSound(makeVideo({ startTime: 500, endTime: 1500, loopCount: 3, fadeInDuration: 250 }))
    expect(sound).toEqual(expect.objectContaining({
      id: 'v1', type: 'audio', filePath: '/clip.mp4', startTime: 500, endTime: 1500, loopCount: 3,
      fadeInDuration: 250, playbackRate: 1, trim: 1, trimSilence: false
    }))
  })
})
