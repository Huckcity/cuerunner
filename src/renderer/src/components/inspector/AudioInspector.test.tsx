// Picking a file decodes it to read its duration. That decode needs an AudioContext,
// and browsers cap how many a page may hold open, so the failure path has to close it
// too — it used to leak one per file that would not decode.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AudioInspector } from './AudioInspector'
import { useStore } from '../../store'
import { audioPlayer } from '../../engine/AudioPlayer'
import type { AudioCue } from '../../types/cue'

class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static decode: (buffer: ArrayBuffer) => Promise<AudioBuffer> =
    async () => ({ duration: 4 } as AudioBuffer)

  closed = false

  constructor() {
    FakeAudioContext.instances.push(this)
  }

  decodeAudioData(buffer: ArrayBuffer): Promise<AudioBuffer> {
    return FakeAudioContext.decode(buffer)
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

function audioCue(overrides: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1',
    number: '1',
    name: 'Walk-in Music',
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
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    outputs: [{ volume: 1, pan: 0 }],
    loopCount: 0,
    playbackRate: 1,
    trim: 1,
    ...overrides
  }
}

describe('AudioInspector', () => {
  let container: HTMLDivElement
  let root: Root
  let warn: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    FakeAudioContext.instances = []
    FakeAudioContext.decode = async () => ({ duration: 4 } as AudioBuffer)
    ;(globalThis as Record<string, unknown>).AudioContext = FakeAudioContext
    ;(window.winslab.audio.pickFile as unknown as Mock).mockResolvedValue('/shows/walk-in.wav')

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    warn.mockRestore()
    vi.restoreAllMocks()
    useStore.setState({ cues: [] })
  })

  async function show(cue: AudioCue, tab = 'Audio'): Promise<void> {
    useStore.setState({ cues: [cue] })
    await act(async () => { root.render(<AudioInspector cue={cue} tab={tab} />) })
  }

  function resetButton(label: string): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(`button[title="Reset ${label} to default"]`)
    if (!button) throw new Error(`no reset button for ${label}`)
    return button
  }

  it('restores rate and trim to 1x through the player, not just the store', async () => {
    const cue = audioCue({ playbackRate: 2, trim: 0.4 })
    await show(cue)
    const setPlaybackRate = vi.spyOn(audioPlayer, 'setPlaybackRate')
    const setTrim = vi.spyOn(audioPlayer, 'setTrim')

    await act(async () => { resetButton('Rate').click() })
    await act(async () => { resetButton('Trim').click() })

    expect(useStore.getState().cues[0]).toMatchObject({ playbackRate: 1, trim: 1 })
    expect(setPlaybackRate).toHaveBeenCalledWith('a1', 1)
    expect(setTrim).toHaveBeenCalledWith('a1', 1)
  })

  it('restores volume and pan on the cue output through the player', async () => {
    await show(audioCue({ outputs: [{ volume: 0.2, pan: -0.7 }] }))
    const setVolume = vi.spyOn(audioPlayer, 'setVolume')
    const setPan = vi.spyOn(audioPlayer, 'setPan')

    await act(async () => { resetButton('Volume').click() })
    // The panel re-renders from the store after each edit, so feed the updated cue back in.
    await show(useStore.getState().cues[0] as AudioCue)
    await act(async () => { resetButton('Pan').click() })

    expect(useStore.getState().cues[0]).toMatchObject({ outputs: [{ volume: 1, pan: 0 }] })
    expect(setVolume).toHaveBeenCalledWith('a1', 1)
    expect(setPan).toHaveBeenCalledWith('a1', 0)
  })

  it('leaves the Timing resets inert until the field is changed', async () => {
    const cue = audioCue({ startTime: 0, endTime: null })
    await show(cue, 'Timing')

    expect(container.querySelector('button[title="Start time is at its default"]')).toHaveProperty('disabled', true)
    expect(container.querySelector('button[title="End time is at its default"]')).toHaveProperty('disabled', true)
  })

  async function browse(cue: AudioCue): Promise<void> {
    useStore.setState({ cues: [cue] })
    await act(async () => { root.render(<AudioInspector cue={cue} tab="Audio" />) })

    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Browse')!
    await act(async () => { button.click() })
  }

  it('closes the decoding context when the file will not decode', async () => {
    FakeAudioContext.decode = async () => { throw new Error('not an audio file') }
    const cue = audioCue()

    await browse(cue)

    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(FakeAudioContext.instances[0].closed).toBe(true)
    // The file is still selected; only its duration is unknown.
    expect(useStore.getState().cues[0]).toMatchObject({ filePath: '/shows/walk-in.wav', duration: 0 })
  })

  it('closes the decoding context and records the duration of a file that decodes', async () => {
    const cue = audioCue()

    await browse(cue)

    expect(FakeAudioContext.instances[0].closed).toBe(true)
    expect(useStore.getState().cues[0]).toMatchObject({ duration: 4000 })
  })
})
