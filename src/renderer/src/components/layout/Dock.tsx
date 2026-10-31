import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSelectedCue, useStore } from '../../store'
import type { Cue, GroupCue } from '../../../../shared/cue'
import { WaveformPanel } from '../waveform/WaveformPanel'
import { TimelineEditor } from '../timeline/TimelineEditor'
import { LogPanel } from '../log/LogPanel'
import { MonitorPanel } from '../monitor/MonitorPanel'
import { RfPanel } from '../rf/RfPanel'
import { ScriptPanel } from '../script/ScriptPanel'
import { ActivePanel } from '../active/ActivePanel'
import { OutputsPanel } from '../outputs/OutputsPanel'
import { CueIcon } from '../../utils/cueIcons'
import { formatDuration } from '../../utils/cueDefaults'
import { groupDurationMs } from '../../utils/cueDuration'
import type { ShowStrip } from './TransportBar'
import type { AppView } from './Toolbar'
import './Dock.css'

/** What the dock is showing: the selected cue, or one of the show's panels. */
export type DockTab = 'cue' | 'active' | ShowStrip

// The class names are the ones the strips' buttons had, which is what the specs and the
// guide's screenshot script press.
const TABS: { id: DockTab; label: string; className: string }[] = [
  { id: 'cue', label: 'Cue', className: 'btn-cue' },
  { id: 'active', label: 'Active', className: 'btn-active' },
  { id: 'log', label: 'Log', className: 'btn-log' },
  { id: 'monitor', label: 'Monitor', className: 'btn-monitor' },
  { id: 'rf', label: 'Wireless', className: 'btn-rf' },
  { id: 'script', label: 'Script', className: 'btn-script' },
  { id: 'outputs', label: 'Outputs', className: 'btn-outputs' }
]

export const DOCK_DEFAULT_HEIGHT = 180
const DOCK_MIN_HEIGHT = 110
// Never more than this share of the window: the cue list is still the window's job.
const DOCK_MAX_SHARE = 0.6
const HEIGHT_KEY = 'cuerunner.dock.height'
const COLLAPSED_KEY = 'cuerunner.dock.collapsed'

// The dock's size and its fold are this operator's taste on this machine, not the show's:
// they live in the window's own storage, and a storage that will not answer costs nothing
// but the default — the fold being the one thing a workspace chooses first, until the
// operator does.
function readStored(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

function writeStored(key: string, value: string): void {
  try { localStorage.setItem(key, value) } catch { /* the default is fine */ }
}

export function clampDockHeight(height: number, windowHeight: number): number {
  // A window that is not on screen yet has no height to fit the dock into, and reading
  // that as a real one would clamp every launch on a loaded machine down to the minimum
  // and remember it. The height stands as it was left, and is fitted once there is a
  // window to fit.
  if (windowHeight <= 0) return Math.max(height, DOCK_MIN_HEIGHT)
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
        <CueIcon type={cue.type} className="dock-summary-icon" />
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
              <CueIcon type={child.type} className="dock-summary-icon" />
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
  const selected = useSelectedCue()

  // The height is the operator's, and the window is a limit on what is drawn rather than
  // on what is kept: a window that is briefly small must not take their dock away with
  // it, and a window that has no height yet — a loaded machine mounts the dock while the
  // window is still coming up — is no limit at all.
  const [height, setHeight] = useState(() => Number(readStored(HEIGHT_KEY)) || DOCK_DEFAULT_HEIGHT)
  const [windowHeight, setWindowHeight] = useState(() => window.innerHeight)
  // Whether the operator has folded this dock themselves — the chevron, or a tab press —
  // and null while they never have. Until they do, the fold follows the workspace: a show
  // with no cue in it has nothing for the Cue tab to show, so the dock is its tabs there —
  // 180px of nothing across the window a new show is being built in — and the dock comes
  // back the moment there is something in the list. That is the state it *opens* in, not one
  // written down: nothing is stored while this is null, and an operator's own fold is the
  // dock's wherever a workspace is opened from then on, empty or not.
  const [chosenFold, setChosenFold] = useState<boolean | null>(() => {
    const stored = readStored(COLLAPSED_KEY)
    return stored === null ? null : stored === 'true'
  })
  const emptyWorkspace = useStore(s => s.cues.length === 0)
  const log = useStore(s => s.log)
  // The newest log line the operator has had on screen. The Log tab counts the errors
  // written since, because the log is the one place a failed cue explains itself and it
  // is a tab nobody has open by default: an error that only an unopened panel could show
  // is an error that was not shown. Session state — it is where this operator has read to.
  const [readThrough, setReadThrough] = useState(0)
  const collapsed = chosenFold ?? emptyWorkspace
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null)
  /** The tab the dock last unfolded for, so a real change is told from a re-render. */
  const lastRevealTab = useRef<DockTab>(tab)

  useEffect(() => {
    const measure = (): void => setWindowHeight(window.innerHeight)
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => { writeStored(HEIGHT_KEY, String(height)) }, [height])
  useEffect(() => {
    if (chosenFold !== null) writeStored(COLLAPSED_KEY, String(chosenFold))
  }, [chosenFold])

  // The Scenes view has no cue list to have selected from, so it has no Cue tab: the
  // dock there is the show's panels, or just its tabs.
  const tabs = view === 'scenes' ? TABS.filter(entry => entry.id !== 'cue') : TABS
  // The mark says which panel is *loaded*, so it stays on when the dock is folded away:
  // a collapsed dock with no tab marked is a dock the operator cannot read.
  const showBody = !collapsed && !(view === 'scenes' && tab === 'cue')

  const logOnScreen = showBody && tab === 'log'
  const newestLogId = log.length === 0 ? 0 : log[log.length - 1].id
  useEffect(() => {
    if (logOnScreen) setReadThrough(newestLogId)
  }, [logOnScreen, newestLogId])
  const unreadErrors = logOnScreen
    ? 0
    : log.filter(entry => entry.level === 'error' && entry.id > readThrough).length

  const choose = (next: DockTab): void => {
    // The same press that opened a panel puts the cue back, as the strips' buttons did.
    if (next === tab && next !== 'cue' && !collapsed) onTab('cue')
    else onTab(next)
    setChosenFold(false)
  }

  // Somebody else asking for a panel — an alarm chip on the transport, a locked feature
  // pointing at Settings — goes through the same door as a press on the tab. A tab
  // written straight into state while the dock was collapsed was a panel that appeared
  // nowhere at all, and the collapse is remembered across sessions.
  useEffect(() => {
    if (tab !== lastRevealTab.current) {
      lastRevealTab.current = tab
      setChosenFold(false)
    }
  }, [tab])

  // The waveform asked for by name — the inspector's "Show on waveform" — is the Cue tab,
  // unfolded, whichever panel the dock was showing.
  const waveformReveal = useStore(s => s.waveformReveal)
  const lastWaveformReveal = useRef(waveformReveal)
  useEffect(() => {
    if (waveformReveal === lastWaveformReveal.current) return
    lastWaveformReveal.current = waveformReveal
    setChosenFold(false)
    onTab('cue')
  }, [waveformReveal, onTab])



  const startResize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    // From the height on screen, which is the height the pointer is holding: a dock whose
    // remembered height the window will not take has to move the moment it is dragged.
    dragRef.current = { startY: e.clientY, startHeight: clampDockHeight(height, windowHeight) }
  }
  const resize = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    setHeight(clampDockHeight(drag.startHeight + (drag.startY - e.clientY), windowHeight))
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
      case 'active':
        return <ActivePanel onClose={backToCue} />
      case 'log':
        return <LogPanel onClose={backToCue} />
      case 'monitor':
        return <MonitorPanel onClose={backToCue} />
      case 'rf':
        return <RfPanel onClose={backToCue} />
      case 'script':
        return <ScriptPanel onClose={backToCue} />
      case 'outputs':
        return <OutputsPanel onClose={backToCue} />
    }
  })()

  return (
    <div
      className="dock"
      data-tab={tab}
      data-collapsed={!showBody}
      data-fullscreen={fullscreen}
      style={showBody && !fullscreen ? { height: clampDockHeight(height, windowHeight) } : undefined}
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
        {tabs.map(({ id, label, className }) => (
          <button
            key={id}
            role="tab"
            className={`dock-tab ${className}`}
            aria-selected={tab === id}
            data-active={tab === id}
            onClick={() => choose(id)}
          >
            {label}
            {id === 'log' && unreadErrors > 0 && (
              <span
                className="dock-tab-count"
                data-level="error"
                title={`${unreadErrors} ${unreadErrors === 1 ? 'error' : 'errors'} in the log since it was last open`}
              >
                {unreadErrors > 99 ? '99+' : unreadErrors}
              </span>
            )}
          </button>
        ))}
        {/* The fold press says what it does and does what it says: the press sets the fold
            to the body's own state, so the dock always moves the way the top of the window
            reads. The Scenes view's Cue tab is the one state where no press can show
            anything — the body there is pinned away whatever the fold is, because there is
            no cue list to have selected from — so the press is not offered, and the view's
            own tabs are what open the dock. */}
        {!(view === 'scenes' && tab === 'cue') && (
          <button
            className="dock-collapse"
            onClick={() => setChosenFold(showBody)}
            title={showBody ? 'Hide the dock, and give the cue list the room' : 'Show the dock'}
            aria-label={showBody ? 'Hide the dock' : 'Show the dock'}
          >
            {showBody ? '▾' : '▴'}
          </button>
        )}
      </div>
      {showBody && <div className="dock-body">{body}</div>}
    </div>
  )
}
