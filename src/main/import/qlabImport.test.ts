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

  it('offers QLab 5’s own backups beside its workspaces', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })
    await importQLabFile(win)
    const call = vi.mocked(dialog.showOpenDialog).mock.calls[0] as unknown[]
    const options = call[call.length - 1] as { filters: Array<{ extensions: string[] }> }
    expect(options.filters[0].extensions).toEqual(['qlab5', 'qlab4', 'qlab3', 'qlab5backup', 'cues'])
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

  it('finds a file a cloud drive renamed, and names the files when two could be it', () => {
    // A real show's audio came back from Google Drive with each ' turned into _: four of its
    // forty-five files were missing under the names QLab kept.
    const media = join(dir, 'audio')
    mkdirSync(media)
    const names = [
      "(rt) 07B IT'S SURE A NICE VIEW HERE.mp3",
      "(rt) 07C WORLD'S LARGEST REFRIGERATOR.mp3",
      "(rt) 13.2-14.1 38 PLANES REPRISE-SOMEWHERE - SOMETHING'S MISSING.mp3",
      "(rt) 14.2 SOMETHING'S MISSING.mp3"
    ]
    for (const name of names) writeFileSync(join(media, name.replace(/'/g, '_')), 'ID3')
    // The last one is there twice, under two characters a ' can become.
    writeFileSync(join(media, '(rt) 14.2 SOMETHING’S MISSING.mp3'), 'ID3')
    const elsewhere = '/Users/sm/Desktop/CFA RTs/audio'
    const cues = names.map((name, index) => ({
      id: `A${index}`, number: String(index + 1), name, colorLabel: 'none', parentId: null, preWait: 0, postWait: 0,
      timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: '', type: 'audio',
      filePath: `${elsewhere}/${name}`, startTime: 0, endTime: null, fadeInDuration: 0, volume: 1, pan: 0, outputs: null,
      loopCount: 0, playbackRate: 1, trim: 1
    })) as AudioCue[]
    const workspace = { version: 1 as const, id: 'w', name: 'CFA RTs', createdAt: '', audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' }, cues }

    const found = relinkFromFolder(workspace, null, media)
    expect(found.found).toBe(3)
    expect(found.workspace.cues.slice(0, 3).map(cue => (cue as AudioCue).filePath)).toEqual(
      names.slice(0, 3).map(name => join(media, name.replace(/'/g, '_')))
    )
    expect(found.missingMedia.map(entry => entry.cueId)).toEqual(['A3'])
    expect(found.ambiguous).toEqual([{
      cueId: 'A3',
      candidates: [join(media, '(rt) 14.2 SOMETHING_S MISSING.mp3'), join(media, '(rt) 14.2 SOMETHING’S MISSING.mp3')].sort()
    }])
  })

  it('takes a file under its own name before one under a renamed name', () => {
    const media = join(dir, 'audio')
    mkdirSync(media)
    writeFileSync(join(media, "IT'S.mp3"), 'ID3')
    writeFileSync(join(media, 'IT_S.mp3'), 'ID3')
    const cue = {
      id: 'A', number: '1', name: 'x', colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '', type: 'audio', filePath: "/gone/IT'S.mp3", startTime: 0, endTime: null,
      fadeInDuration: 0, volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1
    } as AudioCue
    const found = relinkFromFolder(
      { version: 1, id: 'w', name: 'x', createdAt: '', audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' }, cues: [cue] },
      null, media
    )
    expect((found.workspace.cues[0] as AudioCue).filePath).toBe(join(media, "IT'S.mp3"))
    expect(found.ambiguous).toEqual([])
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
