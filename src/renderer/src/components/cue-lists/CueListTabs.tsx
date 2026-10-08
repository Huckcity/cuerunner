import { useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import { useStore } from '../../store'
import { listMembership, MAIN_CUE_LIST_ID, type CueListInfo } from '../../../../shared/cueLists'
import { CUE_COLORS, CUE_COLOR_SWATCH, CUE_COLOR_VAR } from '../../utils/cueColors'
import { ListSettingsDialog } from './ListSettingsDialog'
import { DeleteListDialog } from './DeleteListDialog'
import '../cue-list/CueContextMenu.css'
import './CueListTabs.css'

/** What a cue row's drag carries for a tab to read: the ids of the cues being dragged. */
export const CUE_IDS_DRAG_TYPE = 'application/x-cue-ids'

/** What a tab's own drag carries: the list being moved among the tabs. */
const LIST_DRAG_TYPE = 'application/x-cue-list'

interface Props {
  /** Show mode: the tabs bring a list to the front and edit nothing. */
  readOnly?: boolean
}

/**
 * The show's cue lists, one tab each, above the list on screen: the main sequence, a cart of
 * effects, a pre-show loop. A press brings a list to the front, where its own playhead was
 * left; a double press renames it; a right-click has the rest — its colour, its face, taking
 * it out of the show, its place among the tabs, its clock, and deleting it with its cues.
 * Cue rows dropped on a tab move to that list, groups whole; a tab dragged along the bar
 * moves the list. Every one of those is one edit and one undo.
 *
 * A tab says what is running in it, so a cue playing in a list nobody is looking at is
 * never a sound with no row on screen.
 */
export function CueListTabs({ readOnly = false }: Props) {
  const lists = useStore(s => s.cueLists)
  const activeListId = useStore(s => s.activeListId)
  const cues = useStore(s => s.cues)
  const running = useStore(s => s.running)
  const setActiveList = useStore(s => s.setActiveList)
  const addCueList = useStore(s => s.addCueList)
  const updateCueList = useStore(s => s.updateCueList)
  const moveCueList = useStore(s => s.moveCueList)
  const moveCuesToList = useStore(s => s.moveCuesToList)

  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; listId: string } | null>(null)
  const [settingsFor, setSettingsFor] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [dropOn, setDropOn] = useState<string | null>(null)

  // How many cues are running in each list: a tab with sound behind it says so.
  const busy = useMemo(() => {
    const membership = listMembership(cues)
    const count = new Map<string, number>()
    for (const cueId of running.keys()) {
      const listId = membership.get(cueId)
      if (listId !== undefined) count.set(listId, (count.get(listId) ?? 0) + 1)
    }
    return count
  }, [cues, running])

  // Ctrl+PageDown and Ctrl+PageUp walk the tabs, as they do in a browser.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (!e.ctrlKey || (e.key !== 'PageDown' && e.key !== 'PageUp')) return
      if (useStore.getState().modals > 0) return
      const state = useStore.getState()
      const at = state.cueLists.findIndex(list => list.id === state.activeListId)
      const step = e.key === 'PageDown' ? 1 : -1
      const next = state.cueLists[(at + step + state.cueLists.length) % state.cueLists.length]
      if (next === undefined) return
      e.preventDefault()
      state.setActiveList(next.id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const dragKind = (e: React.DragEvent): 'cues' | 'list' | null => {
    if (e.dataTransfer.types.includes(CUE_IDS_DRAG_TYPE)) return 'cues'
    if (e.dataTransfer.types.includes(LIST_DRAG_TYPE)) return 'list'
    return null
  }

  const onDrop = (e: React.DragEvent, list: CueListInfo, index: number): void => {
    const kind = dragKind(e)
    setDropOn(null)
    if (kind === null || readOnly) return
    e.preventDefault()
    e.stopPropagation()
    if (kind === 'cues') {
      const ids = JSON.parse(e.dataTransfer.getData(CUE_IDS_DRAG_TYPE) || '[]') as unknown
      if (Array.isArray(ids)) moveCuesToList(ids.filter((id): id is string => typeof id === 'string'), list.id)
      return
    }
    const moving = e.dataTransfer.getData(LIST_DRAG_TYPE)
    if (moving !== '') moveCueList(moving, index)
  }

  return (
    <div className="cue-list-tabs" role="tablist" aria-label="Cue lists">
      {lists.map((list, index) => {
        const active = list.id === activeListId
        const playing = busy.get(list.id) ?? 0
        return (
          <div
            key={list.id}
            className="cue-list-tab"
            role="tab"
            tabIndex={active ? 0 : -1}
            aria-selected={active}
            data-list-id={list.id}
            data-active={active}
            data-cart={list.cart === true}
            data-disarmed={list.disarmed === true}
            data-drop={dropOn === list.id || undefined}
            draggable={!readOnly && renaming !== list.id}
            title={tabTitle(list, playing)}
            onClick={() => setActiveList(list.id)}
            onDoubleClick={() => { if (!readOnly) setRenaming(list.id) }}
            onContextMenu={e => {
              e.preventDefault()
              if (readOnly) return
              setMenu({ x: e.clientX, y: e.clientY, listId: list.id })
            }}
            onDragStart={e => {
              e.dataTransfer.effectAllowed = 'move'
              e.dataTransfer.setData(LIST_DRAG_TYPE, list.id)
            }}
            onDragOver={e => {
              if (dragKind(e) === null || readOnly) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'move'
              setDropOn(list.id)
            }}
            onDragLeave={() => setDropOn(current => current === list.id ? null : current)}
            onDrop={e => onDrop(e, list, index)}
          >
            <span className="cue-list-tab-color" style={{ background: CUE_COLOR_VAR[list.color ?? 'none'] }} />
            {renaming === list.id ? (
              <RenameInput
                name={list.name}
                onDone={name => {
                  setRenaming(null)
                  if (name !== null) updateCueList(list.id, { name })
                }}
              />
            ) : (
              <span className="cue-list-tab-name">{list.name}</span>
            )}
            {list.cart === true && <span className="cue-list-tab-badge">Cart</span>}
            {list.disarmed === true && <span className="cue-list-tab-badge" data-kind="off">Off</span>}
            {playing > 0 && <span className="cue-list-tab-running" aria-label={`${playing} running`} />}
          </div>
        )
      })}
      {!readOnly && (
        <button
          className="cue-list-tab-add"
          onClick={() => addCueList()}
          title="New cue list"
          aria-label="New cue list"
        >
          +
        </button>
      )}
      {menu !== null && (
        <TabMenu
          x={menu.x}
          y={menu.y}
          list={lists.find(list => list.id === menu.listId)!}
          index={lists.findIndex(list => list.id === menu.listId)}
          count={lists.length}
          onClose={() => setMenu(null)}
          onRename={() => setRenaming(menu.listId)}
          onSettings={() => setSettingsFor(menu.listId)}
          onDelete={() => setDeleting(menu.listId)}
          onNewCart={() => addCueList(undefined, true)}
        />
      )}
      {settingsFor !== null && lists.some(list => list.id === settingsFor) && (
        <ListSettingsDialog listId={settingsFor} onClose={() => setSettingsFor(null)} />
      )}
      {deleting !== null && lists.some(list => list.id === deleting) && (
        <DeleteListDialog listId={deleting} onClose={() => setDeleting(null)} />
      )}
    </div>
  )
}

/** A tab's tooltip: its name, and what it is and has going on. */
function tabTitle(list: CueListInfo, playing: number): string {
  const facts = [
    list.cart === true ? 'a cart' : null,
    list.disarmed === true ? 'disarmed: nothing in it fires' : null,
    playing > 0 ? `${playing} running` : null
  ].filter((fact): fact is string => fact !== null)
  return facts.length === 0 ? list.name : `${list.name} — ${facts.join(', ')}`
}

/** The tab's name, being typed: Enter or leaving keeps it, Escape puts the old one back. */
function RenameInput({ name, onDone }: { name: string; onDone: (name: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const finish = (value: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(value)
  }
  return (
    <input
      ref={ref}
      className="cue-list-tab-rename"
      defaultValue={name}
      aria-label="List name"
      onClick={e => e.stopPropagation()}
      onBlur={e => finish(e.currentTarget.value)}
      onKeyDown={e => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
    />
  )
}

interface MenuProps {
  x: number
  y: number
  list: CueListInfo
  index: number
  count: number
  onClose: () => void
  onRename: () => void
  onSettings: () => void
  onDelete: () => void
  onNewCart: () => void
}

/** What a right-click on a tab offers: the list's own edits, one press each. */
function TabMenu({ x, y, list, index, count, onClose, onRename, onSettings, onDelete, onNewCart }: MenuProps) {
  const updateCueList = useStore(s => s.updateCueList)
  const moveCueList = useStore(s => s.moveCueList)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    // Escape closes the menu and goes no further: on its way past it would stop the show.
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [onClose])

  const act = (fn: () => void) => () => { fn(); onClose() }
  const left = Math.min(x, window.innerWidth - 200)
  const top = Math.min(y, window.innerHeight - 360)

  return ReactDOM.createPortal(
    <div ref={ref} className="cue-context-menu cue-list-tab-menu" style={{ left, top }} role="menu"
      onContextMenu={e => e.preventDefault()}>
      <button className="cue-context-menu-item" data-action="rename-list" onClick={act(onRename)}>
        <span className="cue-context-menu-icon">✎</span>Rename
      </button>
      <button className="cue-context-menu-item" data-action="list-settings" onClick={act(onSettings)}>
        <span className="cue-context-menu-icon">⚙</span>List settings…
      </button>
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item" data-action="toggle-cart"
        onClick={act(() => updateCueList(list.id, { cart: list.cart !== true }))}>
        <span className="cue-context-menu-icon">▦</span>{list.cart === true ? 'Show as a list' : 'Show as a cart'}
      </button>
      <button className="cue-context-menu-item" data-action="toggle-armed"
        onClick={act(() => updateCueList(list.id, { disarmed: list.disarmed !== true }))}>
        <span className="cue-context-menu-icon">{list.disarmed === true ? '●' : '○'}</span>
        {list.disarmed === true ? 'Arm the list' : 'Disarm the list'}
      </button>
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item" data-action="move-left" disabled={index === 0}
        onClick={act(() => moveCueList(list.id, index - 1))}>
        <span className="cue-context-menu-icon">←</span>Move left
      </button>
      <button className="cue-context-menu-item" data-action="move-right" disabled={index === count - 1}
        onClick={act(() => moveCueList(list.id, index + 1))}>
        <span className="cue-context-menu-icon">→</span>Move right
      </button>
      <button className="cue-context-menu-item" data-action="new-cart" onClick={act(onNewCart)}>
        <span className="cue-context-menu-icon">+</span>New cart
      </button>
      <div className="cue-context-menu-separator" />
      <div className="cue-context-menu-colors" role="group" aria-label="Color">
        {CUE_COLORS.map(color => (
          <button
            key={color}
            className="cue-context-menu-color"
            title={color}
            aria-label={color}
            data-active={(list.color ?? 'none') === color}
            style={{ background: CUE_COLOR_SWATCH[color] }}
            onClick={act(() => updateCueList(list.id, { color }))}
          />
        ))}
      </div>
      <div className="cue-context-menu-separator" />
      <button className="cue-context-menu-item cue-context-menu-item--danger" data-action="delete-list"
        disabled={list.id === MAIN_CUE_LIST_ID}
        title={list.id === MAIN_CUE_LIST_ID ? 'The main list stays: it is where a cue with no list runs' : undefined}
        onClick={act(onDelete)}>
        <span className="cue-context-menu-icon">✕</span>Delete list…
      </button>
    </div>,
    document.body
  )
}
