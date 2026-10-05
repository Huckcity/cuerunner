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
