// Show Settings is the one place the show's desk routing is set up: where the desk is and
// how it is spoken to, the channels on the console and the DCAs they feed, the cast and
// the ensembles that group them, and the mic plot with the swaps it records. These tests
// pin the CRUD in each tab, what removing something cleans up in the rest, and that the
// panel goes when the operator says so — a backdrop click is a stray press while something
// is half-typed, so it is not one of them.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ShowSettings } from './ShowSettings'
import { useStore, type ShowSettingsTab } from '../../store'
import { TEST_LICENSE } from '../../../../test/license'
import { defaultShowSettings } from '../../types/show'
import type {
  CastSettings, Dca, Ensemble, MicScene, Performer, RfPack, RfPlot, RfSwap, ShowChannel
} from '../../types/show'

function showChannel(id: string, name: string, dcaId: string | null = null): ShowChannel {
  return { id, name, dcaId }
}

function performer(overrides: Partial<Performer> = {}): Performer {
  return { id: 'p-1', name: 'Aldonza', role: 'lead', notes: '', channelId: null, ...overrides }
}

function ensemble(overrides: Partial<Ensemble> = {}): Ensemble {
  return { id: 'ens-1', name: 'Ensemble', members: [], ...overrides }
}

function dca(overrides: Partial<Dca> = {}): Dca {
  return { id: 'dca-1', label: 'DCA 1', note: null, address: null, ...overrides }
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

    listPorts = window.cuerunner.midi.listPorts as unknown as Mock
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
    it('adds a performer on the first free strip, and naming them names the strip', async () => {
      await show({ tab: 'cast' })

      await act(async () => { container.querySelector<HTMLButtonElement>('.performer-add')!.click() })

      expect(cast().performers).toHaveLength(1)
      expect(container.querySelectorAll('.performer-row')).toHaveLength(1)
      // On the first strip nobody is on: a performer with no strip is a row that can never
      // be open in a scene, and the strip's label is what the desk shows.
      expect(cast().performers[0].channelId).toBe(cast().channels[0].id)

      const name = field('.performer-name')
      await type(name, 'Aldonza')
      await leave(name)

      expect(cast().performers[0].name).toBe('Aldonza')
      expect(cast().channels[0].name).toBe('Aldonza')
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

    it('patches a performer to a strip, whose options name the fader it drives', async () => {
      await show({
        tab: 'cast',
        cast: {
          channels: [showChannel('ch-1', 'Ruth', 'dca-1'), showChannel('ch-2', '', 'dca-2')],
          dcas: [dca({ id: 'dca-1', label: 'DCA 1' }), dca({ id: 'dca-2', label: 'DCA 2' })],
          performers: [performer()]
        }
      })

      const select = field<HTMLSelectElement>('.performer-channel')
      // Picking a strip is choosing what the desk moves, so the option names the fader too.
      expect([...select.options].map(option => option.textContent))
        .toEqual(['— unpatched —', 'Ch 1 · Ruth → DCA 1', 'Ch 2 → DCA 2'])
      expect(select.value).toBe('')

      await choose(select, 'ch-1')
      expect(cast().performers[0].channelId).toBe('ch-1')
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
    it('opens a new show wired: twelve strips, twelve DCAs, and strip n on DCA n', async () => {
      await show({ tab: 'channels' })

      expect(container.querySelectorAll('.channel-row')).toHaveLength(12)
      expect(container.querySelectorAll('.dca-row')).toHaveLength(12)
      // Strip n drives DCA n, so a new show moves a desk before anything has been
      // assigned: the mic-per-fader arrangement a wireless show is set up as.
      expect(cast().channels.map(channel => channel.dcaId))
        .toEqual(cast().dcas.map(entry => entry.id))
      expect([...container.querySelectorAll<HTMLSelectElement>('.channel-dca')]
        .map(select => select.value)).toEqual(cast().dcas.map(entry => entry.id))
      // …and what the desk is sent is read back once, from the connection: the address a
      // DCA's number makes, where it goes, and which value opens it.
      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends /dca/1/on … /dca/12/on to 127.0.0.1:8000, with 1 to open and 0 to close')
    })

    it('edits where the desk is: the host, the port and the address pattern a DCA is sent to', async () => {
      await show({ tab: 'channels' })

      // The first and last of what the show will send, read back from the pattern: it is
      // easier to check as the addresses it makes than as a template.
      expect(container.querySelector('.desk-preview')?.textContent)
        .toContain('/dca/1/on … /dca/12/on to 127.0.0.1:8000')

      await type(field('.desk-host'), '10.0.0.5')
      await leave(field('.desk-host'))
      await type(field('.desk-port'), '9000')
      await leave(field('.desk-port'))
      await type(field('.desk-address'), '/dca/{n}/mute')
      await leave(field('.desk-address'))

      expect(useStore.getState().showSettings.desk.host).toBe('10.0.0.5')
      expect(useStore.getState().showSettings.desk.port).toBe(9000)
      expect(useStore.getState().showSettings.desk.address).toBe('/dca/{n}/mute')
      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends /dca/1/mute … /dca/12/mute to 10.0.0.5:9000, with 1 to open and 0 to close')
    })

    it('drives the desk over MIDI, offering the ports the machine reports', async () => {
      await show({ tab: 'channels', ports: ['Yamaha', 'IEM rack'] })

      await choose(field<HTMLSelectElement>('.desk-kind'), 'midi')

      // A message to nowhere is worse than none, so a MIDI desk with no port chosen says
      // what is missing rather than previewing a send that cannot happen.
      expect(container.querySelector('.desk-gap')?.textContent).toBe('No MIDI port chosen.')

      const port = field<HTMLSelectElement>('.desk-midi-port')
      expect([...port.options].map(option => option.textContent))
        .toEqual(['— no port —', 'Yamaha', 'IEM rack'])

      await choose(port, 'Yamaha')
      await type(field('.desk-midi-channel'), '3')
      await leave(field('.desk-midi-channel'))

      expect(useStore.getState().showSettings.desk.midiPort).toBe('Yamaha')
      expect(useStore.getState().showSettings.desk.midiChannel).toBe(3)
      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends note 1 … 12 to "Yamaha", on and off')

      // A desk that numbers its DCAs differently: its own note in place of the one the
      // number makes, and typing that number back clears the override.
      const note = field('.dca-override', 3)
      expect(note.value).toBe('4')
      await type(note, '60')
      await leave(note)
      expect(cast().dcas[3].note).toBe(60)

      await type(field('.dca-override', 3), '4')
      await leave(field('.dca-override', 3))
      expect(cast().dcas[3].note).toBeNull()
    })

    it('drives the desk over the network, on the port the desk serves its MIDI on', async () => {
      await show({ tab: 'channels' })

      await choose(field<HTMLSelectElement>('.desk-kind'), 'midi-tcp')

      // The default host is the local machine; clearing it is what an operator sees when
      // they pick the kind before typing where the desk is.
      await type(field('.desk-tcp-host'), '')
      await leave(field('.desk-tcp-host'))
      expect(container.querySelector('.desk-gap')?.textContent).toBe('No desk address.')

      await type(field('.desk-tcp-host'), '10.0.0.5')
      await leave(field('.desk-tcp-host'))
      await type(field('.desk-tcp-port'), '51325')
      await leave(field('.desk-tcp-port'))
      await type(field('.desk-tcp-channel'), '3')
      await leave(field('.desk-tcp-channel'))

      expect(useStore.getState().showSettings.desk).toMatchObject({
        kind: 'midi-tcp',
        host: '10.0.0.5',
        tcpPort: 51325,
        midiChannel: 3
      })
      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends note 1 … 12 to 10.0.0.5:51325, on and off')
    })

    it('sets how many DCAs the desk has, and a strip on a cut fader goes back to its own number', async () => {
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

      // One strip on a fader that stays, one on the fader that is cut.
      await choose(field<HTMLSelectElement>('.channel-dca', 0), cast().dcas[0].id)
      await choose(field<HTMLSelectElement>('.channel-dca', 1), cast().dcas[2].id)

      await choose(field<HTMLSelectElement>('.dca-count-select'), '2')

      expect(cast().dcas.map(entry => entry.label)).toEqual(['DCA 1', 'DCA 2'])
      expect(cast().channels[0].dcaId).toBe(cast().dcas[0].id)
      // A strip pointing at a fader nothing can open is worse than the cut, so it goes
      // back to the fader of its own number — the one that is certainly still there.
      expect(cast().channels[1].dcaId).toBe(cast().dcas[1].id)
    })

    it('adds a channel on the fader of its own number, and removing one unpatches whoever was on it', async () => {
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
      // The new strip drives the fader of its own number, so a channel needs no second
      // decision before it can move the desk.
      expect(cast().channels[2].dcaId).toBe(cast().dcas[2].id)
      expect(rows()[2].querySelector<HTMLSelectElement>('.channel-dca')?.value)
        .toBe(cast().dcas[2].id)

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

    it('takes a strip off its DCA, which leaves that fader carrying nothing', async () => {
      await show({ tab: 'channels' })

      // A strip rides the fader of its own number out of the box, and “— no DCA —” is how
      // one stops moving the desk without the rest of it being reconfigured.
      await choose(field<HTMLSelectElement>('.channel-dca', 0), '')

      expect(cast().channels[0].dcaId).toBeNull()
      expect(field<HTMLSelectElement>('.channel-dca', 0).value).toBe('')
      expect(container.querySelector('.dca-carrying')?.textContent).toBe('nothing assigned')
    })

    it("overrides a DCA's address, and clearing it goes back to what the number makes", async () => {
      await show({ tab: 'channels' })

      // The field says the address its number makes by way of its placeholder, so what
      // will be sent is readable without anything being typed.
      const override = field('.dca-override', 3)
      expect(override.value).toBe('')
      expect(override.placeholder).toBe('/dca/4/on')

      await type(override, '/dca/99/mute')
      await leave(override)

      expect(cast().dcas[3].address).toBe('/dca/99/mute')
      expect(field('.dca-override', 3).value).toBe('/dca/99/mute')

      await type(field('.dca-override', 3), '')
      await leave(field('.dca-override', 3))

      // Empty is not "send nothing": it is the address the number makes again, which is
      // what the placeholder is there to say.
      expect(cast().dcas[3].address).toBeNull()
      expect(field('.dca-override', 3).value).toBe('')
      expect(field('.dca-override', 3).placeholder).toBe('/dca/4/on')
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
