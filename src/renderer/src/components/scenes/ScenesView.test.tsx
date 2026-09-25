// Scenes is the view the operator lives in at curtain up: a row per fader, a column per
// scene, the column the desk was last taken to lit where the show is. A row holds one thing
// — a strip of the console, or an ensemble over several of them — and says it in one block
// whose title carries the whole of what the row stands for, with a blank box beside it that
// changes it.
//
// Everything a row can become comes out of that box: the picker, which lists every strip and
// every group the row does not already hold, behind a filter, and the builder behind the
// picker, which names a group and fills it from the strips the cast stands on. So that is
// what these tests press. They pin the one store write each press makes — and the one undo
// that takes it back — the ✕ that takes a row out of a scene entirely, and the keyboard both
// dialogs take as they open and give back to the row's box as they close.
//
// They also pin the glance (a row per fader, a named column per scene, the all-closed column
// that is never edited and carries nothing), the three presses that move the desk (a column's
// recall, the header's Recall now, and the Resync beside it) and the run mode the view opens
// in, which stops every edit while leaving recall working.
import { describe, it, expect, beforeEach, afterEach, type Mock, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenesView } from './ScenesView'
import { useStore } from '../../store'
import * as scenesEngine from '../../engine/scenes'
import { ALL_CLOSED_SCENE_ID, defaultDeskSettings, defaultShowSettings } from '../../../../shared/show'
import type {
  CastSettings, Dca, DeskSettings, Ensemble, MicScene, Performer, RowMember, SceneDcaPlacement,
  ShowChannel
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

/** A fader: a place on the desk, with no name of its own beyond that place. */
function dca(id: string): Dca {
  return { id, deskNumber: null }
}

const FIRST: Dca = dca('dca-1')
const SECOND: Dca = dca('dca-2')

/** A strip: its name once somebody names it, and nothing until then. */
function channel(id: string, name = ''): ShowChannel {
  return { id, name }
}

// The console these tests drive: two strips the cast stands on, and a third nobody is, which
// is the strip no group can hold and the one the grid falls back to a number for.
const CHANNELS: ShowChannel[] = [channel('ch-ada'), channel('ch-extra'), channel('ch-spare')]

function performer(id: string, name: string, channelId: string | null): Performer {
  return { id, name, role: '', notes: '', channelId }
}

const PERFORMERS: Performer[] = [
  performer('p1', 'Ada', 'ch-ada'),
  performer('p2', 'Extra', 'ch-extra')
]

/** The group over both, which is what an ensemble is: membership, and a name. */
const CHORUS: Ensemble = { id: 'ens-chorus', name: 'Chorus', channelIds: ['ch-ada', 'ch-extra'] }

function scene(id: string, name: string, dcas: MicScene['dcas'] = []): MicScene {
  return { id, name, dcas, notes: '' }
}

/** What one scene does with one fader: the one thing it holds there. */
function placed(dcaId: string, kind: RowMember['kind'], memberId: string): SceneDcaPlacement {
  return { dcaId, kind, memberId }
}

const OPENING = scene('s1', 'Opening', [placed('dca-1', 'channel', 'ch-ada')])
const INTERVAL = scene('s2', 'Interval', [placed('dca-2', 'channel', 'ch-extra')])

// Written out rather than taken from `defaultCastSettings`, whose twelve unnamed strips
// have no placements to recall: a test about which fader carries which mic needs to know
// which strip a performer is on.
function cast(overrides: Partial<CastSettings> = {}): CastSettings {
  return {
    channels: CHANNELS,
    performers: PERFORMERS,
    ensembles: [],
    dcas: [FIRST, SECOND],
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
    // The history goes too: an undo in the next test must not reach back into this one.
    useStore.setState({
      showSettings: defaultShowSettings(),
      showSettingsTab: null,
      deskState: { mutes: {}, assignments: {} },
      deskSceneId: null,
      scenesEditing: false,
      past: [],
      future: []
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

  /** The row of one fader, found by the number in its header: a fader is its number. */
  function rowFor(fader: string): Element {
    const row = [...container.querySelectorAll('.matrix-row')].find(
      candidate => candidate.querySelector('.matrix-fader')?.textContent === fader)
    if (!row) throw new Error(`no row for ${fader}`)
    return row
  }

  /** The cell for one fader in one scene: that row's cell beside that scene's column. */
  function cellFor(fader: string, sceneName: string): Element {
    const index = scenes().findIndex(scene => scene.name === sceneName)
    if (index === -1) throw new Error(`no scene named ${sceneName}`)
    const cell = rowFor(fader).querySelectorAll('.matrix-cell')[index]
    if (!cell) throw new Error(`no cell for ${fader} in ${sceneName}`)
    return cell
  }

  /** What a cell's block says the row holds: the strip's label, or the group's name. */
  function blockName(cell: Element): string | null {
    const name = cell.querySelector('.matrix-block-name')
    return name === null ? null : name.textContent
  }

  /** The whole of what the block stands for, which is what its title carries. */
  function blockTitle(cell: Element): string | null {
    return cell.querySelector('.matrix-block')?.getAttribute('title') ?? null
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

  /**
   * The picker a cell's box opens, reached the way the operator reaches it: pressing the
   * box. It is drawn in a portal on the body, so it is found there rather than in the view.
   */
  async function openPicker(cell: Element): Promise<HTMLElement> {
    await act(async () => {
      // A row holding nothing is a blank box; a row holding something is that name, pressed.
      const way = cell.querySelector<HTMLButtonElement>('.matrix-cell-add') ??
        cell.querySelector<HTMLButtonElement>('.matrix-block-name')!
      way.click()
    })
    const picker = document.body.querySelector<HTMLElement>('.scene-picker')
    if (picker === null) throw new Error('no picker opened')
    return picker
  }

  /** What the picker is offering, in the order it draws it: each heading, then its rows. */
  function offerings(picker: Element): string[] {
    return [...picker.querySelectorAll(
      '.scene-picker-section, .scene-picker-item, .scene-picker-none'
    )].map(row => row.textContent ?? '')
  }

  /** The builder, opened from the picker's last row, which is the only way to it. */
  async function openBuilder(cell: Element): Promise<HTMLElement> {
    const picker = await openPicker(cell)
    await act(async () => {
      picker.querySelector<HTMLButtonElement>('.scene-picker-build')!.click()
    })
    const dialog = container.querySelector<HTMLElement>('.ensemble-dialog')
    if (dialog === null) throw new Error('no builder opened')
    return dialog
  }

  /** The one control under `parent` reading exactly this, pressed. */
  async function press(parent: Element, selector: string, label: string): Promise<void> {
    await act(async () => {
      const control = [...parent.querySelectorAll<HTMLButtonElement>(selector)]
        .find(candidate => candidate.textContent === label)
      if (control === undefined) throw new Error(`nothing under ${selector} reading ${label}`)
      control.click()
    })
  }

  /** The strips one pane of the builder is showing, in the order it shows them. */
  function pane(dialog: Element, key: string): string[] {
    return [...dialog.querySelectorAll(`.ensemble-pane[data-pane="${key}"] .ensemble-item`)]
      .map(item => item.textContent ?? '')
  }

  /** The arrow that files a picked strip across the two panes, or back. */
  async function move(dialog: Element, direction: 'in' | 'out'): Promise<void> {
    await act(async () => {
      dialog.querySelectorAll<HTMLButtonElement>('.ensemble-move')[
        direction === 'in' ? 0 : 1
      ].click()
    })
  }

  it('gives every fader a row, and every scene a named column', async () => {
    await show({
      scenes: [
        OPENING,
        scene('s3', 'Finale', [placed('dca-2', 'channel', 'ch-extra')]),
        INTERVAL
      ]
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('2 faders · 3 scenes')

    expect(sceneColumns().map(column =>
      column.querySelector<HTMLInputElement>('.scene-name-field')?.value))
      .toEqual(['Opening', 'Finale', 'Interval'])

    const rows = [...container.querySelectorAll('.matrix-row')]
    // The header of a row is the fader's own number: a fader has no name but its place.
    expect(rows.map(row => row.querySelector('.matrix-fader')?.textContent)).toEqual(['1', '2'])
    expect(rows[0].querySelector('.matrix-fader')?.getAttribute('title')).toBe('DCA 1')
    expect(rows.map(row => row.querySelectorAll('.matrix-cell').length)).toEqual([3, 3])
    // Each cell names the one thing its row holds there — a strip, by the name the grid
    // gives it — and a row holding nothing there is a cell with no block in it.
    expect(blockName(cellFor('1', 'Opening'))).toBe('Ada')
    expect(blockName(cellFor('2', 'Finale'))).toBe('Extra')
    expect(blockName(cellFor('1', 'Interval'))).toBeNull()
    expect(blockName(cellFor('2', 'Opening'))).toBeNull()
  })

  it('counts a lone fader and scene in the singular', async () => {
    await show({
      scenes: [OPENING],
      cast: cast({ dcas: [FIRST] })
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('1 fader · 1 scene')
  })

  it('places a strip on a row from the box, and one undo takes the row back', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })
    const past = (): number => useStore.getState().past.length

    const cell = cellFor('1', 'Opening')
    // A row holding nothing is one empty box and no block at all.
    expect(cell.querySelector('.matrix-block')).toBeNull()
    expect(cell.querySelectorAll('.matrix-cell-add')).toHaveLength(1)
    expect(cell.getAttribute('data-placed')).toBe('false')
    expect(cell.getAttribute('data-kind')).toBe('none')
    const box = cell.querySelector<HTMLButtonElement>('.matrix-cell-add')
    expect(box?.disabled).toBe(false)
    expect(box?.getAttribute('aria-label')).toBe('Change DCA 1 in Opening')

    const before = past()
    const picker = await openPicker(cell)
    // The box opens the menu about this row, and it is a dialog because it owns the
    // keyboard while it is up.
    expect(picker.getAttribute('role')).toBe('dialog')
    expect(picker.getAttribute('aria-label')).toBe('Change DCA 1 in Opening')
    // Every strip of the console, under its own heading, named the way the grid names one:
    // whoever is standing on it, and its number only while nobody is.
    expect(offerings(picker)).toEqual(['Channels', 'Ada', 'Extra', 'Ch 3'])

    await press(picker, '.scene-picker-item', 'Ada')

    // One store write, hence one undo: the placement is the scene's own, and the row is
    // taken out of the scene rather than left empty when it says nothing.
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'channel', 'ch-ada')])
    expect(past()).toBe(before + 1)
    // Choosing is done with: the picker went with the press.
    expect(document.body.querySelector('.scene-picker')).toBeNull()

    const held = cellFor('1', 'Opening')
    expect(held.getAttribute('data-placed')).toBe('true')
    expect(held.getAttribute('data-kind')).toBe('channel')
    expect(blockName(held)).toBe('Ada')

    await act(async () => { useStore.getState().undo() })
    expect(scenes()[0].dcas).toEqual([])
    expect(blockName(cellFor('1', 'Opening'))).toBeNull()
  })

  it('replaces what a row holds, because a row holds one thing', async () => {
    await show({ scenes: [OPENING] })
    const past = (): number => useStore.getState().past.length
    const before = past()

    const cell = cellFor('1', 'Opening')
    expect(blockName(cell)).toBe('Ada')

    const picker = await openPicker(cell)
    // The strip the row already holds is not offered again: nothing is put on a row twice.
    expect(offerings(picker)).toEqual(['Channels', 'Extra', 'Ch 3'])
    await press(picker, '.scene-picker-item', 'Extra')

    // The row still holds exactly one member, and it is the new one.
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'channel', 'ch-extra')])
    expect(past()).toBe(before + 1)
    const held = cellFor('1', 'Opening')
    expect(held.querySelectorAll('.matrix-block')).toHaveLength(1)
    expect(blockName(held)).toBe('Extra')
    expect(held.getAttribute('data-kind')).toBe('channel')

    await act(async () => { useStore.getState().undo() })
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'channel', 'ch-ada')])
    expect(blockName(cellFor('1', 'Opening'))).toBe('Ada')
  })

  it('puts a group on a row, naming it and everyone in it', async () => {
    await show({ scenes: [scene('s1', 'Opening')], cast: cast({ ensembles: [CHORUS] }) })

    const cell = cellFor('1', 'Opening')
    const picker = await openPicker(cell)
    // The two things a row can gain are different in kind, and are read as such: the
    // strips first, then the groups.
    expect(offerings(picker))
      .toEqual(['Channels', 'Ada', 'Extra', 'Ch 3', 'Ensembles', 'Chorus'])

    await press(picker, '.scene-picker-item', 'Chorus')

    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'ensemble', 'ens-chorus')])
    const held = cellFor('1', 'Opening')
    expect(held.getAttribute('data-kind')).toBe('ensemble')
    expect(blockName(held)).toBe('Chorus')
    // The block is the whole of what the row stands for: the group, and who rides it.
    expect(blockTitle(held)).toBe('Chorus — Ada, Extra')
  })

  it('takes the row out of the scene with the ✕, and one undo puts it back', async () => {
    await show({ scenes: [OPENING] })
    const past = (): number => useStore.getState().past.length
    const before = past()

    const remove = cellFor('1', 'Opening')
      .querySelector<HTMLButtonElement>('.matrix-block-remove')
    expect(remove?.textContent).toBe('✕')
    expect(remove?.getAttribute('aria-label')).toBe('Take Ada off DCA 1 in Opening')
    await act(async () => { remove?.click() })

    // The row is gone from the scene rather than left as a shell: a scene that speaks for
    // a fader it has nothing to say about is one nobody can read.
    expect(scenes()[0].dcas).toEqual([])
    expect(past()).toBe(before + 1)
    expect(blockName(cellFor('1', 'Opening'))).toBeNull()

    await act(async () => { useStore.getState().undo() })
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'channel', 'ch-ada')])
    expect(blockName(cellFor('1', 'Opening'))).toBe('Ada')
  })

  it('offers only what the row does not already hold', async () => {
    await show({
      scenes: [scene('s1', 'Opening', [placed('dca-1', 'ensemble', 'ens-chorus')])],
      cast: cast({ ensembles: [CHORUS] })
    })

    const picker = await openPicker(cellFor('1', 'Opening'))
    // The group the row holds is not offered again, and the groups section goes with it —
    // while the strips still are, because a strip is what the row would hold instead.
    expect(offerings(picker)).toEqual(['Channels', 'Ada', 'Extra', 'Ch 3'])
  })

  it('filters both sections, and leaves the builder reachable through any filter', async () => {
    await show({ scenes: [scene('s1', 'Opening')], cast: cast({ ensembles: [CHORUS] }) })

    const picker = await openPicker(cellFor('1', 'Opening'))
    expect(offerings(picker))
      .toEqual(['Channels', 'Ada', 'Extra', 'Ch 3', 'Ensembles', 'Chorus'])

    // Typing narrows both sections at once, on the names the operator can read.
    await type(picker.querySelector<HTMLInputElement>('.scene-picker-filter')!, 'r')
    expect(offerings(picker)).toEqual(['Channels', 'Extra', 'Ensembles', 'Chorus'])

    await type(picker.querySelector<HTMLInputElement>('.scene-picker-filter')!, 'nowhere')
    expect(offerings(picker)).toEqual(['Nothing matches.'])
    // The builder is an action rather than a row of the list, so a filter that matches
    // nothing still leaves the way to it open.
    expect(picker.querySelector('.scene-picker-build')?.textContent).toBe('Ensemble…')
  })

  it('walks the picker with the arrows, and picks with Enter', async () => {
    await show({ scenes: [scene('s1', 'Opening')], cast: cast({ ensembles: [CHORUS] }) })

    const picker = await openPicker(cellFor('1', 'Opening'))
    const filter = picker.querySelector<HTMLInputElement>('.scene-picker-filter')!
    // The filter drives the list: it is the combobox, the rows are its options, and the one
    // an arrow lands on is named as active so Enter's target is announced rather than only
    // painted.
    expect(filter.getAttribute('role')).toBe('combobox')
    expect(filter.getAttribute('aria-activedescendant')).toBe('scene-picker-channel-ch-ada')
    expect(picker.querySelectorAll('.scene-picker-item[data-active="true"]')).toHaveLength(1)

    await act(async () => {
      filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    })
    expect(filter.getAttribute('aria-activedescendant')).toBe('scene-picker-channel-ch-extra')
    const active = picker.querySelectorAll('.scene-picker-item[data-active="true"]')
    expect([...active].map(row => row.textContent)).toEqual(['Extra'])

    await act(async () => {
      filter.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'channel', 'ch-extra')])
    expect(blockName(cellFor('1', 'Opening'))).toBe('Extra')
  })

  it('builds a group out of the strips it is given, and puts it on the row as one edit', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })
    const past = (): number => useStore.getState().past.length
    const before = past()

    const dialog = await openBuilder(cellFor('1', 'Opening'))
    // The picker went with the press that opened the builder, and both panes are the show's
    // strips in the show's own order, named the way the grid names them.
    expect(document.body.querySelector('.scene-picker')).toBeNull()
    expect(pane(dialog, 'free')).toEqual(['Ada', 'Extra', 'Ch 3'])
    expect(pane(dialog, 'held')).toEqual([])
    expect(dialog.querySelector('.ensemble-none')?.textContent).toBe('Nothing in it yet.')
    // Every strip can be moved across: a group holds strips, so a show with nobody cast on
    // any of them is still a show whose strips can be grouped.
    expect([...dialog.querySelectorAll<HTMLButtonElement>('[data-pane="free"] .ensemble-item')]
      .map(item => [item.textContent, item.disabled]))
      .toEqual([['Ada', false], ['Extra', false], ['Ch 3', false]])
    // Nothing is picked in either pane, so neither arrow has anything to move and there is
    // nothing to create with.
    expect([...dialog.querySelectorAll<HTMLButtonElement>('.ensemble-move')]
      .every(arrow => arrow.disabled)).toBe(true)
    expect(dialog.querySelector<HTMLButtonElement>('.ensemble-create')?.disabled).toBe(true)

    // The name is typed, and the strips are picked and filed across.
    await type(dialog.querySelector<HTMLInputElement>('.ensemble-name-field')!, 'Chorus')
    await press(dialog, '[data-pane="free"] .ensemble-item', 'Ada')
    // Which strip the arrows act on is announced, not only painted.
    const picked = [...dialog.querySelectorAll('.ensemble-item')]
      .filter(item => item.getAttribute('aria-pressed') === 'true')
    expect(picked.map(item => item.textContent)).toEqual(['Ada'])
    await move(dialog, 'in')
    await press(dialog, '[data-pane="free"] .ensemble-item', 'Extra')
    await move(dialog, 'in')
    expect(pane(dialog, 'held')).toEqual(['Ada', 'Extra'])
    expect(pane(dialog, 'free')).toEqual(['Ch 3'])
    expect(dialog.querySelector<HTMLButtonElement>('.ensemble-create')?.disabled).toBe(false)

    await press(dialog, '.ensemble-create', 'Create and apply')

    const ensembles = useStore.getState().showSettings.cast.ensembles
    expect(ensembles).toHaveLength(1)
    expect(ensembles[0].name).toBe('Chorus')
    // It holds the strips it was given, and it is on the row it was opened from — one store
    // write, so one undo takes the cast and the row back together.
    expect(ensembles[0].channelIds).toEqual(['ch-ada', 'ch-extra'])
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'ensemble', ensembles[0].id)])
    expect(blockName(cellFor('1', 'Opening'))).toBe('Chorus')
    expect(past()).toBe(before + 1)
    expect(container.querySelector('.ensemble-dialog')).toBeNull()

    await act(async () => { useStore.getState().undo() })
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([])
    expect(scenes()[0].dcas).toEqual([])
  })

  it('opens the builder at the group the row holds, and saves it back there', async () => {
    await show({
      scenes: [scene('s1', 'Opening', [placed('dca-1', 'ensemble', 'ens-chorus')])],
      cast: cast({ ensembles: [CHORUS] })
    })
    const past = (): number => useStore.getState().past.length
    const before = past()

    const dialog = await openBuilder(cellFor('1', 'Opening'))
    // The row decides what the builder opens as: the group it holds, filled in.
    expect(dialog.getAttribute('aria-label')).toBe('Edit Chorus')
    expect(dialog.querySelector('.ensemble-title')?.textContent).toBe('Edit ensemble')
    expect(dialog.querySelector<HTMLInputElement>('.ensemble-name-field')?.value).toBe('Chorus')
    expect(pane(dialog, 'held')).toEqual(['Ada', 'Extra'])
    expect(pane(dialog, 'free')).toEqual(['Ch 3'])
    expect(dialog.querySelector('.ensemble-create')?.textContent).toBe('Save')

    // Renaming it and dropping a member changes the group itself, which is membership
    // rather than a copy: every row holding it holds the new one.
    await type(dialog.querySelector<HTMLInputElement>('.ensemble-name-field')!, 'Principals')
    await press(dialog, '[data-pane="held"] .ensemble-item', 'Extra')
    await move(dialog, 'out')
    expect(pane(dialog, 'held')).toEqual(['Ada'])
    await press(dialog, '.ensemble-create', 'Save')

    expect(useStore.getState().showSettings.cast.ensembles)
      .toEqual([{ id: 'ens-chorus', name: 'Principals', channelIds: ['ch-ada'] }])
    expect(past()).toBe(before + 1)
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'ensemble', 'ens-chorus')])
    expect(blockName(cellFor('1', 'Opening'))).toBe('Principals')
    expect(blockTitle(cellFor('1', 'Opening'))).toBe('Principals — Ada')
    expect(container.querySelector('.ensemble-dialog')).toBeNull()

    await act(async () => { useStore.getState().undo() })
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([CHORUS])
  })

  it('deletes the group from the edit of it, emptying the row', async () => {
    await show({
      scenes: [scene('s1', 'Opening', [placed('dca-1', 'ensemble', 'ens-chorus')])],
      cast: cast({ ensembles: [CHORUS] })
    })
    const past = (): number => useStore.getState().past.length
    const before = past()

    const dialog = await openBuilder(cellFor('1', 'Opening'))
    expect(dialog.querySelector('.ensemble-delete')?.textContent).toBe('Delete')

    await act(async () => {
      dialog.querySelector<HTMLButtonElement>('.ensemble-delete')!.click()
    })

    // The group leaves the cast and every row that held it in the same write.
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([])
    expect(scenes()[0].dcas).toEqual([])
    expect(past()).toBe(before + 1)
    expect(cellFor('1', 'Opening').querySelector('.matrix-block')).toBeNull()

    await act(async () => { useStore.getState().undo() })
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([CHORUS])
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'ensemble', 'ens-chorus')])
  })

  it('gives the keyboard back to the row, whichever way in the row now has', async () => {
    // A save can take the box away — the row was empty and now holds the group — and a
    // delete can take the name away, so what the keyboard goes back to is the row's own way
    // in, found again rather than the element that opened the dialog. Focusing a detached
    // element is a no-op, and the operator would be left at the top of the window.
    await show({ scenes: [scene('s1', 'Opening')] })
    const cell = cellFor('1', 'Opening')
    const dialog = await openBuilder(cell)
    await type(dialog.querySelector<HTMLInputElement>('.ensemble-name-field')!, 'Principals')
    await press(dialog, '[data-pane="free"] .ensemble-item', 'Ada')
    await act(async () => {
      dialog.querySelectorAll<HTMLButtonElement>('.ensemble-move')[0].click()
    })
    await press(dialog, '.ensemble-create', 'Create and apply')

    // The row holds the group now, so the block's name is the way in — and it has the
    // keyboard.
    const held = cellFor('1', 'Opening')
    expect(blockName(held)).toBe('Principals')
    expect(document.activeElement).toBe(held.querySelector('.matrix-block-name'))
  })

  it('takes the keyboard into the builder, and gives it back to the row’s box', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })
    const cell = cellFor('1', 'Opening')
    const dialog = await openBuilder(cell)

    // The press that opened it was inside a menu that unmounted with it, so the dialog takes
    // the keyboard itself: the first Tab is the Name field rather than the grid behind it.
    expect(document.activeElement).toBe(dialog)

    await press(dialog, '.ensemble-cancel', 'Cancel')
    expect(document.activeElement).toBe(cell.querySelector('.matrix-cell-add'))
  })

  it('opens the builder from the picker, and closes it without changing the show', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })

    const dialog = await openBuilder(cellFor('1', 'Opening'))
    expect(dialog.getAttribute('role')).toBe('dialog')
    expect(dialog.getAttribute('aria-label')).toBe('New ensemble')
    expect(dialog.querySelector('.ensemble-title')?.textContent).toBe('New ensemble')
    // Nothing in the group, so nothing to create with: the press is off rather than a press
    // that would make a group which opens nothing. A new group has nothing to delete either.
    expect(dialog.querySelector<HTMLButtonElement>('.ensemble-create')?.disabled).toBe(true)
    expect(dialog.querySelector('.ensemble-delete')).toBeNull()

    await press(dialog, '.ensemble-cancel', 'Cancel')
    expect(container.querySelector('.ensemble-dialog')).toBeNull()
    expect(useStore.getState().showSettings.cast.ensembles).toEqual([])
    expect(scenes()[0].dcas).toEqual([])

    // Escape is the dismissal every panel in the window answers to.
    await openBuilder(cellFor('1', 'Opening'))
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(container.querySelector('.ensemble-dialog')).toBeNull()
  })

  it('has no second box once a row holds something, and the name it holds is the way in', async () => {
    await show({
      scenes: [scene('s1', 'Opening', [placed('dca-1', 'channel', 'ch-ada')])],
      cast: cast({ channels: [channel('ch-ada')], performers: [PERFORMERS[0]] })
    })

    // The row holds one thing, so it is one block: no empty box beside it to imply a row can
    // hold another. The one strip rides the row and there is no group to apply, so the
    // picker has nothing to offer — but the builder is where a group is made, and the name
    // the row holds is the press that reaches it, wherever a row is.
    const cell = cellFor('1', 'Opening')
    expect(blockName(cell)).toBe('Ada')
    expect(cell.querySelector('.matrix-cell-add')).toBeNull()

    const picker = await openPicker(cell)
    expect(offerings(picker)).toEqual(['Everything the show has is already on this row.'])
    expect(picker.querySelector('.scene-picker-build')?.textContent).toBe('Ensemble…')

    // And the builder behind it is the one that opens, on the row it was reached from.
    await act(async () => {
      picker.querySelector<HTMLButtonElement>('.scene-picker-build')!.click()
    })
    expect(document.body.querySelector('.scene-picker')).toBeNull()
    expect(container.querySelector('.ensemble-dialog')).not.toBeNull()
    expect(scenes()[0].dcas).toEqual([placed('dca-1', 'channel', 'ch-ada')])
  })

  it('takes the picker away when its own box is pressed again', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })
    const cell = cellFor('1', 'Opening')
    const picker = await openPicker(cell)
    await type(picker.querySelector<HTMLInputElement>('.scene-picker-filter')!, 'extra')
    expect(offerings(picker)).toEqual(['Channels', 'Extra'])

    // The box under the menu is the menu's own press: it puts it away rather than reopening
    // it with the filter thrown away, which would read as a press that did nothing. A real
    // press is a mousedown and then a click, and the menu's own outside-press rule must not
    // get there first — a `click()` alone would pass while the app reopened the menu.
    const box = cell.querySelector<HTMLButtonElement>('.matrix-cell-add')!
    await act(async () => {
      box.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      box.click()
    })
    expect(document.body.querySelector('.scene-picker')).toBeNull()
    expect(scenes()[0].dcas).toEqual([])
  })

  it('puts an overlay away when the show changes under it', async () => {
    await show({ scenes: [scene('s1', 'Opening')] })
    expect(await openPicker(cellFor('1', 'Opening'))).not.toBeNull()

    // An undo, a redo or another hand changing the show moves the row the menu is pinned to
    // — or takes it away — so the menu goes with it rather than hanging over whatever is
    // there now.
    await act(async () => {
      useStore.getState().updateScenesSettings({ list: [] })
    })
    expect(document.body.querySelector('.scene-picker')).toBeNull()

    // The builder is open on the same row, so a change to the cast is the same kind of move.
    await show({ scenes: [scene('s1', 'Opening')], cast: cast({ ensembles: [CHORUS] }) })
    expect(await openBuilder(cellFor('1', 'Opening'))).not.toBeNull()
    await act(async () => {
      useStore.getState().updateCastSettings({ ensembles: [] })
    })
    expect(container.querySelector('.ensemble-dialog')).toBeNull()
  })

  it('draws a hostile label as text, whole, in the block and its title', async () => {
    // Long enough that the column draws an ellipsis, and shaped like markup: the block
    // draws it as text, and its title carries the whole of it.
    const label = `<img src=x onerror="alert('boom')"> ${'Ruth '.repeat(20)}`.trim()
    const group = `<b>Loud</b> ${'and proud '.repeat(12)}`.trim()

    await show({
      scenes: [
        scene('s1', 'Opening', [
          placed('dca-1', 'channel', 'ch-loud'),
          placed('dca-2', 'ensemble', 'ens-loud')
        ])
      ],
      cast: cast({
        channels: [channel('ch-loud', label)],
        performers: [performer('p9', 'Ruth', 'ch-loud')],
        ensembles: [{ id: 'ens-loud', name: group, channelIds: ['ch-loud'] }]
      })
    })

    const strip = cellFor('1', 'Opening')
    expect(strip.querySelector('.matrix-block-name')?.textContent).toBe(label)
    expect(blockTitle(strip)).toBe(label)
    expect(strip.querySelector('img')).toBeNull()
    expect(strip.querySelector('.matrix-block-name')?.children).toHaveLength(0)

    // A group's title names the group and who it holds: same rules, the em dash apart.
    const grouped = cellFor('2', 'Opening')
    expect(grouped.querySelector('.matrix-block-name')?.textContent).toBe(group)
    expect(blockTitle(grouped)).toBe(`${group} — ${label}`)
    expect(grouped.querySelector('b')).toBeNull()
    expect(grouped.querySelector('img')).toBeNull()
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

  it('recalls the all-closed column: every controlled channel is closed, and the column is current', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      desk: DESK,
      deskState: {
        mutes: { 'ch-ada': false, 'ch-extra': false, 'ch-spare': false },
        assignments: { 'ch-ada': ['dca-1'], 'ch-extra': [], 'ch-spare': [] }
      },
      deskSceneId: 's1'
    })

    const column = allClosedColumn()
    expect(column.getAttribute('data-current')).toBe('false')

    await act(async () => {
      column.querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })

    // Every controlled channel is closed — a channel each, addressed by its own number —
    // and no fader is written: this desk is a note desk, which takes no assignment.
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
    expect(useStore.getState().deskState.mutes)
      .toEqual({ 'ch-ada': true, 'ch-extra': true, 'ch-spare': true })
    expect(useStore.getState().deskSceneId).toBe(ALL_CLOSED_SCENE_ID)
    expect(column.getAttribute('data-current')).toBe('true')
  })

  it('runs the show without editing it: every control in a cell is still, the column recall is live', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      editing: false,
      desk: DESK,
      deskState: {
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-spare': true },
        assignments: { 'ch-ada': ['dca-1'], 'ch-extra': [], 'ch-spare': [] }
      },
      deskSceneId: 's1'
    })

    // Every control a cell holds is disabled in run mode — the name, the ✕, and the box an
    // empty row carries — while the block still names what the row holds, and the marks on
    // the cell are the marks they always were: this is the scene the desk is on, and it is
    // where the desk was left.
    const cell = cellFor('1', 'Opening')
    expect(blockName(cell)).toBe('Ada')
    expect([...cell.querySelectorAll<HTMLButtonElement>('.matrix-block-name, .matrix-block-remove')]
      .every(control => control.disabled)).toBe(true)
    expect(cell.getAttribute('data-current')).toBe('true')
    expect(cell.getAttribute('data-pending')).toBe('false')
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('false')
    expect(columnFor('Interval').getAttribute('data-pending')).toBe('true')

    // Nothing in the cell opens: the name is asleep, and a row holding nothing carries a box
    // that is drawn rather than absent and says why it is asleep, because a disabled control
    // is one the keyboard never reaches to read a tooltip on.
    await act(async () => {
      cell.querySelector<HTMLButtonElement>('.matrix-block-name')!.click()
    })
    expect(document.body.querySelector('.scene-picker')).toBeNull()
    const empty = cellFor('1', 'Interval')
    expect(empty.querySelector('.matrix-cell-add')).not.toBeNull()
    expect(empty.querySelector('.matrix-cell-add')?.getAttribute('aria-label'))
      .toBe('Change DCA 1 in Interval — asleep while the show runs: press Edit')
    await act(async () => {
      empty.querySelector<HTMLButtonElement>('.matrix-cell-add')!.click()
    })
    expect(document.body.querySelector('.scene-picker')).toBeNull()

    const recall = columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')
    expect(recall?.disabled).toBe(false)
    await act(async () => { recall?.click() })

    // Interval moves Ada and Extra: recalling is what the view is for, and it still is.
    expect(midiSend).toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBe('s2')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('true')
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

  it('marks the column the desk is in, and the cells say what is still to send', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      deskState: {
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-spare': true },
        assignments: { 'ch-ada': ['dca-1'], 'ch-extra': [], 'ch-spare': [] }
      },
      deskSceneId: 's1'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('true')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('false')
    expect(allClosedColumn().getAttribute('data-current')).toBe('false')
    // The desk is where Opening left it: nothing to send, so nothing pending.
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('false')
    expect(cellFor('1', 'Opening').getAttribute('data-pending')).toBe('false')
    expect(cellFor('1', 'Opening').getAttribute('data-placed')).toBe('true')

    await show({
      scenes: [OPENING, INTERVAL],
      deskState: {
        mutes: { 'ch-ada': true, 'ch-extra': true, 'ch-spare': true },
        assignments: { 'ch-ada': [], 'ch-extra': [], 'ch-spare': [] }
      },
      deskSceneId: 's1'
    })

    // Opening would put Ada back on the first fader and open her: the column and its cell
    // both say so, while the band's row — nothing placed there, nothing recorded — stays
    // still.
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('1', 'Opening').getAttribute('data-current')).toBe('true')
    expect(cellFor('1', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('1', 'Opening').getAttribute('data-placed')).toBe('true')
    expect(cellFor('2', 'Opening').getAttribute('data-pending')).toBe('false')
    expect(cellFor('2', 'Opening').getAttribute('data-placed')).toBe('false')
  })

  it('names the scene the desk is on and the one coming, where the grid cannot', async () => {
    const three = [OPENING, INTERVAL, scene('s3', 'Finale', [placed('dca-2', 'channel', 'ch-extra')])]

    // Nothing recalled: the show has not started, so the first scene is what is coming.
    await show({ scenes: three })
    expect(where()).toEqual({ now: 'nothing recalled', next: '1 Opening' })

    await show({
      scenes: three,
      deskSceneId: 's2',
      deskState: { mutes: { 'ch-extra': false }, assignments: { 'ch-extra': ['dca-2'] } }
    })
    expect(where()).toEqual({ now: '2 Interval', next: '3 Finale' })

    // The last scene has nothing after it, so the slot goes rather than naming a scene
    // that is not there.
    await show({
      scenes: three,
      deskSceneId: 's3',
      deskState: { mutes: { 'ch-extra': false }, assignments: { 'ch-extra': ['dca-2'] } }
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
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-spare': true },
        assignments: { 'ch-ada': ['dca-1'], 'ch-extra': [], 'ch-spare': [] }
      },
      deskSceneId: 's1'
    })

    expect(container.querySelector('.matrix-apply')).toBeNull()

    // Taking the row out leaves the desk holding a placement the scene no longer names: the
    // column says so in amber and the header offers the change that would send.
    await act(async () => {
      cellFor('1', 'Opening').querySelector<HTMLButtonElement>('.matrix-block-remove')!.click()
    })

    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('1', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('2', 'Opening').getAttribute('data-pending')).toBe('false')

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
      .toEqual({ 'ch-ada': true, 'ch-extra': true, 'ch-spare': true })
    // Taking the strip off closed it on the desk, but the record still has its old fader: a
    // note desk cannot be told an assignment, so the placement moves nowhere and the column
    // stays pending for it.
    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
  })

  it('sends exactly the changes a column recall needs', async () => {
    await show({ scenes: [OPENING, INTERVAL], desk: DESK })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-recall')?.click()
    })

    // Nothing has been recalled yet, so the placed channel is opened on its fader and the
    // unplaced ones are closed: one message per mic, addressed by the channel's number.
    expect(midiSend).toHaveBeenCalledTimes(3)
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
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-spare': true },
        assignments: { 'ch-ada': ['dca-1'], 'ch-extra': [], 'ch-spare': [] }
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
        mutes: { 'ch-ada': false, 'ch-extra': true, 'ch-spare': true },
        assignments: { 'ch-ada': ['dca-1'], 'ch-extra': [], 'ch-spare': [] }
      },
      deskSceneId: 's1'
    })

    const disabled = (selector: string): boolean[] =>
      [...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(selector)]
        .map(control => control.disabled)

    expect(disabled('.scene-name-field').every(Boolean)).toBe(true)
    // What removes a scene is not there at all, rather than there and asleep beside recall.
    expect(container.querySelector('.matrix-scene-remove')).toBeNull()
    expect(disabled('.matrix-block-remove').every(Boolean)).toBe(true)
    // The box is there and asleep, and a press on it opens nothing.
    expect(disabled('.matrix-cell-add').every(Boolean)).toBe(true)
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-cell-add')!.click()
    })
    expect(document.body.querySelector('.scene-picker')).toBeNull()
    expect(container.querySelector('.scenes-add')).toBeNull()

    // Edit is how the show is edited, and recall is what the view is for.
    expect(container.querySelector<HTMLButtonElement>('.scenes-edit')?.disabled).toBe(false)
    expect([...container.querySelectorAll<HTMLButtonElement>('.matrix-recall')]
      .every(recall => !recall.disabled)).toBe(true)
    // The desk is where Opening left it, so the header has nothing to apply: the opening
    // scene's own count is none, and Apply only appears once there is a difference.
    expect(container.querySelector('.matrix-apply')).toBeNull()

    // A column recall still opens Extra and closes Ada.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })
    expect(midiSend).toHaveBeenCalled()
    expect(useStore.getState().deskSceneId).toBe('s2')
  })
})
