// The scene editor is where the running order is built, so these tests pin the two
// things an operator relies on: the mics panel follows the scene that was clicked, and
// every edit leaves the store as a message the desk can actually be sent. Text lands
// when the field is left, not on every keystroke, so a half-typed scene name is never
// written to the workspace.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SceneDialog } from './SceneDialog'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import { midiNoteMessages, oscMessages } from '../../utils/scenes'
import type { DeskChannel, MicScene, RfPack, RfPerformer } from '../../types/show'

function scene(overrides: Partial<MicScene> = {}): MicScene {
  return { id: 'scene-1', name: 'Opening', live: [], notes: '', ...overrides }
}

function pack(overrides: Partial<RfPack> = {}): RfPack {
  return { id: 'pack-1', label: 'Pack 1', channelId: null, performerId: null, notes: '', ...overrides }
}

function performer(overrides: Partial<RfPerformer> = {}): RfPerformer {
  return { id: 'perf-1', name: 'Aldonza', role: 'lead', notes: '', ...overrides }
}

function channel(overrides: Partial<DeskChannel> = {}): DeskChannel {
  return { id: 'dca-1', label: 'DCA 1', mute: null, unmute: null, ...overrides }
}

describe('SceneDialog', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: () => void

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
      deskSceneId: null
    })
  })

  interface DialogState {
    scenes?: MicScene[]
    channels?: DeskChannel[]
    packs?: RfPack[]
    performers?: RfPerformer[]
    ports?: string[]
    deskSceneId?: string | null
  }

  async function show(state: DialogState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    vi.mocked(window.winslab.midi.listPorts).mockResolvedValue(state.ports ?? [])
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          scenes: { list: state.scenes ?? [], channels: state.channels ?? [] },
          rf: {
            ...defaults.rf,
            plot: { performers: state.performers ?? [], packs: state.packs ?? [] }
          }
        },
        deskSceneId: state.deskSceneId ?? null
      })
      root.render(<SceneDialog onClose={onClose} />)
    })
  }

  function scenes() {
    return useStore.getState().showSettings.scenes
  }

  function field<T extends HTMLElement = HTMLInputElement>(selector: string, index = 0): T {
    return container.querySelectorAll<T>(selector)[index]
  }

  function summary(): string {
    return container.querySelector('.group-summary')!.textContent ?? ''
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

  it('opens as a dialog and closes from Escape, the backdrop and the close button', async () => {
    await show()

    const dialog = container.querySelector('.scene-dialog')!
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('Scenes')

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)

    await act(async () => { container.querySelector<HTMLElement>('.scene-overlay')!.click() })
    expect(onClose).toHaveBeenCalledTimes(2)

    await act(async () => { container.querySelector<HTMLButtonElement>('.scene-close')!.click() })
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('adds scenes, renames one when the field is left, and removes one', async () => {
    await show()
    expect(container.querySelectorAll('.scene-row')).toHaveLength(0)

    await act(async () => { container.querySelector<HTMLButtonElement>('.scene-add')!.click() })
    await act(async () => { container.querySelector<HTMLButtonElement>('.scene-add')!.click() })
    expect(container.querySelectorAll('.scene-row')).toHaveLength(2)
    expect(scenes().list.map(entry => entry.name)).toEqual(['Scene 1', 'Scene 2'])

    const name = field('.scene-name-input')
    await type(name, 'Entrance')
    // Half a name is not a rename: the scene list is untouched until the field is left.
    expect(scenes().list[0].name).toBe('Scene 1')

    await leave(name)
    expect(scenes().list[0].name).toBe('Entrance')
    expect(field('.scene-name-input').value).toBe('Entrance')

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('.scene-row .scene-remove')[1].click()
    })
    expect(scenes().list.map(entry => entry.name)).toEqual(['Entrance'])
    expect(container.querySelectorAll('.scene-row')).toHaveLength(1)
  })

  it('opens on the scene the desk was last told about, falling back to the first', async () => {
    await show({
      scenes: [scene({ id: 'a', name: 'Opening' }), scene({ id: 'b', name: 'Ballad' })],
      deskSceneId: 'b'
    })
    expect(container.querySelectorAll('.scene-row')[1].getAttribute('data-selected')).toBe('true')
    expect(container.querySelectorAll('.scene-row')[0].getAttribute('data-selected')).toBe('false')
  })

  it('falls back to the first scene when the desk scene is no longer in the list', async () => {
    await show({
      scenes: [scene({ id: 'a', name: 'Opening' }), scene({ id: 'b', name: 'Ballad' })],
      deskSceneId: 'gone'
    })
    expect(container.querySelectorAll('.scene-row')[0].getAttribute('data-selected')).toBe('true')
  })

  it('shows the mics of the row that was clicked, named for the pack and its performer', async () => {
    await show({
      scenes: [
        scene({ id: 'a', name: 'Opening', live: ['pack-1'] }),
        scene({ id: 'b', name: 'Ballad', live: [] })
      ],
      performers: [performer({ id: 'perf-1', name: 'Aldonza' })],
      packs: [
        pack({ id: 'pack-1', label: 'Pack 1', performerId: 'perf-1' }),
        pack({ id: 'pack-2', label: 'Pack 2' })
      ]
    })

    const rows = () => container.querySelectorAll('.scene-row')
    const toggles = () => [...container.querySelectorAll<HTMLInputElement>('.scene-mic-toggle')]

    expect([...container.querySelectorAll('.scene-mic-label')].map(el => el.textContent))
      .toEqual(['Pack 1 — Aldonza', 'Pack 2'])
    expect(toggles().map(box => box.checked)).toEqual([true, false])

    await act(async () => { (rows()[1] as HTMLElement).click() })

    expect(rows()[1].getAttribute('data-selected')).toBe('true')
    expect(rows()[0].getAttribute('data-selected')).toBe('false')
    // The panel below followed the click: this is Ballad, where nothing is open.
    expect(toggles().map(box => box.checked)).toEqual([false, false])
  })

  it('opens and closes a mic in the scene being edited', async () => {
    await show({ scenes: [scene({ id: 'a' })], packs: [pack({ id: 'pack-1' })] })

    expect(container.querySelector('.scene-mic-row')!.getAttribute('data-live')).toBe('false')

    await act(async () => { field<HTMLInputElement>('.scene-mic-toggle').click() })
    expect(scenes().list[0].live).toEqual(['pack-1'])
    expect(container.querySelector('.scene-mic-row')!.getAttribute('data-live')).toBe('true')

    await act(async () => { field<HTMLInputElement>('.scene-mic-toggle').click() })
    expect(scenes().list[0].live).toEqual([])
    expect(container.querySelector('.scene-mic-row')!.getAttribute('data-live')).toBe('false')
  })

  it('says the plot is empty when there are no packs to open', async () => {
    await show({ scenes: [scene()], packs: [] })

    expect(container.querySelectorAll('.scene-mic-row')).toHaveLength(0)
    expect(container.querySelector('.scene-mics-empty')!.textContent)
      .toBe('The mic plot is empty — add packs in Edit plot…')
  })

  it('adds a desk group and configures MIDI delivery', async () => {
    await show({ ports: ['Yamaha', 'IEM rack'] })

    await act(async () => { container.querySelector<HTMLButtonElement>('.group-add')!.click() })
    expect(scenes().channels.map(entry => entry.label)).toEqual(['DCA 1'])
    expect(container.querySelectorAll('.group-row')).toHaveLength(1)
    // A new group has no delivery yet, so it is not being sent anywhere.
    expect(summary()).toBe('nothing / nothing')

    await choose(field<HTMLSelectElement>('.group-delivery'), 'midi')
    await choose(field<HTMLSelectElement>('.group-port'), 'Yamaha')
    await choose(field<HTMLSelectElement>('.group-channel'), '3')
    await choose(field<HTMLSelectElement>('.group-note'), '12')

    const expected = midiNoteMessages('Yamaha', 3, 12)
    const configured = scenes().channels[0]
    expect(configured.unmute).toEqual(expected.unmute)
    expect(configured.mute).toEqual(expected.mute)
    expect(summary()).toBe('noteOn ch3 → "Yamaha" / noteOff ch3 → "Yamaha"')

    const label = field('.group-label')
    await type(label, 'DCA 3 — Ensemble')
    expect(scenes().channels[0].label).toBe('DCA 1')
    await leave(label)
    expect(scenes().channels[0].label).toBe('DCA 3 — Ensemble')
  })

  it('switches a group to OSC and sends one address for both states', async () => {
    await show({ channels: [channel({ id: 'dca-1', label: 'DCA 2', ...midiNoteMessages('Yamaha', 3, 12) })] })

    await choose(field<HTMLSelectElement>('.group-delivery'), 'osc')

    await type(field('.group-host'), '10.0.0.5')
    await leave(field('.group-host'))
    await type(field('.group-osc-port'), '9000')
    await leave(field('.group-osc-port'))
    await type(field('.group-address'), '/dca/2/mute')
    await leave(field('.group-address'))

    const expected = oscMessages('10.0.0.5', 9000, '/dca/2/mute')
    expect(scenes().channels[0].unmute).toEqual(expected.unmute)
    expect(scenes().channels[0].mute).toEqual(expected.mute)
    expect(summary()).toBe('OSC /dca/2/mute 1 → 10.0.0.5:9000 / OSC /dca/2/mute 0 → 10.0.0.5:9000')
  })

  it('leaves a group alone on recall when its delivery is none', async () => {
    await show({ channels: [channel({ ...midiNoteMessages('Yamaha', 3, 12) })] })

    await choose(field<HTMLSelectElement>('.group-delivery'), 'none')

    expect(container.querySelector('.group-port')).toBeNull()
    expect(scenes().channels[0].unmute).toBeNull()
    expect(scenes().channels[0].mute).toBeNull()
    expect(summary()).toBe('nothing / nothing')
  })

  it('removes a group and clears the pointer on the packs that fed it', async () => {
    await show({
      channels: [channel({ id: 'dca-1' }), channel({ id: 'dca-2', label: 'DCA 2' })],
      packs: [
        pack({ id: 'pack-1', label: 'Pack 1', deskChannelId: 'dca-1' }),
        pack({ id: 'pack-2', label: 'Pack 2', deskChannelId: 'dca-1' }),
        pack({ id: 'pack-3', label: 'Pack 3', deskChannelId: 'dca-2' }),
        pack({ id: 'pack-4', label: 'Pack 4', deskChannelId: null })
      ]
    })

    await act(async () => { field<HTMLButtonElement>('.group-remove', 0).click() })

    expect(scenes().channels.map(entry => entry.id)).toEqual(['dca-2'])
    expect(useStore.getState().showSettings.rf.plot.packs
      .map(entry => [entry.id, entry.deskChannelId])).toEqual([
      ['pack-1', null],
      ['pack-2', null],
      ['pack-3', 'dca-2'],
      ['pack-4', null]
    ])
  })

  it('keeps the port a group is patched to even when the service is not reporting it', async () => {
    await show({
      channels: [channel({ ...midiNoteMessages('FOH desk', 1, 1) })],
      ports: ['Yamaha']
    })

    const options = [...container.querySelectorAll<HTMLOptionElement>('.group-port option')]
    expect(options.map(option => option.getAttribute('value'))).toEqual(['FOH desk', 'Yamaha'])
    expect(field<HTMLSelectElement>('.group-port').value).toBe('FOH desk')
  })
})
