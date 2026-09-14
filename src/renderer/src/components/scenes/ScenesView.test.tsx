// Scenes is the view the operator lives in at curtain up and the only place the show is
// edited: a row per pack, a column per scene, the column the desk was last taken to lit
// where the show is, and the desk groups in a drawer below. These tests pin that glance,
// every editing control the old dialog used to hold, the two presses that move the desk —
// a column's Recall and the header's Apply — and the run mode it opens in, which stops
// every edit while leaving recall, Apply and Mics off working.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenesView } from './ScenesView'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import { midiNoteMessages, oscMessages } from '../../utils/scenes'
import type {
  DeskChannel,
  MicScene,
  RfPack,
  RfPerformer,
  RfPlot,
  ScenesSettings
} from '../../types/show'

const PORT = 'Desk'

const ENSEMBLE: DeskChannel = {
  id: 'dca-ensemble',
  label: 'DCA 1 — Ensemble',
  unmute: { kind: 'midi', portName: PORT, message: { kind: 'noteOn', channel: 0, note: 60, velocity: 127 } },
  mute: { kind: 'midi', portName: PORT, message: { kind: 'noteOff', channel: 0, note: 60, velocity: 0 } }
}

const BAND: DeskChannel = {
  id: 'dca-band',
  label: 'DCA 2 — Band',
  unmute: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2', args: [1] },
  mute: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2', args: [0] }
}

const PERFORMERS: RfPerformer[] = [
  { id: 'f1', name: 'Ada', role: 'Lead', notes: '' },
  { id: 'f2', name: 'Bea', role: 'MD', notes: '' }
]

function pack(
  id: string,
  label: string,
  deskChannelId: string | null,
  performerId: string | null = null
): RfPack {
  return { id, label, channelId: null, performerId, notes: '', deskChannelId }
}

// Pack 1 on the ensemble, Pack 3 on the band: recalling a scene opens one group and
// closes the other, which is the handful of messages the whole feature exists to send.
const PLOT: RfPlot = {
  performers: PERFORMERS,
  packs: [
    pack('p1', 'Pack 1', 'dca-ensemble', 'f1'),
    pack('p2', 'Pack 2', 'dca-ensemble'),
    pack('p3', 'Pack 3', 'dca-band', 'f2')
  ]
}

function scene(id: string, name: string, live: string[]): MicScene {
  return { id, name, live, notes: '' }
}

const OPENING = scene('s1', 'Opening', ['p1'])
const INTERVAL = scene('s2', 'Interval', ['p3'])

function channel(overrides: Partial<DeskChannel> = {}): DeskChannel {
  return { id: 'dca-1', label: 'DCA 1', mute: null, unmute: null, ...overrides }
}

function settings(
  list: MicScene[],
  channels: DeskChannel[] = [ENSEMBLE, BAND]
): ScenesSettings {
  return { channels, list }
}

describe('ScenesView', () => {
  let container: HTMLDivElement
  let root: Root
  let midiSend: Mock
  let oscSend: Mock
  let listPorts: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

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
    midiSend.mockReset()
    oscSend.mockReset()
    listPorts.mockReset()
    useStore.setState({
      showSettings: defaultShowSettings(),
      deskState: {},
      deskSceneId: null,
      scenesEditing: false
    })
  })

  interface ViewState {
    scenes?: ScenesSettings
    plot?: RfPlot
    deskState?: Record<string, boolean>
    deskSceneId?: string | null
    ports?: string[]
    /** Most of these tests are about editing, so they start in edit mode. */
    editing?: boolean
  }

  async function show(state: ViewState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    listPorts.mockResolvedValue(state.ports ?? [])
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          rf: { ...defaults.rf, plot: state.plot ?? defaults.rf.plot },
          scenes: state.scenes ?? defaults.scenes
        },
        deskState: state.deskState ?? {},
        deskSceneId: state.deskSceneId ?? null,
        scenesEditing: state.editing ?? true
      })
      root.render(<ScenesView />)
    })
  }

  function scenes(): ScenesSettings {
    return useStore.getState().showSettings.scenes
  }

  function columnFor(name: string): Element {
    const column = [...container.querySelectorAll('.matrix-scene')].find(
      candidate =>
        candidate.querySelector<HTMLInputElement>('.scene-name-field')?.value === name
    )
    if (!column) throw new Error(`no scene column named ${name}`)
    return column
  }

  // Rows are found by who is wearing the mic; a pack nobody is wearing falls back to its
  // label, which is what the view shows for it too.
  function rowFor(who: string): Element {
    const row = [...container.querySelectorAll('.matrix-row')].find(
      candidate => candidate.querySelector('.matrix-performer')?.textContent === who
    )
    if (!row) throw new Error(`no mic row for ${who}`)
    return row
  }

  function cellFor(label: string, sceneName: string): HTMLButtonElement {
    const cell = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')].find(
      candidate => candidate.getAttribute('aria-label') === `${label} in ${sceneName}`
    )
    if (!cell) throw new Error(`no cell for ${label} in ${sceneName}`)
    return cell
  }

  function field<T extends HTMLElement = HTMLInputElement>(selector: string, index = 0): T {
    return container.querySelectorAll<T>(selector)[index]
  }

  function summary(): string {
    return container.querySelector('.group-summary')!.textContent ?? ''
  }

  // The header readout as the operator reads it: the two labels and what they point at.
  function where(): { now: string; next: string | null } {
    const slot = (position: string): string | null => {
      const element = container.querySelector(position)
      if (element === null) return null
      return [...element.children]
        .filter(child => !child.classList.contains('scenes-where-label'))
        .map(child => child.textContent)
        .join(' ')
    }
    return { now: slot('.scenes-now') ?? '', next: slot('.scenes-next') }
  }

  async function openGroups(): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.scenes-groups-toggle')!.click()
    })
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

  it('gives every mic a row of who is wearing it, and every scene a named column', async () => {
    await show({
      scenes: settings([OPENING, scene('s3', 'Finale', ['p2', 'p3']), INTERVAL]),
      plot: PLOT
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('3 mics · 3 scenes')

    const columns = [...container.querySelectorAll('.matrix-scene')]
    expect(columns.map(column =>
      column.querySelector<HTMLInputElement>('.scene-name-field')?.value))
      .toEqual(['Opening', 'Finale', 'Interval'])

    // The row is a name, and the column says the name and the two presses: how many mics a
    // scene opens is already the block of colour beside it.
    const rows = [...container.querySelectorAll('.matrix-row')]
    expect(rows.map(row => row.querySelector('.matrix-performer')?.textContent))
      .toEqual(['Ada', 'Pack 2', 'Bea'])
    expect(rows.map(row => row.querySelectorAll('.matrix-cell').length)).toEqual([3, 3, 3])
    expect(columns.every(column => column.querySelector('.matrix-scene-count') === null))
      .toBe(true)
  })

  it('counts a lone mic and scene in the singular', async () => {
    await show({
      scenes: settings([OPENING]),
      plot: { performers: [], packs: [pack('p1', 'Pack 1', 'dca-ensemble')] }
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('1 mic · 1 scene')
  })

  it('reads each row as who is wearing the mic, and marks the ones nobody is', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    expect(rowFor('Ada').querySelector('.matrix-performer')?.getAttribute('data-unassigned'))
      .toBe('false')
    expect(rowFor('Bea').querySelector('.matrix-performer')?.getAttribute('data-unassigned'))
      .toBe('false')

    // A pack nobody is wearing is still a row the show has to have: it reads as its label.
    const spare = rowFor('Pack 2')
    expect(spare.querySelector('.matrix-performer')?.getAttribute('data-unassigned')).toBe('true')
    // And no row carries the patch any more: which group a mic feeds is set up with the plot.
    expect(spare.querySelector('.matrix-group-select')).toBeNull()
  })

  it('toggles a mic in a scene through to the store', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    const cell = cellFor('Pack 2', 'Opening')
    expect(cell.getAttribute('data-live')).toBe('false')

    await act(async () => { cell.click() })

    expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p1', 'p2'])
    expect(cell.getAttribute('data-live')).toBe('true')

    await act(async () => { cell.click() })

    expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p1'])
    expect(cell.getAttribute('data-live')).toBe('false')
  })

  it('adds a scene from the header and renames it in place, refusing an empty name', async () => {
    await show({ scenes: settings([]), plot: PLOT })

    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(0)
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No scenes yet.')
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('Add one from the header.')

    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-add')!.click() })

    expect(scenes().list.map(entry => entry.name)).toEqual(['Scene 1'])
    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(1)

    const name = field('.scene-name-field')
    await type(name, 'Entrance')
    // Half a name is not a rename: the scene list is untouched until the field is left.
    expect(scenes().list[0].name).toBe('Scene 1')

    await leave(name)
    expect(scenes().list[0].name).toBe('Entrance')
    expect(field<HTMLInputElement>('.scene-name-field').value).toBe('Entrance')

    // A scene without a name is a row nobody can find again, so the old one stays.
    await type(field('.scene-name-field'), '')
    await leave(field('.scene-name-field'))
    expect(scenes().list[0].name).toBe('Entrance')
    expect(field<HTMLInputElement>('.scene-name-field').value).toBe('Entrance')
  })

  it('removes a scene from its column', async () => {
    await show({ scenes: settings([OPENING, INTERVAL]), plot: PLOT })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-scene-remove')!.click()
    })

    expect(scenes().list.map(entry => entry.name)).toEqual(['Interval'])
    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(1)
  })

  it('runs the show without editing it: every cell is still, the column recall is live', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      editing: false,
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    const cells = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(cell => cell.disabled)).toBe(true)

    await act(async () => { cellFor('Pack 2', 'Opening').click() })
    expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p1'])

    const recall = columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')
    expect(recall?.disabled).toBe(false)
    await act(async () => { recall?.click() })

    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOff', channel: 0, note: 60, velocity: 0 }]
    })
    expect(oscSend).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 9000,
      address: '/dca/2',
      args: [{ type: 'i', value: 1 }]
    })
    expect(useStore.getState().deskSceneId).toBe('s2')
  })

  it('opens to run the show, and Edit and Done switch it, saying what the clicks now do', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT, editing: false })

    const edit = container.querySelector<HTMLButtonElement>('.scenes-edit')
    expect(edit?.textContent).toBe('Edit')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('false')
    expect(container.querySelector('.scenes-editing-hint')).toBeNull()
    expect(container.querySelector('.scenes-add')).toBeNull()
    expect(container.querySelector('.scenes-plot')).toBeNull()

    await act(async () => { edit?.click() })

    // A mode of the window, not a change to the show.
    expect(useStore.getState().scenesEditing).toBe(true)
    expect(edit?.textContent).toBe('Done')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('true')
    expect(container.querySelector('.scenes-editing-hint')?.textContent).toContain('Editing')
    expect(container.querySelector('.scenes-add')).not.toBeNull()
    expect(container.querySelector('.scenes-plot')).not.toBeNull()

    await act(async () => { edit?.click() })
    expect(useStore.getState().scenesEditing).toBe(false)
  })

  it('opens the mic plot and the telemetry sources from edit mode', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-plot')!.click() })
    expect(container.querySelector('.plot-dialog')).not.toBeNull()

    useStore.setState({ settingsTab: null })
    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-sources')!.click() })
    expect(useStore.getState().settingsTab).toBe('wireless')
  })

  it('marks the column the desk is in, and the rows follow it', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('true')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('false')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['true', 'false', 'false'])

    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': false, 'dca-band': true },
      deskSceneId: 's2'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('false')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('true')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['false', 'false', 'true'])
  })

  it('names the scene the desk is on and the one coming, where the grid cannot', async () => {
    const three = settings([OPENING, INTERVAL, scene('s3', 'Finale', ['p3'])])

    // Nothing recalled: the show has not started, so the first scene is what is coming.
    await show({ scenes: three, plot: PLOT })
    expect(where()).toEqual({ now: 'nothing recalled', next: '1 Opening' })

    await show({ scenes: three, plot: PLOT, deskSceneId: 's2', deskState: { 'dca-band': true } })
    expect(where()).toEqual({ now: '2 Interval', next: '3 Finale' })

    // The last scene has nothing after it, so the slot goes rather than naming a scene
    // that is not there.
    await show({ scenes: three, plot: PLOT, deskSceneId: 's3', deskState: { 'dca-band': true } })
    expect(where()).toEqual({ now: '3 Finale', next: null })
  })

  it('leaves the header to the empty state when there are no scenes to name', async () => {
    await show({ plot: PLOT })

    expect(container.querySelector('.scenes-where')).toBeNull()
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No scenes yet')
  })

  it('marks the scene pending after an edit and applies exactly that change', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(container.querySelector('.matrix-apply')).toBeNull()

    // Closing Pack 1 leaves the ensemble open on the desk: the column says so in amber
    // and the header offers the one message that would close it.
    await act(async () => { cellFor('Pack 1', 'Opening').click() })

    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    // Both mics on the ensemble are pending together: the desk holds one state per group.
    expect(cellFor('Pack 1', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Pack 2', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Pack 3', 'Interval').getAttribute('data-pending')).toBe('false')

    const apply = container.querySelector<HTMLButtonElement>('.matrix-apply')
    expect(apply?.textContent).toBe('Apply to desk (1)')

    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => { apply?.click() })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOff', channel: 0, note: 60, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskState).toEqual({ 'dca-ensemble': false, 'dca-band': false })
    expect(container.querySelector('.matrix-apply')).toBeNull()
  })

  it('sends exactly the changes a column recall needs', async () => {
    await show({ scenes: settings([OPENING, INTERVAL]), plot: PLOT })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-recall')?.click()
    })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOn', channel: 0, note: 60, velocity: 127 }]
    })
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(oscSend).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 9000,
      address: '/dca/2',
      args: [{ type: 'i', value: 0 }]
    })
    expect(useStore.getState().deskSceneId).toBe('s1')
  })

  it('says the plot is empty, and goes straight to entering it', async () => {
    await show({ scenes: settings([OPENING]), plot: { performers: [], packs: [] }, editing: false })

    expect(container.querySelector('.matrix-empty')?.textContent).toContain('The mic plot is empty')
    expect(container.querySelectorAll('.matrix-row').length).toBe(0)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().scenesEditing).toBe(true)
    expect(container.querySelector('.plot-dialog')).not.toBeNull()
  })

  it('offers Edit from an empty show that is being run', async () => {
    await show({ scenes: settings([]), plot: PLOT, editing: false })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().scenesEditing).toBe(true)
    expect(container.querySelector('.scenes-add')).not.toBeNull()
  })

  it('keeps the desk groups shut until the header asks for them', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    const toggle = container.querySelector<HTMLButtonElement>('.scenes-groups-toggle')
    expect(toggle?.textContent).toBe('Desk groups (2)')
    expect(container.querySelector('.scenes-groups')).toBeNull()

    await act(async () => { toggle?.click() })
    expect(container.querySelector('.scenes-groups')).not.toBeNull()
    expect(toggle?.getAttribute('data-open')).toBe('true')

    await act(async () => { toggle?.click() })
    expect(container.querySelector('.scenes-groups')).toBeNull()
  })

  it('adds a group in the drawer and configures MIDI delivery', async () => {
    await show({ scenes: settings([OPENING], []), plot: PLOT, ports: ['Yamaha', 'IEM rack'] })
    await openGroups()

    expect(container.querySelectorAll('.group-row')).toHaveLength(0)
    await act(async () => { container.querySelector<HTMLButtonElement>('.group-add')!.click() })

    expect(scenes().channels.map(entry => entry.label)).toEqual(['DCA 1'])
    expect(container.querySelectorAll('.group-row')).toHaveLength(1)

    const added = container.querySelectorAll('.group-row')[0]
    const delivery = added.querySelector<HTMLSelectElement>('.group-delivery')!
    expect([...delivery.options].map(option => option.value)).toEqual(['midi', 'osc', 'none'])
    await choose(delivery, 'midi')
    await choose(added.querySelector<HTMLSelectElement>('.group-port')!, 'Yamaha')
    await choose(added.querySelector<HTMLSelectElement>('.group-channel')!, '3')
    await choose(added.querySelector<HTMLSelectElement>('.group-note')!, '12')

    const expected = midiNoteMessages('Yamaha', 3, 12)
    const configured = scenes().channels[0]
    expect(configured.unmute).toEqual(expected.unmute)
    expect(configured.mute).toEqual(expected.mute)
    expect(added.querySelector('.group-summary')?.textContent)
      .toBe('noteOn ch3 → "Yamaha" / noteOff ch3 → "Yamaha"')
  })

  it('switches a group to OSC and sends one address for both states', async () => {
    await show({
      scenes: settings([OPENING], [
        channel({ id: 'dca-1', label: 'DCA 2', ...midiNoteMessages('Yamaha', 3, 12) })
      ]),
      plot: PLOT
    })
    await openGroups()

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
    expect(summary())
      .toBe('OSC /dca/2/mute 1 → 10.0.0.5:9000 / OSC /dca/2/mute 0 → 10.0.0.5:9000')
  })

  it('leaves a group alone on recall when its delivery is none', async () => {
    await show({
      scenes: settings([OPENING], [
        channel({ id: 'dca-1', label: 'DCA 2', ...midiNoteMessages('Yamaha', 3, 12) })
      ]),
      plot: PLOT
    })
    await openGroups()

    await choose(field<HTMLSelectElement>('.group-delivery'), 'none')

    expect(container.querySelector('.group-port')).toBeNull()
    expect(scenes().channels[0].unmute).toBeNull()
    expect(scenes().channels[0].mute).toBeNull()
    expect(summary()).toBe('nothing / nothing')
  })

  it('removes a group and clears the pointer on the packs that fed it', async () => {
    await show({
      scenes: settings([OPENING], [
        channel({ id: 'dca-1' }),
        channel({ id: 'dca-2', label: 'DCA 2' })
      ]),
      plot: {
        performers: [],
        packs: [
          pack('pack-1', 'Pack 1', 'dca-1'),
          pack('pack-2', 'Pack 2', 'dca-1'),
          pack('pack-3', 'Pack 3', 'dca-2'),
          pack('pack-4', 'Pack 4', null)
        ]
      }
    })
    await openGroups()

    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('.group-remove')[0].click()
    })

    expect(scenes().channels.map(entry => entry.id)).toEqual(['dca-2'])
    expect(useStore.getState().showSettings.rf.plot.packs
      .map(entry => [entry.id, entry.deskChannelId])).toEqual([
      ['pack-1', null],
      ['pack-2', null],
      ['pack-3', 'dca-2'],
      ['pack-4', null]
    ])
  })

  it('shows which mics feed each group, and where that leaves it', async () => {
    await show({
      scenes: settings([OPENING], [
        ENSEMBLE,
        BAND,
        channel({ id: 'dca-3', label: 'DCA 3' })
      ]),
      plot: PLOT,
      deskSceneId: 's1',
      // Read-only text is what the locked view shows; edit mode's chips are covered
      // separately, since they are a different rendering of the same summary.
      editing: false
    })
    await openGroups()

    const rows = [...container.querySelectorAll('.group-row')]
    expect(rows.map(row => row.querySelector('.group-label') instanceof HTMLInputElement
      ? (row.querySelector<HTMLInputElement>('.group-label')!.value)
      : null)).toEqual(['DCA 1 — Ensemble', 'DCA 2 — Band', 'DCA 3'])

    // Pack 1 is open in the scene, so its group is live and Pack 2 rides with it; the band
    // is muted; a group with no message configured is not driven at all.
    expect(rows.map(row => row.querySelector('.group-packs')?.textContent))
      .toEqual(['Pack 1, Pack 2', 'Pack 3', 'nothing assigned'])
    expect(rows.map(row => row.querySelector('.group-state')?.textContent))
      .toEqual(['live', 'muted', '—'])
  })

  it('assigns and releases a pack from a group row, without leaving Scenes', async () => {
    await show({
      scenes: settings([OPENING], [ENSEMBLE, BAND]),
      plot: {
        performers: [],
        packs: [
          pack('p1', 'Pack 1', 'dca-ensemble'),
          pack('p2', 'Pack 2', null),
          pack('p3', 'Pack 3', null)
        ]
      }
    })
    await openGroups()

    const rows = [...container.querySelectorAll('.group-row')]
    const ensembleRow = rows[0]
    const bandRow = rows[1]

    // The read-only text is gone while editing: chips and a picker take its place.
    expect(ensembleRow.querySelector('.group-packs')).toBeNull()
    expect(ensembleRow.querySelectorAll('.pack-chip')).toHaveLength(1)
    expect(ensembleRow.querySelector('.pack-chip')?.textContent).toContain('Pack 1')

    // Assigning offers only the packs no group has claimed yet.
    const bandAdd = bandRow.querySelector<HTMLSelectElement>('.group-pack-add')!
    expect([...bandAdd.options].map(option => option.value)).toEqual(['', 'p2', 'p3'])

    await choose(bandAdd, 'p2')
    expect(useStore.getState().showSettings.rf.plot.packs
      .find(candidate => candidate.id === 'p2')?.deskChannelId).toBe('dca-band')

    // The picker's own value resets, and the pack it just pulled in is off the list.
    expect(bandRow.querySelector<HTMLSelectElement>('.group-pack-add')?.value).toBe('')
    expect([...bandRow.querySelectorAll('.pack-chip')].map(chip => chip.textContent))
      .toEqual(['Pack 2✕'])

    // Releasing sends the pack back to no group — and back into every row's picker.
    await act(async () => {
      bandRow.querySelector<HTMLButtonElement>('.pack-chip-remove')!.click()
    })
    expect(useStore.getState().showSettings.rf.plot.packs
      .find(candidate => candidate.id === 'p2')?.deskChannelId).toBeNull()
    expect(container.querySelectorAll('.group-row')[1].querySelectorAll('.pack-chip'))
      .toHaveLength(0)
  })

  it('while the show is run, nothing edits it; recall, Apply and Mics off stay live', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      editing: false,
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': true },
      deskSceneId: 's1',
      ports: ['Yamaha']
    })
    await openGroups()

    const disabled = (selector: string): boolean[] =>
      [...container.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>(selector)]
        .map(control => control.disabled)

    expect(disabled('.scene-name-field').every(Boolean)).toBe(true)
    // What removes a scene is not there at all, rather than there and asleep beside recall.
    expect(container.querySelector('.matrix-scene-remove')).toBeNull()
    expect(disabled('.matrix-cell').every(Boolean)).toBe(true)
    expect(container.querySelector('.scenes-add')).toBeNull()
    expect(disabled('.group-label').every(Boolean)).toBe(true)
    expect(disabled('.group-delivery').every(Boolean)).toBe(true)
    expect(disabled('.group-port').every(Boolean)).toBe(true)
    expect(disabled('.group-channel').every(Boolean)).toBe(true)
    expect(disabled('.group-note').every(Boolean)).toBe(true)
    expect(disabled('.group-host').every(Boolean)).toBe(true)
    expect(disabled('.group-osc-port').every(Boolean)).toBe(true)
    expect(disabled('.group-address').every(Boolean)).toBe(true)
    expect(container.querySelector('.group-remove')).toBeNull()
    expect(container.querySelector('.group-add')).toBeNull()

    // Edit is how the show is edited, and recall is what the view is for; both the Mics
    // off press and the drawer's own toggle stay live.
    expect(container.querySelector<HTMLButtonElement>('.scenes-edit')?.disabled).toBe(false)
    expect(container.querySelector<HTMLButtonElement>('.scenes-groups-toggle')?.disabled).toBe(false)
    expect([...container.querySelectorAll<HTMLButtonElement>('.matrix-recall')]
      .every(recall => !recall.disabled)).toBe(true)
    expect(container.querySelector('.matrix-apply')?.textContent).toBe('Apply to desk (1)')

    // Apply still moves the band, which is the one group the scene disagrees with.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-apply')!.click()
    })
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(midiSend).not.toHaveBeenCalled()

    // Mics off still closes the ensemble, which apply left open.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.scenes-mics-off')!.click()
    })
    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(useStore.getState().deskSceneId).toBeNull()

    // ...and a column recall still opens the band.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(useStore.getState().deskSceneId).toBe('s2')
  })
})
