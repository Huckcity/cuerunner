// The lighting surfaces in the window: the patch adds and flags fixtures and flashes one, the
// Light cue's tab builds a look a line at a time, and the tracking tab says what a cue moves and
// what it leaves. What main does with a command is the lighting engine's tests' business.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PatchPanel } from './PatchPanel'
import { LightInspector, LightTrackingTab } from './LightInspector'
import { useStore } from '../../store'
import { builtinFixtureTypes, defaultLightingSettings } from '../../../../shared/dmx'
import type { LightCue } from '../../../../shared/cue'

const BASE = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  advance: 'none' as const, isArmed: true, notes: '', duration: 3000, effects: [], curve: 'linear' as const,
  intensity: 'ltp' as const
}

function lightCue(id: string, look: LightCue['look']): LightCue {
  return { ...BASE, id, number: id, name: `Cue ${id}`, type: 'light', look }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.mocked(window.cuerunner.show.command).mockResolvedValue({ ok: true })
  useStore.setState({
    lighting: {
      ...defaultLightingSettings(),
      types: builtinFixtureTypes().filter(type => type.id === 'builtin:dimmer-rgb'),
      fixtures: [
        { id: 'p1', name: 'Par 1', typeId: 'builtin:dimmer-rgb', mode: '4 channel', universe: 1, address: 1 },
        { id: 'p2', name: 'Par 2', typeId: 'builtin:dimmer-rgb', mode: '4 channel', universe: 1, address: 5 }
      ],
      groups: [{ id: 'g1', name: 'Wash', fixtureIds: ['p1', 'p2'] }]
    },
    cues: []
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.clearAllMocks()
})

function click(element: Element | null): void {
  if (element === null) throw new Error('nothing to click')
  act(() => (element as HTMLElement).click())
}

function button(text: string): HTMLButtonElement | null {
  return [...container.querySelectorAll('button')].find(entry => entry.textContent === text) ?? null
}

function choose(selector: string, value: string): void {
  const select = container.querySelector(selector) as HTMLSelectElement
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(select, value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

describe('the patch', () => {
  it('lists the rig and flags a fixture patched over another', () => {
    useStore.setState(s => ({
      lighting: {
        ...s.lighting,
        fixtures: [...s.lighting.fixtures, { id: 'p3', name: 'Par 3', typeId: 'builtin:dimmer-rgb', mode: '4 channel', universe: 1, address: 3 }]
      }
    }))
    act(() => root.render(<PatchPanel />))
    expect(container.querySelectorAll('table[aria-label="Fixtures"] tbody tr')).toHaveLength(3)
    expect(container.querySelector('[aria-label="Patch warnings"]')?.textContent).toMatch(/Par 1 .* and Par 3 .* share a slot/)
    expect(container.querySelector('tr[data-fixture="Par 3"]')?.getAttribute('data-warning')).toBe('true')
  })

  it('patches into the first gap, one undo step, and flashes a fixture to find it', () => {
    act(() => root.render(<PatchPanel />))
    choose('#patch-type', 'builtin:rgb')
    click(button('Patch'))
    const lighting = useStore.getState().lighting
    expect(lighting.fixtures.at(-1)).toMatchObject({ name: 'RGB', address: 9, typeId: 'builtin:rgb' })
    expect(lighting.types.map(type => type.id)).toContain('builtin:rgb')
    expect(useStore.getState().isDirty).toBe(true)

    click(container.querySelector('tr[data-fixture="Par 1"]')!.querySelector('button'))
    expect(window.cuerunner.show.command).toHaveBeenCalledWith('dmx', 'identify', {
      values: [
        { u: 1, s: 0, f: null, i: true, h: 0, v: 1 },
        { u: 1, s: 1, f: null, i: false, h: 0, v: 1 },
        { u: 1, s: 2, f: null, i: false, h: 0, v: 1 },
        { u: 1, s: 3, f: null, i: false, h: 0, v: 1 }
      ],
      ms: 3000
    })
  })
})

describe('the Light tab', () => {
  it('adds a group level to the look, and takes one out', () => {
    const cue = lightCue('1', [])
    useStore.setState({ cues: [cue] })
    act(() => root.render(<LightInspector cue={cue} />))
    choose('#light-target', 'group:g1')
    choose('#light-param', 'blue')
    click(button('Add level'))
    const look = (useStore.getState().cues[0] as LightCue).look
    expect(look).toEqual([{ target: 'group', id: 'g1', param: 'blue', value: 1 }])

    act(() => root.render(<LightInspector cue={useStore.getState().cues[0] as LightCue} />))
    expect(container.querySelector('.light-look-target')?.textContent).toBe('Wash · Blue')
    click(container.querySelector('[aria-label="Remove Wash · Blue"]'))
    expect((useStore.getState().cues[0] as LightCue).look).toEqual([])
  })

  it('says a level whose fixture has left the rig is gone', () => {
    const cue = lightCue('1', [{ target: 'fixture', id: 'unpatched', param: 'dimmer', value: 1 }])
    act(() => root.render(<LightInspector cue={cue} />))
    expect(container.querySelector('.light-look-row')?.getAttribute('data-gone')).toBe('true')
  })
})

describe('the Tracking tab', () => {
  it('says what this cue moves, sets again and leaves', () => {
    const first = lightCue('1', [{ target: 'group', id: 'g1', param: 'dimmer', value: 0.5 }])
    const second = lightCue('2', [
      { target: 'fixture', id: 'p1', param: 'dimmer', value: 0.5 },
      { target: 'fixture', id: 'p2', param: 'red', value: 1 }
    ])
    useStore.setState({ cues: [first, second] })
    act(() => root.render(<LightTrackingTab cue={second} />))
    const rows = [...container.querySelectorAll('tr.light-tracking-row')].map(row =>
      [...row.querySelectorAll('td')].map(cell => cell.textContent)
    )
    expect(rows).toEqual([
      ['Par 1', 'Dimmer', '50%', 'this cue', 'sets again'],
      ['Par 2', 'Dimmer', '50%', 'cue 1', 'tracks'],
      ['Par 2', 'Red', '100%', 'this cue', 'moves']
    ])
  })
})
