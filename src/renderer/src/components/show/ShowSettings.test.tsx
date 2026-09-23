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
import { defaultShowSettings } from '../../../../shared/show'
import type {
  CastSettings, Dca, Ensemble, MicScene, Performer, RfPack, RfPlot, RfSwap, ShowChannel
} from '../../../../shared/show'

function showChannel(id: string, name: string): ShowChannel {
  return { id, name }
}

function performer(overrides: Partial<Performer> = {}): Performer {
  return { id: 'p-1', name: 'Aldonza', role: 'lead', notes: '', channelId: null, ...overrides }
}

function ensemble(overrides: Partial<Ensemble> = {}): Ensemble {
  return { id: 'ens-1', name: 'Ensemble', members: [], ...overrides }
}

function dca(overrides: Partial<Dca> = {}): Dca {
  return { id: 'dca-1', label: 'DCA 1', deskNumber: null, ...overrides }
}

function scene(id: string, name: string, dcas: MicScene['dcas'] = []): MicScene {
  return { id, name, dcas, notes: '' }
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
          scenes: { list: state.scenes ?? [], allowDuplicateAssignment: true },
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

    it('patches a performer to a strip, whose options name the strip alone', async () => {
      await show({
        tab: 'cast',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', '')],
          dcas: [dca({ id: 'dca-1', label: 'DCA 1' }), dca({ id: 'dca-2', label: 'DCA 2' })],
          performers: [performer()]
        }
      })

      const select = field<HTMLSelectElement>('.performer-channel')
      // A strip is a name and a number, and which fader it rides is the scene's decision
      // rather than the strip's — so the option says the strip and nothing else.
      expect([...select.options].map(option => option.textContent))
        .toEqual(['— unpatched —', 'Ch 1 · Ruth', 'Ch 2'])
      expect(select.value).toBe('')

      await choose(select, 'ch-1')
      expect(cast().performers[0].channelId).toBe('ch-1')
    })

    it('removes a performer: releases their pack, drops them from the cast and its ensembles, and leaves the scenes alone', async () => {
      await show({
        tab: 'cast',
        cast: {
          performers: [performer(), performer({ id: 'p-2', name: 'Sancho' })],
          ensembles: [ensemble({ members: ['p-1'] })]
        },
        scenes: [scene('s-1', 'Opening', [
          { dcaId: 'dca-1', channels: ['ch-1'], ensembles: ['ens-1'], excluded: [] }
        ])],
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
      // The scenes name channels, and the strip stays on the console after the person who
      // was on it has gone — so removing a performer touches no placement.
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
        { dcaId: 'dca-1', channels: ['ch-1'], ensembles: ['ens-1'], excluded: [] }
      ])
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
        scenes: [scene('s-1', 'Opening', [
          { dcaId: 'dca-1', channels: [], ensembles: ['ens-1'], excluded: [] }
        ])]
      })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.ensemble-remove')!.click()
      })

      expect(cast().ensembles).toEqual([])
      expect(cast().performers.map(entry => entry.name)).toEqual(['Aldonza'])
      // A row still pointing at an ensemble that is gone is a row nobody can group from
      // again, so the row stops naming it while keeping what it placed by hand.
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
    })
  })

  describe('channels', () => {
    it('opens a new show with twelve strips and twelve faders, and no per-channel fader select', async () => {
      await show({ tab: 'channels' })

      expect(container.querySelectorAll('.channel-row')).toHaveLength(12)
      expect(container.querySelectorAll('.dca-row')).toHaveLength(12)
      // A strip is a name and a number now: which fader it rides is the scene's decision,
      // made in the Scenes view, so there is nothing to choose on the row.
      expect(container.querySelector('.channel-dca')).toBeNull()
      // …and what a recall will touch is read back once, from the connection: the set it
      // writes and what this desk can be told of it.
      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends /dca/1/on … /dca/12/on to 127.0.0.1:8000, with 1 to open and 0 to close — a recall writes 12 channel mutes there and takes no assignment')
    })

    it('edits where the desk is: the host, the port and the address pattern a channel mute is sent to', async () => {
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
        .toBe('Sends /dca/1/mute … /dca/12/mute to 10.0.0.5:9000, with 1 to open and 0 to close — a recall writes 12 channel mutes there and takes no assignment')
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
        .toBe('Sends note 1 … 12 to "Yamaha", on and off — a recall writes 12 channel mutes and takes no assignment')

      // A desk that numbers its faders differently: its own number in place of the one the
      // place makes, and clearing the field goes back to derived.
      const number = field<HTMLInputElement>('.dca-override', 3)
      expect(number.value).toBe('')
      expect(number.placeholder).toBe('4')
      await type(number, '60')
      await leave(number)
      expect(cast().dcas[3].deskNumber).toBe(60)

      await type(field('.dca-override', 3), '')
      await leave(field('.dca-override', 3))
      expect(cast().dcas[3].deskNumber).toBeNull()
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
        .toBe('Sends note 1 … 12 to 10.0.0.5:51325, on and off — a recall writes 12 channel mutes and takes no assignment')
    })

    it('sets how many faders the show drives, and the rows it keeps', async () => {
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

      await choose(field<HTMLSelectElement>('.dca-count-select'), '2')

      expect(cast().dcas.map(entry => entry.label)).toEqual(['DCA 1', 'DCA 2'])
      // The strips stay: a fader cut drops nobody's strip, and a scene that placed a
      // channel on a fader that is gone keeps the entry where the row comes back.
      expect(cast().channels.map(entry => entry.name)).toEqual(['Ruth', 'Bea'])
    })

    it('adds a strip, and removing one unpatches whoever was on it and clears its placements', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')],
          performers: [performer({ channelId: 'ch-2' })]
        },
        scenes: [scene('s-1', 'Opening', [
          { dcaId: 'dca-1', channels: ['ch-2'], ensembles: [], excluded: [] }
        ])]
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
      // The placement naming the strip that went is gone with it: a cell nobody can read
      // again is worse than the cut.
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
    })
    it('refuses a fader number outside the profile’s own block', async () => {
      await show({ tab: 'channels' })

      await choose(field<HTMLSelectElement>('.desk-kind'), 'midi-tcp')
      await choose(field<HTMLSelectElement>('.desk-profile'), 'sq')

      // An SQ numbers its faders 0–7: the field says the derived number until typed in,
      // and refuses one past the block rather than sending it.
      const number = field<HTMLInputElement>('.dca-override', 0)
      expect(number.placeholder).toBe('0')
      await type(number, '60')
      await leave(number)
      expect(cast().dcas[0].deskNumber).toBeNull()
    })

    it('names the scenes that place channels on each fader', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')],
          dcas: [dca({ id: 'dca-1', label: 'DCA 1' }), dca({ id: 'dca-2', label: 'DCA 2' })]
        },
        scenes: [
          scene('s-1', 'Opening', [
            { dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }
          ]),
          scene('s-2', 'Finale', [
            { dcaId: 'dca-1', channels: ['ch-2'], ensembles: [], excluded: [] }
          ])
        ]
      })

      // A fader nobody places anything on is one a recall never writes.
      expect([...container.querySelectorAll('.dca-carrying')].map(row => row.textContent))
        .toEqual(['2 scenes place mics here', 'nothing is placed on it yet'])
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
