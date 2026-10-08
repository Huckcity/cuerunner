import { useEffect } from 'react'
import { useStore } from '../store'
import { cueEngine } from '../engine/CueEngine'
import type { CueListInfo } from '../../../shared/cueLists'

/**
 * Keys a tile cannot have, because the window already answers them: GO, STOP and PAUSE, the
 * keys that walk and edit the list, the cart's own number keys, and the views' function keys.
 */
const RESERVED_KEYS = new Set([
  ' ', 'escape', 'p', 'enter', 'tab', 'backspace', 'delete',
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'pageup', 'pagedown', 'home', 'end',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'f5', 'f6', 'shift', 'control', 'alt', 'meta'
])

/** The key a press names, the way a tile stores it: `KeyboardEvent.key`, lower-cased. */
export function tileKeyOf(key: string): string {
  return key.toLowerCase()
}

/** Why a key cannot be a tile's, or null when it can. */
export function tileKeyRefusal(key: string): string | null {
  const name = tileKeyOf(key)
  if (RESERVED_KEYS.has(name)) return `${key === ' ' ? 'Space' : key} already does something in the window`
  return null
}

/** The cue a key fires: the first cart tile, in tab order, that has the key as its own. */
export function cueForTileKey(lists: readonly CueListInfo[], key: string): string | null {
  const name = tileKeyOf(key)
  for (const list of lists) {
    const hit = list.tileKeys?.find(entry => entry.key === name)
    if (hit !== undefined) return hit.cueId
  }
  return null
}

/**
 * A cart's tiles that have keys of their own answer them wherever the show is standing — the
 * main list on screen, the cart behind it — because a sound effects board is played while the
 * operator's eyes are on the stage, not on the tab the effect is in. A bare press only, never
 * one typed into a field, and never while a panel has the keyboard. The press goes through the
 * same runner as a tile's own button, so a disarmed cue, a disarmed list and "if fired again"
 * all hold.
 */
export function useTileKeys(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      const state = useStore.getState()
      if (state.modals > 0) return
      const el = e.target as HTMLElement | null
      const tag = el?.tagName
      if ((tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') || tag === 'TEXTAREA' || tag === 'SELECT') return
      const cueId = cueForTileKey(state.cueLists, e.key)
      if (cueId === null || !state.cues.some(cue => cue.id === cueId)) return
      e.preventDefault()
      cueEngine.goById(cueId)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
