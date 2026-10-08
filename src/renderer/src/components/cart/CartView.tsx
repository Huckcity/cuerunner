import { useEffect, useState } from 'react'
import { useStore, type RunningCue } from '../../store'
import type { Cue } from '../../../../shared/cue'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueEngine } from '../../engine/CueEngine'
import { CueIcon } from '../../utils/cueIcons'
import { CUE_COLOR_VAR } from '../../utils/cueColors'
import { groupDurationMs } from '../../utils/cueDuration'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import { formatDuration } from '../../utils/cueDefaults'
import './CartView.css'

// Enough to read a countdown by.
const TICK_MS = 100

/** How many tiles answer a number key: 1 to 9, then 0 for the tenth. */
export const KEYED_TILES = 10

/** The key a tile answers to, by its place: "1" … "9", "0" for the tenth, none after. */
export function tileKey(index: number): string | null {
  if (index < 9) return String(index + 1)
  if (index === 9) return '0'
  return null
}

/** The tile a number key fires, by its place, or null for a key that names none. */
export function tileForKey(key: string): number | null {
  if (!/^[0-9]$/.test(key)) return null
  return key === '0' ? 9 : Number(key) - 1
}

interface Props {
  onExit: () => void
}

/**
 * The list as a wall of buttons: one tile per cue at the top of the list — a group is one
 * tile, which fires it whole — that plays its cue when pressed, wherever the show is standing.
 * It is how a sound-effects board is run: the doorbell, the phone, the crash, in whatever
 * order the scene asks for them. The first ten answer the number keys as well. A press goes
 * through the same runner as GO, so the repeat guard, a disarmed cue and "if fired again" all
 * hold here too; a running tile counts down and has a stop of its own.
 */
export function CartView({ onExit }: Props) {
  const cues = useStore(s => s.cues)
  const running = useStore(s => s.running)
  const [now, setNow] = useState(() => Date.now())
  const tiles = cues.filter(cue => cue.parentId === null)

  const active = running.size > 0
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [active])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (useStore.getState().modals > 0) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if ((tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT') return
      const index = tileForKey(e.key)
      if (index === null) return
      const tile = useStore.getState().cues.filter(cue => cue.parentId === null)[index]
      if (!tile) return
      e.preventDefault()
      cueEngine.goById(tile.id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div className="cart" role="region" aria-label="Cart">
      <div className="cart-bar">
        <span className="cart-title">Cart</span>
        <span className="cart-hint">Press a tile to play it — 1 to 9 and 0 fire the first ten</span>
        <button className="cart-exit" onClick={onExit} title="Back to the list (F6)">
          List <kbd>F6</kbd>
        </button>
      </div>
      {tiles.length === 0 ? (
        <div className="cart-empty">No cues to play. Add some in the list, then come back.</div>
      ) : (
        <div className="cart-grid">
          {tiles.map((cue, index) => (
            <CartTile key={cue.id} cue={cue} cues={cues} index={index} run={running.get(cue.id)} now={now} />
          ))}
        </div>
      )}
    </div>
  )
}

function CartTile({ cue, cues, index, run, now }: {
  cue: Cue
  cues: Cue[]
  index: number
  run: RunningCue | undefined
  now: number
}) {
  const totalMs = cue.type === 'group' ? groupDurationMs(cues, cue.id) : cue.duration
  const timing = run === undefined
    ? null
    : runTiming(cue, run, totalMs, now, cue.type === 'audio' ? audioEngine.getProgress(cue.id) : null)
  const key = tileKey(index)
  return (
    <div className="cart-tile" data-state={run?.state ?? 'idle'} data-armed={cue.isArmed} data-cue-id={cue.id}>
      <button
        className="cart-tile-fire"
        onClick={() => cueEngine.goById(cue.id)}
        disabled={!cue.isArmed}
        title={cue.isArmed ? `Play ${cue.number} ${cue.name}` : `${cue.number} is disarmed`}
      >
        <span className="cart-tile-color" style={{ background: CUE_COLOR_VAR[cue.colorLabel] }} />
        <span className="cart-tile-head">
          <span className="cart-tile-number">{cue.number}</span>
          <CueIcon type={cue.type} className="cart-tile-icon" />
          {key !== null && <kbd className="cart-tile-key">{key}</kbd>}
        </span>
        <span className="cart-tile-name">{cue.name || 'untitled'}</span>
        <span className="cart-tile-time">
          {timing === null
            ? (totalMs > 0 ? formatDuration(totalMs) : '')
            : timing.remainingMs === null
              ? formatRunTime(timing.elapsedMs)
              : `−${formatRunTime(timing.remainingMs)}`}
        </span>
        {timing !== null && (
          <span className="cart-tile-progress"><i style={{ transform: `scaleX(${timing.fraction ?? 0})` }} /></span>
        )}
      </button>
      {run !== undefined && (
        <button
          className="cart-tile-stop"
          onClick={() => cueEngine.stop(cue.id)}
          aria-label={`Stop ${cue.number}`}
          title={`Stop ${cue.number}`}
        >
          ■
        </button>
      )}
    </div>
  )
}
