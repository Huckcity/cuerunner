// Shortcuts are written once, the way the menus define them ("Mod+Shift+S"), and shown
// the way this machine's keyboard is labelled: ⇧⌘S on a Mac, Ctrl+Shift+S everywhere
// else. The handlers already accept either modifier; the labels have to teach the key
// the operator actually has.

const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘' }
// Apple's order for stacked modifiers.
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod']
const MODIFIERS = new Set(MAC_ORDER)

export function currentPlatform(): string {
  return window.cuerunner?.platform ?? 'win32'
}

export function formatShortcut(combo: string, platform: string = currentPlatform()): string {
  // A key can be the plus key itself — the keypad's `Num+` — which a split on "+" would lose.
  const plus = combo.endsWith('Num+')
  const parts = (plus ? combo.slice(0, -'Num+'.length) : combo).split('+').filter(part => part !== '')
  const key = plus ? 'Num+' : parts.pop() ?? ''
  const modifiers = parts.filter(part => MODIFIERS.has(part))
  if (platform === 'darwin') {
    const ordered = MAC_ORDER.filter(modifier => modifiers.includes(modifier))
    return ordered.map(modifier => MAC_SYMBOLS[modifier]).join('') + key
  }
  return [...modifiers.map(modifier => (modifier === 'Mod' ? 'Ctrl' : modifier)), key].join('+')
}
