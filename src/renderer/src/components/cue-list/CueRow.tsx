import { useState, useRef, useEffect } from 'react'
import type { AudioCue, Cue } from '../../../../shared/cue'
import type { RunningCue } from '../../store'
import { useStore } from '../../store'
import { formatDuration } from '../../utils/cueDefaults'
import type { MediaLengthState } from '../../utils/mediaLength'
import { CUE_COLOR_VAR } from '../../utils/cueColors'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import { audioEngine } from '../../engine/audioEngineClient'
import { CueIcon, GroupChevron } from '../../utils/cueIcons'
import './CueRow.css'

interface Props {
  cue: Cue
  depth: number
  isSelected: boolean
  runState: RunningCue | null
  /** Derived length for group rows — a group's own `duration` is never stored. */
  durationMs?: number
  /**
   * Where the length has not been measured yet, or cannot be: a row that would
   * otherwise show `–` for a file nobody has read, or a zero for one that is gone.
   */
  mediaState?: MediaLengthState | null
  /**
   * Why the cue's last run failed, in the runner's own words, or null when it did not —
   * or has not run. The same fact the inspector's Last Run block carries, said here
   * because GO has moved the selection on by the time a cue fails: the inspector is
   * showing the next cue, and a failure only it could show was a failure nobody saw.
   */
  failure?: string | null
  collapsed?: boolean
  onToggleCollapse?: () => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  renamingId: string | null
}

export function CueRow({ cue, depth, isSelected, runState, durationMs, mediaState, failure = null, collapsed, onToggleCollapse, onClick, onContextMenu, renamingId }: Props) {
  const updateCue = useStore(s => s.updateCue)
  const [editing, setEditing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const rafRef = useRef<number>(0)
  const progressFillRef = useRef<HTMLDivElement>(null)
  const remainingRef = useRef<HTMLSpanElement>(null)

  const isAudioPlaying = cue.type === 'audio' && runState?.state === 'playing'
  // A vamp loops forever, which means it has no end to count down to: its cell shows the
  // length of the section instead, and the row says what the cue is doing. A countdown
  // that only ever counted up would read as "playing", which is the thing it is not.
  const vamping = isAudioPlaying && (cue as AudioCue).loopCount < 0
  const totalMs = durationMs ?? cue.duration
  // While a cue with a known length plays, its Duration cell counts down what is left:
  // the question in the booth is how long until it ends, not how long it was.
  const countingDown = runState?.state === 'playing' && !vamping && (totalMs > 0 || isAudioPlaying)

  useEffect(() => {
    if (!countingDown || !runState) {
      if (progressFillRef.current) progressFillRef.current.style.width = '0%'
      return
    }
    const tick = () => {
      // The engine's own position, cached by the playback client at tick rate.
      const prog = cue.type === 'audio' ? audioEngine.getProgress(cue.id) : null
      if (progressFillRef.current) {
        // runFraction spans the whole run (loop repeats included); the waveform
        // panel keeps using fraction, which is position inside the file.
        progressFillRef.current.style.width = `${(prog?.runFraction ?? 0) * 100}%`
      }
      if (remainingRef.current) {
        const { remainingMs } = runTiming(cue, runState, totalMs, Date.now(), prog)
        remainingRef.current.textContent = remainingMs === null ? '' : `−${formatRunTime(remainingMs)}`
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [countingDown, runState, totalMs, cue])

  const startEdit = (e: React.MouseEvent) => {
    if (!isSelected) return
    e.stopPropagation()
    setEditing(true)
    setTimeout(() => inputRef.current?.select(), 0)
  }

  const commitEdit = (e: React.FocusEvent | React.KeyboardEvent) => {
    // Escape cancels the rename and stays out of the list-level Escape (deselect)
    if ('key' in e && e.key === 'Escape') {
      e.stopPropagation()
      if (inputRef.current) inputRef.current.value = cue.name
      setEditing(false)
      return
    }
    if ('key' in e && e.key !== 'Enter') return
    const val = inputRef.current?.value.trim()
    // Only a name that changed is an edit. Opening the field and leaving it — a
    // double-click that was meant to select — used to write the same name back, which
    // put the unsaved dot on a show nobody had touched and a no-op in the undo history.
    if (val !== undefined && val !== cue.name) updateCue(cue.id, { name: val })
    setEditing(false)
  }

  useEffect(() => {
    if (renamingId === cue.id) {
      setEditing(true)
      setTimeout(() => inputRef.current?.select(), 0)
    }
  }, [renamingId, cue.id])

  const isGroup = cue.type === 'group'
  const isRunning = runState !== null

  return (
    <div
      className="cue-row"
      data-selected={isSelected}
      data-type={cue.type}
      data-running={isRunning}
      data-state={runState?.state}
      data-depth={depth}
      data-armed={cue.isArmed}
      data-failed={failure !== null && !isRunning}
      onClick={onClick}
      onDoubleClick={startEdit}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, cue.id) }}
    >
      {/* The colour label is the row's own edge rather than a block in the middle of it:
          it marks the whole row at a glance and leaves the icon column to the icons. */}
      <span
        className="col-color"
        style={{ background: CUE_COLOR_VAR[cue.colorLabel] }}
      />
      {/* Number, then one icon slot. A group's icon is the chevron that opens it, so
          every row has the same two slots and the icons line up as a column — the
          disclosure column the list used to keep for groups alone is name width now. */}
      <span className="col-num">
        <span className="cue-number" title={cue.number}>{cue.number}</span>
        <span className="cue-icon-slot">
          {isGroup ? (
            <button
              className="group-toggle"
              onClick={e => { e.stopPropagation(); onToggleCollapse?.() }}
              title={collapsed ? 'Expand group' : 'Collapse group'}
              aria-label={collapsed ? 'Expand group' : 'Collapse group'}
              aria-expanded={!collapsed}
            >
              <GroupChevron open={collapsed !== true} className="cue-type-icon" />
            </button>
          ) : (
            <CueIcon type={cue.type} className="cue-type-icon" />
          )}
        </span>
      </span>
      <span className="col-name">
        {editing ? (
          <input
            ref={inputRef}
            className="name-edit"
            defaultValue={cue.name}
            onBlur={commitEdit}
            onKeyDown={commitEdit}
            onClick={e => e.stopPropagation()}
          />
        ) : (
          <span className="name-text">{cue.name || <em>untitled</em>}</span>
        )}
        {cue.type === 'memo' && cue.notes.trim() !== '' && (
          <span className="memo-text" title={cue.notes}>{cue.notes.trim().split('\n')[0]}</span>
        )}
        {!cue.isArmed && (
          <span className="disarmed-pill">disarmed</span>
        )}
        {isRunning && runState?.state === 'pre-wait' && (
          <span className="state-pill">pre-wait</span>
        )}
        {isRunning && runState?.state === 'post-wait' && (
          <span className="state-pill">post-wait</span>
        )}
        {isRunning && runState?.state === 'paused' && (
          <span className="state-pill" data-paused="true">paused</span>
        )}
        {vamping && <span className="state-pill" data-vamping="true">vamping</span>}
        {/* The last run, not this one: a cue fired again is doing what its other pills
            say, and what it did last time comes back only if it does it again. */}
        {failure !== null && !isRunning && (
          <span className="failed-pill" title={`Last run failed: ${failure}`}>failed</span>
        )}
      </span>
      <span className="col-dur">
        {countingDown ? (
          <span ref={remainingRef} className="col-dur-remaining" />
        ) : cue.type === 'audio' && cue.filePath === '' ? (
          // Said where its length would be, before anybody presses GO: a cue made with
          // the toolbar has no file until it is given one, and a row that read `–` looked
          // like a cue that was ready.
          <span className="col-dur-media" data-media="none" title="this cue has no file to play">
            no file
          </span>
        ) : mediaState === 'measuring' ? (
          <span className="col-dur-media" data-media="measuring" title="the file's length is being read">
            measuring
          </span>
        ) : mediaState === 'missing' ? (
          <span className="col-dur-media" data-media="missing" title="this cue's file could not be read">
            missing
          </span>
        ) : (
          formatDuration(totalMs)
        )}
      </span>
      <span className="col-pre">{cue.preWait > 0 ? formatDuration(cue.preWait) : '–'}</span>
      <span className="col-post">{cue.postWait > 0 ? formatDuration(cue.postWait) : '–'}</span>
      <span className="col-adv">{cue.advance !== 'none' ? cue.advance : ''}</span>

      {isAudioPlaying && (
        <div className="cue-progress-bar">
          <div ref={progressFillRef} className="cue-progress-fill" style={{ width: '0%' }} />
        </div>
      )}
    </div>
  )
}
