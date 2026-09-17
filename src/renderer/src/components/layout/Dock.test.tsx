// The dock is the bottom of the window: the selected cue, or one of the show's panels,
// at one height. Selecting cues changes what it shows and nothing about its size.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Dock, clampDockHeight, DOCK_DEFAULT_HEIGHT, type DockTab } from './Dock'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { AppView } from './Toolbar'
import type { Cue, GroupCue } from '../../types/cue'

vi.mock('../waveform/WaveformPanel', () => ({ WaveformPanel: () => <div className="waveform-panel" /> }))
vi.mock('../timeline/TimelineEditor', () => ({ TimelineEditor: () => <div className="timeline-panel" /> }))

function cue(type: Cue['type'], patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type), ...patch } as Cue
}

function Harness({ view = 'cues', initial = 'cue' }: { view?: AppView; initial?: DockTab }) {
  const [tab, setTab] = useState<DockTab>(initial)
  return <Dock view={view} tab={tab} onTab={setTab} timelineExpanded={false} onToggleTimeline={() => {}} />
}

describe('Dock', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    localStorage.clear()
    window.innerHeight = 768
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ cues: [], selectedId: null, license: { state: 'unlicensed' } })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const dock = (): HTMLElement => container.querySelector('.dock')!
  const tab = (className: string): HTMLButtonElement => container.querySelector(`.${className}`)!

  it('shows the selected cue in whatever form it has, at one height', () => {
    const audio = cue('audio')
    const group = cue('group', { mode: 'timeline' } as Partial<GroupCue>)
    const wait = cue('wait', { name: 'Count 8', number: '3' })
    useStore.setState({ cues: [audio, group, wait], selectedId: audio.id })
    act(() => { root.render(<Harness />) })
    const height = dock().style.height
    expect(height).toBe(`${DOCK_DEFAULT_HEIGHT}px`)
    expect(container.querySelector('.waveform-panel')).not.toBeNull()

    act(() => { useStore.setState({ selectedId: group.id }) })
    expect(container.querySelector('.timeline-panel')).not.toBeNull()
    expect(dock().style.height).toBe(height)

    act(() => { useStore.setState({ selectedId: wait.id }) })
    expect(container.querySelector('.dock-summary')?.textContent).toContain('Count 8')
    expect(dock().style.height).toBe(height)
  })

  it('opens a panel from its tab, and the same tab puts the cue back', () => {
    act(() => { root.render(<Harness />) })

    act(() => tab('btn-log').click())
    expect(container.querySelector('.log-panel')).not.toBeNull()
    expect(tab('btn-log').dataset.active).toBe('true')

    act(() => tab('btn-log').click())
    expect(container.querySelector('.log-panel')).toBeNull()
    expect(tab('btn-cue').dataset.active).toBe('true')
  })

  it('shows an unlicensed machine the lock inside a Pro panel', () => {
    act(() => { root.render(<Harness />) })
    act(() => tab('btn-rf').click())
    expect(container.querySelector('.pro-lock[data-feature="Wireless"]')).not.toBeNull()
  })

  it('folds away to its tabs, and remembers that', () => {
    act(() => { root.render(<Harness />) })
    act(() => container.querySelector<HTMLButtonElement>('.dock-collapse')!.click())

    expect(dock().dataset.collapsed).toBe('true')
    expect(container.querySelector('.dock-body')).toBeNull()
    expect(localStorage.getItem('cuerunner.dock.collapsed')).toBe('true')

    // Any tab opens it again.
    act(() => tab('btn-log').click())
    expect(dock().dataset.collapsed).toBe('false')
  })

  it('has no Cue tab in the Scenes view, where there is no list to select from', () => {
    act(() => { root.render(<Harness view="scenes" />) })
    expect(container.querySelector('.btn-cue')).toBeNull()
    expect(dock().dataset.collapsed).toBe('true')
  })

  it('keeps the height it was left at, and draws it within the window', () => {
    // A loaded machine mounts the dock while the window is still 0 high: that is not a
    // window to clamp against, and clamping against it used to floor the dock at the
    // minimum and remember 110 as the operator's choice.
    localStorage.setItem('cuerunner.dock.height', '900')
    window.innerHeight = 0
    act(() => { root.render(<Harness />) })
    expect(dock().style.height).toBe('900px')

    // A window the operator shrinks limits what is drawn, not what is kept: the dock
    // gives the room back while it is small, and takes its own height again after.
    window.innerHeight = 768
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(dock().style.height).toBe(`${clampDockHeight(900, 768)}px`)
    expect(localStorage.getItem('cuerunner.dock.height')).toBe('900')

    window.innerHeight = 1600
    act(() => { window.dispatchEvent(new Event('resize')) })
    expect(dock().style.height).toBe('900px')
  })
})

describe('clampDockHeight', () => {
  it('keeps the dock between a readable minimum and six tenths of the window', () => {
    expect(clampDockHeight(40, 768)).toBe(110)
    expect(clampDockHeight(240, 768)).toBe(240)
    expect(clampDockHeight(900, 768)).toBe(461)
  })
})
