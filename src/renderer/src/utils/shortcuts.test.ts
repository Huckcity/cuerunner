import { describe, it, expect } from 'vitest'
import { formatShortcut } from './shortcuts'

describe('formatShortcut', () => {
  it('writes Ctrl on Windows and Linux, where the app is meant to run', () => {
    expect(formatShortcut('Mod+N', 'win32')).toBe('Ctrl+N')
    expect(formatShortcut('Mod+Shift+S', 'win32')).toBe('Ctrl+Shift+S')
    expect(formatShortcut('Mod+,', 'linux')).toBe('Ctrl+,')
  })

  it('writes the Mac symbols in the Mac order', () => {
    expect(formatShortcut('Mod+N', 'darwin')).toBe('⌘N')
    expect(formatShortcut('Mod+Shift+S', 'darwin')).toBe('⇧⌘S')
    expect(formatShortcut('Shift+Mod+P', 'darwin')).toBe('⇧⌘P')
  })

  it('leaves a bare key alone', () => {
    expect(formatShortcut('Space', 'win32')).toBe('Space')
    expect(formatShortcut('Shift+Esc', 'win32')).toBe('Shift+Esc')
    expect(formatShortcut('Shift+Esc', 'darwin')).toBe('⇧Esc')
  })

  it('reads the platform the preload reports when none is given', () => {
    expect(formatShortcut('Mod+D')).toBe(window.winslab.platform === 'darwin' ? '⌘D' : 'Ctrl+D')
  })
})
