import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSelectedCue, useStore, usePro } from '../../store'
import type { Cue, GroupCue } from '../../types/cue'
import { WaveformPanel } from '../waveform/WaveformPanel'
import { TimelineEditor } from '../timeline/TimelineEditor'
import { LogPanel } from '../log/LogPanel'
import { MonitorPanel } from '../monitor/MonitorPanel'
import { RfPanel } from '../rf/RfPanel'
import { ScriptPanel } from '../script/ScriptPanel'
import { ProLock, ProMark } from '../license/ProLock'
import { CUE_ICON } from '../../utils/cueIcons'
import { formatDuration } from '../../utils/cueDefaults'
import { groupDurationMs } from '../../utils/cueDuration'
import type { ShowStrip } from './TransportBar'
import type { AppView } from './Toolbar'
import './Dock.css'

/** What the dock is showing: the selected cue, or one of the show's panels. */
export type DockTab = 'cue' | ShowStrip

// The class names are the ones the strips' buttons had, which is what the specs and the
// guide's screenshot script press.
const TABS: { id: DockTab; label: string; className: string; pro?: true }[] = [
  { id: 'cue', label: 'Cue', className: 'btn-cue' },
  { id: 'log', label: 'Log', className: 'btn-log' },
  { id: 'monitor', label: 'Monitor', className: 'btn-monitor', pro: true },
  { id: 'rf', label: 'Wireless', className: 'btn-rf', pro: true },
  { id: 'script', label: 'Script', className: 'btn-script', pro: true }
]

export const DOCK_DEFAULT_HEIGHT = 180
const DOCK_MIN_HEIGHT = 110
// Never more than this share of the window: the cue list is still the window's job.
const DOCK_MAX_SHARE = 0.6
const HEIGHT_KEY = 'winslab.dock.height'
const COLLAPSED_KEY = 'winslab.dock.collapsed'

// The dock's size is this operator's taste on this machine, not the show's: it lives in
// the window's own storage, and a storage that will not answer costs nothing but the
// default.
function readStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* the default is fine */ }
}

export function clampDockHeight(height: number, windowHeight: number): number {
  return Math.round(Math.min(Math.max(height, DOCK_MIN_HEIGHT), Math.max(DOCK_MIN_HEIGHT, windowHeight * DOCK_MAX_SHARE)))
}

/** A cue with no picture of its own still says what it is, in the same space. */
function CueSummary({ cue }: { cue: Cue | null }) {
  const cues = useStore(s => s.cues)
  if (cue === null) {
    return <div className="dock-summary dock-summary-empty">Select a cue to see it here.</div>
  }
  const children = cue.type === 'group' ? cues.filter(child => child.parentId === cue.id) : []
  const length = cue.type === 'group' ? groupDurationMs(cues, cue.id) : cue.duration
  return (
    <div className="dock-summary">
      <div className="dock-summary-head">
        <span className="dock-summary-icon">{CUE_ICON[cue.type]}</span>
        <strong>{cue.number}</strong>
        <span>{cue.name || 'untitled'}</span>
        <span className="dock-summary-meta">
          {cue.type === 'group' ? `${(cue as GroupCue).mode} group` : cue.type}
          {length > 0 ? ` · ${formatDuration(length)}` : ''}
        </span>
      </div>
      {children.length > 0 && (
        <ol className="dock-summary-children">
          {children.map(child => (
            <li key={child.id}>
              <span className="dock-summary-icon">{CUE_ICON[child.type]}</span>
              <strong>{child.number}</strong> {child.name}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

interface Props {
  view: AppView
  tab: DockTab
  onTab: (tab: DockTab) => void
  timelineExpanded: boolean
  onToggleTimeline: () => void
}

/**
 * The bottom of the window: one place, one height. Its Cue tab shows the selected cue —
 * the waveform, the timeline, or what the cue is — and the show's panels sit beside it as
 * tabs. Selecting a cue changes what the dock shows, never how tall it is, so nothing
 * under the operator's pointer moves as they walk the list.
 */
export function Dock({ view, tab, onTab, timelineExpanded, onToggleTimeline }: Props) {
  const pro = usePro()
  const selected = useSelectedCue()

  const [height, setHeight] = useState(() =>
    clampDockHeight(Number(readStored(HEIGHT_KEY)) || DOCK_DEFAULT_HEIGHT, window.innerHeight))
  const [collapsed, setCollapsed] = useState(() => readStored(COLLAPSED_KEY) === 'true')
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)

  useEffect(() => { writeStored(HEIGHT_KEY, String(height)) }, [height])
  useEffect(() => { writeStored(COLLAPSED_KEY, String(collapsed)) }, [collapsed])

  // The Scenes view has no cue list to have selected from, so it has no Cue tab: the
  // dock there is the show's panels, or just its tabs.
  const tabs = view === 'scenes' ? TABS.filter(entry => entry.id !== 'cue') : TABS
  const showBody = !collapsed && !(view === 'scenes' && tab === 'cue')

  const choose = (next: DockTab): void => {
    // The same press that opened a panel puts the cue back, as the strips' buttons did.
    if (next === tab && next !== 'cue' && !collapsed) onTab('cue')
    else onTab(next)
    setCollapsed(false)
  }

  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { startY: e.clientY, startHeight: height }
  }
  const resize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    setHeight(clampDockHeight(drag.startHeight + (drag.startY - e.clientY), window.innerHeight))
  }
  const endResize = (): void => { dragRef.current = null }

  const backToCue = (): void => onTab('cue')

  const timelineGroup = selected?.type === 'group' && (selected as GroupCue).mode === 'timeline'
    ? selected as GroupCue
    : null
  const fullscreen = timelineExpanded && timelineGroup !== null && tab === 'cue' && view === 'cues'

  const body = (() => {
    switch (tab) {
      case 'cue':
        if (timelineGroup) {
          return <TimelineEditor cue={timelineGroup} expanded={timelineExpanded} onToggleExpand={onToggleTimeline} />
        }
        if (selected?.type === 'audio') return <WaveformPanel />
        return <CueSummary cue={selected} />
      case 'log':
        return <LogPanel onClose={backToCue} />
      case 'monitor':
        return pro ? <MonitorPanel onClose={backToCue} /> : (
          <ProLock variant="strip" feature="Show monitor"
            blurb="What is listening, and what is on the network." onClose={backToCue} />
        )
      case 'rf':
        return pro ? <RfPanel onClose={backToCue} /> : (
          <ProLock variant="strip" feature="Wireless"
            blurb="The mic plot, the packs on stage, and the alarm before a battery dies mid-line." onClose={backToCue} />
        )
      case 'script':
        return pro ? <ScriptPanel onClose={backToCue} /> : (
          <ProLock variant="strip" feature="Script panel"
            blurb="The script beside the cue stack, with cues pinned to the lines they fire on." onClose={backToCue} />
        )
    }
  })()

  return (
    <div
      className="dock"
      data-tab={tab}
      data-collapsed={!showBody}
      data-fullscreen={fullscreen}
      style={showBody && !fullscreen ? { height } : undefined}
    >
      {showBody && (
        <div
          className="dock-resize"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize the dock"
          onPointerDown={startResize}
          onPointerMove={resize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      )}
      <div className="dock-tabs" role="tablist" aria-label="Dock">
        {tabs.map(({ id, label, className, pro: gated }) => (
          <button
            key={id}
            role="tab"
            className={`dock-tab ${className}`}
            aria-selected={tab === id}
            data-active={tab === id && showBody}
            data-locked={gated === true && !pro}
            onClick={() => choose(id)}
          >
            {label}
            {gated === true && !pro && <ProMark />}
          </button>
        ))}
        <button
          className="dock-collapse"
          onClick={() => setCollapsed(value => !value)}
          title={collapsed ? 'Show the dock' : 'Hide the dock, and give the cue list the room'}
          aria-label={collapsed ? 'Show the dock' : 'Hide the dock'}
        >
          {collapsed ? '▴' : '▾'}
        </button>
      </div>
      {showBody && <div className="dock-body">{body}</div>}
    </div>
  )
}
