// The dock is the bottom of the window: the selected cue, or one of the show's panels,
// at one height. Selecting cues changes what it shows and nothing about its size.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Dock, clampDockHeight, DOCK_DEFAULT_HEIGHT, type DockTab } from './Dock'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import type { AppView } from './Toolbar'
import type { Cue, GroupCue } from '../../../../shared/cue'

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
    // A workspace with a cue in it: the dock of an empty one opens folded, which is a case
    // of its own below.
    const count = cue('wait', { name: 'Count 8', number: '3' })
    useStore.setState({ cues: [count], selectedId: count.id })
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

  it('counts the errors written to the log since it was last on screen, on its tab', () => {
    useStore.setState({ log: [] })
    act(() => { root.render(<Harness />) })
    const count = (): string | null => tab('btn-log').querySelector('.dock-tab-count')?.textContent ?? null
    expect(count()).toBeNull()

    // A cue fails while the dock is showing the selected cue: the log is the only place
    // that says why, and its tab is the only part of it on screen.
    act(() => {
      useStore.getState().appendLog([
        { level: 'info', message: 'started', label: '4 · Strings Patch' },
        { level: 'error', message: 'No MIDI output port is set for this cue', label: '4 · Strings Patch' },
        { level: 'error', message: 'request failed', label: '6 · Trigger Video' }
      ])
    })
    expect(count()).toBe('2')

    // Opening the log is reading it, and the count does not come back when it is closed.
    act(() => { tab('btn-log').click() })
    expect(count()).toBeNull()
    act(() => { tab('btn-cue').click() })
    expect(count()).toBeNull()

    // What is written after that is new.
    act(() => { useStore.getState().appendLog([{ level: 'error', message: 'audio device lost' }]) })
    expect(count()).toBe('1')
  })

  it('counts nothing but errors, and nothing while the log is the panel on screen', () => {
    useStore.setState({ log: [] })
    act(() => { root.render(<Harness initial="log" />) })
    act(() => {
      useStore.getState().appendLog([
        { level: 'output', message: 'house lights → warm' },
        { level: 'error', message: 'request failed' }
      ])
    })
    expect(tab('btn-log').querySelector('.dock-tab-count')).toBeNull()

    act(() => { tab('btn-monitor').click() })
    act(() => { useStore.getState().appendLog([{ level: 'info', message: 'completed in 12ms' }]) })
    expect(tab('btn-log').querySelector('.dock-tab-count')).toBeNull()
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

  it('opens folded in a workspace with nothing in it, and that fold is the workspace\'s', () => {
    useStore.setState({ cues: [], selectedId: null })
    act(() => { root.render(<Harness />) })

    // A new workspace has no cue for the Cue tab to show, so the dock is drawn as its tabs.
    expect(dock().dataset.collapsed).toBe('true')
    expect(container.querySelector('.dock-body')).toBeNull()
    // And nothing was written down: this is the workspace's fold, not the operator's.
    expect(localStorage.getItem('cuerunner.dock.collapsed')).toBeNull()

    // A cue arriving is a show with something in it, so the dock comes back on its own.
    act(() => { useStore.setState({ cues: [cue('wait', { name: 'Count 8' })] }) })
    expect(dock().dataset.collapsed).toBe('false')
    expect(localStorage.getItem('cuerunner.dock.collapsed')).toBeNull()

    // And the fold follows the workspace the other way too: the last cue leaving leaves a
    // show with nothing to show, and the dock goes with it — still the workspace's fold,
    // still nothing written down.
    act(() => { useStore.setState({ cues: [], selectedId: null }) })
    expect(dock().dataset.collapsed).toBe('true')
    expect(localStorage.getItem('cuerunner.dock.collapsed')).toBeNull()
  })

  it('offers the fold press only where a press can show something', () => {
    // The Scenes view's Cue tab has no body whatever the fold is — there is no cue list to
    // have selected from — so the press is not drawn there; the view's own tabs are what
    // open the dock. Anywhere the body can be drawn, the press is there and the glyph says
    // which way it goes.
    act(() => { root.render(<Harness view="scenes" />) })
    expect(container.querySelector('.dock-collapse')).toBeNull()

    act(() => tab('btn-log').click())
    expect(container.querySelector<HTMLButtonElement>('.dock-collapse')?.title).toBe('Hide the dock, and give the cue list the room')
  })

  it('keeps the operator\'s own fold whoever the workspace is', () => {
    // A press is theirs: folded with a show in it, and still folded when the next
    // workspace opens with nothing in it — which is the fold they chose, not one the
    // empty show would have given them anyway.
    act(() => { root.render(<Harness />) })
    act(() => container.querySelector<HTMLButtonElement>('.dock-collapse')!.click())
    expect(localStorage.getItem('cuerunner.dock.collapsed')).toBe('true')

    act(() => { root.unmount() })
    root = createRoot(container)
    useStore.setState({ cues: [], selectedId: null })
    act(() => { root.render(<Harness />) })
    expect(dock().dataset.collapsed).toBe('true')

    // And the other way round: a dock they opened stays open over an empty workspace.
    act(() => container.querySelector<HTMLButtonElement>('.dock-collapse')!.click())
    expect(localStorage.getItem('cuerunner.dock.collapsed')).toBe('false')
    expect(dock().dataset.collapsed).toBe('false')
    expect(container.querySelector('.dock-body')).not.toBeNull()
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
