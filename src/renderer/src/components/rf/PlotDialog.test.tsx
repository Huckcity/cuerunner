// The mic plot editor is where the plot is changed during a show, so these tests pin the
// two things an operator relies on: text lands when the field is left (not on every
// keystroke), and a change that moves a pack leaves the same swap behind in the store and
// the session log that the report is built from.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { PlotDialog } from './PlotDialog'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import { formatClock } from '../../utils/cueDefaults'
import type { DeviceState, RfPack, RfPerformer, RfPlot, RfSwap } from '../../types/show'

const AT = 1_700_000_000_000

function performer(overrides: Partial<RfPerformer> = {}): RfPerformer {
  return { id: 'perf-1', name: 'Aldonza', role: 'lead', notes: '', ...overrides }
}

function pack(overrides: Partial<RfPack> = {}): RfPack {
  return { id: 'pack-1', label: 'Pack 1', channelId: null, performerId: null, notes: '', ...overrides }
}

function device(overrides: Partial<DeviceState> = {}): DeviceState {
  return { id: 'rf:ch-1', service: 'rf', name: 'Pack 1', online: true, lastSeen: AT, ...overrides }
}

function swap(overrides: Partial<RfSwap> = {}): RfSwap {
  return { at: AT, packId: 'pack-1', packLabel: 'Pack 1', from: null, to: 'Aldonza', ...overrides }
}

const EMPTY_PLOT: RfPlot = { performers: [], packs: [] }

describe('PlotDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    useStore.setState({
      showSettings: defaultShowSettings(),
      showDevices: [],
      log: []
    })
  })

  interface DialogState {
    plot?: RfPlot
    devices?: DeviceState[]
    swaps?: RfSwap[]
  }

  async function show(state: DialogState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          rf: {
            ...defaults.rf,
            plot: state.plot ?? EMPTY_PLOT,
            swaps: state.swaps ?? []
          }
        },
        showDevices: state.devices ?? []
      })
      root.render(<PlotDialog onClose={onClose} />)
    })
  }

  function rf() {
    return useStore.getState().showSettings.rf
  }

  function field<T extends HTMLElement = HTMLInputElement>(selector: string, index = 0): T {
    return container.querySelectorAll<T>(selector)[index]
  }

  // Controlled inputs: setting the value through the prototype setter is what gets past
  // React's own tracker, so the dispatched event looks like a real keystroke.
  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  async function leave(input: HTMLElement): Promise<void> {
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  it('opens as a dialog and closes from Escape, the backdrop and the footer', async () => {
    await show()

    const dialog = container.querySelector('.plot-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Mic plot')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => { container.querySelector<HTMLElement>('.plot-overlay')!.click() })
    expect(onClose).toHaveBeenCalledTimes(2)

    await act(async () => { container.querySelector<HTMLButtonElement>('.plot-close')!.click() })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('adds a performer and a pack', async () => {
    await show()
    expect(container.querySelectorAll('.plot-performer-row')).toHaveLength(0)
    expect(container.querySelectorAll('.plot-pack-row')).toHaveLength(0)

    await act(async () => { container.querySelector<HTMLButtonElement>('.plot-add-performer')!.click() })
    expect(container.querySelectorAll('.plot-performer-row')).toHaveLength(1)
    expect(rf().plot.performers).toHaveLength(1)

    await act(async () => { container.querySelector<HTMLButtonElement>('.plot-add-pack')!.click() })
    expect(container.querySelectorAll('.plot-pack-row')).toHaveLength(1)

    // A new pack is unassigned and unpatched: both are decisions, not defaults.
    const added = rf().plot.packs[0]
    expect(added.performerId).toBeNull()
    expect(added.channelId).toBeNull()
  })

  it('renames a performer in place, committing when the field is left', async () => {
    await show({ plot: { performers: [performer()], packs: [] } })
    const name = field('.plot-name')

    await type(name, 'Aldo')
    // Half a name is not a rename: the plot is untouched until the field is left.
    expect(rf().plot.performers[0].name).toBe('Aldonza')

    await leave(name)
    expect(rf().plot.performers[0].name).toBe('Aldo')
    expect(field('.plot-name').value).toBe('Aldo')
    expect(rf().swaps).toEqual([])
    expect(useStore.getState().log).toHaveLength(0)
  })

  it('edits a pack label, channel and notes without recording a swap', async () => {
    await show({ plot: { performers: [], packs: [pack()] } })

    const label = field('.plot-pack-label')
    await type(label, 'Pack 12')
    await leave(label)

    const channel = field('.plot-channel')
    await type(channel, 'ch-9')
    await leave(channel)

    const notes = field('.plot-pack-notes')
    await type(notes, 'Spare — swap with 4')
    await leave(notes)

    const edited = rf().plot.packs[0]
    expect(edited.label).toBe('Pack 12')
    expect(edited.channelId).toBe('ch-9')
    expect(edited.notes).toBe('Spare — swap with 4')
    expect(rf().swaps).toEqual([])
    expect(useStore.getState().log).toHaveLength(0)

    // Emptying the field unpatches the pack rather than leaving it on a stale channel.
    await type(field('.plot-channel'), '')
    await leave(field('.plot-channel'))
    expect(rf().plot.packs[0].channelId).toBeNull()
  })

  it('assigns a performer, recording one swap and one log line', async () => {
    await show({ plot: { performers: [performer()], packs: [pack()] } })

    const select = field<HTMLSelectElement>('.plot-pack-performer')
    expect(select.querySelector('option')!.textContent).toBe('— unassigned —')
    expect([...select.querySelectorAll('option')].map(o => o.textContent))
      .toEqual(['— unassigned —', 'Aldonza'])

    await choose(select, 'perf-1')

    expect(rf().plot.packs[0].performerId).toBe('perf-1')
    expect(rf().swaps).toHaveLength(1)
    expect(rf().swaps[0]).toMatchObject({ packLabel: 'Pack 1', from: null, to: 'Aldonza' })
    expect(useStore.getState().log).toHaveLength(1)
    expect(useStore.getState().log[0]).toMatchObject({
      level: 'info',
      label: 'RF',
      message: 'Swap: Pack 1 unassigned → Aldonza'
    })
  })

  it('assigning the same performer again records nothing', async () => {
    await show({ plot: { performers: [performer()], packs: [pack({ performerId: 'perf-1' })] } })

    await choose(field<HTMLSelectElement>('.plot-pack-performer'), 'perf-1')

    expect(rf().swaps).toEqual([])
    expect(useStore.getState().log).toHaveLength(0)
  })

  it('sets a pack back to unassigned, recording a swap to unassigned', async () => {
    await show({ plot: { performers: [performer()], packs: [pack({ performerId: 'perf-1' })] } })

    await choose(field<HTMLSelectElement>('.plot-pack-performer'), '')

    expect(rf().plot.packs[0].performerId).toBeNull()
    expect(rf().swaps).toHaveLength(1)
    expect(rf().swaps[0]).toMatchObject({ from: 'Aldonza', to: null })
    expect(useStore.getState().log[0].message).toBe('Swap: Pack 1 Aldonza → unassigned')
  })

  it('removing a performer releases their packs, a swap and a log line each', async () => {
    await show({
      plot: {
        performers: [performer({ id: 'p-a', name: 'Aldonza' }), performer({ id: 'p-b', name: 'Sancho' })],
        packs: [
          pack({ id: 'k1', label: 'Pack 1', performerId: 'p-a' }),
          pack({ id: 'k2', label: 'Pack 2', performerId: 'p-a' }),
          pack({ id: 'k3', label: 'Pack 3', performerId: 'p-b' })
        ]
      }
    })

    const removeAldonza = field<HTMLButtonElement>('.plot-performer-row .plot-remove', 0)
    await act(async () => { removeAldonza.click() })

    expect(rf().plot.performers.map(p => p.id)).toEqual(['p-b'])
    expect(rf().plot.packs.map(p => [p.id, p.performerId]))
      .toEqual([['k1', null], ['k2', null], ['k3', 'p-b']])
    expect(rf().swaps.map(s => s.packLabel)).toEqual(['Pack 1', 'Pack 2'])
    expect(rf().swaps.every(s => s.from === 'Aldonza' && s.to === null)).toBe(true)
    expect(useStore.getState().log.map(entry => entry.message)).toEqual([
      'Swap: Pack 1 Aldonza → unassigned',
      'Swap: Pack 2 Aldonza → unassigned'
    ])
  })

  it('removing a performer with no packs logs nothing', async () => {
    await show({ plot: { performers: [performer({ name: 'Fermina' })], packs: [] } })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.plot-performer-row .plot-remove')!.click()
    })

    expect(rf().plot.performers).toEqual([])
    expect(rf().swaps).toEqual([])
    expect(useStore.getState().log).toHaveLength(0)
  })

  it('offers the channels the service is reporting, by id and name, without pinning the field', async () => {
    await show({
      plot: { performers: [], packs: [pack()] },
      devices: [
        device({ id: 'rf:ch-1', name: 'Pack 1' }),
        device({ id: 'rf:ch-2', name: 'Pack 2' }),
        device({ id: 'shure:1', name: 'Receiver' })
      ]
    })

    const options = [...container.querySelectorAll<HTMLOptionElement>('#plot-channels option')]
    expect(options.map(option => option.getAttribute('value'))).toEqual(['ch-1', 'ch-2'])
    expect(options.map(option => option.getAttribute('label'))).toEqual(['Pack 1', 'Pack 2'])
    expect(field('.plot-channel').getAttribute('list')).toBe('plot-channels')

    // A pack that is switched off today is still part of tonight's plot, so a channel
    // the service is not reporting can still be patched by hand.
    await type(field('.plot-channel'), 'ch-99')
    await leave(field('.plot-channel'))
    expect(rf().plot.packs[0].channelId).toBe('ch-99')
  })

  it('lists the last swaps newest first, or says there are none', async () => {
    await show({ plot: EMPTY_PLOT, swaps: [] })
    expect(container.querySelector('.plot-swaps-empty')?.textContent).toBe('No swaps yet.')
    expect(container.querySelectorAll('.plot-swap')).toHaveLength(0)

    await show({
      plot: EMPTY_PLOT,
      swaps: [
        swap({ at: AT + 1000, packId: 'k1', packLabel: 'Pack 1', from: null, to: 'Aldonza' }),
        swap({ at: AT + 2000, packId: 'k2', packLabel: 'Pack 2', from: 'Aldonza', to: 'Sancho' })
      ]
    })

    expect(container.querySelector('.plot-swaps-empty')).toBeNull()
    expect([...container.querySelectorAll('.plot-swap-text')].map(el => el.textContent)).toEqual([
      'Pack 2 Aldonza → Sancho',
      'Pack 1 unassigned → Aldonza'
    ])
    expect([...container.querySelectorAll('.plot-swap-time')].map(el => el.textContent)).toEqual([
      formatClock(AT + 2000),
      formatClock(AT + 1000)
    ])
  })
})
