// What the engine and the loaded workspace have to say for themselves: media-memory
// pressure, and a show whose media would not all fit in memory. Both are estimates or
// engine facts, both stay on screen while they last, and neither costs a decode.
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlaybackWarnings } from './PlaybackWarnings'
import { audioEngine } from '../../engine/audioEngineClient'
import type { AudioEngineInfo } from '../../engine/audioEngineClient'
import { useStore } from '../../store'
import type { AudioCue } from '../../types/cue'
import type { AudioProbe } from '../../../../shared/audio'

vi.mock('../../engine/audioEngineClient')

const engine = vi.mocked(audioEngine)
const MB = 1024 * 1024

function audioCue(id: string, filePath: string): AudioCue {
  return {
    id,
    number: id,
    name: id,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    type: 'audio',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

function probe(overrides: Partial<AudioProbe> = {}): AudioProbe {
  return {
    filePath: '/shows/long.wav',
    format: 'wav',
    durationMs: 120_000,
    sampleRate: 48000,
    channels: 2,
    frames: 120_000 * 48,
    fileBytes: 23 * MB,
    decodedBytes: 46 * MB,
    streaming: true,
    resident: false,
    ...overrides
  }
}

describe('PlaybackWarnings', () => {
  let container: HTMLDivElement
  let root: Root
  // The engine's clean answers, captured before any test bends them: a test that sets
  // its own must not decide what the next one sees.
  let cleanInfo: AudioEngineInfo

  beforeAll(async () => {
    cleanInfo = await engine.info()
  })

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    engine.info.mockReset()
    engine.info.mockResolvedValue({ ...cleanInfo, warnings: [] })
    engine.probe.mockReset()
    engine.probe.mockRejectedValue(new Error('not measured in this test'))
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    useStore.setState({ cues: [] })
  })

  async function show(compact = false): Promise<void> {
    await act(async () => { root.render(<PlaybackWarnings compact={compact} />) })
    // The engine is read once on mount, then the workspace's media is measured.
    await act(async () => { await Promise.resolve() })
  }

  async function withEngine(info: Partial<AudioEngineInfo>, warnings: string[] = []): Promise<void> {
    const base = await engine.info()
    engine.info.mockResolvedValue({ ...base, warnings, ...info } as AudioEngineInfo)
  }

  async function withFootprintBudget(): Promise<void> {
    const base = await engine.info()
    engine.info.mockResolvedValue({
      ...base,
      cache: { ...base.cache, limitBytes: 512 * MB, maxFileBytes: 32 * MB }
    } as AudioEngineInfo)
  }

  it('renders nothing while the engine has nothing to say and the show is small', async () => {
    await withFootprintBudget()
    await show()
    expect(container.textContent).toBe('')
  })

  it('shows the engine’s own words while the condition lasts', async () => {
    await withFootprintBudget()
    await withEngine({}, ['media memory pressure: 1.4 GB resident', '3 stream underruns'])
    await show()

    expect(container.textContent).toContain('media memory pressure: 1.4 GB resident')
    expect(container.textContent).toContain('3 stream underruns')
  })

  it('says when the workspace’s media would not be held in memory', async () => {
    await withFootprintBudget()
    engine.probe.mockResolvedValue(probe())
    useStore.setState({ cues: [audioCue('a1', '/shows/long.wav')] })

    await show()

    expect(engine.probe).toHaveBeenCalledWith('/shows/long.wav')
    expect(container.textContent).toContain('above the engine')
    expect(container.textContent).toContain('per-file cache bound')
    expect(container.textContent).toContain('stream from disk')
  })

  it('measures each distinct file once, however many cues point at it', async () => {
    await withFootprintBudget()
    engine.probe.mockResolvedValue(probe())
    useStore.setState({
      cues: [audioCue('a1', '/shows/long.wav'), audioCue('a2', '/shows/long.wav')]
    })

    await show()

    expect(engine.probe).toHaveBeenCalledTimes(1)
  })

  it('puts the workspace first, and keeps the whole list in the tooltip', async () => {
    await withFootprintBudget()
    engine.probe.mockResolvedValue(probe())
    await withEngine({}, ['engine warning one'])
    useStore.setState({ cues: [audioCue('a1', '/shows/long.wav')] })

    await show(true)

    const shown = container.textContent ?? ''
    expect(shown).toContain('stream from disk')
    expect(shown).not.toContain('engine warning one')
    expect(shown).toContain('and 1 more playback warning')
    expect(container.querySelector('.engine-warning')?.getAttribute('title')).toContain('engine warning one')
  })

  it('does not guess at a file the engine cannot measure', async () => {
    await withFootprintBudget()
    engine.probe.mockRejectedValue(new Error('no such file'))
    useStore.setState({ cues: [audioCue('a1', '/shows/gone.wav')] })

    await show()

    expect(container.textContent).toBe('')
  })
})
