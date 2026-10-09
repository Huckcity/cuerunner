import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, type RunningCue } from '../../store'
import { cuesOfList } from '../../../../shared/cueLists'
import type { Cue } from '../../../../shared/cue'
import { audioEngine } from '../../engine/audioEngineClient'
import { CueIcon } from '../../utils/cueIcons'
import { CUE_COLOR_VAR } from '../../utils/cueColors'
import { groupDurationMs } from '../../utils/cueDuration'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import { formatDuration } from '../../utils/cueDefaults'
import './ShowMode.css'

// The cards' clocks are for reading across a booth, not for the audio: ten a second is plenty.
const TICK_MS = 100

/** Where a cue stands in the show, as the card says it. */
export type CardState = 'done' | 'next' | 'ready' | 'running' | 'pre-wait' | 'post-wait' | 'paused'

/**
 * A cue's place relative to the cue GO fires: before it is done, it is next, after it is
 * ready — and a running cue says that instead, wherever it is. Nothing selected is the end of
 * the show, so everything that is not running has been played.
 */
export function cardState(index: number, standingIndex: number, run: RunningCue | undefined): CardState {
  if (run !== undefined && run.state !== 'idle') return run.state === 'playing' ? 'running' : run.state
  if (standingIndex < 0) return 'done'
  if (index < standingIndex) return 'done'
  return index === standingIndex ? 'next' : 'ready'
}

const LABEL: Record<CardState, string> = {
  done: 'Done',
  next: 'Next',
  ready: 'Ready',
  running: 'Running',
  'pre-wait': 'Pre-wait',
  'post-wait': 'Post-wait',
  paused: 'Paused'
}

function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

interface Props {
  onExit: () => void
}

/**
 * The show, for running it: every cue as a card in large type, what is done set back, what
 * GO fires next lit, what is running counting down. Read-only by design — nothing on it can
 * be dragged, renamed or deleted by a hand that meant to press GO — and the transport under
 * it works as it always does. It follows the show: the card GO fires, or the one that is
 * running, is kept in view.
 */
export function ShowModeView({ onExit }: Props) {
  const allCues = useStore(s => s.cues)
  const activeListId = useStore(s => s.activeListId)
  // The list on screen, as its own running order: what is done and what is next are read
  // along it, and another list's cues are on that list's tab.
  const cues = useMemo(() => cuesOfList(allCues, activeListId), [allCues, activeListId])
  const selectedId = useStore(s => s.selectedId)
  const running = useStore(s => s.running)
  const listRef = useRef<HTMLOListElement>(null)
  const [now, setNow] = useState(() => Date.now())

  const active = running.size > 0
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [active])

  const standingIndex = selectedId === null ? -1 : cues.findIndex(cue => cue.id === selectedId)
  // The card to keep in view: the one GO fires, or, with nothing next, the newest running one.
  const focusId = selectedId ?? [...running.values()].sort((a, b) => b.startedAt - a.startedAt)[0]?.cueId ?? null
  useEffect(() => {
    if (focusId === null) return
    const cards = listRef.current?.querySelectorAll<HTMLElement>('.show-card') ?? []
    const card = [...cards].find(candidate => candidate.dataset.cueId === focusId)
    card?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [focusId])

  return (
    <div className="show-mode" role="region" aria-label="Show mode">
      <div className="show-mode-bar">
        <span className="show-mode-title">Show mode</span>
        <span className="show-mode-hint">Read-only — Space is GO, Esc is STOP</span>
        <button className="show-mode-exit" onClick={onExit} title="Back to editing (F5)">
          Exit <kbd>F5</kbd>
        </button>
      </div>
      {cues.length === 0 ? (
        <div className="show-mode-empty">No cues in this show.</div>
      ) : (
        <ol className="show-mode-list" ref={listRef}>
          {cues.map((cue, index) => (
            <ShowCard
              key={cue.id}
              cue={cue}
              cues={cues}
              state={cardState(index, standingIndex, running.get(cue.id))}
              run={running.get(cue.id)}
              now={now}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function ShowCard({ cue, cues, state, run, now }: {
  cue: Cue
  cues: Cue[]
  state: CardState
  run: RunningCue | undefined
  now: number
}) {
  const totalMs = cue.type === 'group' ? groupDurationMs(cues, cue.id) : cue.duration
  const timing = run === undefined
    ? null
    : runTiming(cue, run, totalMs, now, cue.type === 'audio' ? audioEngine.getProgress(cue.id) : null)
  const note = firstLine(cue.notes)
  return (
    <li
      className="show-card"
      data-state={state}
      data-cue-id={cue.id}
      data-armed={cue.isArmed}
      data-depth={cue.parentId === null ? 0 : 1}
    >
      <span className="show-card-color" style={{ background: CUE_COLOR_VAR[cue.colorLabel] }} />
      <span className="show-card-number">{cue.number}</span>
      <CueIcon type={cue.type} className="show-card-icon" />
      <div className="show-card-words">
        <span className="show-card-name">{cue.name || 'untitled'}</span>
        {note !== '' && <span className="show-card-note">{note}</span>}
      </div>
      <span className="show-card-state">
        {!cue.isArmed && state !== 'running' ? 'Disarmed' : LABEL[state]}
      </span>
      <span className="show-card-time">
        {timing === null
          ? (totalMs > 0 ? formatDuration(totalMs) : '')
          : timing.remainingMs === null
            ? formatRunTime(timing.elapsedMs)
            : `−${formatRunTime(timing.remainingMs)}`}
      </span>
      {timing !== null && (
        <span className="show-card-progress">
          <i style={{ transform: `scaleX(${timing.fraction ?? 0})` }} />
        </span>
      )}
    </li>
  )
}
