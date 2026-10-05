// The context bar answers the booth's two questions: what is playing, and what does GO
// do next? Each half names its cue and carries the note written on it, and the next half
// answers by the runner's rule, whichever view is on screen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ContextBar, outermostRuns, standbyCue } from './ContextBar'
import { useStore, type RunningCue } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import { defaultShowSettings } from '../../../../shared/show'
import type { Cue, SceneCue } from '../../../../shared/cue'

function cue(type: Cue['type'], number: string, name: string, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type), number, name, ...patch } as Cue
}

function running(entries: Array<[string, RunningCue['state'], number]>): Map<string, RunningCue> {
  return new Map(entries.map(([cueId, state, startedAt]) => [cueId, { cueId, state, startedAt, progress: 0 }]))
}

describe('standbyCue', () => {
  const a = cue('wait', '1', 'One')
  const b = cue('wait', '2', 'Two')

  it('is the selected cue', () => {
    expect(standbyCue([a, b], b.id)).toBe(b)
  })

  it('is nothing when nothing is selected, because GO fires nothing then', () => {
    // After the last cue of a show the selection is empty, and the bar used to name cue 1
    // there: one more press of GO restarted the show.
    expect(standbyCue([a, b], null)).toBeNull()
  })

  it('is nothing when the selection points nowhere', () => {
    expect(standbyCue([a, b], 'gone')).toBeNull()
  })
})

describe('outermostRuns', () => {
  it('keeps a running group and leaves its running children inside it', () => {
    const group = cue('group', '2', 'Act 1')
    const child = cue('wait', '3', 'Count 8', { parentId: group.id })
    const solo = cue('audio', '1', 'Walk-in')
    const runs = outermostRuns(
      [solo, group, child],
      running([[child.id, 'playing', 30], [group.id, 'playing', 20], [solo.id, 'playing', 10]])
    )
    expect(runs.map(r => r.cue.name)).toEqual(['Walk-in', 'Act 1'])
  })
})

describe('ContextBar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ cues: [], selectedId: null, running: new Map(), showSettings: defaultShowSettings() })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.useRealTimers()
  })

  function render(): void {
    act(() => { root.render(<ContextBar />) })
  }

  const text = (selector: string): string | null | undefined => container.querySelector(selector)?.textContent

  it('says there is nothing to fire in an empty show', () => {
    render()
    expect(text('.ctx-none')).toBe('No cues yet')
  })

  it('says nothing is playing until something is', () => {
    useStore.setState({ cues: [cue('wait', '1', 'Hold')] })
    render()
    expect(text('.ctx-live .ctx-tag')).toBe('Nothing playing')
  })

  it('names the cue GO fires, with the first line of its notes', () => {
    const next = cue('group', '2', 'Act 1', { notes: '\nA sequence group: GO fires its children.\nSecond line' })
    useStore.setState({ cues: [cue('audio', '1', 'Walk-in'), next], selectedId: next.id })
    render()

    expect(text('.ctx-next .ctx-number')).toBe('2')
    expect(text('.ctx-next .ctx-name')).toBe('Act 1')
    expect(text('.ctx-next .ctx-note')).toBe('A sequence group: GO fires its children.')
  })

  it('warns when the cue on standby is disarmed, because GO will pass over it', () => {
    const off = cue('wait', '4', 'Hold', { isArmed: false })
    useStore.setState({ cues: [off], selectedId: off.id })
    render()

    expect(text('.ctx-disarmed')).toContain('GO skips it')
  })

  it('says which scene a scene cue recalls', () => {
    const settings = defaultShowSettings()
    settings.scenes.list = [{ id: 's1', name: 'Wedding', dcas: [], notes: '' }]
    const sceneCue = { ...cue('scene', '9', 'Into the wedding'), sceneId: 's1' } as SceneCue
    useStore.setState({ cues: [sceneCue], selectedId: sceneCue.id, showSettings: settings })
    render()

    expect(text('.ctx-recalls')).toBe('Recalls Wedding')
  })

  it('counts a running cue down to its end, and carries its note too', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const wait = cue('wait', '3', 'Count 8', { duration: 8000, notes: 'Conductor counts the band in.' })
    useStore.setState({ cues: [wait], running: running([[wait.id, 'playing', 7000]]) })
    render()

    expect(text('.ctx-live .ctx-name')).toBe('Count 8')
    expect(text('.ctx-live .ctx-note')).toBe('Conductor counts the band in.')
    expect(text('.ctx-clock')).toBe('0:03.0 / −0:05.0')

    act(() => { vi.advanceTimersByTime(1000) })
    expect(text('.ctx-clock')).toBe('0:04.0 / −0:04.0')
  })

  it('shows the cue that has been running longest, and counts the rest', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const first = cue('audio', '1', 'Walk-in', { duration: 20_000 })
    const second = cue('audio', '7', 'Scene Change', { duration: 4000 })
    useStore.setState({
      cues: [first, second],
      running: running([[second.id, 'playing', 9000], [first.id, 'playing', 5000]])
    })
    render()

    expect(text('.ctx-live .ctx-name')).toBe('Walk-in')
    expect(text('.ctx-more')).toBe('+1 more')
  })

  it('says what a cue that has not started yet is waiting on', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const wait = cue('audio', '2', 'Sting', { duration: 3000, preWait: 5000 })
    useStore.setState({ cues: [wait], running: running([[wait.id, 'pre-wait', 9000]]) })
    render()

    expect(text('.ctx-phase')).toBe('pre-wait')
  })
})
