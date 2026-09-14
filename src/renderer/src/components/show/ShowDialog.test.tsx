// The Show panel is the one place DCA routing is set up: performers, the ensembles that
// group them, and the desk groups they drive. These tests pin the CRUD in each section,
// the resolution a performer's own group takes over their ensemble's, and that removing
// something cleans up whatever pointed at it — the same discipline the old Scenes drawer
// had for packs, now for performers and ensembles.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ShowDialog } from './ShowDialog'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import { midiNoteMessages, oscMessages } from '../../utils/cast'
import type { CastSettings, DeskChannel, MicScene, RfEnsemble, RfPerformer } from '../../types/show'

function performer(overrides: Partial<RfPerformer> = {}): RfPerformer {
  return {
    id: 'p-1', name: 'Aldonza', role: 'lead', notes: '',
    ensembleId: null, deskChannelId: null, ...overrides
  }
}

function ensemble(overrides: Partial<RfEnsemble> = {}): RfEnsemble {
  return { id: 'ens-1', name: 'Ensemble', deskChannelId: null, ...overrides }
}

function group(overrides: Partial<DeskChannel> = {}): DeskChannel {
  return { id: 'dca-1', label: 'DCA 1', mute: null, unmute: null, ...overrides }
}

describe('ShowDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: Mock
  let midiSend: Mock
  let oscSend: Mock
  let listPorts: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn()
    midiSend = window.winslab.midi.send as unknown as Mock
    oscSend = window.winslab.osc.send as unknown as Mock
    listPorts = window.winslab.midi.listPorts as unknown as Mock
    midiSend.mockReset().mockResolvedValue({ ok: true })
    oscSend.mockReset().mockResolvedValue({ ok: true })
    listPorts.mockReset().mockResolvedValue([])
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useStore.setState({ showSettings: defaultShowSettings(), log: [] })
  })

  interface DialogState {
    cast?: Partial<CastSettings>
    scenes?: MicScene[]
    ports?: string[]
  }

  async function show(state: DialogState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    listPorts.mockResolvedValue(state.ports ?? [])
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          cast: { ...defaults.cast, ...state.cast },
          scenes: { list: state.scenes ?? [] }
        }
      })
      root.render(<ShowDialog onClose={onClose} />)
    })
  }

  function cast(): CastSettings {
    return useStore.getState().showSettings.cast
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

  it('opens as a dialog and closes from Escape, the backdrop and the footer', async () => {
    await show()

    const dialog = container.querySelector('.show-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Show')

    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => { container.querySelector<HTMLElement>('.show-overlay')!.click() })
    expect(onClose).toHaveBeenCalledTimes(2)

    await act(async () => { container.querySelector<HTMLButtonElement>('.show-close')!.click() })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  describe('performers', () => {
    it('adds a performer unassigned to any ensemble or group', async () => {
      await show()

      await act(async () => { container.querySelector<HTMLButtonElement>('.performer-add')!.click() })

      expect(cast().performers).toHaveLength(1)
      expect(cast().performers[0]).toMatchObject({ ensembleId: null, deskChannelId: null })
    })

    it('renames a performer and sets their role and notes, committing when the field is left', async () => {
      await show({ cast: { performers: [performer()] } })

      const name = field('.performer-name')
      await type(name, 'Aldonza (cover)')
      // Half a name is not a rename: the cast is untouched until the field is left.
      expect(cast().performers[0].name).toBe('Aldonza')

      await leave(name)
      expect(cast().performers[0].name).toBe('Aldonza (cover)')

      await type(field('.performer-role'), 'standby')
      await leave(field('.performer-role'))
      expect(cast().performers[0].role).toBe('standby')
    })

    it("gives a performer's own group priority over their ensemble's", async () => {
      await show({
        cast: {
          performers: [performer({ ensembleId: 'ens-1' })],
          ensembles: [ensemble({ deskChannelId: 'dca-2' })],
          groups: [group({ id: 'dca-1' }), group({ id: 'dca-2', label: 'DCA 2' })]
        }
      })

      const groupSelect = field<HTMLSelectElement>('.performer-group')
      expect(groupSelect.querySelector('option')!.textContent).toBe('— use ensemble —')

      await choose(groupSelect, 'dca-1')
      expect(cast().performers[0].deskChannelId).toBe('dca-1')
    })

    it('removes a performer: releases their packs, drops them from scenes, keeps the ensemble', async () => {
      const scene: MicScene = { id: 's-1', name: 'Opening', live: ['p-1', 'p-2'], notes: '' }
      await show({
        cast: {
          performers: [performer({ ensembleId: 'ens-1' }), performer({ id: 'p-2', name: 'Sancho' })],
          ensembles: [ensemble()]
        },
        scenes: [scene]
      })
      useStore.setState({
        showSettings: {
          ...useStore.getState().showSettings,
          rf: {
            ...useStore.getState().showSettings.rf,
            plot: { packs: [{ id: 'k1', label: 'Pack 1', channelId: null, performerId: 'p-1', notes: '' }] }
          }
        }
      })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.performer-remove')!.click()
      })

      expect(cast().performers.map(p => p.id)).toEqual(['p-2'])
      expect(cast().ensembles).toHaveLength(1)
      expect(useStore.getState().showSettings.rf.plot.packs[0].performerId).toBeNull()
      expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p-2'])
      expect(useStore.getState().log[0]?.message).toBe('Swap: Pack 1 Aldonza → unassigned')
    })
  })

  describe('ensembles', () => {
    it('names a new ensemble after the ones already there', async () => {
      await show()

      await act(async () => { container.querySelector<HTMLButtonElement>('.ensemble-add')!.click() })
      await act(async () => { container.querySelector<HTMLButtonElement>('.ensemble-add')!.click() })

      expect(cast().ensembles.map(e => e.name)).toEqual(['Ensemble 1', 'Ensemble 2'])
    })

    it('renames an ensemble and sets its desk group', async () => {
      await show({ cast: { ensembles: [ensemble()], groups: [group()] } })

      await type(field('.ensemble-name'), 'Chorus')
      await leave(field('.ensemble-name'))
      expect(cast().ensembles[0].name).toBe('Chorus')

      await choose(field<HTMLSelectElement>('.ensemble-group'), 'dca-1')
      expect(cast().ensembles[0].deskChannelId).toBe('dca-1')
    })

    it('adds a member from the picker, and moving them to another ensemble takes them out of the first', async () => {
      await show({
        cast: {
          performers: [performer(), performer({ id: 'p-2', name: 'Sancho' })],
          ensembles: [ensemble({ id: 'ens-1', name: 'Leads' }), ensemble({ id: 'ens-2', name: 'Chorus' })]
        }
      })

      const rows = () => [...container.querySelectorAll('.ensemble-row')]
      await act(async () => {
        rows()[0].querySelector<HTMLSelectElement>('.member-add')!.value = 'p-1'
        rows()[0].querySelector<HTMLSelectElement>('.member-add')!
          .dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(cast().performers.find(p => p.id === 'p-1')?.ensembleId).toBe('ens-1')
      expect(rows()[0].querySelectorAll('.member-chip')).toHaveLength(1)

      // Picking the same performer from the second ensemble's own picker moves them.
      await act(async () => {
        rows()[1].querySelector<HTMLSelectElement>('.member-add')!.value = 'p-1'
        rows()[1].querySelector<HTMLSelectElement>('.member-add')!
          .dispatchEvent(new Event('change', { bubbles: true }))
      })
      expect(cast().performers.find(p => p.id === 'p-1')?.ensembleId).toBe('ens-2')
      expect(rows()[0].querySelectorAll('.member-chip')).toHaveLength(0)
      expect(rows()[1].querySelectorAll('.member-chip')).toHaveLength(1)
    })

    it("removing a chip's ✕ takes the performer out without removing the ensemble", async () => {
      await show({ cast: { performers: [performer({ ensembleId: 'ens-1' })], ensembles: [ensemble()] } })

      await act(async () => {
        container.querySelector<HTMLButtonElement>('.member-chip button')!.click()
      })

      expect(cast().performers[0].ensembleId).toBeNull()
      expect(cast().ensembles).toHaveLength(1)
    })

    it('removing an ensemble releases its members rather than removing them', async () => {
      await show({ cast: { performers: [performer({ ensembleId: 'ens-1' })], ensembles: [ensemble()] } })

      await act(async () => { container.querySelector<HTMLButtonElement>('.ensemble-remove')!.click() })

      expect(cast().ensembles).toEqual([])
      expect(cast().performers[0].ensembleId).toBeNull()
      expect(cast().performers[0].name).toBe('Aldonza')
    })
  })

  describe('desk groups', () => {
    it('adds a group and configures MIDI delivery', async () => {
      await show({ ports: ['Yamaha', 'IEM rack'] })

      expect(container.querySelectorAll('.group-row')).toHaveLength(0)
      await act(async () => { container.querySelector<HTMLButtonElement>('.group-add')!.click() })
      expect(cast().groups.map(g => g.label)).toEqual(['DCA 1'])

      const row = container.querySelectorAll('.group-row')[0]
      await choose(row.querySelector<HTMLSelectElement>('.group-delivery')!, 'midi')
      await choose(row.querySelector<HTMLSelectElement>('.group-port')!, 'Yamaha')
      await choose(row.querySelector<HTMLSelectElement>('.group-channel')!, '3')
      await choose(row.querySelector<HTMLSelectElement>('.group-note')!, '12')

      const expected = midiNoteMessages('Yamaha', 3, 12)
      expect(cast().groups[0].unmute).toEqual(expected.unmute)
      expect(cast().groups[0].mute).toEqual(expected.mute)
    })

    it('switches a group to OSC and sends one address for both states', async () => {
      await show({ cast: { groups: [group({ ...midiNoteMessages('Yamaha', 3, 12) })] } })

      await choose(field<HTMLSelectElement>('.group-delivery'), 'osc')
      await type(field('.group-host'), '10.0.0.5')
      await leave(field('.group-host'))
      await type(field('.group-osc-port'), '9000')
      await leave(field('.group-osc-port'))
      await type(field('.group-address'), '/dca/1/mute')
      await leave(field('.group-address'))

      const expected = oscMessages('10.0.0.5', 9000, '/dca/1/mute')
      expect(cast().groups[0].unmute).toEqual(expected.unmute)
      expect(cast().groups[0].mute).toEqual(expected.mute)
    })

    it('removes a group and clears the pointer on performers and ensembles that fed it', async () => {
      await show({
        cast: {
          groups: [group()],
          performers: [performer({ deskChannelId: 'dca-1' })],
          ensembles: [ensemble({ deskChannelId: 'dca-1' })]
        }
      })

      await act(async () => { container.querySelector<HTMLButtonElement>('.group-remove')!.click() })

      expect(cast().groups).toEqual([])
      expect(cast().performers[0].deskChannelId).toBeNull()
      expect(cast().ensembles[0].deskChannelId).toBeNull()
    })

    it('shows which performers and ensembles feed each group', async () => {
      await show({
        cast: {
          groups: [group({ id: 'dca-1' }), group({ id: 'dca-2', label: 'DCA 2' })],
          performers: [
            performer({ id: 'p-1', name: 'Aldonza', deskChannelId: 'dca-1' }),
            performer({ id: 'p-2', name: 'Sancho', ensembleId: 'ens-1' })
          ],
          ensembles: [ensemble({ deskChannelId: 'dca-2' })]
        }
      })

      const rows = [...container.querySelectorAll('.group-row')]
      expect(rows.map(row => row.querySelector('.group-carrying')?.textContent)).toEqual([
        'Aldonza',
        'Ensemble'
      ])
    })
  })
})
