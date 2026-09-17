// Scenes is the view the operator lives in at curtain up: a row per performer, a column
// per scene, the column the desk was last taken to lit where the show is. Which DCA a
// performer's mic opens is their channel's, and what that DCA is sent comes from the
// show's one desk connection (`ShowSettings.test.tsx`) — these tests pin the glance, the
// two presses that move the desk (a column's recall and the header's Recall now) and the run
// mode it opens in, which stops every edit while leaving recall and Apply working. The
// first column is the scene that is never edited: all closed.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenesView } from './ScenesView'
import { useStore } from '../../store'
import { ALL_CLOSED_SCENE_ID, defaultDeskSettings, defaultShowSettings } from '../../types/show'
import type {
  CastSettings, Dca, DeskSettings, Ensemble, MicScene, Performer, ShowChannel
} from '../../types/show'

// The desk these tests drive: one connection for the show, MIDI on the port the desk
// answers to, so what a recall put on the wire reads as a port and a note rather than a
// literal address in every assertion. The note is the DCA's number — none of these
// carries an override.
const DESK: DeskSettings = {
  ...defaultDeskSettings(),
  kind: 'midi',
  midiPort: 'Yamaha',
  midiChannel: 3
}

const ENSEMBLE: Dca = { id: 'dca-ensemble', label: 'DCA 1 — Ensemble', note: null, address: null }

const BAND: Dca = { id: 'dca-band', label: 'DCA 2 — Band', note: null, address: null }

/** A fader nobody is patched to: no scene drives it, so a recall leaves it where it is. */
const SPARE: Dca = { id: 'dca-spare', label: 'DCA 3 — Spare', note: null, address: null }

function channel(id: string, name: string, dcaId: string | null): ShowChannel {
  return { id, name, dcaId }
}

const CHANNELS: ShowChannel[] = [
  channel('ch-ada', 'Ada', 'dca-ensemble'),
  channel('ch-extra', 'Extra', 'dca-ensemble'),
  channel('ch-bea', 'Bea', 'dca-band')
]

function performer(id: string, name: string, channelId: string | null): Performer {
  return { id, name, role: '', notes: '', channelId }
}

// Ada and Extra ride the ensemble's strip, Bea the band's: recalling a scene opens one DCA
// and closes the other, which is the handful of messages the whole feature exists to send.
// Two performers on one strip is also what makes their cells pending together — the desk
// holds one state per DCA, not one per performer.
const PERFORMERS: Performer[] = [
  performer('p1', 'Ada', 'ch-ada'),
  performer('p2', 'Extra', 'ch-extra'),
  performer('p3', 'Bea', 'ch-bea')
]

const CHORUS: Ensemble = { id: 'ens-chorus', name: 'Chorus', members: ['p1', 'p2'] }

function scene(id: string, name: string, live: string[], overrides: Partial<MicScene> = {}): MicScene {
  return { id, name, live, ensembles: [], excluded: [], notes: '', ...overrides }
}

const OPENING = scene('s1', 'Opening', ['p1'])
const INTERVAL = scene('s2', 'Interval', ['p3'])

// Written out rather than taken from `defaultCastSettings`, whose twelve unnamed strips
// have no routing to recall: a test about which DCA opens needs to know which strip a
// performer is on.
function cast(overrides: Partial<CastSettings> = {}): CastSettings {
  return {
    channels: CHANNELS,
    performers: PERFORMERS,
    ensembles: [],
    dcas: [ENSEMBLE, BAND],
    ...overrides
  }
}

describe('ScenesView', () => {
  let container: HTMLDivElement
  let root: Root
  let midiSend: Mock
  let oscSend: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    midiSend = window.cuerunner.midi.send as unknown as Mock
    oscSend = window.cuerunner.osc.send as unknown as Mock
    midiSend.mockReset().mockResolvedValue({ ok: true })
    oscSend.mockReset().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    midiSend.mockReset()
    oscSend.mockReset()
    useStore.setState({
      showSettings: defaultShowSettings(),
      showSettingsTab: null,
      deskState: {},
      deskSceneId: null,
      scenesEditing: false
    })
  })

  interface ViewState {
    scenes?: MicScene[]
    cast?: CastSettings
    /** A case that asserts on the wire says which desk; the rest run a new show's OSC. */
    desk?: Partial<DeskSettings>
    deskState?: Record<string, boolean>
    deskSceneId?: string | null
    /** Most of these tests are about editing, so they start in edit mode. */
    editing?: boolean
  }

  async function show(state: ViewState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          desk: { ...defaults.desk, ...state.desk },
          cast: state.cast ?? cast(),
          scenes: { list: state.scenes ?? [] }
        },
        deskState: state.deskState ?? {},
        deskSceneId: state.deskSceneId ?? null,
        scenesEditing: state.editing ?? true
      })
      root.render(<ScenesView />)
    })
  }

  function scenes(): MicScene[] {
    return useStore.getState().showSettings.scenes.list
  }

  /** The scene columns, which is every column but the one that is always there. */
  function sceneColumns(): Element[] {
    return [...container.querySelectorAll('.matrix-scene[data-scene-id]')]
  }

  function allClosedColumn(): Element {
    const column = container.querySelector('.matrix-scene[data-all-closed="true"]')
    if (!column) throw new Error('no all-closed column')
    return column
  }

  function columnFor(name: string): Element {
    const column = [...container.querySelectorAll('.matrix-scene')].find(
      candidate =>
        candidate.querySelector<HTMLInputElement>('.scene-name-field')?.value === name
    )
    if (!column) throw new Error(`no scene column named ${name}`)
    return column
  }

  function cellFor(name: string, sceneName: string): HTMLButtonElement {
    const cell = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')].find(
      candidate => candidate.getAttribute('aria-label') === `${name} in ${sceneName}`
    )
    if (!cell) throw new Error(`no cell for ${name} in ${sceneName}`)
    return cell
  }

  function field<T extends HTMLElement = HTMLInputElement>(selector: string, index = 0): T {
    return container.querySelectorAll<T>(selector)[index]
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

  // Controlled inputs: setting the value through the prototype setter is what gets past
  // React's own tracker, so the dispatched event looks like a real keystroke.
  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function leave(input: HTMLElement): Promise<void> {
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  it('gives every performer a row, and every scene a named column', async () => {
    await show({
      scenes: [OPENING, scene('s3', 'Finale', ['p2', 'p3']), INTERVAL]
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('3 performers · 3 scenes')

    expect(sceneColumns().map(column =>
      column.querySelector<HTMLInputElement>('.scene-name-field')?.value))
      .toEqual(['Opening', 'Finale', 'Interval'])

    const rows = [...container.querySelectorAll('.matrix-row')]
    expect(rows.map(row => row.querySelector('.matrix-performer')?.textContent))
      .toEqual(['Ada', 'Extra', 'Bea'])
    expect(rows.map(row => row.querySelectorAll('.matrix-cell').length)).toEqual([3, 3, 3])
  })

  it('counts a lone performer and scene in the singular', async () => {
    await show({
      scenes: [OPENING],
      cast: cast({ performers: [performer('p1', 'Ada', 'ch-ada')] })
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('1 performer · 1 scene')
  })

  it('toggles a performer in a scene through to the store', async () => {
    await show({ scenes: [OPENING] })

    const cell = cellFor('Extra', 'Opening')
    expect(cell.getAttribute('data-live')).toBe('false')

    await act(async () => { cell.click() })

    expect(scenes()[0].live).toEqual(['p1', 'p2'])
    expect(cell.getAttribute('data-live')).toBe('true')

    await act(async () => { cell.click() })

    expect(scenes()[0].live).toEqual(['p1'])
    expect(cell.getAttribute('data-live')).toBe('false')
  })

  it('adds a scene from the header and renames it in place, refusing an empty name', async () => {
    await show({ scenes: [] })

    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(0)
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No scenes yet.')
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('Add one from the header.')

    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-add')!.click() })

    expect(scenes().map(entry => entry.name)).toEqual(['Scene 1'])
    // The all-closed column arrives with the first scene: the grid is what it belongs to.
    expect(sceneColumns()).toHaveLength(1)
    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(2)

    const name = field('.scene-name-field')
    await type(name, 'Entrance')
    // Half a name is not a rename: the scene list is untouched until the field is left.
    expect(scenes()[0].name).toBe('Scene 1')

    await leave(name)
    expect(scenes()[0].name).toBe('Entrance')
    expect(field<HTMLInputElement>('.scene-name-field').value).toBe('Entrance')

    // A scene without a name is a row nobody can find again, so the old one stays.
    await type(field('.scene-name-field'), '')
    await leave(field('.scene-name-field'))
    expect(scenes()[0].name).toBe('Entrance')
    expect(field<HTMLInputElement>('.scene-name-field').value).toBe('Entrance')
  })

  it('removes a scene from its column', async () => {
    await show({ scenes: [OPENING, INTERVAL] })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-scene-remove')!.click()
    })

    expect(scenes().map(entry => entry.name)).toEqual(['Interval'])
    expect(sceneColumns()).toHaveLength(1)
  })

  it('always has the all-closed column, and never lets it be edited', async () => {
    await show({ scenes: [OPENING, INTERVAL] })

    const column = allClosedColumn()
    expect(container.querySelectorAll('.matrix-scene')[0]).toBe(column)
    expect(column.querySelector('.scene-name-static')?.textContent).toBe('All closed')

    // A place the desk can be, not a scene with a name to type or a column to remove —
    // while the scenes beside it have both.
    expect(column.querySelector('.scene-name-field')).toBeNull()
    expect(column.querySelector('.matrix-scene-remove')).toBeNull()
    expect(sceneColumns()[0].querySelector('.scene-name-field')).not.toBeNull()
    expect(sceneColumns()[0].querySelector('.matrix-scene-remove')).not.toBeNull()

    // Every performer row leaves it a gap rather than a cell: there is nothing to open
    // in a column that closes everything.
    expect(container.querySelectorAll('.matrix-cell-blank')).toHaveLength(PERFORMERS.length)
    expect(column.querySelectorAll('.matrix-cell')).toHaveLength(0)
  })

  it('recalls the all-closed column: everything the show drives is closed, and the column is current', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      cast: cast({ dcas: [ENSEMBLE, BAND, SPARE] }),
      desk: DESK,
      deskState: { 'dca-ensemble': true, 'dca-band': true, 'dca-spare': true },
      deskSceneId: 's1'
    })

    const column = allClosedColumn()
    expect(column.getAttribute('data-current')).toBe('false')

    await act(async () => {
      column.querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })

    // Both faders a performer rides are closed, one message each. The spare is nobody's —
    // the desk may well be doing something else with it — so it is left alone.
    expect(midiSend).toHaveBeenCalledTimes(2)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 1, velocity: 0 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 2, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskState)
      .toEqual({ 'dca-ensemble': false, 'dca-band': false, 'dca-spare': true })
    expect(useStore.getState().deskSceneId).toBe(ALL_CLOSED_SCENE_ID)
    expect(column.getAttribute('data-current')).toBe('true')
  })

  it('puts an ensemble above the performers, and applies it to a scene', async () => {
    await show({ scenes: [OPENING, INTERVAL], cast: cast({ ensembles: [CHORUS] }) })

    const grid = container.querySelector('.matrix-grid')!
    const children = [...grid.children]
    const ensembleAt = children.findIndex(child => child.classList.contains('matrix-ensemble-row'))
    const performerAt = children.findIndex(child => child.classList.contains('matrix-row'))
    expect(ensembleAt).toBeGreaterThan(-1)
    expect(ensembleAt).toBeLessThan(performerAt)

    const row = container.querySelector('.matrix-ensemble-row')!
    expect(row.querySelector('.matrix-ensemble-count')?.textContent).toBe('2')

    const cell = cellFor('Chorus', 'Opening')
    expect(cell.getAttribute('data-applied')).toBe('off')

    await act(async () => { cell.click() })

    expect(scenes()[0].ensembles).toEqual(['ens-chorus'])
    expect(cell.getAttribute('data-applied')).toBe('on')
    // Every member is open by way of the ensemble, whatever the scene's own list says.
    expect(cellFor('Ada', 'Opening').getAttribute('data-live')).toBe('true')
    expect(cellFor('Extra', 'Opening').getAttribute('data-live')).toBe('true')

    await act(async () => { cell.click() })

    expect(scenes()[0].ensembles).toEqual([])
    expect(cell.getAttribute('data-applied')).toBe('off')
    expect(cellFor('Ada', 'Opening').getAttribute('data-live')).toBe('false')
    expect(cellFor('Extra', 'Opening').getAttribute('data-live')).toBe('false')
  })

  it('closing a member inside an applied ensemble leaves the ensemble applied, the cell partial', async () => {
    await show({ scenes: [OPENING, INTERVAL], cast: cast({ ensembles: [CHORUS] }) })

    const cell = cellFor('Chorus', 'Opening')
    await act(async () => { cell.click() })

    await act(async () => { cellFor('Ada', 'Opening').click() })

    // Closing her is an exclusion, not a membership change: she is still in the chorus,
    // and the next scene that applies it opens her again.
    expect(scenes()[0].excluded).toEqual(['p1'])
    expect(scenes()[0].ensembles).toEqual(['ens-chorus'])
    expect(cell.getAttribute('data-applied')).toBe('partial')
    expect(cellFor('Ada', 'Opening').getAttribute('data-live')).toBe('false')
    expect(cellFor('Extra', 'Opening').getAttribute('data-live')).toBe('true')
  })

  it('makes an ensemble out of the scene on the desk, and only then can one be made', async () => {
    await show({ scenes: [OPENING, INTERVAL] })

    const button = container.querySelector<HTMLButtonElement>('.scenes-ensemble')!
    // Grouping the mics that are open needs a scene on the desk to read them from.
    expect(button.disabled).toBe(true)

    await act(async () => { useStore.setState({ deskSceneId: 's1' }) })
    expect(button.disabled).toBe(false)

    await act(async () => { button.click() })

    const ensembles = useStore.getState().showSettings.cast.ensembles
    expect(ensembles).toHaveLength(1)
    expect(ensembles[0].name).toBe('Ensemble 1')
    // Exactly who is open in the scene it was made from, applied to it.
    expect(ensembles[0].members).toEqual(['p1'])
    expect(scenes()[0].ensembles).toEqual([ensembles[0].id])
    expect(cellFor(ensembles[0].name, 'Opening').getAttribute('data-applied')).toBe('on')

    // The all-closed scene is a place the desk can be, not a scene with anyone open in
    // it, so it leaves nothing to group.
    await act(async () => { useStore.setState({ deskSceneId: ALL_CLOSED_SCENE_ID }) })
    expect(button.disabled).toBe(true)
  })

  it('removes an ensemble from the grid and from the scenes that used it', async () => {
    const used = scene('s1', 'Opening', [], { ensembles: ['ens-chorus'] })
    await show({ scenes: [used, INTERVAL], cast: cast({ ensembles: [CHORUS] }) })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-ensemble-row .matrix-scene-remove')!.click()
    })

    expect(useStore.getState().showSettings.cast.ensembles).toEqual([])
    expect(scenes()[0].ensembles).toEqual([])
    expect(container.querySelector('.matrix-ensemble-row')).toBeNull()
    // The performers it grouped are still the cast.
    expect(container.querySelectorAll('.matrix-row')).toHaveLength(PERFORMERS.length)
  })

  it('reads the strip a performer is patched to, and a strip taken off its DCA drives nothing', async () => {
    const OUT: Dca = { id: 'dca-out', label: 'DCA 1 — Out', note: null, address: null }

    await show({
      scenes: [scene('s1', 'Opening', ['p1', 'p3'])],
      cast: cast({
        // Ruth's strip is on no fader at all — that is what choosing “— no DCA —” in Show
        // Settings leaves — so her mic opens nothing on the desk.
        channels: [channel('ch-ruth', 'Ruth', null), channel('ch-bea', 'Bea', 'dca-band')],
        performers: [performer('p1', 'Ruth', 'ch-ruth'), performer('p3', 'Bea', 'ch-bea')],
        dcas: [OUT, BAND]
      }),
      desk: DESK,
      deskState: { 'dca-out': false, 'dca-band': false },
      deskSceneId: 's1'
    })

    const rows = [...container.querySelectorAll('.matrix-row')]
    expect(rows.map(row => row.querySelector('.matrix-channel')?.textContent))
      .toEqual(['Ch 1 · Ruth', 'Ch 2 · Bea'])
    expect(rows.map(row => row.querySelector('.matrix-performer')?.textContent))
      .toEqual(['Ruth', 'Bea'])

    // A strip patched to no fader is patched to nothing: nobody's state is pending for it,
    // and a recall leaves the whole desk alone but for the strip that still moves.
    expect(cellFor('Ruth', 'Opening').getAttribute('data-pending')).toBe('false')
    expect(cellFor('Bea', 'Opening').getAttribute('data-pending')).toBe('true')

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 3, note: 2, velocity: 127 }]
    })
    expect(useStore.getState().deskState).toEqual({ 'dca-out': false, 'dca-band': true })
  })

  it('runs the show without editing it: every cell is still, the column recall is live', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      editing: false,
      desk: DESK,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    const cells = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(cell => cell.disabled)).toBe(true)

    await act(async () => { cellFor('Extra', 'Opening').click() })
    expect(scenes()[0].live).toEqual(['p1'])

    const recall = columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')
    expect(recall?.disabled).toBe(false)
    await act(async () => { recall?.click() })

    // Interval opens the band and closes the ensemble: one message to each fader.
    expect(midiSend).toHaveBeenCalledTimes(2)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 1, velocity: 0 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 3, note: 2, velocity: 127 }]
    })
    expect(useStore.getState().deskSceneId).toBe('s2')
  })

  it('opens to run the show, and Edit and Done switch it, saying what the clicks now do', async () => {
    await show({ scenes: [OPENING], editing: false })

    const edit = container.querySelector<HTMLButtonElement>('.scenes-edit')
    expect(edit?.textContent).toBe('Edit')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('false')
    expect(container.querySelector('.scenes-editing-hint')).toBeNull()
    expect(container.querySelector('.scenes-add')).toBeNull()
    expect(container.querySelector('.scenes-ensemble')).toBeNull()
    // The little fly-out buttons are gone: setting the show up is the menu's Show Settings.
    expect(container.querySelector('.scenes-plot')).toBeNull()
    expect(container.querySelector('.scenes-show')).toBeNull()
    expect(container.querySelector('.scenes-sources')).toBeNull()
    expect(container.querySelector('.scenes-mics-off')).toBeNull()

    await act(async () => { edit?.click() })

    // A mode of the window, not a change to the show.
    expect(useStore.getState().scenesEditing).toBe(true)
    expect(edit?.textContent).toBe('Done')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('true')
    expect(container.querySelector('.scenes-editing-hint')?.textContent).toContain('Editing')
    expect(container.querySelector('.scenes-add')).not.toBeNull()
    expect(container.querySelector('.scenes-ensemble')).not.toBeNull()

    await act(async () => { edit?.click() })
    expect(useStore.getState().scenesEditing).toBe(false)
  })

  it('marks the column the desk is in, and the rows follow it', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('true')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('false')
    expect(allClosedColumn().getAttribute('data-current')).toBe('false')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['true', 'false', 'false'])

    await show({
      scenes: [OPENING, INTERVAL],
      deskState: { 'dca-ensemble': false, 'dca-band': true },
      deskSceneId: 's2'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('false')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('true')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['false', 'false', 'true'])
  })

  it('names the scene the desk is on and the one coming, where the grid cannot', async () => {
    const three = [OPENING, INTERVAL, scene('s3', 'Finale', ['p3'])]

    // Nothing recalled: the show has not started, so the first scene is what is coming.
    await show({ scenes: three })
    expect(where()).toEqual({ now: 'nothing recalled', next: '1 Opening' })

    await show({ scenes: three, deskSceneId: 's2', deskState: { 'dca-band': true } })
    expect(where()).toEqual({ now: '2 Interval', next: '3 Finale' })

    // The last scene has nothing after it, so the slot goes rather than naming a scene
    // that is not there.
    await show({ scenes: three, deskSceneId: 's3', deskState: { 'dca-band': true } })
    expect(where()).toEqual({ now: '3 Finale', next: null })
  })

  it('leaves the header to the empty state when there are no scenes to name', async () => {
    await show({})

    expect(container.querySelector('.scenes-where')).toBeNull()
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No scenes yet')
  })

  it('marks the scene pending after an edit and applies exactly that change', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      desk: DESK,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(container.querySelector('.matrix-apply')).toBeNull()

    // Closing Ada leaves the ensemble open on the desk: the column says so in amber
    // and the header offers the one message that would close it.
    await act(async () => { cellFor('Ada', 'Opening').click() })

    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    // Ada and Extra ride the same strip, so both cells are pending together: the desk
    // holds one state per DCA.
    expect(cellFor('Ada', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Extra', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Bea', 'Interval').getAttribute('data-pending')).toBe('false')

    const apply = container.querySelector<HTMLButtonElement>('.matrix-apply')
    expect(apply?.textContent).toBe('Recall now (1)')

    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => { apply?.click() })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 1, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskState).toEqual({ 'dca-ensemble': false, 'dca-band': false })
    expect(container.querySelector('.matrix-apply')).toBeNull()
  })

  it('sends exactly the changes a column recall needs', async () => {
    await show({ scenes: [OPENING, INTERVAL], desk: DESK })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-recall')?.click()
    })

    // Nothing has been recalled yet, so both faders are told: the one Opening opens and
    // the one it closes.
    expect(midiSend).toHaveBeenCalledTimes(2)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 3, note: 1, velocity: 127 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 2, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBe('s1')
  })

  it('says the cast is empty, and goes straight to entering it', async () => {
    await show({ scenes: [OPENING], cast: cast({ performers: [] }), editing: false })

    expect(container.querySelector('.matrix-empty')?.textContent).toContain('The cast is empty')
    expect(container.querySelectorAll('.matrix-row').length).toBe(0)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().showSettingsTab).toBe('cast')
  })

  it('offers Edit from an empty show that is being run', async () => {
    await show({ scenes: [], editing: false })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().scenesEditing).toBe(true)
    expect(container.querySelector('.scenes-add')).not.toBeNull()
  })

  it('while the show is run, nothing edits it; recall and Apply stay live', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      editing: false,
      desk: DESK,
      deskState: { 'dca-ensemble': true, 'dca-band': true },
      deskSceneId: 's1'
    })

    const disabled = (selector: string): boolean[] =>
      [...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(selector)]
        .map(control => control.disabled)

    expect(disabled('.scene-name-field').every(Boolean)).toBe(true)
    // What removes a scene is not there at all, rather than there and asleep beside recall.
    expect(container.querySelector('.matrix-scene-remove')).toBeNull()
    expect(disabled('.matrix-cell').every(Boolean)).toBe(true)
    expect(container.querySelector('.scenes-add')).toBeNull()
    expect(container.querySelector('.scenes-ensemble')).toBeNull()

    // Edit is how the show is edited, and recall is what the view is for.
    expect(container.querySelector<HTMLButtonElement>('.scenes-edit')?.disabled).toBe(false)
    expect([...container.querySelectorAll<HTMLButtonElement>('.matrix-recall')]
      .every(recall => !recall.disabled)).toBe(true)
    expect(container.querySelector('.matrix-apply')?.textContent).toBe('Recall now (1)')

    // Apply still moves the band, which is the one fader the scene disagrees with.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-apply')!.click()
    })
    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 2, velocity: 0 }]
    })

    // ...and a column recall still opens the band and closes the ensemble.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })
    expect(midiSend).toHaveBeenCalledTimes(2)
    expect(useStore.getState().deskSceneId).toBe('s2')
  })
})
