// Scenes is the view the operator lives in at curtain up: a row per fader, a column
// per scene, the column the desk was last taken to lit where the show is. A cell names the
// channels its row carries and the ensembles applied to it, and a recall writes that
// membership and then each mic's mute. These tests pin the glance, the three presses that
// move the desk (a column's recall, the header's Recall now, and the Resync beside it) and
// the run mode it opens in, which stops every edit while leaving recall working. The
// first column is the scene that is never edited: all closed.
import { describe, it, expect, beforeEach, afterEach, type Mock, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenesView } from './ScenesView'
import { useStore } from '../../store'
import * as scenesEngine from '../../engine/scenes'
import { ALL_CLOSED_SCENE_ID, defaultDeskSettings, defaultShowSettings } from '../../../../shared/show'
import type {
  CastSettings, Dca, DeskSettings, Ensemble, MicScene, Performer, ShowChannel
} from '../../../../shared/show'

// The desk these tests drive: one connection for the show, MIDI on the port the desk
// answers to, so what a recall put on the wire reads as a port and a message rather than
// a literal address in every assertion.
const DESK: DeskSettings = {
  ...defaultDeskSettings(),
  kind: 'midi',
  midiPort: 'Yamaha',
  midiChannel: 3
}

function dca(id: string, label: string): Dca {
  return { id, label, deskNumber: null }
}

const ENSEMBLE: Dca = dca('dca-ensemble', 'DCA 1 — Ensemble')
const BAND: Dca = dca('dca-band', 'DCA 2 — Band')
/** A fader no scene places anything on: a recall never writes it, so it is left alone. */
const SPARE: Dca = dca('dca-spare', 'DCA 3 — Spare')

function channel(id: string, name: string): ShowChannel {
  return { id, name }
}

const CHANNELS: ShowChannel[] = [
  channel('ch-ada', 'Ada'),
  channel('ch-extra', 'Extra'),
  channel('ch-bea', 'Bea')
]

function performer(id: string, name: string, channelId: string | null): Performer {
  return { id, name, role: '', notes: '', channelId }
}

// Ada and Extra are the chorus's members, Bea the band's: applying the chorus to the first
// row carries two channels on one fader, which is the handful of writes the recall exists
// to send. Two members on one row is also what makes an exclusion mean something — one of
// them left off while the group stays applied.
const PERFORMERS: Performer[] = [
  performer('p1', 'Ada', 'ch-ada'),
  performer('p2', 'Extra', 'ch-extra'),
  performer('p3', 'Bea', 'ch-bea')
]

const CHORUS: Ensemble = { id: 'ens-chorus', name: 'Chorus', members: ['p1', 'p2'] }

function scene(id: string, name: string, dcas: MicScene['dcas'] = []): MicScene {
  return { id, name, dcas, notes: '' }
}

function placed(dcaId: string, channels: string[], extra: Partial<MicScene['dcas'][number]> = {}) {
  return { dcaId, channels, ensembles: [], excluded: [], ...extra }
}

const OPENING = scene('s1', 'Opening', [placed('dca-ensemble', ['ch-ada'])])
const INTERVAL = scene('s2', 'Interval', [placed('dca-band', ['ch-bea'])])

// Written out rather than taken from `defaultCastSettings`, whose twelve unnamed strips
// have no placements to recall: a test about which fader carries which mic needs to know
// which strip a performer is on.
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
    vi.restoreAllMocks()
    useStore.setState({
      showSettings: defaultShowSettings(),
      showSettingsTab: null,
      deskState: { mutes: {}, assignments: {} },
      deskSceneId: null,
      scenesEditing: false
    })
  })

  interface ViewState {
    scenes?: MicScene[]
    cast?: CastSettings
    /** A case that asserts on the wire says which desk; the rest run a new show's OSC. */
    desk?: Partial<DeskSettings>
    deskState?: { mutes?: Record<string, boolean>; assignments?: Record<string, string[]> }
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
          scenes: { list: state.scenes ?? [], allowDuplicateAssignment: true }
        },
        deskState: {
          mutes: state.deskState?.mutes ?? {},
          assignments: state.deskState?.assignments ?? {}
        },
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

  /** The cell for one fader in one scene, found by the row header it sits under. */
  function cellFor(fader: string, sceneName: string): Element {
    const row = [...container.querySelectorAll('.matrix-row')].find(
      candidate => candidate.querySelector('.matrix-fader')?.textContent === fader
    )
    if (!row) throw new Error(`no row for ${fader}`)
    const index = scenes().findIndex(scene => scene.name === sceneName)
    if (index === -1) throw new Error(`no scene named ${sceneName}`)
    const cell = row.querySelectorAll('.matrix-cell')[index]
    if (!cell) throw new Error(`no cell for ${fader} in ${sceneName}`)
    return cell
  }

  function chips(cell: Element): string[] {
    return [...cell.querySelectorAll('.matrix-channel')]
      .map(chip => chip.childNodes[0]?.textContent ?? '')
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

  async function choose(select: HTMLSelectElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select, value)
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('gives every fader a row, and every scene a named column', async () => {
    await show({
      scenes: [OPENING, scene('s3', 'Finale', [placed('dca-band', ['ch-extra', 'ch-bea'])]), INTERVAL]
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('2 faders · 3 scenes')

    expect(sceneColumns().map(column =>
      column.querySelector<HTMLInputElement>('.scene-name-field')?.value))
      .toEqual(['Opening', 'Finale', 'Interval'])

    const rows = [...container.querySelectorAll('.matrix-row')]
    expect(rows.map(row => row.querySelector('.matrix-fader')?.textContent))
      .toEqual(['1 · DCA 1 — Ensemble', '2 · DCA 2 — Band'])
    expect(rows.map(row => row.querySelectorAll('.matrix-cell').length)).toEqual([3, 3])
    // Each cell names what its row carries, through the channel labels.
    expect(chips(cellFor('1 · DCA 1 — Ensemble', 'Opening'))).toEqual(['Ch 1 · Ada'])
    expect(chips(cellFor('2 · DCA 2 — Band', 'Finale')))
      .toEqual(['Ch 2 · Extra', 'Ch 3 · Bea'])
  })

  it('counts a lone fader and scene in the singular', async () => {
    await show({
      scenes: [OPENING],
      cast: cast({ dcas: [ENSEMBLE] })
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('1 fader · 1 scene')
  })

  it('places a channel on a cell with one undo, and removes it with one undo', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })
    const past = (): number => useStore.getState().past.length

    const cell = cellFor('1 · DCA 1 — Ensemble', 'Opening')
    expect(chips(cell)).toEqual([])

    const before = past()
    await choose(cell.querySelector<HTMLSelectElement>('.matrix-place')!, 'ch-ada')

    // One store write, hence one undo: the placement lands in the scene list.
    expect(scenes()[0].dcas).toEqual([placed('dca-ensemble', ['ch-ada'])])
    expect(useStore.getState().past.length).toBe(before + 1)
    expect(chips(cellFor('1 · DCA 1 — Ensemble', 'Opening'))).toEqual(['Ch 1 · Ada'])

    // Choosing from the picker resets it to its placeholder: the press is done.
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening')
      .querySelector<HTMLSelectElement>('.matrix-place')?.value).toBe('')

    // The picker only offers the channels the row does not carry yet.
    expect([...cellFor('1 · DCA 1 — Ensemble', 'Opening')
      .querySelector<HTMLSelectElement>('.matrix-place')!.options]
      .map(option => option.textContent))
      .toEqual(['+ place', 'Ch 2 · Extra', 'Ch 3 · Bea'])

    const placed1 = past()
    await act(async () => {
      cellFor('1 · DCA 1 — Ensemble', 'Opening')
        .querySelector<HTMLButtonElement>('.matrix-channel-remove')!.click()
    })

    expect(scenes()[0].dcas).toEqual([])
    expect(useStore.getState().past.length).toBe(placed1 + 1)
    expect(chips(cellFor('1 · DCA 1 — Ensemble', 'Opening'))).toEqual([])

    // And one undo each puts them back: the place, then the remove.
    await act(async () => { useStore.getState().undo() })
    expect(scenes()[0].dcas).toEqual([placed('dca-ensemble', ['ch-ada'])])
    await act(async () => { useStore.getState().undo() })
    expect(scenes()[0].dcas).toEqual([])
  })

  it('applies an ensemble to a row, and leaves a member off it', async () => {
    await show({
      scenes: [scene('s1', 'Opening')],
      cast: cast({ ensembles: [CHORUS] })
    })

    const cell = cellFor('1 · DCA 1 — Ensemble', 'Opening')
    expect(cell.querySelector('.matrix-ensemble')).toBeNull()

    // The picker only offers the ensembles not yet applied to this row.
    await choose(cell.querySelector<HTMLSelectElement>('.matrix-ensemble-add')!, 'ens-chorus')

    expect(scenes()[0].dcas).toEqual([
      placed('dca-ensemble', [], { ensembles: ['ens-chorus'] })
    ])
    // Both members ride the row by way of the group.
    expect(chips(cellFor('1 · DCA 1 — Ensemble', 'Opening')))
      .toEqual(['Ch 1 · Ada', 'Ch 2 · Extra'])

    const applied = cellFor('1 · DCA 1 — Ensemble', 'Opening')
      .querySelector<HTMLButtonElement>('.matrix-ensemble')!
    expect(applied.textContent).toBe('Chorus')
    expect(applied.getAttribute('data-applied')).toBe('on')

    // A member whose channel the row does not carry is an exclusion chip, and leaving one
    // off is a press on the member: the ensemble stays applied, the row reads partial.
    await act(async () => {
      cellFor('1 · DCA 1 — Ensemble', 'Opening')
        .querySelectorAll<HTMLButtonElement>('.matrix-member')[0].click()
    })

    expect(scenes()[0].dcas).toEqual([
      placed('dca-ensemble', [], { ensembles: ['ens-chorus'], excluded: ['ch-ada'] })
    ])
    expect(chips(cellFor('1 · DCA 1 — Ensemble', 'Opening'))).toEqual(['Ch 2 · Extra'])
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening')
      .querySelector('.matrix-ensemble')?.getAttribute('data-applied')).toBe('partial')
    // The member left off reads excluded; the one still carried is no chip at all.
    expect([...cellFor('1 · DCA 1 — Ensemble', 'Opening')
      .querySelectorAll('.matrix-member')].map(chip => [
        chip.textContent, chip.getAttribute('data-excluded')
      ])).toEqual([['Ada', 'true'], ['Extra', 'false']])

    // Clicking the applied ensemble takes the group off, leaving the hand placements —
    // here none — as they were.
    await act(async () => {
      cellFor('1 · DCA 1 — Ensemble', 'Opening')
        .querySelector<HTMLButtonElement>('.matrix-ensemble')!.click()
    })
    expect(scenes()[0].dcas).toEqual([])
  })

  it('groups what a row carries into an ensemble from the cell', async () => {
    await show({ scenes: [OPENING] })

    await act(async () => {
      cellFor('1 · DCA 1 — Ensemble', 'Opening')
        .querySelector<HTMLButtonElement>('.matrix-ensemble-new')!.click()
    })

    const ensembles = useStore.getState().showSettings.cast.ensembles
    expect(ensembles).toHaveLength(1)
    expect(ensembles[0].members).toEqual(['p1'])
    // Applied to the row it was made from.
    expect(scenes()[0].dcas).toEqual([
      placed('dca-ensemble', [], { ensembles: [ensembles[0].id] })
    ])
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening')
      .querySelector('.matrix-ensemble')?.textContent).toBe(ensembles[0].name)
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

    // Every fader row leaves it a gap rather than a cell: there is nothing to carry in a
    // column that closes everything.
    expect(container.querySelectorAll('.matrix-cell-blank')).toHaveLength(2)
    expect(column.querySelectorAll('.matrix-cell')).toHaveLength(0)
  })

  it('recalls the all-closed column: everything the show placed is closed, and the column is current', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      cast: cast({ dcas: [ENSEMBLE, BAND, SPARE] }),
      desk: DESK,
      deskState: {
        mutes: { 'ch-ada': false, 'ch-bea': false },
        assignments: { 'ch-ada': ['dca-ensemble'], 'ch-bea': ['dca-band'] }
      },
      deskSceneId: 's1'
    })

    const column = allClosedColumn()
    expect(column.getAttribute('data-current')).toBe('false')

    await act(async () => {
      column.querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })

    // Every controlled channel is closed — a channel each, addressed by its own number —
    // while the spare fader nobody placed anything on is left where it is: the set is the
    // channels, not the faders.
    expect(midiSend).toHaveBeenCalledTimes(3)
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 1, velocity: 0 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 2, velocity: 0 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 3, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskState.mutes).toEqual({ 'ch-ada': true, 'ch-extra': true, 'ch-bea': true })
    expect(useStore.getState().deskSceneId).toBe(ALL_CLOSED_SCENE_ID)
    expect(column.getAttribute('data-current')).toBe('true')
  })

  it('runs the show without editing it: every control in a cell is still, the column recall is live', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      editing: false,
      desk: DESK,
      deskState: {
        mutes: { 'ch-ada': false, 'ch-bea': true },
        assignments: { 'ch-ada': ['dca-ensemble'], 'ch-bea': [] }
      },
      deskSceneId: 's1'
    })

    // Every control a cell holds is disabled in run mode — the remove, the pickers, the
    // ensemble presses — while the chips still name what the row carries.
    const cell = cellFor('1 · DCA 1 — Ensemble', 'Opening')
    expect(chips(cell)).toEqual(['Ch 1 · Ada'])
    expect([...cell.querySelectorAll<
      HTMLButtonElement | HTMLSelectElement
    >('.matrix-channel-remove, .matrix-place, .matrix-ensemble-add, .matrix-ensemble-new, .matrix-ensemble, .matrix-member')]
      .every(control => control.disabled)).toBe(true)

    const recall = columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')
    expect(recall?.disabled).toBe(false)
    await act(async () => { recall?.click() })

    // Interval moves Ada's mute and Bea's: Ada closes, Bea opens on the band's fader.
    expect(midiSend).toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBe('s2')
  })

  it('opens to run the show, and Edit and Done switch it, saying what the clicks now do', async () => {
    await show({ scenes: [OPENING], editing: false })

    const edit = container.querySelector<HTMLButtonElement>('.scenes-edit')
    expect(edit?.textContent).toBe('Edit')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('false')
    expect(container.querySelector('.scenes-editing-hint')).toBeNull()
    expect(container.querySelector('.scenes-add')).toBeNull()

    await act(async () => { edit?.click() })

    // A mode of the window, not a change to the show.
    expect(useStore.getState().scenesEditing).toBe(true)
    expect(edit?.textContent).toBe('Done')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('true')
    expect(container.querySelector('.scenes-editing-hint')?.textContent).toContain('Editing')
    expect(container.querySelector('.scenes-add')).not.toBeNull()

    await act(async () => { edit?.click() })
    expect(useStore.getState().scenesEditing).toBe(false)
  })

  it('marks the column the desk is in, and the pending columns say what is still to send', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      deskState: {
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-bea': true },
        assignments: { 'ch-ada': ['dca-ensemble'], 'ch-extra': [], 'ch-bea': [] }
      },
      deskSceneId: 's1'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('true')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('false')
    expect(allClosedColumn().getAttribute('data-current')).toBe('false')
    // The desk is where Opening left it: nothing to send, so nothing pending.
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('false')
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening').getAttribute('data-pending')).toBe('false')

    await show({
      scenes: [OPENING, INTERVAL],
      deskState: {
        mutes: { 'ch-ada': true, 'ch-extra': true, 'ch-bea': true },
        assignments: { 'ch-ada': [], 'ch-extra': [], 'ch-bea': [] }
      },
      deskSceneId: 's1'
    })

    // Opening would move Ada back onto the first fader and open her: the column and its
    // cell both say so, while the band's row — nothing placed, nothing recorded — stays
    // still.
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening').getAttribute('data-current')).toBe('true')
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening').getAttribute('data-placed')).toBe('true')
    expect(cellFor('2 · DCA 2 — Band', 'Opening').getAttribute('data-pending')).toBe('false')
    expect(cellFor('2 · DCA 2 — Band', 'Opening').getAttribute('data-placed')).toBe('false')
  })

  it('names the scene the desk is on and the one coming, where the grid cannot', async () => {
    const three = [OPENING, INTERVAL, scene('s3', 'Finale', [placed('dca-band', ['ch-bea'])])]

    // Nothing recalled: the show has not started, so the first scene is what is coming.
    await show({ scenes: three })
    expect(where()).toEqual({ now: 'nothing recalled', next: '1 Opening' })

    await show({
      scenes: three,
      deskSceneId: 's2',
      deskState: { mutes: { 'ch-bea': false }, assignments: { 'ch-bea': ['dca-band'] } }
    })
    expect(where()).toEqual({ now: '2 Interval', next: '3 Finale' })

    // The last scene has nothing after it, so the slot goes rather than naming a scene
    // that is not there.
    await show({
      scenes: three,
      deskSceneId: 's3',
      deskState: { mutes: { 'ch-bea': false }, assignments: { 'ch-bea': ['dca-band'] } }
    })
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
      deskState: {
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-bea': true },
        assignments: { 'ch-ada': ['dca-ensemble'], 'ch-extra': [], 'ch-bea': [] }
      },
      deskSceneId: 's1'
    })

    expect(container.querySelector('.matrix-apply')).toBeNull()

    // Taking Ada off the first row leaves the desk holding a placement the scene no longer
    // names: the column says so in amber and the header offers the change that would send.
    await act(async () => {
      cellFor('1 · DCA 1 — Ensemble', 'Opening')
        .querySelector<HTMLButtonElement>('.matrix-channel-remove')!.click()
    })

    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('1 · DCA 1 — Ensemble', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('2 · DCA 2 — Band', 'Opening').getAttribute('data-pending')).toBe('false')

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
    expect(useStore.getState().deskState.mutes)
      .toEqual({ 'ch-ada': true, 'ch-extra': true, 'ch-bea': true })
    // Taking Ada off closed her on the desk, but the record still has her old fader: the
    // placement moves on the next recall, so the column stays pending for it.
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
  })

  it('sends exactly the changes a column recall needs', async () => {
    await show({ scenes: [OPENING, INTERVAL], desk: DESK })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-recall')?.click()
    })

    // Nothing has been recalled yet, so the placed channel is opened on its fader and the
    // unplaced ones are closed: one message per mic, addressed by the channel's number.
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 3, note: 1, velocity: 127 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 2, velocity: 0 }]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 3, note: 3, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBe('s1')
  })

  it('re-sends the scene the desk is on when Resync is pressed', async () => {
    const resync = vi.spyOn(scenesEngine, 'resyncDesk').mockResolvedValue({
      sceneName: 'Opening', written: 1, failures: []
    })
    await show({
      scenes: [OPENING, INTERVAL],
      desk: DESK,
      deskState: {
        mutes: { 'ch-ada': false, 'ch-bea': true },
        assignments: { 'ch-ada': ['dca-ensemble'], 'ch-bea': [] }
      },
      deskSceneId: 's1'
    })

    const button = container.querySelector<HTMLButtonElement>('.matrix-resync')
    expect(button).not.toBeNull()
    expect(button?.title).toContain('moved a fader by hand')

    await act(async () => { button?.click() })
    expect(resync).toHaveBeenCalledTimes(1)
  })

  it('shows no Resync with no scene standing', async () => {
    await show({ scenes: [OPENING, INTERVAL] })

    expect(useStore.getState().deskSceneId).toBeNull()
    expect(container.querySelector('.matrix-resync')).toBeNull()
  })

  it('says the show has no faders, and goes straight to setting them up', async () => {
    await show({ scenes: [OPENING], cast: cast({ dcas: [] }), editing: false })

    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No faders')
    expect(container.querySelectorAll('.matrix-row').length).toBe(0)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().showSettingsTab).toBe('channels')
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
      deskState: {
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-bea': true },
        assignments: { 'ch-ada': ['dca-ensemble'], 'ch-extra': [], 'ch-bea': [] }
      },
      deskSceneId: 's1'
    })

    const disabled = (selector: string): boolean[] =>
      [...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(selector)]
        .map(control => control.disabled)

    expect(disabled('.scene-name-field').every(Boolean)).toBe(true)
    // What removes a scene is not there at all, rather than there and asleep beside recall.
    expect(container.querySelector('.matrix-scene-remove')).toBeNull()
    expect(disabled('.matrix-channel-remove').every(Boolean)).toBe(true)
    expect(container.querySelector('.matrix-place')).toBeNull()
    expect(container.querySelector('.matrix-ensemble-add')).toBeNull()
    expect(container.querySelector('.scenes-add')).toBeNull()

    // Edit is how the show is edited, and recall is what the view is for.
    expect(container.querySelector<HTMLButtonElement>('.scenes-edit')?.disabled).toBe(false)
    expect([...container.querySelectorAll<HTMLButtonElement>('.matrix-recall')]
      .every(recall => !recall.disabled)).toBe(true)
    // The desk is where Opening left it, but Interval would move two channels: the header
    // names the standing scene's own count, which is none, so Apply is gone — the press
    // that matters here is the column's.
    expect(container.querySelector('.matrix-apply')).toBeNull()

    // A column recall still opens the band and closes the ensemble row.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })
    expect(midiSend).toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBe('s2')
  })
})
