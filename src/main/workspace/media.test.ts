// A show is a folder that gets copied to whichever machine is running it, so the media
// inside it has to survive the move, media outside it has to stay where it is, and
// anything that cannot be found has to be visible rather than silently skipped.
//
// These tests run against the real filesystem with Electron stubbed out, because the
// behaviour under test is what the app does with paths that exist and paths that do not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, truncateSync, writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { writeRecovery } from './recovery'
import {
  openRecovery,
  openWorkspace,
  openWorkspaceFromPath,
  planMediaRelink,
  relinkWorkspaceMedia,
  resolveMediaReference,
  resolveWorkspaceMedia,
  saveWorkspace,
  storedMediaPath
} from './WorkspaceManager'
import { Refusal } from '../ipc/refusal'
import type { MissingMedia } from '../../shared/media'
import type { AudioCue, Cue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  // One directory for the whole file: getPath must be stable, or the recent list and
  // the recovery snapshot would land in different places.
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-media-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: {}
  }
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-media-'))
  vi.mocked(dialog.showOpenDialog).mockReset()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A cue as the store leaves it after a retarget: the new path, and no route pair. */
function retargetedCue(cue: Cue, filePath: string): Cue {
  const next = { ...cue, filePath } as Cue
  delete (next as unknown as Record<string, unknown>).media
  return next
}

function audioCue(id: string, filePath: string): AudioCue {
  return {
    id,
    number: id,
    name: `Cue ${id}`,
    type: 'audio',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

function workspaceWith(cues: Cue[]): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Tour Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  }
}

function write(dirPath: string, name: string, contents = 'RIFF....WAVE'): string {
  mkdirSync(dirPath, { recursive: true })
  const file = join(dirPath, name)
  writeFileSync(file, contents)
  return file
}

describe('resolveMediaReference', () => {
  it('finds a file stored relative to the workspace folder', () => {
    const media = write(join(dir, 'media'), 'walk-in.wav')

    const resolution = resolveMediaReference(
      { path: 'media/walk-in.wav', originalPath: join(dir, 'gone', 'walk-in.wav') },
      dir
    )

    expect(resolution.filePath).toBe(media)
  })

  it('falls back to the absolute original when the folder moved without its media', () => {
    const media = write(join(dir, 'elsewhere'), 'walk-in.wav')

    const resolution = resolveMediaReference(
      { path: 'media/walk-in.wav', originalPath: media },
      join(dir, 'moved-show')
    )

    expect(resolution.filePath).toBe(media)
  })

  it('prefers the path stored for the folder when both that and the original are there', () => {
    const beside = write(join(dir, 'media'), 'walk-in.wav')
    const original = write(join(dir, 'original'), 'walk-in.wav')

    const resolution = resolveMediaReference(
      { path: 'media/walk-in.wav', originalPath: original },
      dir
    )

    expect(resolution.filePath).toBe(beside)
  })

  it('reports nothing found and keeps both halves for the relink dialog', () => {
    const original = join(dir, 'gone', 'walk-in.wav')

    const resolution = resolveMediaReference(
      { path: 'media/walk-in.wav', originalPath: original },
      dir
    )

    expect(resolution.filePath).toBeNull()
    expect(resolution.storedPath).toBe('media/walk-in.wav')
    expect(resolution.originalPath).toBe(original)
  })

  it('resolves an absolute path outside the folder without consulting the folder', () => {
    const media = write(join(dir, 'external'), 'sting.wav')

    const resolution = resolveMediaReference(
      { path: media, originalPath: media },
      join(dir, 'show')
    )

    expect(resolution.filePath).toBe(media)
  })
})

describe('storedMediaPath', () => {
  it('stores a file inside the folder relative to it', () => {
    expect(storedMediaPath(join(dir, 'media', 'walk-in.wav'), dir)).toBe(join('media', 'walk-in.wav'))
  })

  it('stores a file outside the folder as an absolute path', () => {
    const outside = join(dir, 'external', 'sting.wav')
    expect(storedMediaPath(outside, join(dir, 'show'))).toBe(outside)
  })

  it('does not mistake a sibling folder with the same prefix for being inside', () => {
    // "Show-archive" starts with the text "Show"; only a real path relationship counts.
    const archive = join(dir, 'Show-archive', 'walk-in.wav')
    expect(storedMediaPath(archive, join(dir, 'Show'))).toBe(archive)
  })
})

describe('resolveWorkspaceMedia', () => {
  it('resolves a show folder that moved, without disturbing anything else in the workspace', () => {
    const media = write(join(dir, 'media'), 'walk-in.wav')
    const cue = {
      ...audioCue('a1', join(dir, 'old-machine', 'media', 'walk-in.wav')),
      media: { path: 'media/walk-in.wav', originalPath: join(dir, 'old-machine', 'media', 'walk-in.wav') }
    } as Cue

    const resolved = resolveWorkspaceMedia(workspaceWith([cue]), join(dir, 'Tour Show.cuerunner'))

    expect(resolved.missingMedia).toEqual([])
    expect((resolved.workspace.cues[0] as AudioCue).filePath).toBe(media)
    // The route the file was saved with travels with the cue: it is what a later save
    // writes back, so a show whose folder moved keeps the route it had.
    expect((resolved.workspace.cues[0] as unknown as Record<string, unknown>).media).toEqual({
      path: 'media/walk-in.wav',
      originalPath: join(dir, 'old-machine', 'media', 'walk-in.wav')
    })
    expect(resolved.workspace.name).toBe('Tour Show')
  })

  it('leaves external media on its absolute path', () => {
    const media = write(join(dir, 'external'), 'sting.wav')

    const resolved = resolveWorkspaceMedia(
      workspaceWith([audioCue('a1', media)]),
      join(dir, 'Tour Show.cuerunner')
    )

    expect(resolved.missingMedia).toEqual([])
    expect((resolved.workspace.cues[0] as AudioCue).filePath).toBe(media)
  })

  it('reports a file nothing could find, keeping the path it was last seen at', () => {
    const original = join(dir, 'old-machine', 'media', 'walk-in.wav')
    const cue = {
      ...audioCue('a1', original),
      media: { path: 'media/walk-in.wav', originalPath: original }
    } as Cue

    const resolved = resolveWorkspaceMedia(workspaceWith([cue]), join(dir, 'Tour Show.cuerunner'))

    expect(resolved.missingMedia).toEqual([
      { cueId: 'a1', path: 'media/walk-in.wav', originalPath: original }
    ])
    expect((resolved.workspace.cues[0] as AudioCue).filePath).toBe(original)
  })

  it('does not call an audio cue with no file missing', () => {
    const blank = audioCue('a1', '')

    const resolved = resolveWorkspaceMedia(
      workspaceWith([blank]),
      join(dir, 'Tour Show.cuerunner')
    )

    expect(resolved.missingMedia).toEqual([])
    expect(resolved.workspace.cues[0]).toEqual(blank)
  })

  it('reports a legacy workspace whose absolute paths are gone', () => {
    const gone = join(dir, 'old-machine', 'walk-in.wav')

    const resolved = resolveWorkspaceMedia(
      workspaceWith([audioCue('a1', gone)]),
      join(dir, 'Tour Show.cuerunner')
    )

    expect(resolved.missingMedia).toEqual([{ cueId: 'a1', path: gone, originalPath: gone }])
  })

  it('leaves cues of other types untouched', () => {
    const wait: Cue = {
      id: 'w1',
      number: '2',
      name: 'Wait',
      type: 'wait',
      colorLabel: 'none',
      parentId: null,
      preWait: 0,
      postWait: 0,
      timelineOffset: 0,
      duration: 1000,
      advance: 'none',
      isArmed: true,
      notes: ''
    }

    const resolved = resolveWorkspaceMedia(workspaceWith([wait]), null)

    expect(resolved.missingMedia).toEqual([])
    expect(resolved.workspace.cues[0]).toEqual(wait)
  })
})

describe('saving and reopening a show folder', () => {
  it('writes both locations per file and resolves them after the folder moves', async () => {
    const showDir = join(dir, 'show')
    const inside = write(join(showDir, 'media'), 'walk-in.wav')
    const outside = write(join(dir, 'external'), 'sting.wav')
    const workspace = workspaceWith([audioCue('inside', inside), audioCue('outside', outside)])

    const saved = join(showDir, 'Tour Show.cuerunner')
    await saveWorkspace({} as never, workspace, saved)

    const onDisk = JSON.parse(readFileSync(saved, 'utf-8')) as Workspace
    const [insideCue, outsideCue] = onDisk.cues as AudioCue[]
    const insideMedia = (insideCue as unknown as Record<string, unknown>).media as Record<string, string>
    const outsideMedia = (outsideCue as unknown as Record<string, unknown>).media as Record<string, string>
    expect(insideMedia).toEqual({ path: join('media', 'walk-in.wav'), originalPath: inside })
    expect(outsideMedia).toEqual({ path: outside, originalPath: outside })
    // The saved `filePath` is the route, not the path this machine resolved: a cue's
    // runtime path is never what a save writes (AD-10). A file outside the folder keeps
    // the absolute route it lives at.
    expect(insideCue.filePath).toBe(join('media', 'walk-in.wav'))
    expect(outsideCue.filePath).toBe(outside)
    // Saving must not mutate the workspace the renderer is holding.
    expect((workspace.cues[0] as unknown as Record<string, unknown>).media).toBeUndefined()

    // The operator copies the show folder to another machine; the outside file stays put.
    const moved = join(dir, 'other-machine')
    renameSync(showDir, moved)
    const reopened = await openWorkspaceFromPath(join(moved, 'Tour Show.cuerunner'))

    expect(reopened.missingMedia).toEqual([])
    const [movedInside, movedOutside] = reopened.workspace.cues as AudioCue[]
    expect(movedInside.filePath).toBe(join(moved, 'media', 'walk-in.wav'))
    expect(movedOutside.filePath).toBe(outside)
  })

  it('keeps the stored relative route when the folder moved and its media did not', async () => {
    const machineA = join(dir, 'machine-a')
    const media = write(join(machineA, 'media'), 'walk-in.wav')
    const savedInA = join(machineA, 'Tour Show.cuerunner')
    await saveWorkspace({} as never, workspaceWith([audioCue('a1', media)]), savedInA)

    // Only the showfile arrives on the other machine, and the one it was saved on is
    // gone: nothing at the stored route and nothing at the absolute it was last seen at.
    const machineB = join(dir, 'machine-b')
    mkdirSync(machineB, { recursive: true })
    const arrived = join(machineB, 'Tour Show.cuerunner')
    copyFileSync(savedInA, arrived)
    rmSync(machineA, { recursive: true, force: true })

    const opened = await openWorkspaceFromPath(arrived)
    expect(opened.missingMedia).toEqual([
      { cueId: 'a1', path: join('media', 'walk-in.wav'), originalPath: media }
    ])

    await saveWorkspace({} as never, opened.workspace, arrived)

    const onDisk = JSON.parse(readFileSync(arrived, 'utf-8')) as Workspace
    const cue = onDisk.cues[0] as unknown as { filePath: string; media: Record<string, string> }
    // The route the show already had, in both fields, and the last known absolute kept
    // beside it — never the path this machine happened to try.
    expect(cue.media).toEqual({ path: join('media', 'walk-in.wav'), originalPath: media })
    expect(cue.filePath).toBe(join('media', 'walk-in.wav'))
    // Nothing about the route changed, so the save wrote no history entry for it.
    expect((onDisk as unknown as Record<string, unknown>).history).toBeUndefined()

    // And the next open reports the same file missing, at the same route.
    const reopened = await openWorkspaceFromPath(arrived)
    expect(reopened.missingMedia).toEqual([
      { cueId: 'a1', path: join('media', 'walk-in.wav'), originalPath: media }
    ])

    // The media arrives with the folder later: the route the show kept finds it.
    const restored = write(join(machineB, 'media'), 'walk-in.wav')
    const found = await openWorkspaceFromPath(arrived)
    expect(found.missingMedia).toEqual([])
    expect((found.workspace.cues[0] as AudioCue).filePath).toBe(restored)
  })

  it('leaves a file that stayed at the old absolute out of the route', async () => {
    const machineA = join(dir, 'machine-a')
    const media = write(join(machineA, 'media'), 'walk-in.wav')
    const savedInA = join(machineA, 'Tour Show.cuerunner')
    await saveWorkspace({} as never, workspaceWith([audioCue('a1', media)]), savedInA)

    // A copy of the show is opened elsewhere while the machine it came from — and the
    // file on it — are still there.
    const machineB = join(dir, 'machine-b')
    mkdirSync(machineB, { recursive: true })
    const arrived = join(machineB, 'Tour Show.cuerunner')
    copyFileSync(savedInA, arrived)

    const opened = await openWorkspaceFromPath(arrived)
    expect(opened.missingMedia).toEqual([])
    // It plays from where the file stayed.
    expect((opened.workspace.cues[0] as AudioCue).filePath).toBe(media)

    await saveWorkspace({} as never, opened.workspace, arrived)

    const onDisk = JSON.parse(readFileSync(arrived, 'utf-8')) as Workspace
    const cue = onDisk.cues[0] as unknown as { filePath: string; media: Record<string, string> }
    // Where this session found the file is not promoted into the show: the route stays
    // relative and the absolute remains only the pair's other half.
    expect(cue.media).toEqual({ path: join('media', 'walk-in.wav'), originalPath: media })
    expect(cue.filePath).toBe(join('media', 'walk-in.wav'))

    const reopened = await openWorkspaceFromPath(arrived)
    expect(reopened.missingMedia).toEqual([])
    expect((reopened.workspace.cues[0] as AudioCue).filePath).toBe(media)
  })

  it('writes no media for a blank audio cue, and leaves its path empty', async () => {
    const showDir = join(dir, 'show')
    const media = write(join(showDir, 'media'), 'walk-in.wav')
    const saved = join(showDir, 'Tour Show.cuerunner')
    // The second blank cue is what a hand-edited file leaves behind: no path, but the
    // route record was never cleared.
    const stalePair = {
      ...audioCue('blank-pair', ''),
      media: { path: join('media', 'old.wav'), originalPath: join(dir, 'old', 'media', 'old.wav') }
    } as unknown as Cue
    await saveWorkspace(
      {} as never,
      workspaceWith([audioCue('blank', ''), stalePair, audioCue('a1', media)]),
      saved
    )

    const onDisk = JSON.parse(readFileSync(saved, 'utf-8')) as Workspace
    const [blank, pairBlank, filled] = onDisk.cues as unknown as Array<Record<string, unknown>>
    expect('media' in blank).toBe(false)
    expect(blank.filePath).toBe('')
    // A cue with no file has no route to record: the pair goes with the file it named.
    expect('media' in pairBlank).toBe(false)
    expect(pairBlank.filePath).toBe('')
    // The cue beside it is written as usual: the blank branch is a cue waiting for a
    // file, not a hole in the walk.
    expect(filled.media).toEqual({ path: join('media', 'walk-in.wav'), originalPath: media })
  })

  it('writes both halves for a file whose pair was only half recorded', async () => {
    const showDir = join(dir, 'show')
    const saved = join(showDir, 'Tour Show.cuerunner')
    // A file that names the route beside the folder but never recorded the absolute the
    // file was last seen at: half a pair, which is not a pair.
    mkdirSync(showDir, { recursive: true })
    writeFileSync(saved, JSON.stringify({
      ...workspaceWith([
        {
          ...audioCue('a1', join('media', 'walk-in.wav')),
          media: { path: join('media', 'walk-in.wav') }
        } as unknown as Cue
      ])
    }, null, 2))

    const opened = await openWorkspaceFromPath(saved)
    expect(opened.missingMedia).toHaveLength(1)

    await saveWorkspace({} as never, opened.workspace, saved)

    const onDisk = JSON.parse(readFileSync(saved, 'utf-8')) as Workspace
    const cue = onDisk.cues[0] as unknown as { filePath: string; media: Record<string, string> }
    // The route is kept, and the half that was missing is written as the shape declares
    // it — a string — rather than half a record being copied back.
    expect(cue.filePath).toBe(join('media', 'walk-in.wav'))
    expect(cue.media).toEqual({
      path: join('media', 'walk-in.wav'),
      originalPath: join(showDir, 'media', 'walk-in.wav')
    })
  })

  it('keeps the last known location of a missing file across another save', async () => {
    const gone = join(dir, 'old-machine', 'media', 'walk-in.wav')
    const saved = join(dir, 'Tour Show.cuerunner')
    await saveWorkspace({} as never, workspaceWith([audioCue('a1', gone)]), saved)

    const first = await openWorkspaceFromPath(saved)
    expect(first.missingMedia).toEqual([
      { cueId: 'a1', path: join('old-machine', 'media', 'walk-in.wav'), originalPath: gone }
    ])

    // Trying again must not turn a missing file into a pathless one. The saved show
    // stores it relative to the folder, which is where the file belongs when it comes
    // back — the absolute original is what the picker is pointed at.
    await saveWorkspace({} as never, first.workspace, saved)
    const second = await openWorkspaceFromPath(saved)

    expect(second.missingMedia).toEqual([
      { cueId: 'a1', path: join('old-machine', 'media', 'walk-in.wav'), originalPath: gone }
    ])
    // The route, not the path this machine tried: the absolute it was last seen at is
    // the pair's other half and is not promoted into `filePath`.
    expect((second.workspace.cues[0] as AudioCue).filePath)
      .toBe(join('old-machine', 'media', 'walk-in.wav'))
  })

  it('reports missing media in a recovered snapshot', async () => {
    const gone = join(dir, 'old-machine', 'walk-in.wav')
    await writeRecovery(workspaceWith([audioCue('a1', gone)]), join(dir, 'Tour Show.cuerunner'))

    const recovered = await openRecovery()

    expect(recovered?.missingMedia).toEqual([{ cueId: 'a1', path: gone, originalPath: gone }])
  })

  it('migrates a snapshot left by an older build, the way it migrates a file', async () => {
    // A session that died on an older build leaves an older snapshot: without the
    // migration its groups come back with no children, because the children are still
    // named by the `childIds` field this build no longer reads.
    const legacy = {
      ...workspaceWith([]),
      cues: [
        { id: 'g1', type: 'group', mode: 'sequence', name: 'Act 1', childIds: ['c1'] },
        { id: 'c1', type: 'wait', name: 'Top of act', duration: 1000, parentId: null }
      ]
    } as unknown as Workspace
    await writeRecovery(legacy, join(dir, 'Tour Show.cuerunner'))

    const recovered = await openRecovery()

    expect(recovered?.workspace.cues.map(cue => [cue.id, cue.parentId])).toEqual([
      ['g1', null],
      ['c1', 'g1']
    ])
  })

  it('refuses a workspace past the size this app will open, from the dialog too', async () => {
    // File→Open is how most shows arrive, and the cap has to be on that path as much as
    // on the ones that go through readWorkspaceFile: a 500 MB file would spike the
    // main process by several gigabytes before anything could say no.
    const huge = join(dir, 'huge.cuerunner')
    writeFileSync(huge, '')
    truncateSync(huge, 64 * 1024 * 1024 + 1)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [huge] })

    // A marked refusal, so the `workspace:open` handler can answer it as a value; the
    // channel-level pin is src/main/ipc/refusal.test.ts.
    const refused = await openWorkspace({} as never).catch((error: unknown) => error)

    expect(refused).toBeInstanceOf(Refusal)
    expect((refused as Error).message).toBe('that workspace file is larger than this app will open')
  })
})

describe('planMediaRelink', () => {
  const missing = (...entries: Array<[string, string]>): MissingMedia[] =>
    entries.map(([cueId, originalPath]) => ({ cueId, path: originalPath, originalPath }))

  it('relinks every file the same move accounts for', () => {
    const newFolder = join(dir, 'new-machine', 'media')
    const chosen = write(newFolder, 'a.wav')
    write(newFolder, 'b.wav')
    const oldFolder = join(dir, 'old-machine', 'media')

    const plan = planMediaRelink(
      missing(['a', join(oldFolder, 'a.wav')], ['b', join(oldFolder, 'b.wav')]),
      'a',
      chosen
    )

    expect(plan.get('a')).toBe(chosen)
    expect(plan.get('b')).toBe(join(newFolder, 'b.wav'))
  })

  it('leaves a file missing when the mapping has nothing there', () => {
    const chosen = write(join(dir, 'new-machine', 'media'), 'a.wav')
    const oldFolder = join(dir, 'old-machine', 'media')

    const plan = planMediaRelink(
      missing(['a', join(oldFolder, 'a.wav')], ['b', join(oldFolder, 'b.wav')]),
      'a',
      chosen
    )

    expect(plan.get('a')).toBe(chosen)
    // b.wav never came along, and a file that is not there is not relinked.
    expect(plan.has('b')).toBe(false)
  })

  it('does not guess between files that merely share a name', () => {
    const chosen = write(join(dir, 'new-machine', 'a.wav'), 'a.wav')

    const plan = planMediaRelink(
      missing(['a', join(dir, 'old', 'one', 'a.wav')], ['other', join(dir, 'somewhere', 'other', 'a.wav')]),
      'a',
      chosen
    )

    expect(plan.get('a')).toBe(chosen)
    // The other file is only the same name in a different tree; there is no way to know
    // it is the one the operator meant, so nothing is assumed about it.
    expect(plan.has('other')).toBe(false)
  })

  it('relinks just the picked cue when the pick shares no folder structure with it', () => {
    const chosen = write(join(dir, 'new-machine'), 'renamed.wav')

    const plan = planMediaRelink(
      missing(['a', join(dir, 'old', 'one', 'a.wav')], ['b', join(dir, 'old', 'one', 'b.wav')]),
      'a',
      chosen
    )

    expect([...plan.entries()]).toEqual([['a', chosen]])
  })

  it('relinks nothing when the picked file is not there', () => {
    const plan = planMediaRelink(
      missing(['a', join(dir, 'old', 'one', 'a.wav')]),
      'a',
      join(dir, 'old', 'one', 'a.wav')
    )

    expect(plan.size).toBe(0)
  })
})

describe('relinkWorkspaceMedia', () => {
  it('resolves every missing file one pick accounts for', async () => {
    const newFolder = join(dir, 'new-machine', 'media')
    const chosen = write(newFolder, 'a.wav')
    write(newFolder, 'b.wav')
    const oldFolder = join(dir, 'old-machine', 'media')
    const workspace = workspaceWith([
      audioCue('a', join(oldFolder, 'a.wav')),
      audioCue('b', join(oldFolder, 'b.wav'))
    ])
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({
      canceled: false,
      filePaths: [chosen]
    })

    const result = await relinkWorkspaceMedia(
      {} as never,
      workspace,
      join(dir, 'Tour Show.cuerunner'),
      'a'
    )

    expect(result.missingMedia).toEqual([])
    expect((result.workspace.cues[0] as AudioCue).filePath).toBe(chosen)
    expect((result.workspace.cues[1] as AudioCue).filePath).toBe(join(newFolder, 'b.wav'))
    // Nothing about the cues besides their file changed.
    expect((result.workspace.cues[0] as AudioCue).name).toBe('Cue a')
  })

  it('writes the picked file’s route into the show, so the next save keeps the pick', async () => {
    const showDir = join(dir, 'show')
    const media = write(join(showDir, 'media'), 'walk-in.wav')
    const saved = join(showDir, 'Tour Show.cuerunner')
    await saveWorkspace({} as never, workspaceWith([audioCue('a1', media)]), saved)

    // The folder moves without its media, and the operator finds the file elsewhere.
    const movedShow = join(dir, 'moved')
    mkdirSync(movedShow, { recursive: true })
    const arrived = join(movedShow, 'Tour Show.cuerunner')
    copyFileSync(saved, arrived)
    // The folder it came from — and the media on it — is gone.
    rmSync(showDir, { recursive: true, force: true })
    const picked = write(join(dir, 'found-again'), 'walk-in.wav')

    const opened = await openWorkspaceFromPath(arrived)
    expect(opened.missingMedia).toHaveLength(1)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [picked] })
    const relinked = await relinkWorkspaceMedia({} as never, opened.workspace, arrived, 'a1')

    // The pick replaces the cue's stored route as well as its runtime path, which is why
    // re-resolving reports nothing missing.
    expect(relinked.missingMedia).toEqual([])
    expect((relinked.workspace.cues[0] as unknown as Record<string, unknown>).media)
      .toEqual({ path: picked, originalPath: picked })

    // This save is handed a cue that was read before a retarget let its pair go — what a
    // window opened on a recovered snapshot from an earlier build holds — so it still
    // carries the route the file it no longer plays was saved with: the pick, not that
    // route, is what the show has to keep.
    const patched = {
      ...opened.workspace,
      cues: opened.workspace.cues.map(cue => ({ ...cue, filePath: picked } as Cue))
    }
    await saveWorkspace({} as never, patched, arrived)

    const onDisk = JSON.parse(readFileSync(arrived, 'utf-8')) as Workspace
    const cue = onDisk.cues[0] as unknown as { filePath: string; media: Record<string, string> }
    expect(cue.media).toEqual({ path: picked, originalPath: picked })
    expect(cue.filePath).toBe(picked)
  })

  it('writes the picked file’s route relative to the folder when the pick is inside it', async () => {
    const showDir = join(dir, 'machine-a')
    const media = write(join(showDir, 'media'), 'walk-in.wav')
    const saved = join(showDir, 'Tour Show.cuerunner')
    await saveWorkspace({} as never, workspaceWith([audioCue('a1', media)]), saved)

    // The folder moves without its media, and the operator picks a file that lives in
    // the new folder but at a route the show never stored.
    const movedShow = join(dir, 'machine-b')
    mkdirSync(movedShow, { recursive: true })
    const arrived = join(movedShow, 'Tour Show.cuerunner')
    copyFileSync(saved, arrived)
    rmSync(showDir, { recursive: true, force: true })
    const picked = write(join(movedShow, 'audio'), 'walk-in.wav')

    const opened = await openWorkspaceFromPath(arrived)
    expect(opened.missingMedia).toHaveLength(1)
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [picked] })
    const relinked = await relinkWorkspaceMedia({} as never, opened.workspace, arrived, 'a1')

    // The pair names the route the pick sits at, relative to the show's own folder.
    expect(relinked.missingMedia).toEqual([])
    expect((relinked.workspace.cues[0] as unknown as Record<string, unknown>).media)
      .toEqual({ path: join('audio', 'walk-in.wav'), originalPath: picked })
    expect((relinked.workspace.cues[0] as AudioCue).filePath).toBe(picked)

    // The window hands the save the cue as the store leaves it: the runtime path it
    // patched on, and no pair — a retarget lets the pair go with the file it named. The
    // next save writes the picked file's route, not the one it replaced and not an
    // absolute.
    const patched = {
      ...opened.workspace,
      cues: opened.workspace.cues.map(cue => retargetedCue(cue, picked))
    }
    await saveWorkspace({} as never, patched, arrived)

    const onDisk = JSON.parse(readFileSync(arrived, 'utf-8')) as Workspace
    const cue = onDisk.cues[0] as unknown as { filePath: string; media: Record<string, string> }
    expect(cue.media).toEqual({ path: join('audio', 'walk-in.wav'), originalPath: picked })
    expect(cue.filePath).toBe(join('audio', 'walk-in.wav'))

    // And the show finds it where the pick left it.
    const reopened = await openWorkspaceFromPath(arrived)
    expect(reopened.missingMedia).toEqual([])
    expect((reopened.workspace.cues[0] as AudioCue).filePath).toBe(picked)
  })

  it('hands back the unchanged workspace and misses when the operator cancels', async () => {
    const oldFolder = join(dir, 'old-machine', 'media')
    const workspace = workspaceWith([audioCue('a', join(oldFolder, 'a.wav'))])
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [] })

    const result = await relinkWorkspaceMedia({} as never, workspace, null, 'a')

    expect(result.workspace.cues).toEqual(workspace.cues)
    expect(result.missingMedia).toEqual([
      { cueId: 'a', path: join(oldFolder, 'a.wav'), originalPath: join(oldFolder, 'a.wav') }
    ])
  })

  it('leaves the files a pick did not account for missing, with their locations intact', async () => {
    const chosen = write(join(dir, 'new-machine', 'media'), 'a.wav')
    const oldFolder = join(dir, 'old-machine', 'media')
    const other = join(dir, 'unrelated', 'b.wav')
    const workspace = workspaceWith([audioCue('a', join(oldFolder, 'a.wav')), audioCue('b', other)])
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [chosen] })

    const result = await relinkWorkspaceMedia({} as never, workspace, null, 'a')

    expect(result.missingMedia).toEqual([{ cueId: 'b', path: other, originalPath: other }])
    expect((result.workspace.cues[0] as AudioCue).filePath).toBe(chosen)
    expect((result.workspace.cues[1] as AudioCue).filePath).toBe(other)
  })

  it('does nothing for a cue that is not missing', async () => {
    const media = write(join(dir, 'media'), 'a.wav')
    const workspace = workspaceWith([audioCue('a', media)])

    const result = await relinkWorkspaceMedia({} as never, workspace, null, 'a')

    expect(result.missingMedia).toEqual([])
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
  })
})

describe('the demo folder stays loadable', () => {
  it('has no media references that point outside it', () => {
    // The demo ships its audio beside its .cuerunner and is materialised on open; the media
    // fields described here are for saved workspaces and must not have crept into it.
    const demo = JSON.parse(readFileSync(join(process.cwd(), 'resources/demo/Demo Show.cuerunner'), 'utf-8'))
    for (const cue of demo.cues as Array<Record<string, unknown>>) {
      if (cue.type !== 'audio') continue
      expect(existsSync(join(process.cwd(), 'resources/demo', cue.filePath as string))).toBe(true)
      expect(cue.media).toBeUndefined()
    }
  })
})
