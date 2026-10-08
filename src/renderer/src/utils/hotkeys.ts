import type { Cue } from '../../../shared/cue'
import { cueTriggers } from '../engine/triggers'

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
 * menus' accelerators, the views' function keys and the cart's tile keys.
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
  { key: 'Mod+N', does: 'a new show' },
  { key: 'Mod+O', does: 'open a show' },
  { key: 'Mod+S', does: 'save' },
  { key: 'Mod+Shift+S', does: 'save as' },
  { key: 'Mod+,', does: 'settings' },
  { key: 'Mod+Shift+P', does: 'report a problem' },
  { key: 'Mod+Q', does: 'quit' },
  { key: 'Mod+W', does: 'close the window' },
  // The cart's tiles answer the number row while the cart is up.
  ...['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].map(key => ({ key, does: 'a cart tile' }))
]

/**
 * Why a key cannot be a trigger, as a sentence, or null when it can. A key the app answers is
 * refused; Tab and Enter move focus and press buttons, which a keyboard user cannot lose.
 */
export function hotkeyConflict(key: string): string | null {
  const taken = APP_SHORTCUTS.find(entry => entry.key === key)
  if (taken) return `${key} is the app’s key for ${taken.does}`
  if (key === 'Tab' || key === 'Shift+Tab') return `${key} moves between controls`
  if (key === 'Enter') return 'Enter presses the button that has focus'
  return null
}

/** The other cues already fired by this key, so the panel can say a key is shared. */
export function cuesOnHotkey(cues: readonly Cue[], key: string, except: string | null = null): Cue[] {
  return cues.filter(cue => cue.id !== except &&
    cueTriggers(cue).some(trigger => trigger.kind === 'hotkey' && trigger.key === key))
}

/** The armed cues a press fires, in list order: every cue with a key trigger on this combination. */
export function cuesForHotkey(cues: readonly Cue[], key: string): Cue[] {
  // A key the app answers never fires a cue, whatever a hand-edited file says: the app's own
  // use of it is what the operator's finger is there for.
  if (hotkeyConflict(key) !== null) return []
  return cues.filter(cue => cue.isArmed &&
    cueTriggers(cue).some(trigger => trigger.kind === 'hotkey' && trigger.key === key))
}
