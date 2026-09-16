import { useRef, useCallback, useEffect, useState, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../../store'
import { CueRow } from './CueRow'
import { CueContextMenu } from './CueContextMenu'
import { groupDurationMs } from '../../utils/cueDuration'
import { groupLengthState, mediaLengthsFrom, mediaLengthState } from '../../utils/mediaLength'
import { openDemoWorkspace } from '../../hooks/useWorkspace'
import './CueList.css'

const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.wave', '.aiff', '.aif', '.flac', '.ogg', '.m4a', '.aac', '.opus', '.wma'])

function isAudioFile(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf('.')).toLowerCase()
  return AUDIO_EXTENSIONS.has(ext)
}

function nameFromPath(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.slice(0, dotIdx) : filename
}

// One entry in the virtualizer's flat render list.
interface RenderItem {
  cue: ReturnType<typeof useStore.getState>['cues'][number]
  depth: 0 | 1
  flatIndex: number     // index in cues[]
  collapsed?: boolean   // only set for group rows
}

// Given a drop position between renderItems[dropAt-1] and renderItems[dropAt],
// return the parentId the dropped cue should receive. May name the dragged cue itself
// (dropping a group just below its own header); moveCue rejects that as a no-op.
function dropParentId(items: RenderItem[], dropAt: number): string | null {
  // Either neighbor is a visible child → stay in that group
  if (dropAt < items.length && items[dropAt].depth === 1) {
    return items[dropAt].cue.parentId
  }
  if (dropAt > 0 && items[dropAt - 1].depth === 1) {
    // Past the last row — the empty space under the list — is the end of the show, at
    // the top level: a drop there must not join whichever group happens to be last, or a
    // cue could never be dragged out of a trailing group at all, the gap being the only
    // place below it to aim at.
    return dropAt >= items.length ? null : items[dropAt - 1].cue.parentId
  }
  // Dropping at the bottom half of a group header (empty or collapsed group):
  // the previous item is a group AND the next item is not also a group header.
  // The two-adjacent-groups edge case falls back to null (top-level between them).
  if (
    dropAt > 0 &&
    items[dropAt - 1].cue.type === 'group' &&
    (dropAt >= items.length || items[dropAt].cue.type !== 'group')
  ) {
    return items[dropAt - 1].cue.id
  }
  return null
}

export function CueList() {
  const cues = useStore(s => s.cues)
  const selectedId = useStore(s => s.selectedId)
  const selectedIds = useStore(s => s.selectedIds)
  const running = useStore(s => s.running)
  const mediaLengths = useStore(s => s.mediaLengths)
  const missingMedia = useStore(s => s.missingMedia)
  const select = useStore(s => s.select)
  const extendSelection = useStore(s => s.extendSelection)
  const toggleSelected = useStore(s => s.toggleSelected)
  const removeCues = useStore(s => s.removeCues)
  const duplicateCues = useStore(s => s.duplicateCues)
  const updateCues = useStore(s => s.updateCues)
  const moveCue = useStore(s => s.moveCue)
  const addAudioCuesFromFiles = useStore(s => s.addAudioCuesFromFiles)

  // Collapse state is session state in the store — the toolbar's expand/collapse act on
  // it, and it is not persisted to the workspace.
  const collapsedGroupIds = useStore(s => s.collapsedGroupIds)
  const toggleGroup = useStore(s => s.toggleGroup)

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; cueId: string } | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)

  const openCtxMenu = useCallback((e: React.MouseEvent, cueId: string) => {
    e.preventDefault()
    // A right-click on a row that is already part of the selection acts on the selection —
    // that is the whole point of having one. Anywhere else it moves the selection first,
    // so the menu always acts on what it was opened over.
    if (!useStore.getState().selectedIds.includes(cueId)) select(cueId)
    setCtxMenu({ x: e.clientX, y: e.clientY, cueId })
  }, [select])

  const closeCtxMenu = useCallback(() => setCtxMenu(null), [])


  // A plain press puts the hand on one cue, shift extends from where the hand was, and
  // cmd/ctrl takes one cue in or out of the set. Every one of them ends with the cue that
  // was pressed as the active one, which is the cue GO fires.
  const handleRowClick = useCallback((e: React.MouseEvent, id: string, visibleIds: string[]) => {
    if (e.shiftKey) extendSelection(visibleIds, id)
    else if (e.metaKey || e.ctrlKey) toggleSelected(id)
    else select(id)
  }, [extendSelection, toggleSelected, select])

  // ── Render list ───────────────────────────────────────────────────────────

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    // A folded group takes its whole subtree with it: a cue under a hidden group is
    // hidden too, so a group inside a group cannot leave its own children behind on the
    // screen with nothing above them.
    const hidden = new Set<string>()
    for (let i = 0; i < cues.length; i++) {
      const cue = cues[i]
      if (cue.parentId !== null &&
          (hidden.has(cue.parentId) || collapsedGroupIds.has(cue.parentId))) {
        hidden.add(cue.id)
        continue
      }
      // A group at any depth carries its own state: a group inside a group is folded on
      // its own, and a chevron that always drew "open" for a nested one was a row that
      // could not tell the truth about it.
      const groupState = cue.type === 'group' ? { collapsed: collapsedGroupIds.has(cue.id) } : {}
      items.push({ cue, depth: cue.parentId === null ? 0 : 1, flatIndex: i, ...groupState })
    }
    return items
  }, [cues, collapsedGroupIds])

  // The rows the operator can see, in the order they are drawn: a shift-range runs along
  // this, so a collapsed group's hidden children are not part of a range anybody can see.
  const visibleIds = useMemo(() => renderItems.map(item => item.cue.id), [renderItems])
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])

  // Group rows have no stored duration — derive it from the children here, where the
  // whole cue array is already subscribed. CueRow itself must not subscribe to `cues`
  // (the list is virtualized, so off-screen rows would re-render on every edit).
  const groupDurations = useMemo(() => {
    const map = new Map<string, number>()
    for (const cue of cues) {
      if (cue.type === 'group') map.set(cue.id, groupDurationMs(cues, cue.id))
    }
    return map
  }, [cues])

  // What the session knows about the files behind the lengths, for the rows that have
  // no number to show yet (utils/mediaLength.ts).
  const lengths = useMemo(
    () => mediaLengthsFrom(mediaLengths, missingMedia),
    [mediaLengths, missingMedia]
  )

  // ── File-drop state ───────────────────────────────────────────────────────

  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounterRef = useRef(0)

  // ── Cue-reorder drag state ────────────────────────────────────────────────

  const [dragRenderIndex, setDragRenderIndex] = useState<number | null>(null)
  const [dropRenderIndex, setDropRenderIndex] = useState<number | null>(null)

  // Hover-expand: auto-expand a collapsed group when dragged over for 700ms
  const hoverGroupIdRef = useRef<string | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current) { clearTimeout(hoverTimerRef.current); hoverTimerRef.current = null }
    hoverGroupIdRef.current = null
  }, [])

  const parentRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: renderItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 32,
    overscan: 5
  })
  // Held in a ref so the effect below can follow the selection without depending on the
  // virtualizer object, which is a new one every render.
  const virtualizerRef = useRef(virtualizer)
  virtualizerRef.current = virtualizer

  /**
   * The list follows the selection.
   *
   * The rows are virtualized, so a selection that moves past the bottom edge is a
   * selection nobody can see — and the selection is where GO will fire. Arrow keys and
   * the runner both move it, and neither is a pointer that already knows where it is.
   */
  useEffect(() => {
    if (selectedId === null) return
    const index = renderItems.findIndex(item => item.cue.id === selectedId)
    if (index < 0) return
    virtualizerRef.current.scrollToIndex(index, { align: 'auto' })
  }, [selectedId, renderItems])

  // ── File-drop handlers ────────────────────────────────────────────────────

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) setIsDragOver(true)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDragLeave = useCallback(() => {
    dragCounterRef.current--
    if (dragCounterRef.current === 0) setIsDragOver(false)
  }, [])

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragCounterRef.current = 0
    setIsDragOver(false)

    const audioFiles = Array.from(e.dataTransfer.files)
      .filter(f => isAudioFile(f.name))
      .map(f => {
        const filePath = window.cuerunner.getPathForFile(f)
        return { filePath, name: nameFromPath(filePath) }
      })

    if (audioFiles.length > 0) {
      addAudioCuesFromFiles(audioFiles, selectedId ?? undefined)
    }
  }, [addAudioCuesFromFiles, selectedId])

  // ── Cue-reorder handlers ──────────────────────────────────────────────────

  // Clicking the empty space below the last row drops the selection — otherwise the
  // selected group keeps receiving every new cue.
  const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) select(null)
  }, [select])

  const handleRowDragStart = useCallback((e: React.DragEvent, renderIndex: number) => {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-cue-render-index', String(renderIndex))
    setDragRenderIndex(renderIndex)
    clearHoverTimer()
  }, [clearHoverTimer])

  const handleRowDragOver = useCallback((e: React.DragEvent, renderIndex: number) => {
    if (!e.dataTransfer.types.includes('application/x-cue-render-index')) return
    e.preventDefault()
    e.stopPropagation()

    const item = renderItems[renderIndex]

    // Hover-expand: if this is a collapsed group, start/maintain the timer
    if (item?.cue.type === 'group' && item.collapsed) {
      if (hoverGroupIdRef.current !== item.cue.id) {
        clearHoverTimer()
        hoverGroupIdRef.current = item.cue.id
        hoverTimerRef.current = setTimeout(() => {
          // Expanding, not toggling: the operator is dragging onto this group, and a
          // second hover must not fold it up again under the cue being dropped.
          if (useStore.getState().collapsedGroupIds.has(item.cue.id)) toggleGroup(item.cue.id)
          hoverGroupIdRef.current = null
          hoverTimerRef.current = null
        }, 700)
      }
    } else {
      clearHoverTimer()
    }

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const newDrop = e.clientY < rect.top + rect.height / 2 ? renderIndex : renderIndex + 1
    setDropRenderIndex(newDrop)
  }, [renderItems, clearHoverTimer, toggleGroup])

  const handleScrollDragOver = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-cue-render-index')) return
    e.preventDefault()
    e.stopPropagation()
    clearHoverTimer()
    setDropRenderIndex(renderItems.length)
  }, [renderItems.length, clearHoverTimer])

  const handleReorderDrop = useCallback((e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('application/x-cue-render-index')) return
    e.preventDefault()
    e.stopPropagation()
    clearHoverTimer()

    const fromStr = e.dataTransfer.getData('application/x-cue-render-index')
    if (!fromStr || dropRenderIndex === null) return

    const fromRender = parseInt(fromStr, 10)
    const fromItem = renderItems[fromRender]
    if (!fromItem) return

    const fromFlat = fromItem.flatIndex
    // Index into the pre-move array: the cue the block should land in front of.
    const beforeFlat = dropRenderIndex < renderItems.length
      ? renderItems[dropRenderIndex].flatIndex
      : cues.length
    const newParent = dropParentId(renderItems, dropRenderIndex)

    setDragRenderIndex(null)
    setDropRenderIndex(null)

    moveCue(fromFlat, beforeFlat, newParent)
  }, [dropRenderIndex, renderItems, cues.length, moveCue, clearHoverTimer])

  const handleRowDragEnd = useCallback(() => {
    clearHoverTimer()
    setDragRenderIndex(null)
    setDropRenderIndex(null)
  }, [clearHoverTimer])

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // A modal owns the keyboard while it is up, exactly as the transport bindings do:
    // the panel's Escape closes the panel, and this list must not eat it on the way
    // past — nor act on arrows and Delete that were meant for the panel.
    if (useStore.getState().modals > 0) return
    // The inline rename owns its keystrokes: without this Delete deletes the cue being
    // renamed, arrows move the selection under the caret, and Mod+D fires. Same
    // text-input guard the transport bindings use.
    const el = e.target as HTMLElement | null
    const tag = el?.tagName
    if ((tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT') return

    // Windows and Linux have no Cmd key, so accept either modifier. The key is
    // lower-cased because Shift makes e.key upper-case.
    const mod = e.metaKey || e.ctrlKey
    const key = e.key.toLowerCase()

    if (e.key === 'Escape') {
      // Escape's job in this list is to put down what the operator is holding: the
      // context menu, or the rename a row has open. The selection is not one of those —
      // it is where they are standing, and it is what the waveform panel and GO are
      // drawn from — so a bare Escape is left to the window, which stops the show. An
      // Escape that dropped the selection would take the panel with it and leave the
      // next GO firing nothing.
      if (ctxMenu !== null) {
        e.stopPropagation()
        e.nativeEvent.stopPropagation()
        closeCtxMenu()
      }
      return
    }

    // Undo and redo are owned by the Edit menu, which registers them as accelerators
    // so they work wherever focus sits. A keydown can also reach this container for the
    // same press, and handling it here too would undo twice.
    const renderIdx = renderItems.findIndex(item => item.cue.id === selectedId)

    if (e.key === 'ArrowDown' && renderIdx < renderItems.length - 1) {
      select(renderItems[renderIdx + 1].cue.id)
    } else if (e.key === 'ArrowUp' && renderIdx > 0) {
      select(renderItems[renderIdx - 1].cue.id)
    } else if (e.key === 'Delete' || (key === 'backspace' && mod)) {
      // The set is what the operator is holding, so it is what Delete takes: one edit,
      // one undo, however many cues are in it.
      if (selectedIds.length > 0) removeCues(selectedIds)
    } else if (key === 'd' && mod) {
      e.preventDefault()
      if (selectedIds.length > 0) duplicateCues(selectedIds)
    } else if (key === 'a' && mod && e.shiftKey) {
      // Arming is how a cue is taken out of tonight's show, and it happens mid-run:
      // making it a right-click means reaching for the mouse in the dark. The set is
      // armed together, by the press rather than half by it — the same rule the menu's
      // Arm/Disarm follows.
      e.preventDefault()
      const targetCues = cues.filter(c => selectedIds.includes(c.id))
      if (targetCues.length === 0) return
      const allArmed = targetCues.every(c => c.isArmed)
      updateCues(selectedIds, { isArmed: !allArmed })
    }
  }, [renderItems, selectedId, selectedIds, select, removeCues, duplicateCues, updateCues, cues, ctxMenu, closeCtxMenu])

  // ── Drop indicator ────────────────────────────────────────────────────────

  const showDropIndicator = dropRenderIndex !== null &&
    dragRenderIndex !== null &&
    dropRenderIndex !== dragRenderIndex &&
    dropRenderIndex !== dragRenderIndex + 1

  const dropIndicatorTop = (() => {
    if (!showDropIndicator || dropRenderIndex === null) return null
    const items = virtualizer.getVirtualItems()
    if (dropRenderIndex < renderItems.length) {
      return items.find(i => i.index === dropRenderIndex)?.start ?? null
    }
    const last = items[items.length - 1]
    return last ? last.start + last.size : null
  })()

  // Left indent for the drop indicator when dropping inside a group
  const dropIndent = (() => {
    if (dropRenderIndex === null) return 0
    const parent = dropParentId(renderItems, dropRenderIndex)
    return parent ? 28 : 0
  })()

  return (
    <div
      className="cue-list-container"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleFileDrop}
      data-drag-over={isDragOver}
    >
      <div className="cue-list-header">
        <span className="col-num">#</span>
        <span className="col-name">Name</span>
        <span className="col-dur">Duration</span>
        <span className="col-pre">Pre</span>
        <span className="col-post">Post</span>
        <span className="col-adv">Advance</span>
      </div>
      <div
        ref={parentRef}
        className="cue-list-scroll"
        onClick={handleBackgroundClick}
        onDragOver={handleScrollDragOver}
        onDrop={handleReorderDrop}
        onScroll={() => ctxMenu && closeCtxMenu()}
      >
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map(item => {
            const entry = renderItems[item.index]
            const { cue, depth, collapsed } = entry
            return (
              <div
                key={cue.id}
                className="cue-virtual-row"
                style={{ position: 'absolute', top: item.start, width: '100%', height: item.size }}
                draggable
                data-dragging={dragRenderIndex === item.index || undefined}
                onDragStart={e => handleRowDragStart(e, item.index)}
                onDragOver={e => handleRowDragOver(e, item.index)}
                onDrop={handleReorderDrop}
                onDragEnd={handleRowDragEnd}
              >
                <CueRow
                  cue={cue}
                  depth={depth}
                  isSelected={selectedSet.has(cue.id)}
                  runState={running.get(cue.id) ?? null}
                  durationMs={groupDurations.get(cue.id)}
                  mediaState={cue.type === 'group'
                    ? groupLengthState(cues, cue.id, lengths)
                    : mediaLengthState(cue, lengths)}
                  collapsed={collapsed}
                  onToggleCollapse={cue.type === 'group' ? () => toggleGroup(cue.id) : undefined}
                  onClick={e => handleRowClick(e, cue.id, visibleIds)}
                  onContextMenu={openCtxMenu}
                  renamingId={renamingId}
                />
              </div>
            )
          })}
          {dropIndicatorTop !== null && (
            <div
              className="cue-drop-indicator"
              style={{ top: dropIndicatorTop, left: dropIndent }}
            />
          )}
        </div>
      </div>
      {renderItems.length === 0 && !isDragOver && (
        <div className="cue-list-empty">
          <div>No cues. Add cues using the toolbar above, or drag audio files here.</div>
          <button className="cue-list-empty-demo" onClick={() => openDemoWorkspace()}>
            Open Demo Workspace
          </button>
        </div>
      )}
      {isDragOver && (
        <div className="cue-list-drop-hint">
          Drop audio files to create cues
        </div>
      )}
      {ctxMenu && (() => {
        const ctxCue = cues.find(c => c.id === ctxMenu.cueId)
        return ctxCue ? (
          <CueContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            cue={ctxCue}
            onClose={closeCtxMenu}
            onRename={() => {
              setRenamingId(ctxMenu.cueId)
              setTimeout(() => setRenamingId(null), 100)
            }}
          />
        ) : null
      })()}
    </div>
  )
}
