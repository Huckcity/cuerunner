import { useState, useRef, useEffect } from 'react'
import type { AudioCue, Cue } from '../../types/cue'
import type { RunningCue } from '../../store'
import { useStore } from '../../store'
import { formatDuration } from '../../utils/cueDefaults'
import type { MediaLengthState } from '../../utils/mediaLength'
import { CUE_COLOR_VAR } from '../../utils/cueColors'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import { audioEngine } from '../../engine/audioEngineClient'
import { CUE_ICON } from '../../utils/cueIcons'
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
  collapsed?: boolean
  onToggleCollapse?: () => void
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent, id: string) => void
  renamingId: string | null
}

export function CueRow({ cue, depth, isSelected, runState, durationMs, mediaState, collapsed, onToggleCollapse, onClick, onContextMenu, renamingId }: Props) {
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
    if (val !== undefined) updateCue(cue.id, { name: val })
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
      data-running={isRunning}
      data-state={runState?.state}
      data-depth={depth}
      data-armed={cue.isArmed}
      onClick={onClick}
      onDoubleClick={startEdit}
      onContextMenu={e => { e.preventDefault(); onContextMenu(e, cue.id) }}
    >
      {/* Chevron, icon, number: the same three slots on every row, so the icons line up
          as a column whatever the type. */}
      <span className="col-num">
        <span className="cue-chevron">
          {isGroup && (
            <button
              className="group-toggle"
              onClick={e => { e.stopPropagation(); onToggleCollapse?.() }}
              title={collapsed ? 'Expand group' : 'Collapse group'}
            >
              {collapsed ? '▶' : '▼'}
            </button>
          )}
        </span>
        <span className="cue-type-icon" title={cue.type}>{CUE_ICON[cue.type]}</span>
        {cue.number}
      </span>
      <span
        className="col-color"
        style={{ background: CUE_COLOR_VAR[cue.colorLabel] }}
      />
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
        {!cue.isArmed && (
          <span className="disarmed-pill">disarmed</span>
        )}
        {isRunning && runState?.state === 'pre-wait' && (
          <span className="state-pill">pre-wait</span>
        )}
        {isRunning && runState?.state === 'post-wait' && (
          <span className="state-pill">post-wait</span>
        )}
        {vamping && <span className="state-pill" data-vamping="true">vamping</span>}
      </span>
      <span className="col-dur">
        {countingDown ? (
          <span ref={remainingRef} className="col-dur-remaining" />
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
