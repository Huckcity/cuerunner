// The File menu, defined once. The application menu (the menu bar on Windows and Linux,
// the top of the screen on a Mac) and the WinsLab ▾ button in the window both draw from
// this list, so they cannot come to disagree about what is in it or what it is called.

export type FileMenuAction =
  | 'new'
  | 'open'
  | 'open-demo'
  | 'save'
  | 'save-as'
  | 'show-settings'
  | 'settings'

/** Everything the application menu can ask the window to do. */
export type MenuAction = 'undo' | 'redo' | FileMenuAction

export interface FileMenuItem {
  action: FileMenuAction
  label: string
  /** Electron's accelerator syntax; the window writes it for the keyboard it is on. */
  accelerator?: string
}

export type FileMenuEntry = FileMenuItem | 'separator'

export const FILE_MENU: FileMenuEntry[] = [
  { action: 'new', label: 'New', accelerator: 'CmdOrCtrl+N' },
  { action: 'open', label: 'Open…', accelerator: 'CmdOrCtrl+O' },
  { action: 'open-demo', label: 'Open Demo Workspace' },
  'separator',
  { action: 'save', label: 'Save', accelerator: 'CmdOrCtrl+S' },
  { action: 'save-as', label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S' },
  'separator',
  // The show's own setup, beside the app's: one travels with the workspace, the other
  // with the machine.
  { action: 'show-settings', label: 'Show Settings…' },
  { action: 'settings', label: 'Settings…', accelerator: 'CmdOrCtrl+,' }
]

/** The menu item's id in the application menu, for anything that has to find it. */
export function fileMenuItemId(action: FileMenuAction): string {
  return `file-${action}`
}
