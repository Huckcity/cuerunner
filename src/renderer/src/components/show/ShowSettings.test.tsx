// Show Settings is the one place the show's desk routing is set up: the channels on the
// console and the DCAs they feed, the cast and the ensembles that group them, and the mic
// plot with the swaps it records. These tests pin the CRUD in each tab, what removing
// something cleans up in the rest, and that the panel goes when the operator says so — a
// backdrop click is a stray press while something is half-typed, so it is not one of them.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ShowSettings } from './ShowSettings'
import { useStore, type ShowSettingsTab } from '../../store'
import { TEST_LICENSE } from '../../../../test/license'
import { defaultShowSettings } from '../../types/show'
import { midiNoteMessages, oscMessages } from '../../utils/cast'
import type {
  CastSettings, Dca, Ensemble, MicScene, Performer, RfPack, RfPlot, RfSwap, ShowChannel
} from '../../types/show'

function showChannel(id: string, name: string, dcaId: string | null = null, enabled = true): ShowChannel {
  return { id, name, enabled, dcaId }
}

function performer(overrides: Partial<Performer> = {}): Performer {
  return { id: 'p-1', name: 'Aldonza', role: 'lead', notes: '', channelId: null, ...overrides }
}

function ensemble(overrides: Partial<Ensemble> = {}): Ensemble {
  return { id: 'ens-1', name: 'Ensemble', members: [], ...overrides }
}

function dca(overrides: Partial<Dca> = {}): Dca {
  return { id: 'dca-1', label: 'DCA 1', mute: null, unmute: null, ...overrides }
}

function scene(id: string, name: string, live: string[], overrides: Partial<MicScene> = {}): MicScene {
  return { id, name, live, ensembles: [], excluded: [], notes: '', ...overrides }
}

function pack(overrides: Partial<RfPack> = {}): RfPack {
  return { id: 'pack-1', label: 'Pack 1', channelId: null, performerId: null, notes: '', ...overrides }
}

describe('ShowSettings', () => {
  let container: HTMLDivElement
  let root: Root
  let listPorts: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    listPorts = window.winslab.midi.listPorts as unknown as Mock
    listPorts.mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listPorts.mockReset()
    useStore.setState({
      showSettings: defaultShowSettings(),
      showSettingsTab: null,
      license: { state: 'unlicensed' },
      modals: 0,
      log: [],
      showDevices: []
    })
  })

  interface DialogState {
    cast?: Partial<CastSettings>
    scenes?: MicScene[]
    plot?: RfPlot
    swaps?: RfSwap[]
    ports?: string[]
    tab?: ShowSettingsTab
    /** The mic plot is the Pro surface in here; the cast and the channels are free. */
    licensed?: boolean
  }

  // The dialog reads its tab from the store, so a test opens it where an operator would
  // arrive — the menu's `openShowSettings`, or the tab button in its own header.
  async function show(state: DialogState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    listPorts.mockResolvedValue(state.ports ?? [])
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          cast: { ...defaults.cast, ...state.cast },
          scenes: { list: state.scenes ?? [] },
          rf: { ...defaults.rf, plot: state.plot ?? { packs: [] }, swaps: state.swaps ?? [] }
        },
        showSettingsTab: state.tab ?? 'channels',
        license: state.licensed ? { state: 'active', license: TEST_LICENSE } : { state: 'unlicensed' }
      })
      root.render(<ShowSettings />)
    })
  }

  function cast(): CastSettings {
    return useStore.getState().showSettings.cast
  }

  function rf() {
    return useStore.getState().showSettings.rf
  }

  function field<T extends HTMLElement = HTMLInputElement>(selector: string, index = 0): T {
    return container.querySelectorAll<T>(selector)[index]
  }

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

  it('opens as a dialog on the tab it was asked for, and closes from Escape, its ✕ and the footer', async () => {
    await show({ tab: 'channels' })

    const dialog = container.querySelector('.show-settings-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Show Settings')
    expect([...container.querySelectorAll('.show-settings-tab')].map(tab => tab.getAttribute('data-active')))
      .toEqual(['true', 'false', 'false'])

    // The backdrop is not a close button: half-typed is a state this panel is in.
    await act(async () => { container.querySelector<HTMLElement>('.show-settings-overlay')!.click() })
    expect(useStore.getState().showSettingsTab).toBe('channels')

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(useStore.getState().showSettingsTab).toBeNull()

    await show({ tab: 'channels' })
    await act(async () => { container.querySelector<HTMLButtonElement>('.show-settings-close')!.click() })
    expect(useStore.getState().showSettingsTab).toBeNull()

    await show({ tab: 'channels' })
    expect(container.querySelector('.show-settings-done')?.textContent).toBe('Close')
    await act(async () => { container.querySelector<HTMLButtonElement>('.show-settings-done')!.click() })
    expect(useStore.getState().showSettingsTab).toBeNull()
  })

  it('switches tabs, showing the one the header was pressed for', async () => {
    await show({ tab: 'channels' })

    await act(async () => { field<HTMLButtonElement>('.show-settings-tab', 1).click() })
    expect(useStore.getState().showSettingsTab).toBe('cast')
    expect(container.querySelector('.performer-add')).not.toBeNull()
    expect(container.querySelector('.dca-count-select')).toBeNull()

    await act(async () => { field<HTMLButtonElement>('.show-settings-tab', 2).click() })
    expect(useStore.getState().showSettingsTab).toBe('mic-plot')
    // The plot reads the rack the show is running on, so it is the one tab behind the
    // license — an unlicensed machine gets the lock, not an empty plot.
    expect(container.querySelector('.pro-lock')).not.toBeNull()
    expect(container.querySelector('.plot-add-pack')).toBeNull()
  })

  describe('performers', () => {
    it('adds a performer unpatched', async () => {
      await show({ tab: 'cast' })

      await act(async () => { container.querySelector<HTMLButtonElement>('.performer-add')!.click() })

      expect(cast().performers).toHaveLength(1)
      expect(container.querySelectorAll('.performer-row')).toHaveLength(1)
      // On the roster and unpatched: where their mic is patched is the next decision,
      // not a default.
      expect(cast().performers[0].channelId).toBeNull()
    })

    it('renames a performer and sets their role and notes, committing when the field is left', async () => {
      await show({ tab: 'cast', cast: { performers: [performer()] } })

      const name = field('.performer-name')
      await type(name, 'Aldonza (cover)')
      // Half a name is not a rename: the cast is untouched until the field is left.
      expect(cast().performers[0].name).toBe('Aldonza')

      await leave(name)
      expect(cast().performers[0].name).toBe('Aldonza (cover)')

      await type(field('.performer-role'), 'standby')
      await leave(field('.performer-role'))
      expect(cast().performers[0].role).toBe('standby')

      await type(field('.performer-notes'), 'on book for act two')
      await leave(field('.performer-notes'))
      expect(cast().performers[0].notes).toBe('on book for act two')
    })

    it('removes a performer: releases their pack, drops them from the cast, its ensembles and the scenes', async () => {
      await show({
        tab: 'cast',
        cast: {
          performers: [performer(), performer({ id: 'p-2', name: 'Sancho' })],
          ensembles: [ensemble({ members: ['p-1'] })]
        },
        scenes: [scene('s-1', 'Opening', ['p-1', 'p-2'], { ensembles: ['ens-1'], excluded: ['p-1'] })],
        plot: { packs: [pack({ performerId: 'p-1' })] }
      })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.performer-remove')!.click()
      })

      expect(cast().performers.map(entry => entry.id)).toEqual(['p-2'])
      expect(cast().ensembles).toHaveLength(1)
      expect(cast().ensembles[0].members).toEqual([])
      expect(useStore.getState().showSettings.rf.plot.packs[0].performerId).toBeNull()
      expect(useStore.getState().showSettings.rf.swaps).toHaveLength(1)
      expect(useStore.getState().log[0]?.message).toBe('Swap: Pack 1 Aldonza → unassigned')
      expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p-2'])
      expect(useStore.getState().showSettings.scenes.list[0].excluded).toEqual([])
    })
  })

  describe('ensembles', () => {
    it('names a new ensemble after the ones already there', async () => {
      await show({ tab: 'cast' })

      await act(async () => { container.querySelector<HTMLButtonElement>('.ensemble-add')!.click() })
      await act(async () => { container.querySelector<HTMLButtonElement>('.ensemble-add')!.click() })

      expect(cast().ensembles.map(entry => entry.name)).toEqual(['Ensemble 1', 'Ensemble 2'])
    })

    it('renames an ensemble in place', async () => {
      await show({ tab: 'cast', cast: { ensembles: [ensemble()] } })

      await type(field('.ensemble-name'), 'Chorus')
      await leave(field('.ensemble-name'))

      expect(cast().ensembles[0].name).toBe('Chorus')
    })

    it('adds a member from the picker, which then stops offering them', async () => {
      await show({
        tab: 'cast',
        cast: {
          performers: [performer(), performer({ id: 'p-2', name: 'Sancho' })],
          ensembles: [ensemble({ id: 'ens-1', name: 'Leads' }), ensemble({ id: 'ens-2', name: 'Chorus' })]
        }
      })

      const rows = [...container.querySelectorAll('.ensemble-row')]
      await choose(rows[0].querySelector<HTMLSelectElement>('.member-add')!, 'p-1')

      expect(cast().ensembles[0].members).toEqual(['p-1'])
      expect(rows[0].querySelectorAll('.member-chip')).toHaveLength(1)
      expect(rows[0].querySelector('.ensemble-count')?.textContent).toBe('1 member')
      // Membership is a list, so the picker is what keeps a performer from being added
      // to the same ensemble twice.
      expect([...rows[0].querySelectorAll<HTMLOptionElement>('.member-add option')]
        .map(option => option.textContent)).toEqual(['+ add member', 'Sancho'])
      expect(rows[1].querySelectorAll('.member-chip')).toHaveLength(0)
    })

    it("removing a chip's ✕ takes the performer out without removing the ensemble", async () => {
      await show({
        tab: 'cast',
        cast: { performers: [performer()], ensembles: [ensemble({ members: ['p-1'] })] }
      })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.member-chip button')!.click()
      })

      expect(cast().ensembles[0].members).toEqual([])
      expect(cast().ensembles).toHaveLength(1)
      expect(cast().performers).toHaveLength(1)
    })

    it('removing an ensemble leaves its members in the cast, and unapplies it everywhere', async () => {
      await show({
        tab: 'cast',
        cast: { performers: [performer()], ensembles: [ensemble({ members: ['p-1'] })] },
        scenes: [scene('s-1', 'Opening', [], { ensembles: ['ens-1'] })]
      })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.ensemble-remove')!.click()
      })

      expect(cast().ensembles).toEqual([])
      expect(cast().performers.map(entry => entry.name)).toEqual(['Aldonza'])
      // A scene still pointing at an ensemble that is gone is a group of mics nobody can
      // open or close from the grid again.
      expect(useStore.getState().showSettings.scenes.list[0].ensembles).toEqual([])
    })
  })

  describe('channels', () => {
    it('sets how many DCAs the desk has, and a cut strip is unassigned', async () => {
      await show({
        tab: 'channels',
        cast: { channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')], dcas: [] }
      })

      expect(field<HTMLSelectElement>('.dca-count-select').value).toBe('0')
      expect(container.querySelector('.dca-row')).toBeNull()

      await choose(field<HTMLSelectElement>('.dca-count-select'), '3')

      expect(cast().dcas.map(entry => entry.label)).toEqual(['DCA 1', 'DCA 2', 'DCA 3'])
      expect([...container.querySelectorAll<HTMLInputElement>('.dca-label')].map(input => input.value))
        .toEqual(['DCA 1', 'DCA 2', 'DCA 3'])

      // One strip on a DCA that stays, one on the DCA that is cut.
      await choose(field<HTMLSelectElement>('.channel-dca', 0), cast().dcas[0].id)
      await choose(field<HTMLSelectElement>('.channel-dca', 1), cast().dcas[2].id)

      await choose(field<HTMLSelectElement>('.dca-count-select'), '2')

      expect(cast().dcas.map(entry => entry.label)).toEqual(['DCA 1', 'DCA 2'])
      expect(cast().channels[0].dcaId).toBe(cast().dcas[0].id)
      // Half of this edit — a strip pointing at a DCA nothing can open — would be worse
      // than the cut, so the pointer goes with the DCA.
      expect(cast().channels[1].dcaId).toBeNull()
    })

    it('adds and removes a channel, unpatching whoever was on the removed strip', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')],
          performers: [performer({ channelId: 'ch-2' })]
        }
      })

      const rows = (): Element[] => [...container.querySelectorAll('.channel-row')]
      expect(rows()).toHaveLength(2)

      await act(async () => { container.querySelector<HTMLButtonElement>('.channel-add')!.click() })

      expect(cast().channels).toHaveLength(3)
      expect(rows()[2].querySelector('.channel-number')?.textContent).toBe('3')

      await act(async () => {
        rows()[1].querySelector<HTMLButtonElement>('.channel-remove')!.click()
      })

      expect(cast().channels.map(entry => entry.name)).toEqual(['Ruth', ''])
      // The strips after the one that went close up, and a performer pointed at a strip
      // that is gone is patched to nothing rather than to whatever took its number.
      expect([...container.querySelectorAll('.channel-number')].map(number => number.textContent))
        .toEqual(['1', '2'])
      expect(cast().performers[0].channelId).toBeNull()
    })

    it('configures MIDI delivery for a DCA, offering the ports the machine reports', async () => {
      await show({ tab: 'channels', ports: ['Yamaha', 'IEM rack'] })

      await choose(field<HTMLSelectElement>('.dca-count-select'), '1')
      const row = container.querySelectorAll('.dca-row')[0]
      await choose(row.querySelector<HTMLSelectElement>('.dca-delivery')!, 'midi')

      expect([...row.querySelectorAll<HTMLOptionElement>('.dca-port option')]
        .map(option => option.textContent)).toEqual(['Yamaha', 'IEM rack'])

      await choose(row.querySelector<HTMLSelectElement>('.dca-port')!, 'Yamaha')
      await choose(row.querySelector<HTMLSelectElement>('.dca-channel')!, '3')
      await choose(row.querySelector<HTMLSelectElement>('.dca-note')!, '12')

      const expected = midiNoteMessages('Yamaha', 3, 12)
      expect(cast().dcas[0].unmute).toEqual(expected.unmute)
      expect(cast().dcas[0].mute).toEqual(expected.mute)
    })

    it('switches a DCA to OSC and sends one address for both states', async () => {
      await show({
        tab: 'channels',
        cast: { dcas: [{ id: 'dca-1', label: 'DCA 1', ...midiNoteMessages('Yamaha', 3, 12) }] }
      })

      // A DCA nothing is patched to says so rather than showing a blank.
      expect(container.querySelector('.dca-carrying')?.textContent).toBe('nothing assigned')

      await choose(field<HTMLSelectElement>('.dca-delivery'), 'osc')
      await type(field('.dca-host'), '10.0.0.5')
      await leave(field('.dca-host'))
      await type(field('.dca-osc-port'), '9000')
      await leave(field('.dca-osc-port'))
      await type(field('.dca-address'), '/dca/1/mute')
      await leave(field('.dca-address'))

      const expected = oscMessages('10.0.0.5', 9000, '/dca/1/mute')
      expect(cast().dcas[0].unmute).toEqual(expected.unmute)
      expect(cast().dcas[0].mute).toEqual(expected.mute)
    })

    it('shows which strips feed each DCA', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [
            showChannel('ch-1', 'Ruth', 'dca-1'),
            showChannel('ch-2', 'Bea', 'dca-1'),
            showChannel('ch-3', '', 'dca-2')
          ],
          dcas: [dca({ id: 'dca-1', label: 'DCA 1' }), dca({ id: 'dca-2', label: 'DCA 2' })]
        }
      })

      expect([...container.querySelectorAll('.dca-carrying')].map(row => row.textContent))
        .toEqual(['Ch 1 · Ruth, Ch 2 · Bea', 'Ch 3'])
    })

    it('patches a performer to a channel whose options read as the strip does', async () => {
      await show({
        tab: 'cast',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', '')],
          performers: [performer()]
        }
      })

      const select = field<HTMLSelectElement>('.performer-channel')
      expect([...select.options].map(option => option.textContent))
        .toEqual(['— unpatched —', 'Ch 1 · Ruth', 'Ch 2'])
      expect(select.value).toBe('')

      await choose(select, 'ch-1')
      expect(cast().performers[0].channelId).toBe('ch-1')
    })
  })

  describe('mic plot', () => {
    it('edits the plot from its tab, recording a pack that changes hands', async () => {
      await show({
        tab: 'mic-plot',
        licensed: true,
        cast: { performers: [performer()] },
        plot: { packs: [pack()] }
      })

      await type(field('.plot-pack-label'), 'Pack 12')
      await leave(field('.plot-pack-label'))
      expect(rf().plot.packs[0].label).toBe('Pack 12')

      await choose(field<HTMLSelectElement>('.plot-pack-performer'), 'p-1')

      expect(rf().plot.packs[0].performerId).toBe('p-1')
      expect(rf().swaps).toHaveLength(1)
      expect(useStore.getState().log[0]).toMatchObject({
        level: 'info',
        label: 'RF',
        message: 'Swap: Pack 12 unassigned → Aldonza'
      })
      expect(container.querySelector('.plot-swap-text')?.textContent)
        .toBe('Pack 12 unassigned → Aldonza')
    })
  })
})
