import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import ReactDOM from 'react-dom'
import { useStore } from '../../store'
import { recallScene, resyncDesk } from '../../engine/scenes'
import { stripLabel } from '../../utils/cast'
import {
  addScene,
  placementFor,
  removeScene,
  rowChannels,
  rowEnsemble,
  sceneChanges,
  setRowMember,
  updateScene,
  type DeskChange,
  type DeskState
} from '../../utils/scenes'
import { dcaNumber } from '../../utils/desk'
import { useModal } from '../../hooks/useModal'
import { TextField } from '../common/Field'
import { EnsembleDialog } from './EnsembleDialog'
import {
  ALL_CLOSED_SCENE_ID,
  type CastSettings,
  type Dca,
  type Ensemble,
  type MicScene,
  type ScenesSettings,
  type ShowChannel
} from '../../../../shared/show'
import './ScenesView.css'

// A scene name is what its column is read by, so the field asks for a name's worth of room —
// eighteen characters, which is what the column is measured for — and no more. The column
// itself is a fixed width (a scene track that stretched with the window would draw two
// scenes as two half-window blocks with their names huddled at one edge), so this only sets
// what the input asks for before the width it is given takes over.
const SCENE_NAME_SIZE = 18

/** The columns that are scenes in the file: the all-closed column is not one of them. */
const SCENE_COLUMN = '.matrix-scene[data-scene-id]'

/** The count as the operator says it out loud: "4 faders", "1 fader", "no faders". */
function faderCount(count: number): string {
  if (count === 0) return 'no faders'
  return `${count} fader${count === 1 ? '' : 's'}`
}

/**
 * Whether this row of this scene is still to send: the column's own change list holds a
 * channel the scene places on this fader, or one the record still has on it — the two
 * sides of the same move, read off the one computation rather than derived a second way.
 */
function cellPending(changes: DeskChange[], dcaId: string, deskState: DeskState): boolean {
  return changes.some(change =>
    change.dcas.includes(dcaId) ||
    (deskState.assignments[change.channelId] ?? []).includes(dcaId))
}

interface CellProps {
  scene: MicScene
  dca: Dca
  cast: CastSettings
  scenes: ScenesSettings
  /** This scene's own change list, computed once per render and passed down. */
  changes: DeskChange[]
  deskState: DeskState
  isCurrent: boolean
  locked: boolean
  writeList: (next: ScenesSettings) => void
  /** The fader's own number — its place in the show, which is the only name it has. */
  fader: number
  onAdd: (sceneId: string, dcaId: string, anchor: PickerAnchor) => void
}

/**
 * What the picker hangs from: the box that opened it. The box is kept rather than the corner
 * it was at, because the grid under it scrolls — the menu is re-measured and travels with
 * the row it belongs to rather than being left behind pointing at the next one.
 */
export interface PickerAnchor {
  box: HTMLElement
}

/**
 * One fader in one scene: the one thing it holds, and the box that changes it.
 *
 * A row holds one member — a channel, or an ensemble — so the cell is a single block: its
 * name, and a ✕ that takes it off. An ensemble's block names the group and carries its
 * members in its title, because what a scene is for at curtain up is reading which mics
 * open, and a row of twelve member chips is a list nobody reads.
 *
 * Everything the row can become comes out of one press: the name it holds, or the blank box
 * an empty row carries. Every press is one store write, hence one undo.
 */
function SceneCell({
  scene, dca, fader, cast, scenes, changes, deskState, isCurrent, locked, writeList, onAdd
}: CellProps) {
  const placement = placementFor(scene, dca.id)
  const pending = cellPending(changes, dca.id, deskState)
  // How every press in this cell and every sentence about it names the fader: its number,
  // which is the only name a fader has.
  const where = `DCA ${fader}`
  // What the block says: the strip by the name the grid uses, or the group's own name. The
  // group's members ride along in the title — the whole of what the block stands for, where
  // there is room for it and where a pointer is asking.
  const channel = placement?.kind === 'channel'
    ? stripLabel(cast.channels, cast.performers, placement.memberId)
    : ''
  const ensemble = rowEnsemble(cast, placement)
  const member = channel !== '' ? channel : ensemble?.name ?? ''
  const held = rowChannels(cast, placement)
    .map(channelId => stripLabel(cast.channels, cast.performers, channelId))
    .filter(label => label !== '')
  // What the block stands for. A group whose members stand on no strip is a group that opens
  // nothing — which is said about the strips it would open, not about the cast: the people are
  // still in it.
  const whole = ensemble === null
    ? member
    : `${ensemble.name} — ${held.length === 0 ? 'no strips yet' : held.join(', ')}`

  return (
    <div
      className="matrix-cell"
      data-placed={placement !== null}
      data-kind={placement?.kind ?? 'none'}
      data-current={isCurrent}
      data-pending={pending}
      aria-label={`${where} in ${scene.name}`}
    >
      {placement !== null && member !== '' ? (
        /* What the row holds takes the whole cell: its name is the press that changes it, and
           the ✕ beside it empties the row. There is no second box to imply a row can hold
           more than one thing — the row holds one, and this is it. */
        <span className="matrix-block" data-kind={placement.kind} title={whole}>
          <button
            type="button"
            className="matrix-block-name"
            disabled={locked}
            // The name says what the press acts on as well as what it does: the control
            // reads "Ada" on screen, so "Ada" is in its name, which is what speech control
            // and a name-only announcement have to match.
            aria-label={`Change ${member} on DCA ${fader} in ${scene.name}`}
            title={locked ? whole : `Change what this row holds — ${whole}`}
            onClick={e => onAdd(scene.id, dca.id, { box: e.currentTarget })}
          >{member}</button>
          <button
            type="button"
            className="matrix-block-remove"
            aria-label={`Take ${member} off DCA ${fader} in ${scene.name}`}
            title={locked ? whole : `Take ${member} off this row — undo puts it back`}
            disabled={locked}
            onClick={() => writeList(setRowMember(scenes, scene.id, dca.id, null))}
          >✕</button>
        </span>
      ) : (
        /* A row holding nothing is one blank box, and the box is what it becomes something
           out of: the picker behind it lists the console's strips, the show's groups, and the
           builder. Out of edit mode it is drawn and inert rather than absent — the grid says
           what every row holds, and a stray press on a running show must not open anything. */
        <button
          type="button"
          className="matrix-cell-add"
          disabled={locked}
          aria-label={locked
            ? `Change DCA ${fader} in ${scene.name} — asleep while the show runs: press Edit`
            : `Change DCA ${fader} in ${scene.name}`}
          title={locked
            ? 'Press Edit to change what this row holds'
            : 'Put a channel or an ensemble on this row'}
          onClick={e => onAdd(scene.id, dca.id, { box: e.currentTarget })}
        />
      )}
    </div>
  )
}

/** How wide the picker is drawn, and the most of the window it is allowed to want. */
const PICKER_WIDTH = 224
const PICKER_HEIGHT = 320

/** The picker's list, named by the filter that drives it. */
const PICKER_LIST_ID = 'scene-picker-list'

/** One row of the picker: a strip of the console, or a group that is already built. */
type PickItem =
  | { kind: 'channel'; id: string; label: string }
  | { kind: 'ensemble'; id: string; label: string }

interface PickerProps {
  scene: MicScene
  /** The fader's own number: the only name it has. */
  fader: number
  cast: CastSettings
  /** Every strip of the console, in the show's own order, less the one this row holds. */
  channels: ShowChannel[]
  /** Every group the show has, less the one this row holds. */
  ensembles: Ensemble[]
  /** The box it was opened from. */
  anchor: PickerAnchor
  /** What clips the box: the grid, which a row can leave before the window does. */
  clip: HTMLElement | null
  onChannel: (channelId: string) => void
  onEnsemble: (ensemble: Ensemble) => void
  onBuild: () => void
  onClose: () => void
}

/**
 * What a blank box opens: everything one row can gain, in one list, with a filter over it.
 *
 * Two sections rather than one list, because the two things are different in kind — a strip
 * is placed on the row, a group brings its members — and the strips are named the way the
 * grid names them, which is what the operator is looking at while they type. The filter is
 * the point of the box on a show with a console's worth of strips: twelve names are scanned,
 * thirty are typed at. The builder sits at the foot rather than in a section, because it is
 * an action and not a thing to pick, and it stays reachable however the filter is typed.
 *
 * Drawn in a portal at the box's own corner: the grid scrolls, and a menu inside a scrolling
 * column would be clipped by it.
 */
function ScenePicker({
  scene, fader, cast, channels: freeChannels, ensembles: freeEnsembles, anchor, clip,
  onChannel, onEnsemble, onBuild, onClose
}: PickerProps) {
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const filterRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [at, setAt] = useState(() => anchor.box.getBoundingClientRect())
  const [filter, setFilter] = useState('')
  const [active, setActive] = useState(0)
  // The picker owns the keyboard while it is up, so a filter typed into it is a filter and
  // not the show's next cue.
  useModal()

  const needle = filter.trim().toLowerCase()
  const channels: PickItem[] = freeChannels.flatMap(channel => {
    const label = stripLabel(cast.channels, cast.performers, channel.id)
    if (label === '' || !label.toLowerCase().includes(needle)) return []
    return [{ kind: 'channel' as const, id: channel.id, label }]
  })
  const ensembles: PickItem[] = freeEnsembles
    .filter(ensemble => ensemble.name.toLowerCase().includes(needle))
    .map(ensemble => ({
      kind: 'ensemble' as const,
      id: ensemble.id,
      label: ensemble.name
    }))
  const items = [...channels, ...ensembles]
  const activeItem = items[Math.min(active, items.length - 1)]

  const pick = (item: PickItem): void => {
    if (item.kind === 'channel') {
      onChannel(item.id)
      return
    }
    const ensemble = freeEnsembles.find(candidate => candidate.id === item.id)
    if (ensemble !== undefined) onEnsemble(ensemble)
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The press is swallowed either way: dismissing the picker must not also stop the
      // show behind it.
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    const onMouseDown = (e: MouseEvent) => {
      const at = e.target
      if (!(at instanceof Node)) return
      if (pickerRef.current !== null && pickerRef.current.contains(at)) return
      // A press on the box the picker hangs from is the picker's own toggle, and the click
      // that follows it is what puts the menu away: closing here instead would leave the
      // click to reopen it with the filter thrown away.
      if (anchor.box.contains(at)) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('mousedown', onMouseDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('mousedown', onMouseDown)
    }
  }, [onClose])

  // The box is inside a grid that scrolls and clips it, and the picker hangs from the box:
  // what the operator scrolls under the menu is re-measured rather than dismissed, so the
  // menu travels with its row instead of being left behind over the next one. It goes when
  // its row has left the grid — which is where a row stops being visible, and is well
  // before the window's own edge: between the two there is the dock and the transport bar,
  // and a menu hanging over those is a menu about a row nobody can see.
  useEffect(() => {
    const onMove = (): void => {
      const box = anchor.box.getBoundingClientRect()
      const bounds = clip?.getBoundingClientRect() ?? null
      const onScreen =
        box.bottom > (bounds?.top ?? 0) &&
        box.top < (bounds?.bottom ?? window.innerHeight) &&
        box.right > (bounds?.left ?? 0) &&
        box.left < (bounds?.right ?? window.innerWidth)
      if (!onScreen) {
        onClose()
        return
      }
      setAt(box)
    }
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [anchor, clip, onClose])

  // The arrows walk the list, and the list is taller than the menu on a show with a
  // console's worth of strips: the row the highlight names is brought into view, because
  // Enter picks it and the operator has to be able to see what they are picking.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>('.scene-picker-item[data-active="true"]')
      ?.scrollIntoView?.({ block: 'nearest' })
  }, [activeItem])

  // The filter takes the keyboard when the picker opens, and the page is not scrolled to it:
  // a menu that scrolled the show to reach its own field would move the row it is about.
  useEffect(() => {
    filterRef.current?.focus({ preventScroll: true })
  }, [])

  const left = Math.min(Math.max(4, at.left), Math.max(4, window.innerWidth - PICKER_WIDTH - 4))
  const top = Math.min(at.bottom + 2, Math.max(4, window.innerHeight - PICKER_HEIGHT - 4))

  // The two sections as data, so one row of the menu is written once: the strips the row
  // does not carry, then the groups it does not apply.
  const sections = [
    { title: 'Channels', items: channels },
    { title: 'Ensembles', items: ensembles }
  ]

  return ReactDOM.createPortal(
    <div
      ref={pickerRef}
      className="scene-picker"
      style={{ left, top, width: PICKER_WIDTH }}
      role="dialog"
      aria-label={`Change DCA ${fader} in ${scene.name}`}
    >
      <input
        ref={filterRef}
        className="scene-picker-filter"
        value={filter}
        placeholder="Filter…"
        // The filter is the list's own keyboard: it stays focused while the menu is up, the
        // arrows move the highlight it names, and Enter picks that row.
        role="combobox"
        aria-label="Filter channels and ensembles"
        aria-expanded
        aria-controls={PICKER_LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={activeItem === undefined
          ? undefined
          : `scene-picker-${activeItem.kind}-${activeItem.id}`}
        onChange={e => { setFilter(e.target.value); setActive(0) }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (items.length === 0) return
            const step = e.key === 'ArrowDown' ? 1 : items.length - 1
            setActive(current => (Math.min(current, items.length - 1) + step) % items.length)
            return
          }
          if (e.key === 'Enter' && activeItem !== undefined) {
            e.preventDefault()
            pick(activeItem)
          }
        }}
      />
      <div
        className="scene-picker-list"
        id={PICKER_LIST_ID}
        ref={listRef}
        role="listbox"
        aria-label="Channels and ensembles"
        // A press on the list's own padding is a press on the menu, not a reason to take the
        // keyboard off the filter: the arrows are what walk the rows.
        onMouseDown={e => e.preventDefault()}
      >
        {sections.map(section => section.items.length === 0 ? null : (
          <Fragment key={section.title}>
            <div className="scene-picker-section">{section.title}</div>
            {section.items.map(entry => (
              <button
                key={entry.id}
                type="button"
                id={`scene-picker-${entry.kind}-${entry.id}`}
                role="option"
                aria-selected={entry === activeItem}
                // The filter owns the keyboard, so the rows are out of the tab order: the
                // arrows reach them and a click works, and Tab leaves the menu.
                tabIndex={-1}
                className="scene-picker-item"
                data-kind={entry.kind}
                data-active={entry === activeItem}
                title={entry.label}
                onClick={() => pick(entry)}
                onMouseEnter={() => setActive(items.indexOf(entry))}
              >
                {entry.label}
              </button>
            ))}
          </Fragment>
        ))}
        {items.length === 0 && (
          <div className="scene-picker-none">
            {filter.trim() === ''
              ? 'Everything the show has is already on this row.'
              : 'Nothing matches.'}
          </div>
        )}
      </div>
      <button type="button" className="scene-picker-build" onClick={onBuild}>
        Ensemble…
      </button>
    </div>,
    document.body
  )
}

/**
 * Scenes: the show's faders down the side, the scenes across the top. Each cell names the
 * strips its row places in its scene and the ensembles applied to that row, and — while
 * editing — gains either from the one blank box it carries, which opens the picker.
 *
 * The first column is the scene that is always there and never edited: all closed. It is
 * what the desk wants pressed between numbers, and nothing is ever placed in it.
 *
 * This is the curtain-up view and the place the show is run from, so it has two modes.
 * It always opens to run it: recall and Apply are live, and nothing else can be changed by
 * a stray click — the blank boxes are drawn and inert, so the grid still says what every
 * row carries. Edit is the deliberate press that gives the grid and the names back, and
 * Done hands the view back to the show and puts any picker away with it. Editing a cell
 * changes the scene, never the desk; the header's Apply is the press that moves the room,
 * and it only appears once there is a difference to send.
 */
export function ScenesView() {
  const showSettings = useStore(s => s.showSettings)
  const scenes = showSettings.scenes
  const cast = useStore(s => s.showSettings.cast)
  const deskState = useStore(s => s.deskState)
  const deskSceneId = useStore(s => s.deskSceneId)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)
  const saveEnsembleOnRow = useStore(s => s.saveEnsembleOnRow)
  const removeEnsemble = useStore(s => s.removeEnsemble)
  const editing = useStore(s => s.scenesEditing)
  const setEditing = useStore(s => s.setScenesEditing)
  const openShowSettings = useStore(s => s.openShowSettings)

  // What is open over the grid: the box's picker, and the builder the picker's last row
  // opens. The row is named by ids rather than by the objects, so a scene removed while the
  // picker is up leaves it pointing at nothing instead of at a copy of what is gone.
  const [picker, setPicker] = useState<{ sceneId: string; dcaId: string; anchor: PickerAnchor } | null>(null)
  const [builder, setBuilder] = useState<{
    sceneId: string
    dcaId: string
    /** The box it was opened from, which is where the keyboard goes back to. */
    box: HTMLElement
    /** The group being edited, or null for a new one: the row is the way into both. */
    ensemble: Ensemble | null
  } | null>(null)

  const locked = !editing
  // The scene the desk is on, and whether that is the all-closed one: null is either the
  // all-closed scene or a desk nothing has been recalled to yet, and neither opens a mic.
  const recalled = scenes.list.find(scene => scene.id === deskSceneId) ?? null
  const allClosed = deskSceneId === ALL_CLOSED_SCENE_ID
  const current = allClosed ? null : recalled
  const currentIndex = recalled === null ? -1 : scenes.list.indexOf(recalled)

  // The running order is the show order, so what comes next is the scene after this one —
  // and before anything has been recalled, the first one. Which scene it is belongs in the
  // header rather than only in the grid: the columns scroll, this does not.
  const nextIndex = currentIndex === -1 ? 0 : currentIndex + 1
  const next = scenes.list[nextIndex] ?? null

  // The show moves without a hand on the grid — a scene cue, a trigger, someone else at the
  // desk — so the view follows it: the scene the desk has just gone to is parked at the left
  // of the visible columns, which is where the ones after it are laid out for the next press.
  // A short number cannot leave the next scene off the side of a long show. Scrolling by hand
  // is left alone until the show moves again, and so is an edit: this runs on a recall — the
  // desk was just handed a new state, or a second one for the scene it is already on — and
  // never on the list changing under it, which is how deleting a scene used to drag the view
  // back to wherever the show was.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    // Found rather than taken from the render: which column a scene sits in is the list's
    // business, and the list is not what this follows.
    const index = scenes.list.findIndex(scene => scene.id === deskSceneId)
    if (scroller === null || index === -1) return
    const column = scroller.querySelectorAll<HTMLElement>(SCENE_COLUMN)[index]
    const plotColumn = scroller.querySelector<HTMLElement>('.matrix-mic')
    if (column === undefined || plotColumn === null) return
    // Measured rather than assumed: the current scene is parked against the plot column, and
    // the width behind that column is a CSS variable anyone is free to change.
    const left = column.getBoundingClientRect().left - scroller.getBoundingClientRect().left
    scroller.scrollLeft += left - plotColumn.getBoundingClientRect().width
  }, [deskSceneId, deskState])

  // What a recall of each scene would change, computed once: the columns read their marks
  // off it and the cells read theirs, so the two never disagree about the same press.
  const changesByScene = useMemo(() => {
    const map = new Map<string, DeskChange[]>()
    map.set(ALL_CLOSED_SCENE_ID, sceneChanges(showSettings, null, deskState))
    for (const scene of scenes.list) {
      map.set(scene.id, sceneChanges(showSettings, scene, deskState))
    }
    return map
  }, [showSettings, deskState, scenes.list])

  // The desk's question, asked for the header: what would a recall of the standing scene
  // change? Nothing means the desk is where the show left it.
  const toApply = deskSceneId === null ? 0 : (changesByScene.get(deskSceneId) ?? []).length

  // Every edit writes back the one field it changed, so a cell toggled in the grid cannot
  // carry a stale copy of anything else with it.
  const writeList = (next: ScenesSettings): void => updateScenesSettings({ list: next.list })

  // The row the picker or the builder is open on. Found from the ids each time rather than
  // held from the moment it was opened: the grid is what has the row, so a scene removed
  // while an overlay is up puts it away instead of leaving it naming what is gone.
  const openRow = picker ?? builder
  const openScene = openRow === null
    ? null
    : scenes.list.find(scene => scene.id === openRow.sceneId) ?? null
  const openDca = openRow === null
    ? null
    : cast.dcas.find(dca => dca.id === openRow.dcaId) ?? null
  // Everything the picker offers is worked out here, where the row is known: an edit made
  // while it is open takes what it just used off the list rather than leaving a stale copy.
  const openPlacement = openScene === null || openDca === null
    ? null
    : placementFor(openScene, openDca.id)
  // The one thing the open row holds, which is what the picker leaves out of its lists: a
  // member already on the row is not something to put on it again.
  const openMember = openPlacement === null ? null : openPlacement.memberId
  const openFader = openDca === null ? 0 : dcaNumber(cast.dcas.indexOf(openDca))
  const closeOverlays = (): void => { setPicker(null); setBuilder(null) }

  // The grid under an overlay can move without the overlay being touched: an undo, a redo or
  // any other edit that adds, removes or shifts a scene, or that changes who is on a strip.
  // What the overlay names is found again on every render, so what is put away is the
  // overlay — rather than left hanging over a row that has moved, or over one that is gone.
  useEffect(() => {
    if (openRow === null) return
    closeOverlays()
  }, [scenes, cast])

  return (
    <div className="scenes-view" data-editing={editing}>
      <div className="scenes-header">
        <span className="scenes-title">Scenes</span>
        {(scenes.list.length > 0 || deskSceneId !== null) && (
          <div className="scenes-where">
            <span className="scenes-now">
              <span className="scenes-where-label">now</span>{' '}
              {current === null && !allClosed ? (
                <span className="scenes-where-none">nothing recalled</span>
              ) : (
                <>
                  <strong className="scenes-where-number">
                    {allClosed ? 0 : currentIndex + 1}
                  </strong>{' '}
                  <span className="scenes-where-name" title={allClosed ? 'All closed' : current?.name}>
                    {allClosed ? 'All closed' : current?.name}
                  </span>
                </>
              )}
            </span>
            {next !== null && (
              <span className="scenes-next">
                <span className="scenes-where-label">next scene</span>{' '}
                <strong className="scenes-where-number">{nextIndex + 1}</strong>{' '}
                <span className="scenes-where-name" title={next.name}>{next.name}</span>
              </span>
            )}
          </div>
        )}
        <span className="scenes-subtitle">
          {`${faderCount(cast.dcas.length)} · ${scenes.list.length} scene${scenes.list.length === 1 ? '' : 's'}`}
        </span>
        <div className="scenes-actions">
          {editing && (
            <button
              className="scenes-add"
              onClick={() => writeList(addScene(scenes))}
              title="Add a scene — it places nothing until its cells do"
            >
              Add scene
            </button>
          )}
          {deskSceneId !== null && toApply > 0 && (
            <button
              className="matrix-apply"
              onClick={() => { void recallScene(deskSceneId) }}
              title="Recall the current scene: send its changes to the desk"
            >
              Recall now ({toApply})
            </button>
          )}
          {deskSceneId !== null && (
            <button
              className="matrix-resync"
              onClick={() => { void resyncDesk() }}
              title="Re-send the scene the desk is on: for when somebody moved a fader by hand"
            >
              Resync
            </button>
          )}
          <button
            className="scenes-edit"
            data-editing={editing}
            onClick={() => { setEditing(!editing); closeOverlays() }}
            title={editing ? 'Back to running the show: recall stays live, nothing else moves' : 'Edit scenes and what their rows carry'}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="scenes-editing-hint">
          Editing — cells and names change the show. Done when finished.
        </div>
      )}

      {scenes.list.length === 0 ? (
        <div className="matrix-empty">
          <span>No scenes yet.</span>
          {editing ? (
            <span>Add one from the header.</span>
          ) : (
            <button className="matrix-empty-action" onClick={() => setEditing(true)}>Edit to add one</button>
          )}
        </div>
      ) : cast.dcas.length === 0 ? (
        <div className="matrix-empty">
          <span>No faders: the rows are the show&apos;s faders, and this show drives none.</span>
          <button
            className="matrix-empty-action"
            onClick={() => openShowSettings('channels')}
          >
            Set up channels…
          </button>
        </div>
      ) : (
        <div className="matrix-scroll" ref={scrollerRef}>
          <div
            className="matrix-grid"
            style={{
              // Fixed tracks, so a scene column is the same width in a show of two scenes
              // and a show of twenty: what the window has over the tracks stays to the right
              // of the last column rather than widening the columns themselves, and what
              // does not fit scrolls inside the view.
              gridTemplateColumns:
                `var(--matrix-mic-width) var(--matrix-all-closed-width) ` +
                `repeat(${scenes.list.length}, var(--matrix-scene-width))`
            } as CSSProperties}
          >
            <div className="matrix-corner" />

            {/* The scene that is never edited and always there: every mic closed. It is a
                column like the others so the press is where the show is run from, and the
                column reads as a place the desk can be rather than as a button. */}
            <div
              className="matrix-scene"
              data-all-closed="true"
              data-current={allClosed}
              data-pending={(changesByScene.get(ALL_CLOSED_SCENE_ID) ?? []).length > 0}
            >
              <div className="matrix-scene-name">
                <span className="scene-name-static">All closed</span>
              </div>
              <button
                className="matrix-recall"
                onClick={() => { void recallScene(ALL_CLOSED_SCENE_ID) }}
                title="Close every mic the show drives"
                aria-label="Recall all closed"
              >
                →
              </button>
            </div>

            {scenes.list.map(scene => {
              // Pending is the desk's question, not the scene's: a column is to apply when
              // recalling it would change something, which makes the marker mean the press.
              const pending = (changesByScene.get(scene.id) ?? []).length > 0
              return (
                <div
                  key={scene.id}
                  className="matrix-scene"
                  data-scene-id={scene.id}
                  data-current={scene.id === deskSceneId}
                  data-pending={pending}
                >
                  <div className="matrix-scene-name">
                    <TextField
                      className="scene-name-field"
                      value={scene.name}
                      placeholder="Scene name"
                      aria-label="Scene name"
                      size={SCENE_NAME_SIZE}
                      // The column is a fixed width, so a long name is clipped: the title is
                      // where the whole of it stays readable.
                      title={scene.name}
                      disabled={locked}
                      // A scene without a name is a row nobody can find again, so the old
                      // name stays until something is actually typed.
                      onValue={name => {
                        if (name.trim() === '') return
                        writeList(updateScene(scenes, scene.id, { name }))
                      }}
                    />
                    {/* Removing sits with the name, away from recall, and only exists
                        while the show is being edited. */}
                    {editing && (
                      <button
                        className="matrix-scene-remove"
                        aria-label={`Remove ${scene.name}`}
                        title="Remove this scene — undo puts it back"
                        onClick={() => writeList(removeScene(scenes, scene.id))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {/* The press the view is for: recalling is never locked out, so the
                      header of every column is a press in either mode. */}
                  <button
                    className="matrix-recall"
                    onClick={() => { void recallScene(scene.id) }}
                    title="Recall this scene"
                    aria-label={`Recall ${scene.name}`}
                  >
                    →
                  </button>
                </div>
              )
            })}

            {cast.dcas.map((dca, index) => {
              // The row is a fader, and a fader is a number: its place in the show, which the
              // desk is told and the operator reaches for. It is a narrow column because a
              // number is narrow, and the grid beside it is what needs the room.
              const fader = dcaNumber(index)
              return (
                <div key={dca.id} className="matrix-row">
                  <div className="matrix-mic">
                    <span className="matrix-fader" title={`DCA ${fader}`}>{fader}</span>
                  </div>
                  {/* The all-closed column places nothing: there is nothing to carry in a
                      column that closes everything, so the gap is not a cell and is not in
                      reach. */}
                  <div className="matrix-cell-blank" />
                  {scenes.list.map(scene => (
                    <SceneCell
                      key={scene.id}
                      scene={scene}
                      dca={dca}
                      fader={fader}
                      cast={cast}
                      scenes={scenes}
                      changes={changesByScene.get(scene.id) ?? []}
                      deskState={deskState}
                      isCurrent={scene.id === deskSceneId}
                      locked={locked}
                      writeList={writeList}
                      onAdd={(sceneId, dcaId, anchor) => {
                        // The box under an open menu is the menu's own: pressing it again is
                        // putting the menu away, not reopening it with the filter cleared.
                        if (picker !== null && picker.anchor.box === anchor.box) {
                          setPicker(null)
                          return
                        }
                        setPicker({ sceneId, dcaId, anchor })
                      }}
                    />
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* The two things a blank box can open, drawn over the grid: the picker, and the
          builder that makes a group out of the strips the operator names. Both are put
          through the row they were opened on rather than the cell that opened them, so
          neither holds a copy of a row that an edit has since replaced. */}
      {picker !== null && openScene !== null && openDca !== null && (
        <ScenePicker
          scene={openScene}
          fader={openFader}
          cast={cast}
          channels={cast.channels.filter(channel =>
            !(openPlacement?.kind === 'channel' && openMember === channel.id))}
          ensembles={cast.ensembles.filter(ensemble =>
            !(openPlacement?.kind === 'ensemble' && openMember === ensemble.id))}
          anchor={picker.anchor}
          clip={scrollerRef.current}
          onChannel={channelId => {
            writeList(
              setRowMember(scenes, openScene.id, openDca.id, { kind: 'channel', memberId: channelId })
            )
            setPicker(null)
          }}
          onEnsemble={ensemble => {
            writeList(
              setRowMember(scenes, openScene.id, openDca.id, { kind: 'ensemble', memberId: ensemble.id })
            )
            setPicker(null)
          }}
          onBuild={() => {
            setBuilder({
              sceneId: openScene.id,
              dcaId: openDca.id,
              box: picker.anchor.box,
              // Editing the group this row holds, or making a new one.
              ensemble: rowEnsemble(cast, openPlacement)
            })
            setPicker(null)
          }}
          onClose={() => setPicker(null)}
        />
      )}

      {builder !== null && openScene !== null && openDca !== null && (
        <EnsembleDialog
          scene={openScene}
          fader={openFader}
          cast={cast}
          editing={builder.ensemble}
          box={builder.box}
          onCancel={closeOverlays}
          onDelete={() => {
            if (builder.ensemble !== null) removeEnsemble(builder.ensemble.id)
            closeOverlays()
          }}
          onSave={(name, channelIds) => {
            saveEnsembleOnRow(
              openScene.id,
              openDca.id,
              builder.ensemble?.id ?? null,
              name,
              channelIds
            )
            closeOverlays()
          }}
        />
      )}
    </div>
  )
}
