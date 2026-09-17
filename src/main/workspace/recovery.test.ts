// Saving must never be able to destroy the workspace: the new contents land in a
// temporary file, the previous version is kept, and the replace is a rename. Recovery
// snapshots are a separate file in the app's user-data folder.
//
// Electron is not available here, so it is stubbed with a real temporary directory —
// these tests exercise the actual filesystem.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  // One directory for the whole file: getPath must be stable, or a write and the read
  // after it would look at different places.
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: {},
    BrowserWindow: {}
  }
})

const { app } = await import('electron')
const { clearRecovery, readRecovery, writeFileAtomically, writeRecovery } = await import('./recovery')
const { saveWorkspace } = await import('./WorkspaceManager')
import type { Workspace } from '../../renderer/src/types/workspace'

const userData = app.getPath('userData')

function workspaceWith(cues: Workspace['cues']): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  }
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-save-'))
})

afterEach(() => {
  chmodSync(dir, 0o700)
  rmSync(dir, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

describe('writeFileAtomically', () => {
  it('keeps the previous version as .bak and leaves no temporary file behind', async () => {
    const file = join(dir, 'show.cuerunner')

    await writeFileAtomically(file, '{"first":true}')
    expect(readFileSync(file, 'utf-8')).toBe('{"first":true}')
    // Nothing to back up on a first save.
    expect(existsSync(`${file}.bak`)).toBe(false)

    await writeFileAtomically(file, '{"second":true}')
    expect(readFileSync(file, 'utf-8')).toBe('{"second":true}')
    expect(readFileSync(`${file}.bak`, 'utf-8')).toBe('{"first":true}')
    expect(readdirSync(dir)).toEqual(['show.cuerunner', 'show.cuerunner.bak'])
  })

  it('refuses to lose the file when the write cannot be completed', async () => {
    const file = join(dir, 'show.cuerunner')
    await writeFileAtomically(file, '{"good":true}')

    chmodSync(dir, 0o500)   // read + execute: no new files, no renames

    await expect(writeFileAtomically(file, '{"bad":true}')).rejects.toThrow()

    chmodSync(dir, 0o700)
    expect(readFileSync(file, 'utf-8')).toBe('{"good":true}')
    expect(readdirSync(dir)).toEqual(['show.cuerunner'])
  })
})

describe('saveWorkspace', () => {
  it('writes the workspace through the same atomic path', async () => {
    const file = join(dir, 'show.cuerunner')
    const win = {} as never

    expect(await saveWorkspace(win, workspaceWith([]), file)).toMatchObject({ path: file })
    expect(JSON.parse(readFileSync(file, 'utf-8')).name).toBe('Show')

    expect(await saveWorkspace(win, workspaceWith([]), file)).toMatchObject({ path: file })
    expect(readFileSync(`${file}.bak`, 'utf-8')).toContain('"Show"')
  })
})

describe('recovery snapshots', () => {
  it('round-trips a snapshot and clears it again', async () => {
    expect(await readRecovery()).toBeNull()

    await writeRecovery(workspaceWith([]), '/shows/My Show.cuerunner', 'cue-7')
    const snapshot = await readRecovery()

    expect(snapshot?.workspace.name).toBe('Show')
    expect(snapshot?.sourcePath).toBe('/shows/My Show.cuerunner')
    expect(snapshot?.savedAt).toBeGreaterThan(0)
    // The cue GO would have fired next travels with the work.
    expect(snapshot?.selectedCueId).toBe('cue-7')

    await clearRecovery()
    expect(await readRecovery()).toBeNull()
  })

  it('reads a snapshot written before the place was recorded', async () => {
    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'recovery.cuerunner'),
      JSON.stringify({ workspace: workspaceWith([]), savedAt: 1, sourcePath: null }),
      'utf-8'
    )

    const snapshot = await readRecovery()

    expect(snapshot?.workspace.name).toBe('Show')
    expect(snapshot?.selectedCueId).toBeUndefined()
  })

  it('reads nothing from a snapshot that was half-written when the process died', async () => {
    mkdirSync(userData, { recursive: true })
    writeFileSync(join(userData, 'recovery.cuerunner'), '{"workspace":{"cues":[', 'utf-8')

    expect(await readRecovery()).toBeNull()
  })
})
