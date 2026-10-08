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
import { ownListId } from '../../../../shared/cueLists'
import { tileKeyOf, tileKeyRefusal } from '../../hooks/useTileKeys'
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
  // The tiles are the list on screen's: a cart list's own, or the list F6 turned into one.
  const list = useStore(s => s.cueLists.find(entry => entry.id === s.activeListId))
  const activeListId = useStore(s => s.activeListId)
  const updateCueList = useStore(s => s.updateCueList)
  const [now, setNow] = useState(() => Date.now())
  /** The tile waiting for a key of its own, while one is being chosen. */
  const [keying, setKeying] = useState<string | null>(null)
  const [keyRefused, setKeyRefused] = useState<string | null>(null)
  const tiles = cues.filter(cue => cue.parentId === null && ownListId(cue) === activeListId)
  const ownKey = (cueId: string): string | null => list?.tileKeys?.find(entry => entry.cueId === cueId)?.key ?? null

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
      const state = useStore.getState()
      const tile = state.cues.filter(cue => cue.parentId === null && ownListId(cue) === state.activeListId)[index]
      if (!tile) return
      e.preventDefault()
      cueEngine.goById(tile.id)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // A tile being given a key takes the next press: Backspace takes its key away, Escape leaves
  // it as it was, and a key the window already answers is refused with the reason.
  useEffect(() => {
    if (keying === null) return
    const handler = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setKeying(null); setKeyRefused(null); return }
      const kept = (list?.tileKeys ?? []).filter(entry => entry.cueId !== keying)
      if (e.key === 'Backspace' || e.key === 'Delete') {
        updateCueList(activeListId, { tileKeys: kept })
        setKeying(null)
        setKeyRefused(null)
        return
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      const refusal = tileKeyRefusal(e.key)
      if (refusal !== null) { setKeyRefused(refusal); return }
      const key = tileKeyOf(e.key)
      // One key, one tile: a key moved here is taken off the tile that had it.
      updateCueList(activeListId, { tileKeys: [...kept.filter(entry => entry.key !== key), { cueId: keying, key }] })
      setKeying(null)
      setKeyRefused(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [keying, list, activeListId, updateCueList])

  return (
    <div className="cart" role="region" aria-label="Cart">
      <div className="cart-bar">
        <span className="cart-title">{list?.cart === true ? list.name : 'Cart'}</span>
        <span className="cart-hint">
          {keying !== null
            ? keyRefused ?? 'Press the key for this tile — Backspace takes its key away, Escape leaves it'
            : 'Press a tile to play it — 1 to 9 and 0 fire the first ten; right-click one to give it a key'}
        </span>
        <button className="cart-exit" onClick={onExit} title="Back to the list (F6)">
          List <kbd>F6</kbd>
        </button>
      </div>
      {tiles.length === 0 ? (
        <div className="cart-empty">No cues to play. Add some in the list, then come back.</div>
      ) : (
        <div className="cart-grid">
          {tiles.map((cue, index) => (
            <CartTile key={cue.id} cue={cue} cues={cues} index={index} run={running.get(cue.id)} now={now}
              ownKey={ownKey(cue.id)} keying={keying === cue.id}
              onKey={() => { setKeying(cue.id); setKeyRefused(null) }} />
          ))}
        </div>
      )}
    </div>
  )
}

function CartTile({ cue, cues, index, run, now, ownKey, keying, onKey }: {
  cue: Cue
  cues: Cue[]
  index: number
  run: RunningCue | undefined
  now: number
  /** The key this tile answers wherever the show is standing, or null. */
  ownKey: string | null
  /** The tile is waiting for its key to be pressed. */
  keying: boolean
  onKey: () => void
}) {
  const totalMs = cue.type === 'group' ? groupDurationMs(cues, cue.id) : cue.duration
  const timing = run === undefined
    ? null
    : runTiming(cue, run, totalMs, now, cue.type === 'audio' ? audioEngine.getProgress(cue.id) : null)
  const key = ownKey ?? tileKey(index)
  return (
    <div className="cart-tile" data-state={run?.state ?? 'idle'} data-armed={cue.isArmed} data-cue-id={cue.id}
      data-keying={keying || undefined} data-own-key={ownKey ?? undefined}
      onContextMenu={e => { e.preventDefault(); onKey() }}>
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
