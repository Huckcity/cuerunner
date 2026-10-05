// A show nobody has named is named by the file it is first saved into.
//
// The window drew two names for one show: the file's in the toolbar, and the show's own —
// still "Untitled" — in the title bar and the close prompt, because a first save wrote the
// born-with name into a file the operator had just called something else. The name is
// settled where the file is written, so the bytes, the answer the window adopts and the
// next launch's read all agree.
//
// Electron is stubbed with a temp `userData` and a save dialog that answers where the test
// says, the way `saveGuard.test.ts` stubs it; the files are real.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { BrowserWindow } from 'electron'
import type { Workspace } from '../../shared/workspace'

const gates = vi.hoisted(() => ({
  saveTarget: '',
  saveDialogs: [] as Array<{ defaultPath?: string }>,
  userData: ''
}))

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  gates.userData = mkdtempSync(join(tmpdir(), 'cuerunner-savename-userdata-'))
  return {
    app: { getPath: () => gates.userData, isPackaged: true },
    dialog: {
      showMessageBox: async () => ({ response: 1, checkboxChecked: false }),
      showSaveDialog: async (_win: unknown, options: { defaultPath?: string }) => {
        gates.saveDialogs.push(options)
        return { canceled: false, filePath: gates.saveTarget }
      },
      showOpenDialog: async () => ({ canceled: true, filePaths: [] })
    },
    BrowserWindow: {}
  }
})

const { saveWorkspace, saveWorkspaceAs } = await import('./WorkspaceManager')

const win = {} as BrowserWindow

function show(name: string): Workspace {
  return {
    version: 1,
    id: 'w1',
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }
}

const nameIn = (file: string): string => (JSON.parse(readFileSync(file, 'utf-8')) as Workspace).name

describe('the name a save gives a show', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'cuerunner-savename-'))
    gates.saveDialogs.length = 0
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('names an untitled show after the file it is first saved into, in the file and in the answer', async () => {
    gates.saveTarget = join(dir, 'Macbeth.cuerunner')

    const saved = await saveWorkspace(win, show('Untitled'), null)

    expect(saved?.name).toBe('Macbeth')
    expect(nameIn(gates.saveTarget)).toBe('Macbeth')
    // The dialog still offers the name the show had, which is where the operator types.
    expect(gates.saveDialogs[0].defaultPath).toBe('Untitled.cuerunner')
  })

  it('does the same for a show with no name at all, and for Save As', async () => {
    gates.saveTarget = join(dir, 'Tour 2026.cuerunner')
    expect((await saveWorkspace(win, show('  '), null))?.name).toBe('Tour 2026')

    gates.saveTarget = join(dir, 'Second Night.CUERUNNER')
    expect((await saveWorkspaceAs(win, show('Untitled')))?.name).toBe('Second Night')
    expect(nameIn(gates.saveTarget)).toBe('Second Night')
  })

  it('leaves a show that has a name its own: a copy under another file name is the same show', async () => {
    gates.saveTarget = join(dir, 'Hamlet v2.cuerunner')

    const saved = await saveWorkspaceAs(win, show('Hamlet'))

    expect(saved).not.toHaveProperty('name')
    expect(nameIn(gates.saveTarget)).toBe('Hamlet')
  })

  it('names nothing on a save to the file the show already has', async () => {
    const file = join(dir, 'Renamed On Disk.cuerunner')
    gates.saveTarget = file
    await saveWorkspace(win, show('Hamlet'), null)

    // The path is the session's own now: no dialog, so nothing was typed to name it by —
    // even for a show whose name is the born-with one.
    const saved = await saveWorkspace(win, show('Untitled'), file)

    expect(saved).not.toHaveProperty('name')
    expect(nameIn(file)).toBe('Untitled')
    expect(gates.saveDialogs).toHaveLength(1)
  })

  it('names nothing when the file is itself called Untitled', async () => {
    gates.saveTarget = join(dir, 'Untitled.cuerunner')
    const saved = await saveWorkspace(win, show('Untitled'), null)
    expect(saved).not.toHaveProperty('name')
    expect(nameIn(gates.saveTarget)).toBe('Untitled')
  })
})
