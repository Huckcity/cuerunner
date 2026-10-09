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

describe('a fixture type read from a GDTF file', () => {
  it('asks main to read the file, adds the type, and says what the import had to say', async () => {
    const { FadersPanel } = await import('./FadersPanel')
    const type = {
      id: 'gdtf-1',
      name: 'Test Spot',
      manufacturer: 'Test Lights',
      source: 'import' as const,
      modes: [{
        name: 'Standard',
        channels: 2,
        params: [
          { key: 'dim', label: 'Dim', kind: 'intensity' as const, offset: 0, fineOffset: null, home: 0 },
          {
            key: 'sh1', label: 'Sh1', kind: 'other' as const, offset: 1, fineOffset: null, home: 0.13,
            functions: [{ name: 'Closed', from: 0 }, { name: 'Open', from: 0.125 }, { name: 'Strobe', from: 0.25 }]
          }
        ]
      }]
    }
    vi.mocked(window.cuerunner.show.command).mockResolvedValueOnce({
      ok: true,
      result: { ok: true, type, notes: ['Dim in Standard is 24-bit: its two most significant bytes are driven and the rest held at zero.'] }
    })
    vi.mocked(window.cuerunner.getPathForFile).mockReturnValueOnce('/rig/Test@Spot.gdtf')
    act(() => root.render(<PatchPanel />))
    const input = container.querySelector('input[aria-label="GDTF fixture file"]') as HTMLInputElement
    const file = new File(['zip'], 'Test@Spot.gdtf')
    Object.defineProperty(input, 'files', { value: [file], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(window.cuerunner.show.command).toHaveBeenCalledWith('dmx', 'importGdtf', { path: '/rig/Test@Spot.gdtf' })
    expect(useStore.getState().lighting.types.map(entry => entry.name)).toContain('Test Spot')
    expect(container.querySelector('.lighting-note[role="status"]')?.textContent).toBe(
      'Imported Test Spot: 1 mode. Dim in Standard is 24-bit: its two most significant bytes are driven and the rest held at zero.'
    )

    // Patched, the shutter's fader says which of its functions it rests in.
    act(() => useStore.setState({
      lighting: {
        ...useStore.getState().lighting,
        fixtures: [{ id: 's1', name: 'Spot 1', typeId: 'gdtf-1', mode: 'Standard', universe: 1, address: 20 }]
      }
    }))
    act(() => root.render(<FadersPanel monitor={null} />))
    expect(container.querySelector('[data-testid="fader-function"]')?.textContent).toBe('Open')
  })

  it('puts the sentence a file was refused with beside the buttons, and adds nothing', async () => {
    vi.mocked(window.cuerunner.show.command).mockResolvedValueOnce({
      ok: true,
      result: { ok: false, error: 'that archive has no description.xml, so it is not a GDTF file' }
    })
    vi.mocked(window.cuerunner.getPathForFile).mockReturnValueOnce('/rig/empty.gdtf')
    const before = useStore.getState().lighting.types.length
    act(() => root.render(<PatchPanel />))
    const input = container.querySelector('input[aria-label="GDTF fixture file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'empty.gdtf')], configurable: true })
    await act(async () => {
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.querySelector('.lighting-error')?.textContent).toBe(
      'empty.gdtf: that archive has no description.xml, so it is not a GDTF file'
    )
    expect(useStore.getState().lighting.types).toHaveLength(before)
  })
})
