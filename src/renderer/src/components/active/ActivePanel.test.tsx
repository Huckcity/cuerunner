// The Active panel: one row per running cue, each with its own stop, and an audio cue's bar
// as a handle that drops its playhead where it is let go.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ActivePanel } from './ActivePanel'
import { useStore, type RunningCue } from '../../store'
import { cueEngine } from '../../engine/CueEngine'
import { createCue } from '../../utils/cueDefaults'
import type { AudioCue, Cue } from '../../../../shared/cue'

vi.mock('../../engine/audioEngineClient')

function cue(type: Cue['type'], id: string, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type, id), id, name: `Cue ${id}`, ...patch } as Cue
}

function running(...runs: RunningCue[]): Map<string, RunningCue> {
  return new Map(runs.map(run => [run.cueId, run]))
}

describe('ActivePanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    useStore.setState({ running: new Map(), cues: [] })
  })

  function draw(): void {
    act(() => { root.render(<ActivePanel onClose={() => {}} />) })
  }

  const rows = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.active-row')]

  it('says so when nothing is running', () => {
    useStore.setState({ cues: [cue('wait', '1')], running: new Map() })
    draw()
    expect(rows()).toHaveLength(0)
    expect(container.textContent).toContain('Nothing is running')
  })

  it('lists every running cue, oldest first, with what phase it is in', () => {
    useStore.setState({
      cues: [cue('wait', '1'), cue('audio', '2'), cue('wait', '3')],
      running: running(
        { cueId: '3', state: 'pre-wait', startedAt: 300, progress: 0 },
        { cueId: '1', state: 'playing', startedAt: 100, progress: 0 }
      )
    })
    draw()
    expect(rows().map(row => row.dataset.cueId)).toEqual(['1', '3'])
    expect(rows()[1].querySelector('.active-state')?.textContent).toBe('pre-wait')
    expect(container.querySelector('.active-count')?.textContent).toBe('2 running')
  })

  it('stops the one cue whose button is pressed', () => {
    const stop = vi.spyOn(cueEngine, 'stop').mockImplementation(() => {})
    useStore.setState({
      cues: [cue('wait', '1'), cue('wait', '2')],
      running: running(
        { cueId: '1', state: 'playing', startedAt: 1, progress: 0 },
        { cueId: '2', state: 'playing', startedAt: 2, progress: 0 }
      )
    })
    draw()
    act(() => { rows()[1].querySelector<HTMLButtonElement>('.active-stop')!.click() })
    expect(stop).toHaveBeenCalledWith('2')
  })

  it('offers a playing audio cue’s bar as a handle, and seeks where it is let go', () => {
    const seek = vi.spyOn(cueEngine, 'seekCue').mockImplementation(() => {})
    const audio = cue('audio', '1', { filePath: '/a.wav', startTime: 1000, endTime: 11_000, duration: 20_000 } as Partial<AudioCue>)
    useStore.setState({
      cues: [audio, cue('wait', '2')],
      running: running(
        { cueId: '1', state: 'playing', startedAt: 1, progress: 0 },
        { cueId: '2', state: 'playing', startedAt: 2, progress: 0 }
      )
    })
    draw()
    const [audioBar, waitBar] = rows().map(row => row.querySelector<HTMLElement>('.active-bar')!)
    expect(audioBar.dataset.scrubbable).toBe('true')
    expect(waitBar.dataset.scrubbable).toBe('false')

    audioBar.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 6, right: 200, bottom: 6, x: 0, y: 0, toJSON: () => ({}) })
    audioBar.setPointerCapture = () => {}
    const pointer = (type: string, clientX: number): void => {
      const event = new MouseEvent(type, { bubbles: true, clientX }) as MouseEvent & { pointerId: number }
      Object.defineProperty(event, 'pointerId', { value: 1 })
      audioBar.dispatchEvent(event)
    }
    act(() => { pointer('pointerdown', 20) })
    act(() => { pointer('pointermove', 80) })
    // Nothing moves until the bar is let go: one seek per decision, not one per pixel.
    expect(seek).not.toHaveBeenCalled()
    act(() => { pointer('pointerup', 100) })
    expect(seek).toHaveBeenCalledWith('1', 6000)
  })
})
