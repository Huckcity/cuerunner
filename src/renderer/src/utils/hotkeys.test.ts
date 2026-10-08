// A key as a cue trigger: written the way the menus write a shortcut, read off the physical key,
// and refused where the app already answers it.
import { describe, it, expect } from 'vitest'
import { APP_SHORTCUTS, cuesForHotkey, cuesOnHotkey, hotkeyConflict, hotkeyFromPress, normalizeHotkey } from './hotkeys'
import { createCue } from './cueDefaults'
import type { Cue, CueTrigger } from '../../../shared/cue'

const press = (code: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
  ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods })

const keyed = (id: string, key: string, armed = true): Cue =>
  ({ ...createCue('wait', id), id, isArmed: armed, triggers: [{ id: `k-${id}`, kind: 'hotkey', key } as CueTrigger] })

describe('a key trigger', () => {
  it('reads the physical key and its modifiers, Ctrl and ⌘ as one', () => {
    expect(hotkeyFromPress(press('KeyQ'))).toBe('Q')
    expect(hotkeyFromPress(press('KeyQ', { shiftKey: true }))).toBe('Shift+Q')
    expect(hotkeyFromPress(press('F7', { ctrlKey: true, altKey: true }))).toBe('Mod+Alt+F7')
    expect(hotkeyFromPress(press('Digit1', { metaKey: true }))).toBe('Mod+1')
    expect(hotkeyFromPress(press('Numpad3'))).toBe('Num3')
    expect(hotkeyFromPress(press('ShiftLeft', { shiftKey: true }))).toBeNull()
  })

  it('writes what is typed the one way it is stored', () => {
    expect(normalizeHotkey('shift+f7')).toBe('Shift+F7')
    expect(normalizeHotkey('Cmd+Shift+q')).toBe('Mod+Shift+Q')
    expect(normalizeHotkey('alt + ctrl + 2')).toBe('Mod+Alt+2')
    expect(normalizeHotkey('Num+')).toBe('Num+')
    expect(normalizeHotkey('esc')).toBe('Escape')
    expect(normalizeHotkey('Hyper+Q')).toBeNull()
    expect(normalizeHotkey('F99')).toBeNull()
    expect(normalizeHotkey('')).toBeNull()
  })

  it('refuses every key the app answers, and says what the app does with it', () => {
    expect(hotkeyConflict('Space')).toBe('Space is the app’s key for GO')
    expect(hotkeyConflict('Shift+Escape')).toBe('Shift+Escape is the app’s key for PANIC')
    expect(hotkeyConflict('Mod+S')).toBe('Mod+S is the app’s key for save')
    expect(hotkeyConflict('1')).toBe('1 is the app’s key for a cart tile')
    expect(hotkeyConflict('Enter')).toBe('Enter presses the button that has focus')
    expect(hotkeyConflict('F7')).toBeNull()
    expect(hotkeyConflict('Shift+Q')).toBeNull()
    // Every entry is a combination this module writes, so a press can be compared with it.
    for (const entry of APP_SHORTCUTS) expect(normalizeHotkey(entry.key), entry.key).toBe(entry.key)
  })

  it('fires the armed cues on a key, and none on a key the app answers whatever a file says', () => {
    const cues = [keyed('a', 'F7'), keyed('b', 'F7'), keyed('c', 'F7', false), keyed('d', 'F8'), keyed('e', 'Space')]
    expect(cuesForHotkey(cues, 'F7').map(cue => cue.id)).toEqual(['a', 'b'])
    expect(cuesForHotkey(cues, 'Space')).toEqual([])
    expect(cuesOnHotkey(cues, 'F7', 'a').map(cue => cue.id)).toEqual(['b', 'c'])
  })
})
