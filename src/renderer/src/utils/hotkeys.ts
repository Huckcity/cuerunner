import type { Cue } from '../../../shared/cue'
import type { CueListInfo } from '../../../shared/cueLists'
import { cueTriggers } from '../engine/triggers'
import { currentPlatform, formatShortcut } from './shortcuts'

// A key on this machine's keyboard as a cue trigger: written the way the menus write a
// shortcut ("Mod+Shift+F7"), read off the physical key rather than the character it types —
// a key trigger answers the key the operator's finger is on, whatever layout the machine has
// and whether or not Shift is down — and refused where the app already answers that key.

/** The modifiers a combination is written with, in the order it is written. */
const MODIFIER_ORDER = ['Mod', 'Alt', 'Shift'] as const

/**
 * What a key is written as, from its physical code: letters and digits as themselves, the
 * function keys, the number pad, and the few named keys a sound-effects board is built on.
 * Anything else — a modifier alone, a key with no stable name — is not a trigger.
 */
function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit) return digit[1]
  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code)
  if (fn) return code
  const pad = /^Numpad([0-9])$/.exec(code)
  if (pad) return `Num${pad[1]}`
  switch (code) {
    case 'NumpadAdd': return 'Num+'
    case 'NumpadSubtract': return 'Num-'
    case 'NumpadMultiply': return 'Num*'
    case 'NumpadDivide': return 'Num/'
    case 'NumpadDecimal': return 'Num.'
    case 'NumpadEnter': return 'NumEnter'
    case 'Space': return 'Space'
    case 'Escape': return 'Escape'
    case 'Enter': return 'Enter'
    case 'Tab': return 'Tab'
    case 'Backspace': return 'Backspace'
    case 'Delete': return 'Delete'
    case 'Insert': return 'Insert'
    case 'Home': return 'Home'
    case 'End': return 'End'
    case 'PageUp': return 'PageUp'
    case 'PageDown': return 'PageDown'
    case 'ArrowUp': return 'ArrowUp'
    case 'ArrowDown': return 'ArrowDown'
    case 'ArrowLeft': return 'ArrowLeft'
    case 'ArrowRight': return 'ArrowRight'
    case 'Comma': return ','
    case 'Period': return '.'
    case 'Slash': return '/'
    case 'Semicolon': return ';'
    case 'Quote': return "'"
    case 'BracketLeft': return '['
    case 'BracketRight': return ']'
    case 'Minus': return '-'
    case 'Equal': return '='
    case 'Backquote': return '`'
    case 'Backslash': return '\\'
    default: return null
  }
}

/** The parts of a key press a combination is read from: a `KeyboardEvent`, or a test's own. */
export interface KeyPress {
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

/**
 * The combination a press is, or null for a press that is not one (a modifier on its own, a
 * key with no name here). Ctrl and ⌘ are one modifier, `Mod`, as the app's own shortcuts are:
 * a show written on a Mac answers the same keys on the PC beside it.
 */
export function hotkeyFromPress(press: KeyPress): string | null {
  const key = keyName(press.code)
  if (key === null) return null
  const parts: string[] = []
  if (press.ctrlKey || press.metaKey) parts.push('Mod')
  if (press.altKey) parts.push('Alt')
  if (press.shiftKey) parts.push('Shift')
  return [...parts, key].join('+')
}

/**
 * A combination as typed — `shift+f7`, `Ctrl+Q`, `cmd+1` — written the one way the trigger
 * stores it, or null when it is not a combination this app can answer.
 */
export function normalizeHotkey(text: string): string | null {
  const parts = text.split('+').map(part => part.trim()).filter(part => part !== '')
  // A combination that ends in the plus key itself: `Num+`, written `Num+` or `Shift+Num+`.
  if (text.trim().endsWith('+') && parts.length > 0 && parts[parts.length - 1].toLowerCase() === 'num') {
    parts[parts.length - 1] = 'Num+'
  }
  if (parts.length === 0) return null
  const modifiers = new Set<string>()
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase()
    if (lower === 'mod' || lower === 'ctrl' || lower === 'control' || lower === 'cmd' || lower === 'command' || lower === 'meta') modifiers.add('Mod')
    else if (lower === 'alt' || lower === 'option' || lower === 'opt') modifiers.add('Alt')
    else if (lower === 'shift') modifiers.add('Shift')
    else return null
  }
  const last = parts[parts.length - 1]
  const key = canonicalKey(last)
  if (key === null) return null
  return [...MODIFIER_ORDER.filter(modifier => modifiers.has(modifier)), key].join('+')
}

function canonicalKey(text: string): string | null {
  if (/^[a-z]$/i.test(text)) return text.toUpperCase()
  if (/^[0-9]$/.test(text)) return text
  const fn = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(text)
  if (fn) return `F${fn[1]}`
  const pad = /^num([0-9])$/i.exec(text)
  if (pad) return `Num${pad[1]}`
  const named = ['Num+', 'Num-', 'Num*', 'Num/', 'Num.', 'NumEnter', 'Space', 'Escape', 'Enter', 'Tab', 'Backspace',
    'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ',', '.', '/', ';', "'", '[', ']', '-', '=', '`', '\\']
  const found = named.find(name => name.toLowerCase() === text.toLowerCase())
  if (found) return found
  if (text.toLowerCase() === 'esc') return 'Escape'
  if (text.toLowerCase() === 'return') return 'Enter'
  return null
}

/**
 * The keys the app already answers, and what each does. A trigger on one of them would fire a
 * cue *and* do the app's own thing — a key trigger on Space would GO twice — so a trigger is
 * refused on every one of them. Kept beside the trigger because this is the one list that has
 * to hold every key the window binds: the transport (`useKeyboard`), the cue list's keys, the
 * menus' accelerators and roles (`src/main/index.ts`), the views' function keys and the cart's
 * tile keys. Written the way the trigger stores a key; `appShortcuts` adds what one platform's
 * menus hold and another's do not.
 */
export const APP_SHORTCUTS: ReadonlyArray<{ key: string; does: string }> = [
  { key: 'Space', does: 'GO' },
  { key: 'Escape', does: 'STOP' },
  { key: 'Shift+Escape', does: 'PANIC' },
  { key: 'P', does: 'pause and resume the show' },
  { key: 'F5', does: 'show mode' },
  { key: 'F6', does: 'the cart' },
  { key: 'ArrowUp', does: 'move the selection up' },
  { key: 'ArrowDown', does: 'move the selection down' },
  { key: 'Delete', does: 'delete the selected cues' },
  { key: 'Mod+Backspace', does: 'delete the selected cues' },
  { key: 'Mod+D', does: 'duplicate' },
  { key: 'Mod+Shift+A', does: 'arm and disarm' },
  { key: 'Mod+Z', does: 'undo' },
  { key: 'Mod+Shift+Z', does: 'redo' },
  { key: 'Mod+C', does: 'copy' },
  { key: 'Mod+X', does: 'cut' },
  { key: 'Mod+V', does: 'paste' },
  { key: 'Mod+A', does: 'select all' },
  { key: 'Mod+N', does: 'a new show' },
  { key: 'Mod+O', does: 'open a show' },
  { key: 'Mod+S', does: 'save' },
  { key: 'Mod+Shift+S', does: 'save as' },
  { key: 'Mod+,', does: 'settings' },
  { key: 'Mod+Shift+P', does: 'panic' },
  { key: 'Mod+Q', does: 'quit' },
  // The View menu's zoom roles: actual size, larger (with and without Shift, as the plus key
  // sits on = on most keyboards), smaller.
  { key: 'Mod+0', does: 'actual size' },
  { key: 'Mod+=', does: 'zoom in' },
  { key: 'Mod+Shift+=', does: 'zoom in' },
  { key: 'Mod+-', does: 'zoom out' },
  // The cart's tiles answer the number row while the cart is up.
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(key => ({ key, does: 'a cart tile' }))
]

/**
 * Every key the app answers on one platform: the table above, and the full-screen role, which
 * is F11 on Windows and Linux and Ctrl+⌘F on a Mac — a press this module reads as `Mod+F`,
 * since it counts Ctrl and ⌘ as one modifier the way the app's own shortcuts do.
 */
export function appShortcuts(platform: string = currentPlatform()): ReadonlyArray<{ key: string; does: string }> {
  return platform === 'darwin'
    ? [...APP_SHORTCUTS, { key: 'Mod+F', does: 'full screen' }]
    : [...APP_SHORTCUTS, { key: 'F11', does: 'full screen' }]
}

/** A cart tile's own key, with the list it is in, as a conflict names it. */
export interface TileKeyUse {
  key: string
  list: string
}

/** The tile keys a show's carts hold, in tab order. */
export function tileKeysOf(lists: readonly CueListInfo[]): TileKeyUse[] {
  return lists.flatMap(list => (list.tileKeys ?? []).map(entry => ({ key: entry.key, list: list.name })))
}

/**
 * The `KeyboardEvent.key` a stored combination's press gives, lower-cased the way a tile keeps
 * its key, or null when that cannot be known or no tile could answer it. A tile answers a press
 * with no Ctrl, ⌘ or Alt, so only a bare or shifted key can be one: Shift only changes a
 * letter's case and leaves a function or named key alone, but turns a digit or a mark into
 * whatever this keyboard's layout puts above it, which is not known here.
 */
function tileKeyOfCombo(key: string): string | null {
  const { modifiers, base } = splitHotkey(key)
  if (modifiers.some(modifier => modifier !== 'Shift')) return null
  const shifted = modifiers.includes('Shift')
  if (/^[A-Z]$/.test(base)) return base.toLowerCase()
  if (/^F[0-9]+$/.test(base)) return base.toLowerCase()
  if (base === 'Space') return ' '
  if (base === 'NumEnter') return 'enter'
  const pad = /^Num(.)$/.exec(base)
  if (pad) return shifted ? null : pad[1]
  if (/^[A-Za-z]+$/.test(base)) return base.toLowerCase()
  return shifted ? null : base
}

/** A stored combination's modifiers and key; the key can itself be `Num+`. */
function splitHotkey(key: string): { modifiers: string[]; base: string } {
  const plus = key.endsWith('Num+')
  const parts = (plus ? key.slice(0, -'Num+'.length) : key).split('+').filter(part => part !== '')
  if (plus) return { modifiers: parts, base: 'Num+' }
  return { modifiers: parts.slice(0, -1), base: parts[parts.length - 1] ?? '' }
}

/**
 * Why a key cannot be a trigger, as a sentence, or null when it can. A key the app answers is
 * refused, and so is a key a cart tile already answers; Tab and Enter move focus and press
 * buttons, which a keyboard user cannot lose. The key is named the way this machine's keyboard
 * labels it — ⌘S on a Mac, Ctrl+S everywhere else — never as the stored `Mod+S`.
 */
export function hotkeyConflict(
  key: string,
  options: { platform?: string; tileKeys?: readonly TileKeyUse[] } = {}
): string | null {
  const platform = options.platform ?? currentPlatform()
  const label = formatShortcut(key, platform)
  const taken = appShortcuts(platform).find(entry => entry.key === key)
  if (taken) return `${label} is the app’s key for ${taken.does}`
  const pressed = tileKeyOfCombo(key)
  const tile = pressed === null ? undefined : options.tileKeys?.find(entry => entry.key === pressed)
  if (tile) return `${label} plays a tile in the cart “${tile.list}”`
  if (key === 'Tab' || key === 'Shift+Tab') return `${label} moves between controls`
  if (key === 'Enter') return 'Enter presses the button that has focus'
  return null
}

/** The other cues already fired by this key, so the panel can say a key is shared. */
export function cuesOnHotkey(cues: readonly Cue[], key: string, except: string | null = null): Cue[] {
  return cues.filter(cue => cue.id !== except &&
    cueTriggers(cue).some(trigger => trigger.kind === 'hotkey' && trigger.key === key))
}

/** The armed cues a press fires, in list order: every cue with a key trigger on this combination. */
export function cuesForHotkey(
  cues: readonly Cue[],
  key: string,
  options: { platform?: string; tileKeys?: readonly TileKeyUse[] } = {}
): Cue[] {
  // A key the app or a cart tile answers never fires a cue, whatever a hand-edited file says:
  // the app's own use of it is what the operator's finger is there for.
  if (hotkeyConflict(key, options) !== null) return []
  return cues.filter(cue => cue.isArmed &&
    cueTriggers(cue).some(trigger => trigger.kind === 'hotkey' && trigger.key === key))
}
