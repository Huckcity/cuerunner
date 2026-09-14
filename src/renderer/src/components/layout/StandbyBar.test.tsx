// The standby line answers one question for the booth: what does GO do next? It has to
// answer by the runner's rule, whichever view is on screen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { StandbyBar, outermostRuns, standbyCue } from './StandbyBar'
import { useStore, type RunningCue } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import { defaultShowSettings } from '../../types/show'
import type { Cue, SceneCue } from '../../types/cue'

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

  it('is the first cue when nothing is selected, which is what GO fires', () => {
    expect(standbyCue([a, b], null)).toBe(a)
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

describe('StandbyBar', () => {
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
    act(() => { root.render(<StandbyBar />) })
  }

  const text = (selector: string): string | null | undefined => container.querySelector(selector)?.textContent

  it('says there is nothing to fire in an empty show', () => {
    render()
    expect(text('.standby-none')).toBe('no cues')
  })

  it('names the cue GO fires, with the first line of its notes', () => {
    const next = cue('group', '2', 'Act 1', { notes: '\nA sequence group: GO fires its children.\nSecond line' })
    useStore.setState({ cues: [cue('audio', '1', 'Walk-in'), next], selectedId: next.id })
    render()

    expect(text('.standby-number')).toBe('2')
    expect(text('.standby-name')).toBe('Act 1')
    expect(text('.standby-note')).toBe('A sequence group: GO fires its children.')
  })

  it('warns when the cue on standby is disarmed, because GO will do nothing', () => {
    const off = cue('wait', '4', 'Hold', { isArmed: false })
    useStore.setState({ cues: [off], selectedId: off.id })
    render()

    expect(text('.standby-disarmed')).toContain('GO does nothing')
  })

  it('says which scene a scene cue recalls', () => {
    const settings = defaultShowSettings()
    settings.scenes.list = [{ id: 's1', name: 'Wedding', live: [], notes: '' }]
    const sceneCue = { ...cue('scene', '9', 'Into the wedding'), sceneId: 's1' } as SceneCue
    useStore.setState({ cues: [sceneCue], selectedId: sceneCue.id, showSettings: settings })
    render()

    expect(text('.standby-recalls')).toBe('recalls Wedding')
  })

  it('counts a running cue down to its end', () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    const wait = cue('wait', '3', 'Count 8', { duration: 8000 })
    useStore.setState({ cues: [wait], running: running([[wait.id, 'playing', 7000]]) })
    render()

    expect(text('.standby-run-name')).toContain('Count 8')
    expect(text('.standby-run-elapsed')).toBe('0:03.0')
    expect(text('.standby-run-remaining')).toBe('−0:05.0')

    act(() => { vi.advanceTimersByTime(1000) })
    expect(text('.standby-run-remaining')).toBe('−0:04.0')
  })
})
