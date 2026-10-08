import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dialog, type BrowserWindow } from 'electron'
import type { AudioCue } from '../../shared/cue'
import { migrateWorkspace } from '../workspace/WorkspaceManager'
import { serialiseWorkspace } from '../workspace/serialise'
import {
  checkedAddress, convertQLabShow, findMediaInFolder, folderCandidates, importQLabFile,
  importQLabLive, importQLabPath, listLiveWorkspaces, relinkFromFolder
} from './qlabImport'
import { pressNightWorkspace } from './archiveFixture'
import { parseQLabWorkspace } from './qlabFile'
import { startFakeQLab, type FakeQLab } from './fakeQLab'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const userData = mkdtempSync(join(tmpdir(), 'feat-qlab-import-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: {}
  }
})

const win = {} as BrowserWindow
let dir: string
let qlab: FakeQLab | null = null

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'feat-qlab-import-'))
  vi.mocked(dialog.showOpenDialog).mockReset()
})

afterEach(async () => {
  rmSync(dir, { recursive: true, force: true })
  await qlab?.close()
  qlab = null
})

/** The Press Night workspace on disk, with the audio it names beside it — all but one file. */
function pressNight(): string {
  mkdirSync(join(dir, 'audio'))
  for (const name of ['walk-in.wav', 'bows.wav']) writeFileSync(join(dir, 'audio', name), 'RIFF')
  const file = join(dir, 'Press Night.qlab5')
  writeFileSync(file, pressNightWorkspace())
  return file
}

describe('a converted show', () => {
  it('is a show this build reads back: it passes the load funnel, and saves and loads again unchanged', async () => {
    const imported = await importQLabPath(pressNight())
    const saved = JSON.parse(serialiseWorkspace(imported.workspace, dir))
    const reloaded = migrateWorkspace(saved, 'the saved import')
    expect(reloaded.cues.map(cue => [cue.id, cue.type, cue.parentId])).toEqual(
      imported.workspace.cues.map(cue => [cue.id, cue.type, cue.parentId])
    )
    expect(imported.loadNotes).toEqual([])
  })

  it('plays its audio from the QLab workspace’s folder, and reports what is not there', async () => {
    const imported = await importQLabPath(pressNight())
    const walkIn = imported.workspace.cues.find(cue => cue.number === '1') as AudioCue
    expect(walkIn.filePath).toBe(join(dir, 'audio', 'walk-in.wav'))
    // gone.wav is not in the folder, and the cart's door slam is on the other machine.
    expect(imported.missingMedia.map(entry => entry.cueId).sort()).toEqual(['A-FX1', 'A42'])
    expect(imported.report.media).toEqual({ referenced: 6, found: 4 })
  })

  it('reports where it came from, its lists and its cues', async () => {
    const file = pressNight()
    const { report, workspace } = await importQLabPath(file)
    expect(report).toMatchObject({ source: 'file', origin: file, workspaceName: 'Press Night', cueLists: 2, totalCues: 30 })
    expect(workspace.name).toBe('Press Night')
    expect(workspace.version).toBe(1)
  })

  it('names a show QLab left unnamed', () => {
    const show = parseQLabWorkspace(pressNightWorkspace(), 'x.qlab5')
    expect(convertQLabShow({ ...show, name: '  ' }, 'file', 'x.qlab5').workspace.name).toBe('Imported QLab Show')
  })
})

describe('the file dialog', () => {
  it('converts the file picked, and answers a cancel with nothing', async () => {
    const file = pressNight()
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [file] })
    expect((await importQLabFile(win))?.report.workspaceName).toBe('Press Night')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await importQLabFile(win)).toBeNull()
  })
})

describe('finding missing audio in a folder', () => {
  it('looks under the folder by the path QLab knew, then by its tail, then by name — never by searching', () => {
    const entry = { cueId: 'c', path: '/Users/sm/Show/audio/sfx/door.wav', originalPath: '/Users/sm/Show/audio/sfx/door.wav' }
    expect(folderCandidates(entry, '/media')).toEqual([
      join('/media', 'Users/sm/Show/audio/sfx/door.wav'),
      join('/media', 'sm/Show/audio/sfx/door.wav'),
      join('/media', 'Show/audio/sfx/door.wav'),
      join('/media', 'audio/sfx/door.wav'),
      join('/media', 'sfx/door.wav'),
      join('/media', 'door.wav')
    ])
    expect(folderCandidates({ cueId: 'c', path: 'audio/a.wav', originalPath: '' }, '/media')[0]).toBe(join('/media', 'audio/a.wav'))
  })

  it('relinks every missing file the folder holds and reports the rest', async () => {
    const imported = await importQLabPath(pressNight())
    const stick = join(dir, 'stick')
    mkdirSync(join(stick, 'audio'), { recursive: true })
    writeFileSync(join(stick, 'audio', 'door.wav'), 'RIFF')
    const found = relinkFromFolder(imported.workspace, null, stick)
    expect(found.found).toBe(1)
    expect(found.missingMedia.map(entry => entry.cueId)).toEqual(['A42'])
    const door = found.workspace.cues.find(cue => cue.id === 'A-FX1') as AudioCue & { media?: unknown }
    expect(door.filePath).toBe(join(stick, 'audio', 'door.wav'))
    expect(door.media).toEqual({ path: join(stick, 'audio', 'door.wav'), originalPath: join(stick, 'audio', 'door.wav') })
  })

  it('asks for the folder, and answers a cancel with nothing', async () => {
    const imported = await importQLabPath(pressNight())
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await findMediaInFolder(win, imported.workspace, null)).toBeNull()
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [join(dir, 'audio')] })
    expect((await findMediaInFolder(win, imported.workspace, null))?.found).toBe(0)
  })

  it('does not ask when nothing is missing', async () => {
    const imported = await importQLabPath(pressNight())
    const complete = { ...imported.workspace, cues: imported.workspace.cues.filter(cue => cue.id !== 'A42' && cue.id !== 'A-FX1') }
    expect(await findMediaInFolder(win, complete, null)).toMatchObject({ found: 0, missingMedia: [] })
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })
})

describe('the address of a running QLab', () => {
  it('takes a host and a port', () => {
    expect(checkedAddress(' 10.0.0.5 ', 53000)).toEqual({ host: '10.0.0.5', port: 53000 })
  })

  it('refuses an empty host, a host with spaces, and a port that is not one', () => {
    expect(() => checkedAddress('', 53000)).toThrow('type the address of the Mac running QLab, or 127.0.0.1 for this computer')
    expect(() => checkedAddress('my mac', 53000)).toThrow(/type the address/)
    expect(() => checkedAddress('mac.local', 70000)).toThrow('70000 is not a port: QLab listens on 53000')
    expect(() => checkedAddress('mac.local', 1.5)).toThrow(/is not a port/)
  })

  it('imports a workspace from a running QLab, end to end', async () => {
    qlab = await startFakeQLab({
      workspaces: [{
        id: 'WS-1', name: 'Tour.qlab5', lists: [{
          uniqueID: 'L', name: 'Main', cues: [
            { uniqueID: 'A1', number: '1', name: 'Walk-in', type: 'Audio', values: { fileTarget: join(dir, 'walk-in.wav') } },
            { uniqueID: 'V2', number: '2', name: 'Film', type: 'Video' }
          ]
        }]
      }]
    })
    writeFileSync(join(dir, 'walk-in.wav'), 'RIFF')
    expect(await listLiveWorkspaces('127.0.0.1', qlab.port)).toHaveLength(1)
    const imported = await importQLabLive({ host: '127.0.0.1', port: qlab.port, workspaceId: 'WS-1' })
    expect(imported.report).toMatchObject({ source: 'live', origin: `127.0.0.1:${qlab.port}`, workspaceName: 'Tour', totalCues: 2 })
    expect(imported.workspace.cues.map(cue => [cue.number, cue.type, cue.isArmed])).toEqual([['1', 'audio', true], ['2', 'wait', false]])
    expect(imported.missingMedia).toEqual([])
  })

  it('refuses a workspace id that is not one before opening a socket', async () => {
    await expect(importQLabLive({ host: '127.0.0.1', port: 53000, workspaceId: '../etc' })).rejects.toThrow('pick one of the workspaces QLab has open')
  })
})
