// The panel's idea of how long the file is, while it has no envelope to read it from: one
// is on its way, or the file could not be read. The length it falls back on is the cue's
// own, in the cue's own unit — and never the last file's.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { WaveformPanel } from './WaveformPanel'
import { useStore } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { createCue } from '../../utils/cueDefaults'
import type { AudioCue } from '../../../../shared/cue'

vi.mock('../../engine/audioEngineClient')
// jsdom has no canvas to draw on, and what is drawn is not what is on trial.
vi.mock('../../utils/waveform', async importOriginal => ({
  ...(await importOriginal<typeof import('../../utils/waveform')>()),
  drawWaveform: vi.fn(() => ({ handles: { start: null, end: null } }))
}))
vi.mock('../layout/PlaybackWarnings', () => ({ PlaybackWarnings: () => null }))

const engine = vi.mocked(audioEngine)

function audio(id: string, filePath: string, duration: number): AudioCue {
  return { ...(createCue('audio') as AudioCue), id, filePath, duration }
}

/** The engine's envelope for a file of this length. */
function envelope(filePath: string, durationMs: number) {
  return {
    filePath, buckets: 2, values: [0, 0.5, 0, 0.5], durationMs, startMs: 0, endMs: durationMs,
    sampleRate: 48000, channels: 2, truncated: false, sampled: false
  }
}

describe('WaveformPanel — the length it works from', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('ResizeObserver', class { observe(): void {} disconnect(): void {} })
    HTMLElement.prototype.setPointerCapture = () => {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    // A verb the client's hand-written mock does not carry: named here, with nothing to say.
    engine.onsets = vi.fn(async () => ({ onsetsMs: [] })) as unknown as typeof engine.onsets
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const total = (): string | null => container.querySelector('.waveform-total')?.textContent ?? null

  it('reads the cue it is showing, not the file before it, while the envelope is on its way', async () => {
    const first = audio('a', '/shows/overture.wav', 10_000)
    const second = audio('b', '/shows/sting.wav', 4_000)
    useStore.setState({ cues: [first, second], selectedId: 'a', selectedIds: ['a'], waveformCursor: null })
    engine.waveform.mockResolvedValueOnce(envelope(first.filePath, 10_000) as never)
    await act(async () => { root.render(<WaveformPanel />) })
    await act(async () => { await vi.waitFor(() => expect(engine.waveform).toHaveBeenCalledTimes(1)) })
    expect(total()).toBe('0:10.0')

    // The next cue's envelope has not answered: what the header says is that cue's length.
    engine.waveform.mockReturnValue(new Promise(() => {}) as never)
    await act(async () => { useStore.setState({ selectedId: 'b', selectedIds: ['b'] }) })
    expect(total()).toBe('0:04.0')
  })

  it('places a press against the cue\'s own length when the file could not be read', async () => {
    const cue = audio('a', '/shows/gone.wav', 4_000)
    useStore.setState({ cues: [cue], selectedId: 'a', selectedIds: ['a'], waveformCursor: null })
    engine.waveform.mockRejectedValue(new Error('decode'))
    await act(async () => { root.render(<WaveformPanel />) })
    await act(async () => { await vi.waitFor(() => expect(engine.waveform).toHaveBeenCalled()) })

    const canvas = container.querySelector<HTMLCanvasElement>('.waveform-canvas')!
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50, x: 0, y: 0, toJSON: () => ({}) })
    act(() => {
      canvas.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 50, clientY: 10 }))
    })

    // Half-way across a four-second cue is two seconds in — not two thousand.
    expect(useStore.getState().waveformCursor).toEqual({ cueId: 'a', ms: 2_000 })
  })
})

describe('WaveformPanel — slices on the waveform', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    // The panel is measured once, at 800 px, and the slices are placed against that.
    vi.stubGlobal('ResizeObserver', class {
      constructor(private readonly callback: () => void) {}
      observe(): void { this.callback() }
      disconnect(): void {}
    })
    // A frame is a timer here: the playhead's loop runs on frames.
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16) as unknown as number)
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle))
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { left: 0, top: 0, width: 800, height: 80, right: 800, bottom: 80, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)
    HTMLElement.prototype.setPointerCapture = () => {}
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    engine.onsets = vi.fn(async () => ({ onsetsMs: [] })) as unknown as typeof engine.onsets
    engine.waveform.mockResolvedValue(envelope('/shows/track.wav', 4_000) as never)
    engine.getProgress.mockReturnValue(null)
    useStore.getState().endSliceDrag()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  async function show(cue: AudioCue): Promise<void> {
    useStore.setState({
      cues: [cue], selectedId: cue.id, selectedIds: [cue.id], waveformCursor: null,
      selectedSliceMarker: null, running: new Map(), past: [], future: []
    })
    await act(async () => { root.render(<WaveformPanel />) })
    await act(async () => { await vi.waitFor(() => expect(engine.waveform).toHaveBeenCalled()) })
  }

  /** A few frames of the playhead's loop, with what they set drawn. */
  const frames = (): Promise<void> => act(async () => { await new Promise(resolve => setTimeout(resolve, 80)) })

  const sliced = (slices: AudioCue['slices']): AudioCue => ({ ...audio('a', '/shows/track.wav', 4_000), slices })
  const texts = (selector: string): string[] =>
    [...container.querySelectorAll(selector)].map(node => node.textContent ?? '')

  it('draws a line and a grip for every marker, and a region saying its count for every piece', async () => {
    await show(sliced({ markers: [1000, 2000, 3000], playCounts: [1, -1, 0, 2] }))
    expect(container.querySelectorAll('.slice-marker')).toHaveLength(3)
    expect(container.querySelectorAll('.slice-marker-grip[role="slider"]')).toHaveLength(3)
    expect(texts('.slice-region-count')).toEqual(['×1', '∞', 'skip', '×2'])
    // A quarter of the file is a quarter of the width: 200 px a second.
    const lefts = [...container.querySelectorAll<HTMLElement>('.slice-marker')].map(node => node.style.left)
    expect(lefts).toEqual(['200px', '400px', '600px'])
    expect(container.querySelector('.slice-region[data-piece="1"]')?.getAttribute('aria-label'))
      .toBe('Slice 2 of 4, 0:01.00 to 0:02.00, vamps until a devamp')
  })

  it('keeps Space for GO on a focused slice: the press does not also open its chooser', async () => {
    await show(sliced({ markers: [1000], playCounts: [1, 1] }))
    const region = container.querySelector<HTMLElement>('.slice-region')!
    const press = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true })
    let reachedWindow = false
    const onWindow = (): void => { reachedWindow = true }
    window.addEventListener('keydown', onWindow)
    act(() => { region.dispatchEvent(press) })
    window.removeEventListener('keydown', onWindow)
    expect(press.defaultPrevented).toBe(true)
    expect(reachedWindow).toBe(true)
  })

  it('has no lane for a cue without slices', async () => {
    await show(audio('a', '/shows/track.wav', 4_000))
    expect(container.querySelector('.slice-lane')).toBeNull()
    expect(container.querySelector('.waveform-stage')?.getAttribute('data-lane')).toBe('false')
  })

  it('adds a marker at the cursor with M, as one edit', async () => {
    await show(audio('a', '/shows/track.wav', 4_000))
    act(() => { useStore.getState().setWaveformCursor('a', 1500) })
    const stage = container.querySelector<HTMLElement>('.waveform-stage')!
    await act(async () => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))
    })
    const cue = useStore.getState().cues[0] as AudioCue
    expect(cue.slices).toEqual({ markers: [1500], playCounts: [1, 1] })
    expect(useStore.getState().past).toHaveLength(1)
    expect(container.querySelectorAll('.slice-marker')).toHaveLength(1)
  })

  it('takes the selected marker out with Delete, and says which count the joined piece kept', async () => {
    await show(sliced({ markers: [1000, 2000], playCounts: [2, -1, 1] }))
    act(() => { useStore.getState().selectSliceMarker({ cueId: 'a', index: 0 }) })
    const stage = container.querySelector<HTMLElement>('.waveform-stage')!
    await act(async () => {
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }))
    })
    expect((useStore.getState().cues[0] as AudioCue).slices).toEqual({ markers: [2000], playCounts: [2, 1] })
    expect(container.querySelector('.waveform-slice-status')?.textContent)
      .toBe('Marker removed: slices 1 and 2 joined, ×2 kept over ∞')
  })

  it('lights the piece the engine says it is in, with its pass', async () => {
    await show(sliced({ markers: [1000, 2000, 3000], playCounts: [1, 0, -1, 1] }))
    engine.getProgress.mockReturnValue({ elapsedMs: 2400, fraction: 0.6, slice: { index: 2, pass: 3 } } as never)
    await act(async () => {
      useStore.setState({ running: new Map([['a', { cueId: 'a', state: 'playing', startedAt: 0, progress: 0 }]]) })
    })
    await frames()
    const playing = container.querySelector('.slice-region[data-playing="true"]')!
    expect(playing.getAttribute('data-piece')).toBe('2')
    expect(playing.textContent).toBe('∞pass 3')
    expect(container.querySelector('.waveform-vamp-tag')?.textContent).toContain('pass 3')
  })

  it('works the piece out from the position when the engine does not report a slice', async () => {
    await show(sliced({ markers: [1000, 2000, 3000], playCounts: [1, 2, -1, 1] }))
    engine.getProgress.mockReturnValue({ elapsedMs: 1500, fraction: 0.375 } as never)
    await act(async () => {
      useStore.setState({ running: new Map([['a', { cueId: 'a', state: 'playing', startedAt: 0, progress: 0 }]]) })
    })
    await frames()
    expect(container.querySelector('.slice-region[data-playing="true"]')?.getAttribute('data-piece')).toBe('1')
    expect(container.querySelector('.slice-region[data-playing="true"] .slice-region-pass')?.textContent).toBe('1/2')
    // The position moves back inside the piece: its second pass, and a jump drawn.
    engine.getProgress.mockReturnValue({ elapsedMs: 1010, fraction: 0.2525 } as never)
    await frames()
    expect(container.querySelector('.slice-region[data-playing="true"] .slice-region-pass')?.textContent).toBe('2/2')
    expect(Number(container.querySelector('.waveform-stage')?.getAttribute('data-jumps'))).toBeGreaterThan(0)
  })
})
