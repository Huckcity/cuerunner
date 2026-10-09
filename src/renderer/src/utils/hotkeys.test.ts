// A key as a cue trigger: written the way the menus write a shortcut, read off the physical key,
// and refused where the app already answers it.
import { describe, it, expect } from 'vitest'
import { APP_SHORTCUTS, appShortcuts, cuesForHotkey, cuesOnHotkey, hotkeyConflict, hotkeyFromPress, normalizeHotkey, tileKeysOf } from './hotkeys'
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
    // The preload in the tests says Windows, so the key is named the way a PC labels it.
    expect(hotkeyConflict('Mod+S')).toBe('Ctrl+S is the app’s key for save')
    expect(hotkeyConflict('1')).toBe('1 is the app’s key for a cart tile')
    expect(hotkeyConflict('Enter')).toBe('Enter presses the button that has focus')
    expect(hotkeyConflict('F7')).toBeNull()
    expect(hotkeyConflict('Shift+Q')).toBeNull()
    // Every entry is a combination this module writes, so a press can be compared with it.
    for (const entry of APP_SHORTCUTS) expect(normalizeHotkey(entry.key), entry.key).toBe(entry.key)
    for (const platform of ['darwin', 'win32', 'linux']) {
      for (const entry of appShortcuts(platform)) expect(normalizeHotkey(entry.key), entry.key).toBe(entry.key)
    }
  })

  it('names a taken key the way a Mac labels it, on a Mac', () => {
    expect(hotkeyConflict('Mod+S', { platform: 'darwin' })).toBe('⌘S is the app’s key for save')
    expect(hotkeyConflict('Mod+Shift+P', { platform: 'darwin' })).toBe('⇧⌘P is the app’s key for panic')
    expect(hotkeyConflict('Shift+Escape', { platform: 'darwin' })).toBe('⇧Escape is the app’s key for PANIC')
    expect(hotkeyConflict('Space', { platform: 'darwin' })).toBe('Space is the app’s key for GO')
    expect(hotkeyConflict('Shift+Tab', { platform: 'darwin' })).toBe('⇧Tab moves between controls')
    expect(hotkeyConflict('Shift+F7', { platform: 'darwin' })).toBeNull()
  })

  it('names a taken key with Ctrl on Windows and Linux', () => {
    for (const platform of ['win32', 'linux']) {
      expect(hotkeyConflict('Mod+S', { platform })).toBe('Ctrl+S is the app’s key for save')
      expect(hotkeyConflict('Mod+Shift+P', { platform })).toBe('Ctrl+Shift+P is the app’s key for panic')
      expect(hotkeyConflict('Shift+Tab', { platform })).toBe('Shift+Tab moves between controls')
      expect(hotkeyConflict('Shift+F7', { platform })).toBeNull()
    }
  })

  it('refuses the keys the menus answer on each platform and no other', () => {
    // Select all and the zoom roles are in every platform's menus.
    for (const platform of ['darwin', 'win32', 'linux']) {
      expect(hotkeyConflict('Mod+A', { platform })).not.toBeNull()
      expect(hotkeyConflict('Mod+0', { platform })).not.toBeNull()
      expect(hotkeyConflict('Mod+=', { platform })).not.toBeNull()
      expect(hotkeyConflict('Mod+-', { platform })).not.toBeNull()
      // No menu has Close: Mod+W is free.
      expect(hotkeyConflict('Mod+W', { platform })).toBeNull()
    }
    // Full screen is F11 off a Mac, and Ctrl+⌘F on one — read as Mod+F.
    expect(hotkeyConflict('F11', { platform: 'win32' })).toBe('F11 is the app’s key for full screen')
    expect(hotkeyConflict('F11', { platform: 'linux' })).toBe('F11 is the app’s key for full screen')
    expect(hotkeyConflict('F11', { platform: 'darwin' })).toBeNull()
    expect(hotkeyConflict('Mod+F', { platform: 'darwin' })).toBe('⌘F is the app’s key for full screen')
    expect(hotkeyConflict('Mod+F', { platform: 'win32' })).toBeNull()
  })

  it('refuses a key a cart tile already answers, bare or shifted, and names the cart', () => {
    const lists = [
      { id: 'main', name: 'Main' },
      { id: 'sfx', name: 'SFX', kind: 'cart', tileKeys: [{ cueId: 'x', key: 'q' }, { cueId: 'y', key: 'f9' }, { cueId: 'z', key: '-' }] }
    ] as unknown as Parameters<typeof tileKeysOf>[0]
    const tileKeys = tileKeysOf(lists)
    expect(hotkeyConflict('Q', { tileKeys, platform: 'win32' })).toBe('Q plays a tile in the cart “SFX”')
    // Shift only changes the letter's case; the tile still answers it.
    expect(hotkeyConflict('Shift+Q', { tileKeys, platform: 'darwin' })).toBe('⇧Q plays a tile in the cart “SFX”')
    expect(hotkeyConflict('F9', { tileKeys })).toBe('F9 plays a tile in the cart “SFX”')
    expect(hotkeyConflict('-', { tileKeys })).toBe('- plays a tile in the cart “SFX”')
    // The keypad's minus gives the same key.
    expect(hotkeyConflict('Num-', { tileKeys })).toBe('Num- plays a tile in the cart “SFX”')
    // A tile never answers a press with Ctrl, ⌘ or Alt.
    expect(hotkeyConflict('Mod+Shift+Q', { tileKeys })).toBeNull()
    expect(hotkeyConflict('Alt+Q', { tileKeys })).toBeNull()
    expect(hotkeyConflict('W', { tileKeys })).toBeNull()
    const cues = [keyed('a', 'Q'), keyed('b', 'W')]
    expect(cuesForHotkey(cues, 'Q', { tileKeys }).map(cue => cue.id)).toEqual([])
    expect(cuesForHotkey(cues, 'W', { tileKeys }).map(cue => cue.id)).toEqual(['b'])
  })

  it('fires the armed cues on a key, and none on a key the app answers whatever a file says', () => {
    const cues = [keyed('a', 'F7'), keyed('b', 'F7'), keyed('c', 'F7', false), keyed('d', 'F8'), keyed('e', 'Space')]
    expect(cuesForHotkey(cues, 'F7').map(cue => cue.id)).toEqual(['a', 'b'])
    expect(cuesForHotkey(cues, 'Space')).toEqual([])
    expect(cuesOnHotkey(cues, 'F7', 'a').map(cue => cue.id)).toEqual(['b', 'c'])
  })
})
