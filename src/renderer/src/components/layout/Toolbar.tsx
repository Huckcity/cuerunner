import { useEffect, useRef, useState } from 'react'
import { useStore, usePro } from '../../store'
import { useWorkspace, openDemoWorkspace } from '../../hooks/useWorkspace'
import type { CueType } from '../../types/cue'
import { ProMark } from '../license/ProLock'
import { CUE_ICON } from '../../utils/cueIcons'
import { formatShortcut } from '../../utils/shortcuts'
import './Toolbar.css'

const PRIMARY_CUES: { type: CueType; label: string }[] = [
  { type: 'audio', label: 'Audio' },
  { type: 'group', label: 'Group' },
  { type: 'fade',  label: 'Fade'  },
  { type: 'wait',  label: 'Wait'  },
  { type: 'stop',  label: 'Stop'  },
]

const MORE_CUES: { type: CueType; label: string }[] = [
  { type: 'midi',    label: 'MIDI'    },
  { type: 'osc',     label: 'OSC'     },
  { type: 'network', label: 'Network' },
  { type: 'script',  label: 'Script'  },
  { type: 'scene',   label: 'Scene'   },
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

  const handleAddCue = (type: CueType) => {
    // A scene cue belongs to the scenes the license unlocks: without one there is
    // nothing for it to point at, so the click goes to the place that fixes that
    // rather than adding a cue that cannot run.
    if (type === 'scene' && !pro) {
      openSettings('license')
      return
    }
    addCue(type, selectedId ?? undefined)
    if (type === 'fade' && selectedId) {
      const { cues, selectedId: newId, updateCue } = useStore.getState()
      const target = cues.find(c => c.id === selectedId)
      if (newId && target) {
        updateCue(newId, { name: `Fade ${target.name}`, targetCueId: target.id })
      }
    }
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
      window.winslab.workspace.recent().then(setRecentFiles)
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

  const commitName = () => {
    const val = nameRef.current?.value.trim()
    if (val) setWorkspaceName(val)
    setEditingName(false)
  }

  const baseName = workspacePath
    ? workspacePath.split('/').pop()?.replace('.wlab', '') ?? workspaceName
    : workspaceName

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="file-menu-wrapper" ref={fileMenuRef}>
          <button className="toolbar-brand" onClick={() => setFileMenuOpen(v => !v)} title="File menu">
            WinsLab ▾
          </button>
          {fileMenuOpen && (
            <div className="file-menu">
              <button onClick={() => handleMenuAction(newWorkspace)}>
                <span>New</span><kbd>{formatShortcut('Mod+N')}</kbd>
              </button>
              <button onClick={() => handleMenuAction(openWorkspace)}>
                <span>Open…</span><kbd>{formatShortcut('Mod+O')}</kbd>
              </button>
              <button onClick={() => handleMenuAction(openDemoWorkspace)}>
                <span>Open Demo Workspace</span>
              </button>
              <div className="file-menu-separator" />
              <button onClick={() => handleMenuAction(save)}>
                <span>Save</span><kbd>{formatShortcut('Mod+S')}</kbd>
              </button>
              <button onClick={() => handleMenuAction(saveAs)}>
                <span>Save As…</span><kbd>{formatShortcut('Mod+Shift+S')}</kbd>
              </button>
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
                      <span>{p.split('/').pop()}</span>
                    </button>
                  ))}
                </>
              )}
              <div className="file-menu-separator" />
              <button onClick={() => handleMenuAction(onOpenSettings)}>
                <span>Settings…</span><kbd>{formatShortcut('Mod+,')}</kbd>
              </button>
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
            <span
              className="workspace-name-text"
              onDoubleClick={() => setEditingName(true)}
              title="Double-click to rename"
            >
              {baseName}{isDirty ? <span className="dirty-dot"> ●</span> : ''}
            </span>
          )}
        </div>
      </div>

      {/* Cues are added to the cue stack, so the buttons that add them live with it: in
          the Scenes view they would add to a list that is not on screen. */}
      {view === 'cues' && <div className="toolbar-divider" />}

      <div className="toolbar-actions" hidden={view !== 'cues'}>
        {PRIMARY_CUES.map(({ type, label }) => (
          <button key={type} className="toolbar-cue-btn" onClick={() => handleAddCue(type)}>
            {CUE_ICON[type]} {label}
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
                  data-locked={type === 'scene' && !pro}
                  onClick={() => { handleAddCue(type); setMoreMenuOpen(false) }}
                >
                  <span className="toolbar-more-menu-icon">{CUE_ICON[type]}</span>
                  {label}
                  {type === 'scene' && !pro && <ProMark />}
                </button>
              ))}
            </div>
          )}
        </div>
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
          title={pro ? 'Scenes and mics, for running the show' : 'Scenes — part of WinsLab Pro'}
        >
          Scenes
          {!pro && <ProMark />}
        </button>
      </div>
    </div>
  )
}
