import { useEffect, useRef, useState } from 'react'
import { useStore, usePro } from '../../store'
import {
  useWorkspace,
  openDemoWorkspace,
  exportShowBundle,
  importShowBundle,
  mergeAnotherShow
} from '../../hooks/useWorkspace'
import type { CueType } from '../../../../shared/cue'
import { isProCueType } from '../../../../shared/cue'
import { ProMark } from '../license/ProLock'
import { CueIcon } from '../../utils/cueIcons'
import { formatShortcut } from '../../utils/shortcuts'
import { startNewCueDrag } from '../../utils/newCueDrag'
import { openLogsFolder } from '../../hooks/useLogFile'
import { FILE_MENU, type FileMenuAction, type FileMenuItem } from '../../../../shared/fileMenu'
import './Toolbar.css'

/** An Electron accelerator, written for this keyboard. */
function shortcutLabel(accelerator: string): string {
  return formatShortcut(accelerator.replace('CmdOrCtrl', 'Mod'))
}

const PRIMARY_CUES: { type: CueType; label: string }[] = [
  { type: 'audio', label: 'Audio' },
  { type: 'group', label: 'Group' },
  { type: 'fade',  label: 'Fade'  },
  { type: 'wait',  label: 'Wait'  },
  { type: 'stop',  label: 'Stop'  },
]

/** The File menu entries that open a Pro surface. The file records its own history
 *  whether or not this machine is licensed; comparing it, merging it and bundling it are
 *  what the key turns on. Show Settings is the console, the cast and the mic plot — what
 *  Scenes run on — so it carries the mark too: unmarked, it read as the show's main
 *  settings and opened a desk nobody on a free build had asked about. */
const PRO_FILE_ACTIONS = new Set<FileMenuAction>([
  'compare',
  'merge',
  'export-bundle',
  'import-bundle',
  'show-settings'
])

const MORE_CUES: { type: CueType; label: string }[] = [
  { type: 'midi',    label: 'MIDI'    },
  { type: 'osc',     label: 'OSC'     },
  { type: 'network', label: 'Network' },
  { type: 'script',  label: 'Script'  },
  { type: 'scene',   label: 'Scene'   },
  { type: 'devamp',  label: 'Devamp'  },
  { type: 'msc',     label: 'Show Control' },
  { type: 'mic',     label: 'Mic' },
  { type: 'memo',    label: 'Memo' },
]

interface Props {
  onOpenSettings: () => void
  view: AppView
  onSwitchView: (view: AppView) => void
}

/**
 * What fills the middle of the window: the cue stack the show is built in, or the scenes
 * the show is run from and edited in.
 */
export type AppView = 'cues' | 'scenes'

export function Toolbar({ onOpenSettings, view, onSwitchView }: Props) {
  const addCue = useStore(s => s.addCue)
  const selectedId = useStore(s => s.selectedId)
  const pro = usePro()
  const openSettings = useStore(s => s.openSettings)
  const openShowSettings = useStore(s => s.openShowSettings)
  const openChanges = useStore(s => s.openChanges)
  const openReport = useStore(s => s.openReport)

  const handleAddCue = (type: CueType) => {
    // A scene cue belongs to the scenes the license unlocks: without one there is
    // nothing for it to point at, so the click goes to the place that fixes that
    // rather than adding a cue that cannot run.
    if (isProCueType(type) && !pro) {
      openSettings('license')
      return
    }
    // A fade made with an audio cue selected is a fade of that cue: it is born named for it
    // and aimed at it, as part of the add — written afterwards it was a second edit, and
    // the first undo after adding a fade only un-named it. Only an audio cue: a fade moves
    // a sound, so one made with a wait or a group selected is left for the operator to aim,
    // rather than aimed at something its own tab would not offer.
    const target = type === 'fade' && selectedId
      ? useStore.getState().cues.find(c => c.id === selectedId && c.type === 'audio')
      : undefined
    addCue(
      type,
      selectedId ?? undefined,
      target === undefined ? undefined : { name: `Fade ${target.name}`, targetCueId: target.id }
    )
  }

  const { workspaceName, workspacePath, isDirty, newWorkspace, openWorkspace, openRecent, save, saveAs, setWorkspaceName } =
    useWorkspace()

  const [fileMenuOpen, setFileMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const fileMenuRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (fileMenuOpen) {
      window.cuerunner.workspace.recent().then(setRecentFiles)
    }
  }, [fileMenuOpen])

  useEffect(() => {
    if (!fileMenuOpen && !moreMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (fileMenuRef.current && !fileMenuRef.current.contains(e.target as Node)) setFileMenuOpen(false)
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setMoreMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [fileMenuOpen, moreMenuOpen])

  // Escape closes an open menu, and only that. The press is taken on the document, in the
  // capture phase, before the transport's own binding can read it: an Escape that reached
  // the window stopped the show behind a menu the operator was only backing out of — and
  // left the menu open. The same rule the cue list's context menu follows. Space is not
  // taken: GO is pressed without looking, and a menu passes it through.
  useEffect(() => {
    if (!fileMenuOpen && !moreMenuOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      setFileMenuOpen(false)
      setMoreMenuOpen(false)
    }
    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [fileMenuOpen, moreMenuOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (e.key === 's' && e.shiftKey) { e.preventDefault(); saveAs() }
      else if (e.key === 's') { e.preventDefault(); save() }
      else if (e.key === 'o') { e.preventDefault(); openWorkspace() }
      else if (e.key === 'n') { e.preventDefault(); newWorkspace() }
      else if (e.key === ',') { e.preventDefault(); onOpenSettings() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [save, saveAs, openWorkspace, newWorkspace, onOpenSettings])

  const handleMenuAction = async (action: () => unknown): Promise<void> => {
    setFileMenuOpen(false)
    await action()
  }

  // One set of actions for both File menus: the one in the window and the application's.
  const fileActions: Record<FileMenuAction, () => unknown> = {
    'new': newWorkspace,
    'open': openWorkspace,
    'open-demo': openDemoWorkspace,
    'save': save,
    'save-as': saveAs,
    // Both open the same dialog: the show's own history of its saves, or how it differs
    // from another file. The menu entry says which one the operator asked for.
    'history': () => openChanges('history'),
    'compare': () => openChanges('compare'),
    'merge': mergeAnotherShow,
    'export-bundle': exportShowBundle,
    'import-bundle': importShowBundle,
    'report-problem': openReport,
    'open-logs': () => openLogsFolder(),
    'show-settings': () => openShowSettings('channels'),
    'settings': onOpenSettings
  }
  const fileActionsRef = useRef(fileActions)
  fileActionsRef.current = fileActions

  useEffect(() => window.cuerunner.app.onMenuAction(action => {
    if (action === 'undo' || action === 'redo' || action === 'show-mode') return
    void fileActionsRef.current[action]()
  }), [])

  const fileItem = (item: FileMenuItem) => (
    <button key={item.action} data-action={item.action} onClick={() => handleMenuAction(fileActions[item.action])}>
      <span className="file-menu-label">{item.label}</span>
      {/* On a machine without a key only: the mark says a press leads to something the
          key turns on, and with the key there is nothing to say. */}
      {PRO_FILE_ACTIONS.has(item.action) && !pro && <ProMark />}
      {item.accelerator && <kbd>{shortcutLabel(item.accelerator)}</kbd>}
    </button>
  )
  // Everything in the shared list but Settings, which goes last, after the recent files.
  const [settingsItem] = FILE_MENU.filter((entry): entry is FileMenuItem =>
    entry !== 'separator' && entry.action === 'settings')
  const mainEntries = FILE_MENU.filter(entry => entry !== settingsItem)
  while (mainEntries[mainEntries.length - 1] === 'separator') mainEntries.pop()

  const commitName = () => {
    const val = nameRef.current?.value.trim()
    // The same name back is not a rename, and must not mark the show unsaved.
    if (val && val !== workspaceName) setWorkspaceName(val)
    setEditingName(false)
  }

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="file-menu-wrapper" ref={fileMenuRef}>
          <button className="toolbar-brand" onClick={() => setFileMenuOpen(v => !v)} title="File menu">
            {/* The mark is the app's own: five meter bars, the same drawing as the icon
                the installers ship. */}
            <svg className="toolbar-mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
              <rect x="2.24" y="22.02" width="8.32" height="19.97" rx="2.08" fill="currentColor" opacity="0.55" />
              <rect x="15.04" y="14.03" width="8.32" height="35.94" rx="2.08" fill="currentColor" opacity="0.8" />
              <rect x="27.84" y="7.04" width="8.32" height="49.92" rx="2.08" fill="currentColor" />
              <rect x="40.64" y="17.52" width="8.32" height="28.95" rx="2.08" fill="currentColor" opacity="0.75" />
              <rect x="53.44" y="25.01" width="8.32" height="13.98" rx="2.08" fill="currentColor" opacity="0.55" />
            </svg>
            Cuerunner
            <span className="toolbar-brand-caret">▾</span>
          </button>
          {fileMenuOpen && (
            <div className="file-menu">
              {mainEntries.map((entry, index) => entry === 'separator'
                ? <div key={`separator-${index}`} className="file-menu-separator" />
                : fileItem(entry))}
              {recentFiles.length > 0 && (
                <>
                  <div className="file-menu-separator" />
                  <div className="file-menu-section">Recent</div>
                  {recentFiles.map(p => (
                    <button
                      key={p}
                      className="file-menu-recent"
                      onClick={() => handleMenuAction(() => openRecent(p))}
                      title={p}
                    >
                      <span>{p.split(/[\\/]/).pop()}</span>
                    </button>
                  ))}
                </>
              )}
              {settingsItem && (
                <>
                  <div className="file-menu-separator" />
                  {fileItem(settingsItem)}
                </>
              )}
            </div>
          )}
        </div>

        <div className="workspace-name">
          {editingName ? (
            <input
              ref={nameRef}
              className="workspace-name-input"
              defaultValue={workspaceName}
              onBlur={commitName}
              onKeyDown={e => { if (e.key === 'Enter') commitName(); if (e.key === 'Escape') setEditingName(false) }}
              autoFocus
            />
          ) : (
            // The show's own name, which is the one the window's title and the close
            // prompt use. It used to be the file's name once there was a file, so a show
            // saved as "Macbeth" read "Macbeth" here and "Untitled" in the title bar, and a
            // rename typed into this very field changed the title and left this as it was.
            // The file is still one hover away, for a show kept in a file called something
            // else.
            <span
              className="workspace-name-text"
              onDoubleClick={() => setEditingName(true)}
              title={workspacePath === null ? 'Double-click to rename' : `${workspacePath}\nDouble-click to rename`}
            >
              <span className="workspace-name-label">{workspaceName}</span>
              {isDirty ? <span className="dirty-dot"> ●</span> : ''}
            </span>
          )}
        </div>
      </div>

      {/* Cues are added to the cue stack, so the buttons that add them live with it: in
          the Scenes view they would add to a list that is not on screen. */}
      {view === 'cues' && <div className="toolbar-divider" />}

      <div className="toolbar-actions" hidden={view !== 'cues'}>
        {PRIMARY_CUES.map(({ type, label }) => (
          <button
            key={type}
            className="toolbar-cue-btn"
            onClick={() => handleAddCue(type)}
            // Dragged into the list, the cue lands where it is let go rather than after the
            // selection — the way a cue is put between two others without selecting either.
            draggable
            onDragStart={e => startNewCueDrag(e.dataTransfer, type)}
            title={`${label}: click to add after the selection, or drag into the list`}
          >
            <CueIcon type={type} className="toolbar-cue-icon" />
            {label}
          </button>
        ))}

        <div ref={moreMenuRef} style={{ position: 'relative' }}>
          <button className="toolbar-more-btn" onClick={() => setMoreMenuOpen(v => !v)}>
            More ▾
          </button>
          {moreMenuOpen && (
            <div className="toolbar-more-menu">
              {MORE_CUES.map(({ type, label }) => (
                <button
                  key={type}
                  className="toolbar-more-menu-item"
                  data-locked={isProCueType(type) && !pro}
                  onClick={() => { handleAddCue(type); setMoreMenuOpen(false) }}
                  draggable
                  onDragStart={e => startNewCueDrag(e.dataTransfer, type)}
                >
                  <CueIcon type={type} className="toolbar-more-menu-icon" />
                  {label}
                  {isProCueType(type) && !pro && <ProMark />}
                </button>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* What the list is showing, for a show long enough that folding it away is the
          only way to see the shape of it. Its own tray, beside the one that adds cues:
          these change the view of the list rather than what is in it. Expand opens the
          top level and leaves the nested groups as they were; Collapse closes
          everything. */}
      <div className="toolbar-list-actions" hidden={view !== 'cues'}>
        <button
          className="toolbar-list-btn"
          onClick={() => useStore.getState().expandTopLevel()}
          title="Open the top-level groups — groups inside them stay as you left them"
        >
          Expand
        </button>
        <button
          className="toolbar-list-btn"
          onClick={() => useStore.getState().collapseAll()}
          title="Close every group"
        >
          Collapse
        </button>
      </div>

      <div className="toolbar-view" role="tablist" aria-label="View">
        <button
          className="toolbar-view-btn"
          role="tab"
          aria-selected={view === 'cues'}
          data-active={view === 'cues'}
          onClick={() => onSwitchView('cues')}
          title="The cue stack"
        >
          Cues
        </button>
        <button
          className="toolbar-view-btn"
          role="tab"
          aria-selected={view === 'scenes'}
          data-active={view === 'scenes'}
          data-locked={!pro}
          onClick={() => onSwitchView('scenes')}
          title={pro ? 'Scenes and mics, for running the show' : 'Scenes — part of Cuerunner Pro'}
        >
          Scenes
          {!pro && <ProMark />}
        </button>
      </div>
    </div>
  )
}
