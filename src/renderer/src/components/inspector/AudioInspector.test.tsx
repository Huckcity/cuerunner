// The audio inspector asks the engine what the file and the device are; it never reads
// or decodes media itself. The routing matrix is the operator-facing half of the cue's
// crosspoints.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AudioInspector } from './AudioInspector'
import { useStore } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueEngine } from '../../engine/CueEngine'
import { TEST_LICENSE } from '../../../../test/license'
import type { AudioCue } from '../../../../shared/cue'

vi.mock('../../engine/audioEngineClient')

const engine = vi.mocked(audioEngine)

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
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1,
    ...overrides
  }
}

describe('AudioInspector', () => {
  // The engine answers at 48 kHz (see the audioEngineClient mock); a file at another rate
  // is stated on the cue it applies to rather than silently resampled.
  it('says when the file is not at the rate the engine is mixing at', async () => {
    engine.prepare.mockResolvedValue({
      cueId: 'a1', filePath: '/shows/acetrack-44k.wav', format: 'wav', durationMs: 4000,
      sampleRate: 44100, channels: 2, frames: null, fileBytes: 0,
      streaming: false, cacheHit: false, decodedBytes: 0
    })

    await show(audioCue({ filePath: '/shows/acetrack-44k.wav' }))

    const notice = container.querySelector('.audio-file-rate')
    expect(notice?.textContent).toBe('44.1 kHz file — resampled to 48 kHz')
  })

  it('says nothing about a file that is already at the engine rate', async () => {
    await show(audioCue({ filePath: '/shows/walk-in.wav' }))

    expect(container.querySelector('.audio-file-rate')).toBeNull()
  })

  let container: HTMLDivElement
  let root: Root
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    engine.prepare.mockResolvedValue({
      cueId: 'a1', filePath: '/shows/walk-in.wav', format: 'wav', durationMs: 4000,
      sampleRate: 48000, channels: 4, frames: null, fileBytes: 0,
      streaming: false, cacheHit: false, decodedBytes: 0
    })
    engine.pickFile.mockResolvedValue('/shows/walk-in.wav')
    engine.devices.mockResolvedValue([{
      id: 'default', name: 'Focusrite 18i20', isDefault: true, channels: 8,
      defaultSampleRate: 48000, minSampleRate: 44100, maxSampleRate: 96000,
      sampleRates: [44100, 48000, 96000], formats: ['f32'], exclusive: true
    }])

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
    useStore.setState({
      cues: [],
      audioSettings: { outputDeviceId: 'default' },
      license: { state: 'unlicensed' },
      silenceFailures: {},
      settingsTab: null
    })
  })

  async function show(cue: AudioCue, tab = 'Audio'): Promise<void> {
    useStore.setState({ cues: [cue] })
    await act(async () => { root.render(<AudioInspector cue={cue} tab={tab} />) })
    // The panel loads what the engine knows about the file and the device.
    await act(async () => { await Promise.resolve() })
  }

  function resetButton(label: string): HTMLButtonElement {
    const button = container.querySelector<HTMLButtonElement>(`button[title="Reset ${label} to default"]`)
    if (!button) throw new Error(`no reset button for ${label}`)
    return button
  }

  function setRouting(mode: string): void {
    const select = container.querySelector<HTMLSelectElement>('#routing-mode')!
    select.value = mode
    select.dispatchEvent(new Event('change', { bubbles: true }))
  }

  function crosspointRows(): HTMLDivElement[] {
    return [...container.querySelectorAll<HTMLDivElement>('.routing-row')]
  }

  it('names the file first and puts its folder underneath', async () => {
    await show(audioCue({ filePath: '/Users/sam/Shows/Quixote/audio/walk-in.wav' }))

    const field = container.querySelector<HTMLInputElement>('.audio-file-name')!
    expect(field.value).toBe('walk-in.wav')
    expect(field.title).toBe('/Users/sam/Shows/Quixote/audio/walk-in.wav')
    expect(container.querySelector('.audio-file-folder')?.textContent).toBe('/Users/sam/Shows/Quixote/audio')
  })

  it('reads a Windows path the same way', async () => {
    await show(audioCue({ filePath: 'C:\\Shows\\Quixote\\walk-in.wav' }))

    expect(container.querySelector<HTMLInputElement>('.audio-file-name')!.value).toBe('walk-in.wav')
    expect(container.querySelector('.audio-file-folder')?.textContent).toBe('C:\\Shows\\Quixote')
  })

  it('restores rate and trim to 1x through the runner, not just the store', async () => {
    const cue = audioCue({ playbackRate: 2, trim: 0.4 })
    await show(cue)
    const setLiveParameter = vi.spyOn(cueEngine, 'setLiveParameter')

    await act(async () => { resetButton('Rate').click() })
    await act(async () => { resetButton('Trim').click() })

    expect(useStore.getState().cues[0]).toMatchObject({ playbackRate: 1, trim: 1 })
    expect(setLiveParameter).toHaveBeenCalledWith('a1', 'rate', 1)
    expect(setLiveParameter).toHaveBeenCalledWith('a1', 'trim', 1)
  })

  it('restores master volume and pan through the runner', async () => {
    await show(audioCue({ volume: 0.2, pan: -0.7 }))
    const setLiveParameter = vi.spyOn(cueEngine, 'setLiveParameter')

    await act(async () => { resetButton('Volume').click() })
    // The panel re-renders from the store after each edit, so feed the updated cue back in.
    await show(useStore.getState().cues[0] as AudioCue)
    await act(async () => { resetButton('Pan').click() })

    expect(useStore.getState().cues[0]).toMatchObject({ volume: 1, pan: 0 })
    expect(setLiveParameter).toHaveBeenCalledWith('a1', 'volume', 1)
    expect(setLiveParameter).toHaveBeenCalledWith('a1', 'pan', 0)
  })

  it('leaves the Time & Loops resets inert until the field is changed', async () => {
    const cue = audioCue({ startTime: 0, endTime: null })
    await show(cue, 'Time & Loops')

    expect(container.querySelector('button[title="Start time is at its default"]')).toHaveProperty('disabled', true)
    expect(container.querySelector('button[title="End time is at its default"]')).toHaveProperty('disabled', true)
  })

  // The trim row reads the measurement rather than the file, so what it says differs by
  // which of the two the cue has: a measured cue, one still waiting on the scan, and one
  // whose scan will never answer.
  it('reads the trim as what comes off each end of the file', async () => {
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      trimSilence: true,
      soundRegion: { startMs: 2000, endMs: 8000, durationMs: 11000, silent: false }
    }), 'Time & Loops')

    expect(container.querySelector('.trim-silence-readout')?.textContent)
      .toBe('cuts 2.0s at the head · 3.0s at the tail')
  })

  it('names the ends that carry silence, and says so when neither does', async () => {
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      trimSilence: true,
      soundRegion: { startMs: 0, endMs: 8000, durationMs: 11000, silent: false }
    }), 'Time & Loops')
    expect(container.querySelector('.trim-silence-readout')?.textContent).toBe('cuts 3.0s at the tail')

    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      trimSilence: true,
      soundRegion: { startMs: 0, endMs: 11000, durationMs: 11000, silent: false }
    }), 'Time & Loops')
    expect(container.querySelector('.trim-silence-readout')?.textContent)
      .toBe('no silence at the edges of this file')
  })

  it('says when the region itself sits inside the silence rather than the sound', async () => {
    // The amounts are zero here for the opposite reason to the case above: there is
    // silence, and the region the operator set is entirely inside it. Saying the file has
    // no silence at its edges would be the row misreading its own measurement.
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      trimSilence: true,
      startTime: 0,
      endTime: 1000,
      soundRegion: { startMs: 2000, endMs: 8000, durationMs: 11000, silent: false }
    }), 'Time & Loops')

    expect(container.querySelector('.trim-silence-readout')?.textContent)
      .toBe("the region sits in the file's silence")
  })

  it('says the whole file plays when nothing in it crosses the threshold', async () => {
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      trimSilence: true,
      soundRegion: { startMs: 0, endMs: 11000, durationMs: 11000, silent: true }
    }), 'Time & Loops')

    expect(container.querySelector('.trim-silence-readout')?.textContent)
      .toBe('no sound above -60 dBFS — the whole file plays')
  })

  it('says it is measuring until the file has been scanned', async () => {
    useStore.setState({ license: { state: 'active', license: TEST_LICENSE } })
    await show(audioCue({ filePath: '/shows/walk-in.wav', trimSilence: true }), 'Time & Loops')

    expect(container.querySelector('.trim-silence-readout')?.textContent).toBe('measuring…')
  })

  it('says a file could not be read to measure it', async () => {
    useStore.setState({ silenceFailures: { a1: '/shows/broken.wav' } })
    await show(audioCue({ filePath: '/shows/broken.wav', trimSilence: true }), 'Time & Loops')

    expect(container.querySelector('.trim-silence-readout')?.textContent)
      .toBe('the file could not be read to measure it')
  })

  it('asks the question again after the cue is pointed at another file', async () => {
    useStore.setState({
      license: { state: 'active', license: TEST_LICENSE },
      silenceFailures: { a1: '/shows/broken.wav' }
    })
    await show(audioCue({ filePath: '/shows/walk-in.wav', trimSilence: true }), 'Time & Loops')

    expect(container.querySelector('.trim-silence-readout')?.textContent).toBe('measuring…')
  })

  it('still reads a measured file with the trim off', async () => {
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      soundRegion: { startMs: 2000, endMs: 8000, durationMs: 11000, silent: false }
    }), 'Time & Loops')

    expect(container.querySelector<HTMLInputElement>('#inspector-trim-silence')!.checked).toBe(false)
    expect(container.querySelector('.trim-silence-readout')?.textContent)
      .toBe('measured: cuts 2.0s at the head · 3.0s at the tail (trim is off)')
  })

  it('turns the trim on the cue from the checkbox', async () => {
    useStore.setState({ license: { state: 'active', license: TEST_LICENSE } })
    await show(audioCue({ filePath: '/shows/walk-in.wav' }), 'Time & Loops')

    await act(async () => {
      container.querySelector<HTMLInputElement>('#inspector-trim-silence')!.click()
    })

    expect(useStore.getState().cues[0]).toMatchObject({ trimSilence: true })
  })

  it('trims without a licence, and says nothing about one', async () => {
    await show(audioCue({ filePath: '/shows/walk-in.wav', trimSilence: true }), 'Time & Loops')

    const box = container.querySelector<HTMLInputElement>('#inspector-trim-silence')!
    expect(box.checked).toBe(true)
    expect(box.disabled).toBe(false)
    expect(container.querySelector('.license-hint')).toBeNull()
  })

  async function browse(cue: AudioCue): Promise<void> {
    await show(cue)

    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Browse')!
    await act(async () => { button.click() })
  }

  it('records the duration and channel count the engine reports for a picked file', async () => {
    await browse(audioCue())

    expect(engine.prepare).toHaveBeenCalledWith('a1', '/shows/walk-in.wav')
    expect(useStore.getState().cues[0]).toMatchObject({
      filePath: '/shows/walk-in.wav',
      duration: 4000
    })
  })

  it('keeps the file selected when the engine cannot read it', async () => {
    engine.prepare.mockRejectedValue(new Error('not an audio file'))

    await browse(audioCue())

    // The file is still selected; only its length is unknown.
    expect(useStore.getState().cues[0]).toMatchObject({ filePath: '/shows/walk-in.wav', duration: 0 })
    expect(warn).toHaveBeenCalled()
  })

  it('routes automatically by default, with the file’s channel count in the hint', async () => {
    await show(audioCue({ filePath: '/shows/walk-in.wav' }))

    expect(container.querySelector<HTMLSelectElement>('#routing-mode')!.value).toBe('automatic')
    expect(container.textContent).toContain('This file has 4 channels')
  })

  it('seeds a new matrix from the file and device channels', async () => {
    await show(audioCue({ filePath: '/shows/walk-in.wav' }))

    await act(async () => { setRouting('matrix') })

    expect((useStore.getState().cues[0] as AudioCue).outputs).toEqual([
      { inputChannel: 0, outputChannel: 0, gain: 1 },
      { inputChannel: 1, outputChannel: 1, gain: 1 },
      { inputChannel: 2, outputChannel: 2, gain: 1 },
      { inputChannel: 3, outputChannel: 3, gain: 1 }
    ])
    // The panel renders the cue from the store, so the updated cue goes back in.
    await show(useStore.getState().cues[0] as AudioCue)
    expect(crosspointRows()).toHaveLength(4)
  })

  it('offers every real device channel as an output', async () => {
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      outputs: [{ inputChannel: 0, outputChannel: 0, gain: 1 }]
    }))

    const outputSelect = crosspointRows()[0].querySelectorAll('select')[1]
    expect(outputSelect.querySelectorAll('option')).toHaveLength(8)
  })

  it('adds and removes crosspoints', async () => {
    await show(audioCue({
      filePath: '/shows/walk-in.wav',
      outputs: [{ inputChannel: 0, outputChannel: 0, gain: 1 }]
    }))

    const addButton = [...container.querySelectorAll('button')].find(b => b.textContent === '+ Add crosspoint')!
    await act(async () => { addButton.click() })
    expect((useStore.getState().cues[0] as AudioCue).outputs).toHaveLength(2)

    await show(useStore.getState().cues[0] as AudioCue)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Remove crosspoint 2"]')!.click()
    })
    expect((useStore.getState().cues[0] as AudioCue).outputs).toHaveLength(1)
  })

  it('keeps silent and automatic distinct: an empty list is on purpose', async () => {
    await show(audioCue({ filePath: '/shows/walk-in.wav' }))

    await act(async () => { setRouting('silent') })
    expect((useStore.getState().cues[0] as AudioCue).outputs).toEqual([])

    await show(useStore.getState().cues[0] as AudioCue)
    await act(async () => { setRouting('automatic') })
    expect((useStore.getState().cues[0] as AudioCue).outputs).toBeNull()
  })

  it('tells the runner when the routing of a playing cue changes', async () => {
    await show(audioCue({ filePath: '/shows/walk-in.wav' }))
    const setLiveRouting = vi.spyOn(cueEngine, 'setLiveRouting')

    await act(async () => { setRouting('matrix') })

    expect(setLiveRouting).toHaveBeenCalledWith('a1')
  })
})
