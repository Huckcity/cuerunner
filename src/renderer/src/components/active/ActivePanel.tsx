import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useStore, type RunningCue } from '../../store'
import type { AudioCue, Cue } from '../../../../shared/cue'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueEngine } from '../../engine/CueEngine'
import { CueIcon } from '../../utils/cueIcons'
import { CUE_COLOR_VAR } from '../../utils/cueColors'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import { groupDurationMs } from '../../utils/cueDuration'
import { scrubbableRegion, scrubPositionMs } from '../../utils/scrub'
import { listMembership } from '../../../../shared/cueLists'
import './ActivePanel.css'

interface Props {
  onClose: () => void
}

/**
 * Everything that is running, one row each, oldest first — a group and the cues inside it
 * alike, because the question this panel answers is "what is making sound or holding the
 * show right now", and a child of a group is as much the answer as the group.
 *
 * Each row stops its own cue, and an audio cue's bar can be taken hold of: drag along it and
 * let go, and the cue plays on from there. That is the rehearsal move — "go back to the
 * second verse" — made on the cue that is playing rather than on whichever one is selected.
 */
export function ActivePanel({ onClose }: Props) {
  const running = useStore(s => s.running)
  const cues = useStore(s => s.cues)
  const lists = useStore(s => s.cueLists)
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  // In a show of several lists each row names the list it is running in: a cue playing in a
  // list that is not on screen has no row there to say whose it is.
  const membership = lists.length > 1 ? listMembership(cues) : null
  const listName = (cueId: string): string | null => {
    const listId = membership?.get(cueId)
    return listId === undefined ? null : lists.find(list => list.id === listId)?.name ?? null
  }
  const rows = [...running.values()]
    .filter(run => byId.has(run.cueId))
    .sort((a, b) => a.startedAt - b.startedAt)

  return (
    <div className="active-panel">
      <div className="active-header">
        <span className="active-title">Active</span>
        <span className="active-count">{rows.length === 0 ? 'nothing running' : `${rows.length} running`}</span>
        <div className="active-actions">
          <button className="active-btn" onClick={onClose} title="Hide the active cues">✕</button>
        </div>
      </div>
      <div className="active-list">
        {rows.length === 0 ? (
          <div className="active-empty">Nothing is running. Cues appear here while they play.</div>
        ) : (
          rows.map(run => (
            <ActiveRow key={run.cueId} cue={byId.get(run.cueId)!} run={run} cues={cues} listName={listName(run.cueId)} />
          ))
        )}
      </div>
    </div>
  )
}

function ActiveRow({ cue, run, cues, listName }: { cue: Cue; run: RunningCue; cues: Cue[]; listName: string | null }) {
  const fillRef = useRef<HTMLDivElement>(null)
  const timeRef = useRef<HTMLSpanElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  /** Where a drag on the bar is, 0..1 of the region; null while nobody holds it. */
  const [held, setHeld] = useState<number | null>(null)
  const heldRef = useRef<number | null>(null)
  heldRef.current = held

  const totalMs = cue.type === 'group' ? groupDurationMs(cues, cue.id) : cue.duration
  const audio = cue.type === 'audio' ? cue as AudioCue : null
  const region = audio !== null && run.state === 'playing' ? scrubbableRegion(audio) : null

  useEffect(() => {
    let frame = 0
    const tick = (): void => {
      const progress = audio !== null ? audioEngine.getProgress(cue.id) : null
      let fraction: number | null
      if (region !== null && progress !== null) {
        // The bar is the cue's own region, so a cue trimmed to its middle fills from its in
        // point to its out point rather than across a file it does not play.
        fraction = Math.min(1, Math.max(0, (progress.elapsedMs - region.startMs) / (region.endMs - region.startMs)))
      } else {
        fraction = runTiming(cue, run, totalMs, Date.now(), progress).fraction
      }
      const shown = heldRef.current ?? fraction
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${shown ?? 0})`
      if (timeRef.current) {
        const { remainingMs, elapsedMs } = runTiming(cue, run, totalMs, Date.now(), progress)
        timeRef.current.textContent = remainingMs === null
          ? formatRunTime(elapsedMs)
          : `−${formatRunTime(remainingMs)}`
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [cue, run, totalMs, audio, region])

  const fractionAt = (clientX: number): number => {
    const rect = barRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  }

  const grab = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (region === null) return
    e.currentTarget.setPointerCapture(e.pointerId)
    setHeld(fractionAt(e.clientX))
  }
  const drag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (heldRef.current === null) return
    setHeld(fractionAt(e.clientX))
  }
  const release = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (heldRef.current === null || region === null) return
    const fraction = fractionAt(e.clientX)
    setHeld(null)
    // The seek happens on release, not on every move: each one restarts the engine's read
    // of the file, and a drag is one decision about where to go, not forty.
    cueEngine.seekCue(cue.id, scrubPositionMs(region, fraction))
  }

  return (
    <div className="active-row" data-state={run.state} data-type={cue.type} data-cue-id={cue.id}>
      <span className="active-color" style={{ background: CUE_COLOR_VAR[cue.colorLabel] }} />
      <CueIcon type={cue.type} className="active-icon" />
      <span className="active-number">{cue.number}</span>
      <span className="active-name">
        {cue.name || 'untitled'}
        {listName !== null && <span className="active-list" data-list={listName}> · {listName}</span>}
      </span>
      {run.state !== 'playing' && <span className="state-pill active-state">{run.state}</span>}
      <span className="active-time" ref={timeRef} />
      {audio !== null && (run.state === 'playing' || run.state === 'paused') ? (
        <button
          className="active-pause"
          onClick={() => cueEngine.togglePauseCue(cue.id)}
          data-paused={run.state === 'paused'}
          title={run.state === 'paused' ? `Let ${cue.number} go on` : `Hold ${cue.number} where it is`}
          aria-label={run.state === 'paused' ? `Resume ${cue.number}` : `Pause ${cue.number}`}
        >
          {run.state === 'paused' ? '▶' : '❚❚'}
        </button>
      ) : <span />}
      <button
        className="active-stop"
        onClick={() => cueEngine.stop(cue.id)}
        title={`Stop ${cue.number} ${cue.name}`}
        aria-label={`Stop ${cue.number}`}
      >
        ■
      </button>
      <div
        ref={barRef}
        className="active-bar"
        data-scrubbable={region !== null}
        data-held={held !== null}
        role={region !== null ? 'slider' : undefined}
        aria-label={region !== null ? `Position in ${cue.number}` : undefined}
        aria-valuemin={region !== null ? 0 : undefined}
        aria-valuemax={region !== null ? 100 : undefined}
        title={region !== null ? 'Drag to move the playhead, and let go to play from there' : undefined}
        onPointerDown={grab}
        onPointerMove={drag}
        onPointerUp={release}
        onPointerCancel={() => setHeld(null)}
      >
        <div className="active-fill" ref={fillRef} />
      </div>
    </div>
  )
}
