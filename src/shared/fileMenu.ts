// The File menu, defined once. The application menu (the menu bar on Windows and Linux,
// the top of the screen on a Mac) and the Cuerunner ▾ button in the window both draw from
// this list, so they cannot come to disagree about what is in it or what it is called.

export type FileMenuAction =
  | 'new'
  | 'open'
  | 'open-demo'
  | 'save'
  | 'save-as'
  | 'history'
  | 'compare'
  | 'merge'
  | 'export-bundle'
  | 'import-bundle'
  | 'report-problem'
  | 'show-settings'
  | 'settings'

/**
 * What the View menu asks of the window: show mode, the large-type operator view, in and out.
 * Not a File item, so the Cuerunner ▾ button does not draw it — the window answers F5 itself.
 */
export type ViewMenuAction = 'show-mode'

/** Everything the application menu can ask the window to do. */
export type MenuAction = 'undo' | 'redo' | FileMenuAction | ViewMenuAction

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
  // What the file has done, and what another version of it did differently. The file
  // records its history whether or not this machine can read it: the data is the show's.
  { action: 'history', label: 'Show History…' },
  { action: 'compare', label: 'Compare Show…' },
  { action: 'merge', label: 'Merge Show…' },
  'separator',
  // Handover: the show and the audio it plays as one file, in and out.
  { action: 'export-bundle', label: 'Export Bundle…' },
  { action: 'import-bundle', label: 'Import Bundle…' },
  'separator',
  // Something went wrong, or is not clear: the report is built here, shown in full, and
  // goes nowhere until the operator copies it, saves it or mails it.
  { action: 'report-problem', label: 'Report a Problem…' },
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
