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
import { defaultShowSettings } from '../../../../shared/show'
import type {
  CastSettings, Dca, DeskSettings, Ensemble, MicScene, Performer, RfPack, RfPlot, RfSwap, ShowChannel
} from '../../../../shared/show'

function showChannel(id: string, name: string): ShowChannel {
  return { id, name }
}

function performer(overrides: Partial<Performer> = {}): Performer {
  return { id: 'p-1', name: 'Aldonza', role: 'lead', notes: '', channelId: null, ...overrides }
}

function ensemble(overrides: Partial<Ensemble> = {}): Ensemble {
  return { id: 'ens-1', name: 'Ensemble', channelIds: [], ...overrides }
}

function dca(overrides: Partial<Dca> = {}): Dca {
  return { id: 'dca-1', deskNumber: null, ...overrides }
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
      modals: 0,
      log: [],
      showDevices: []
    })
  })

  interface DialogState {
    cast?: Partial<CastSettings>
    desk?: Partial<DeskSettings>
    scenes?: MicScene[]
    plot?: RfPlot
    swaps?: RfSwap[]
    ports?: string[]
    tab?: ShowSettingsTab
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
          desk: { ...defaults.desk, ...state.desk },
          cast: { ...defaults.cast, ...state.cast },
          scenes: { list: state.scenes ?? [], allowDuplicateAssignment: true },
          rf: { ...defaults.rf, plot: state.plot ?? { packs: [] }, swaps: state.swaps ?? [] }
        },
        showSettingsTab: state.tab ?? 'channels'
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
    expect(container.querySelector('.plot-add-pack')).not.toBeNull()
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
          dcas: [dca({ id: 'dca-1' }), dca({ id: 'dca-2' })],
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

    it('removes a performer: releases their pack, drops them from the cast, and leaves the strips and the scenes alone', async () => {
      await show({
        tab: 'cast',
        cast: {
          performers: [performer(), performer({ id: 'p-2', name: 'Sancho' })],
          ensembles: [ensemble({ channelIds: ['ch-1'] })]
        },
        scenes: [scene('s-1', 'Opening', [
          { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' },
          { dcaId: 'dca-2', kind: 'ensemble', memberId: 'ens-1' }
        ])],
        plot: { packs: [pack({ performerId: 'p-1' })] }
      })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.performer-remove')!.click()
      })

      expect(cast().performers.map(entry => entry.id)).toEqual(['p-2'])
      // The group holds strips, and the strip they were standing on is still there: the
      // person leaving is the plot's business and the group's membership is not.
      expect(cast().ensembles).toHaveLength(1)
      expect(cast().ensembles[0].channelIds).toEqual(['ch-1'])
      expect(useStore.getState().showSettings.rf.plot.packs[0].performerId).toBeNull()
      expect(useStore.getState().showSettings.rf.swaps).toHaveLength(1)
      expect(useStore.getState().log[0]?.message).toBe('Swap: Pack 1 Aldonza → unassigned')
      // The scenes name channels and ensembles, both of which outlive the person: the strip
      // stays on the console and the group stays in the cast, so nothing placed moves.
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
        { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' },
        { dcaId: 'dca-2', kind: 'ensemble', memberId: 'ens-1' }
      ])
    })
  })

  it('shows the cast alone: groups are built from the strips a row names, not from a section here', async () => {
    // The ensembles section is gone: a group is made in the Scenes view, from the strips
    // the row it is opened from should carry. A show that still carries groups from an
    // earlier build keeps them in the cast, and this tab shows nothing of them.
    await show({
      tab: 'cast',
      cast: { performers: [performer()], ensembles: [ensemble({ channelIds: ['ch-1'] })] }
    })

    expect(container.querySelectorAll('.performer-row')).toHaveLength(1)
    // The section this tab has is the cast's: read off the rows the tab draws rather than a
    // class for the ensembles it does not draw, which would pass against any tree at all. A
    // group's own section coming back would bring a second one, and a row of its own with it.
    expect(container.querySelectorAll('.show-section')).toHaveLength(1)
    expect(container.querySelector('.show-section-title')?.textContent).toBe('Performers')
    expect(cast().ensembles).toHaveLength(1)
  })

  describe('channels', () => {
    it('opens a new show with twelve strips and twelve faders, and no per-channel fader select', async () => {
      await show({ tab: 'channels' })

      expect(container.querySelectorAll('.channel-row')).toHaveLength(12)
      expect(container.querySelectorAll('.dca-row')).toHaveLength(12)
      // A strip is a name and a number now: which fader it rides is the scene's decision,
      // made in the Scenes view, so nothing in a row routes — asserted against what the rows
      // actually hold, because a class the product no longer writes would pass whatever the
      // row grew.
      expect(container.querySelectorAll('.channel-row select')).toHaveLength(0)
      // A fader is its number and nothing else: no label to keep in step with the place
      // the desk is actually told, and the row's one field is the override.
      expect([...container.querySelectorAll('.dca-row .dca-number')].map(node => node.textContent))
        .toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
      expect(container.querySelector('.dca-label')).toBeNull()
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

    it('sends nothing when the show has no strips', async () => {
      // A recall walks the show's own channels: with the count at none there is no strip
      // for a range to name, on OSC or on a MIDI desk.
      await show({ tab: 'channels', cast: { channels: [], dcas: [] }, ports: ['Yamaha'] })

      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends nothing to 127.0.0.1:8000 — the show has no channels')

      await choose(field<HTMLSelectElement>('.desk-kind'), 'midi')
      await choose(field<HTMLSelectElement>('.desk-midi-port'), 'Yamaha')

      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends nothing to "Yamaha" — the show has no channels')
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
      // place makes, and clearing the field goes back to derived. The row is a number and
      // that one field — nothing else about a fader is editable.
      expect(container.querySelectorAll('.dca-row input')).toHaveLength(12)
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

    it('sets how many faders the show drives, and drops the scenes’ rows for the places that go', async () => {
      await show({
        tab: 'channels',
        cast: { channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')], dcas: [] }
      })

      expect(field<HTMLSelectElement>('.dca-count-select').value).toBe('0')
      expect(container.querySelector('.dca-row')).toBeNull()

      await choose(field<HTMLSelectElement>('.dca-count-select'), '3')

      expect(cast().dcas).toHaveLength(3)
      expect(cast().dcas.map(entry => entry.deskNumber)).toEqual([null, null, null])
      expect([...container.querySelectorAll('.dca-row .dca-number')].map(node => node.textContent))
        .toEqual(['1', '2', '3'])
      expect(container.querySelector('.dca-label')).toBeNull()

      // A scene that places a strip on the fader the shrink is about to take.
      const third = cast().dcas[2].id
      await act(async () => {
        useStore.getState().updateScenesSettings({
          list: [scene('s-1', 'Opening', [
            { dcaId: third, kind: 'channel', memberId: 'ch-1' }
          ])]
        })
      })

      await choose(field<HTMLSelectElement>('.dca-count-select'), '2')

      expect(cast().dcas).toHaveLength(2)
      expect([...container.querySelectorAll('.dca-row .dca-number')].map(node => node.textContent))
        .toEqual(['1', '2'])
      // The strips stay — a fader cut drops nobody's strip — and the scene's row for the
      // place that went goes with it, so a fader grown back comes back empty.
      expect(cast().channels.map(entry => entry.name)).toEqual(['Ruth', 'Bea'])
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])

      await choose(field<HTMLSelectElement>('.dca-count-select'), '3')
      expect(cast().dcas).toHaveLength(3)
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([])
    })

    it('sizes the console from its own count, and a shrink takes everything that named the strips that went', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [
            showChannel('ch-1', 'Ruth'),
            showChannel('ch-2', 'Bea'),
            showChannel('ch-3', 'Nell')
          ],
          performers: [performer({ channelId: 'ch-3' })]
        },
        scenes: [scene('s-1', 'Opening', [
          { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' },
          { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-3' }
        ])]
      })

      expect(field<HTMLSelectElement>('.channel-count-select').value).toBe('3')

      await choose(field<HTMLSelectElement>('.channel-count-select'), '4')

      expect(cast().channels).toHaveLength(4)
      expect(container.querySelectorAll('.channel-row')).toHaveLength(4)
      // What was there is the same strip: a count appends.
      expect(cast().channels.slice(0, 3).map(entry => entry.name)).toEqual(['Ruth', 'Bea', 'Nell'])
      // Nothing was dropped, so no scene moved and nobody was unpatched.
      expect(cast().performers[0].channelId).toBe('ch-3')
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
        { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' },
        { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-3' }
      ])

      await choose(field<HTMLSelectElement>('.channel-count-select'), '2')

      expect(cast().channels.map(entry => entry.name)).toEqual(['Ruth', 'Bea'])
      expect(container.querySelectorAll('.channel-row')).toHaveLength(2)
      // The mic on the strip that went is patched to nothing, and the row that held it goes
      // with it — a row left saying nothing is one nobody can read again.
      expect(cast().performers[0].channelId).toBeNull()
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
        { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' }
      ])

      // One edit, so one undo puts the count, the placements and the patch back together.
      await act(async () => { useStore.getState().undo() })
      expect(cast().channels).toHaveLength(4)
      expect(cast().performers[0].channelId).toBe('ch-3')
      expect(useStore.getState().showSettings.scenes.list[0].dcas).toEqual([
        { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' },
        { dcaId: 'dca-2', kind: 'channel', memberId: 'ch-3' }
      ])
    })

    it('stops the count at the desk model’s own ceiling, and reports a set larger than it', async () => {
      const many = Array.from({ length: 52 }, (_, index) => showChannel(`ch-${index + 1}`, ''))
      await show({ tab: 'channels', cast: { channels: many } })

      // No desk model is in force yet, so there is no ceiling to offer past the dial's own
      // cap — and with an OSC desk there never is one.
      const counts = (): string[] =>
        [...field<HTMLSelectElement>('.channel-count-select').options].map(option => option.value)
      expect(counts()[counts().length - 1]).toBe('96')

      await choose(field<HTMLSelectElement>('.desk-kind'), 'midi-tcp')
      await choose(field<HTMLSelectElement>('.desk-profile'), 'sq')

      // The options stop at the number the profile states, and a show that is larger keeps
      // its own whole range — so the count it has, and every size between it and the desk's
      // number, stay reachable rather than the hatch being one value wide.
      expect(counts()).toContain('48')
      expect(counts()).toContain('49')
      expect(counts()).toContain('51')
      expect(counts()[counts().length - 1]).toBe('52')
      expect(counts()).toHaveLength(53)
      expect(container.querySelectorAll('.channel-row')).toHaveLength(52)

      // The gap is the preview's, named with the number it exceeded — and the fader list
      // keeps its own clause beside it, since this show drives twelve faders and the SQ
      // has eight.
      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends an SQ’s channel mutes — NRPN page 00 on channel 1 — to 127.0.0.1:51325, and its assignment over the desk’s own control service — a recall writes 52 channels and nothing else; the desk has 48 inputs, so 4 channels are past its last one; the desk has 8, so 4 of the show’s DCAs are not sent')
    })

    it('stops the dial at the desk model’s number for a show inside it', async () => {
      // A show the desk can take: the options end at the desk's own number, so the dial
      // never offers a size the profile says it cannot be told about.
      await show({
        tab: 'channels',
        cast: { channels: Array.from({ length: 12 }, (_, index) => showChannel(`ch-${index + 1}`, '')) },
        desk: { kind: 'midi-tcp', host: '10.0.0.5', profile: 'sq' }
      })

      const counts = [...field<HTMLSelectElement>('.channel-count-select').options]
        .map(option => option.value)
      expect(counts).toHaveLength(49)
      expect(counts[counts.length - 1]).toBe('48')
      expect(container.querySelector('.desk-preview')).not.toBeNull()
      expect(container.querySelector('.desk-preview')?.textContent).not.toContain('inputs')
    })

    it('counts one channel over the line in the singular', async () => {
      const many = Array.from({ length: 49 }, (_, index) => showChannel(`ch-${index + 1}`, ''))
      await show({
        tab: 'channels',
        cast: { channels: many, dcas: [] },
        desk: { kind: 'midi-tcp', host: '10.0.0.5', profile: 'sq' }
      })

      expect(container.querySelector('.desk-preview')?.textContent)
        .toContain('the desk has 48 inputs, so 1 channel is past its last one')
    })

    it('names an Avantis’s own inputs the same way', async () => {
      // A hundred strips on the widest profile here: the Avantis's ceiling is what is
      // exceeded, and it is named beside the model that stated it.
      const many = Array.from({ length: 100 }, (_, index) => showChannel(`ch-${index + 1}`, ''))
      await show({
        tab: 'channels',
        cast: { channels: many, dcas: [] },
        desk: { kind: 'midi-tcp', host: '10.0.0.5', profile: 'avantis', midiChannel: 12 }
      })

      expect(container.querySelector('.desk-preview')?.textContent)
        .toBe('Sends an Avantis’s channel mutes — note-on, 7F on and 3F off, on channel 12 — to 10.0.0.5:51325, and its assignment as NRPN 40 on the same channel — a recall writes 100 channels and nothing else; the desk has 96 inputs, so 4 channels are past its last one')
    })

    it('keeps the dial open where no desk model is in force, whatever the profile field holds', async () => {
      // The profile is a fact about a MIDI desk. A show reached over OSC that still carries
      // an SQ from an earlier setup is bounded by nothing the profile says — reading the
      // field anyway would hide every option above 48 from an OSC show.
      const many = Array.from({ length: 52 }, (_, index) => showChannel(`ch-${index + 1}`, ''))
      await show({
        tab: 'channels',
        cast: { channels: many },
        desk: { kind: 'osc', host: '10.0.0.5', profile: 'sq' }
      })

      const counts = [...field<HTMLSelectElement>('.channel-count-select').options]
        .map(option => option.value)
      expect(counts).toContain('49')
      expect(counts[counts.length - 1]).toBe('96')
    })

    it('turns the one-fader-per-channel rule off from the faders it is about', async () => {
      await show({ tab: 'channels' })

      const rule = container.querySelector<HTMLInputElement>('.dca-duplicates')!
      // On by default: a chorus master on one fader and its members spread across others
      // is how a show is usually built.
      expect(rule.checked).toBe(true)
      const before = useStore.getState().past.length

      await act(async () => { rule.click() })

      expect(useStore.getState().showSettings.scenes.allowDuplicateAssignment).toBe(false)
      expect(useStore.getState().past).toHaveLength(before + 1)

      await act(async () => { useStore.getState().undo() })
      expect(useStore.getState().showSettings.scenes.allowDuplicateAssignment).toBe(true)
    })

    it('adds a strip, and removing one unpatches whoever was on it and clears its placements', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')],
          performers: [performer({ channelId: 'ch-2' })]
        },
        scenes: [scene('s-1', 'Opening', [
          { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' }
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

      // Fader 9 of the show's twelve is past the SQ's own list: every write for it is
      // refused, so the field advertises no number at all — 8 included.
      expect(field<HTMLInputElement>('.dca-override', 8).placeholder).toBe('')
      expect(field<HTMLInputElement>('.dca-override', 8).max).toBe('7')
    })

    it('names the scenes that place channels on each fader', async () => {
      await show({
        tab: 'channels',
        cast: {
          channels: [showChannel('ch-1', 'Ruth'), showChannel('ch-2', 'Bea')],
          dcas: [dca({ id: 'dca-1' }), dca({ id: 'dca-2' })]
        },
        scenes: [
          scene('s-1', 'Opening', [
            { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-1' }
          ]),
          scene('s-2', 'Finale', [
            { dcaId: 'dca-1', kind: 'channel', memberId: 'ch-2' }
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
