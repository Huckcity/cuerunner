// A show is a folder that gets copied to whichever machine is running it, so the media
// inside it has to survive the move, media outside it has to stay where it is, and
// anything that cannot be found has to be visible rather than silently skipped.
//
// These tests run against the real filesystem with Electron stubbed out, because the
// behaviour under test is what the app does with paths that exist and paths that do not.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { writeRecovery } from './recovery'
import {
  openRecovery,
  openWorkspaceFromPath,
  planMediaRelink,
  relinkWorkspaceMedia,
  resolveMediaReference,
  resolveWorkspaceMedia,
  saveWorkspace,
  storedMediaPath
} from './WorkspaceManager'
import type { MissingMedia } from '../../shared/media'
import type { AudioCue, Cue } from '../../renderer/src/types/cue'
import type { Workspace } from '../../renderer/src/types/workspace'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  // One directory for the whole file: getPath must be stable, or the recent list and
  // the recovery snapshot would land in different places.
  const userData = mkdtempSync(join(tmpdir(), 'winslab-media-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: {}
  }
})

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'winslab-media-'))
  vi.mocked(dialog.showOpenDialog).mockReset()
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

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

    const resolved = resolveWorkspaceMedia(workspaceWith([cue]), join(dir, 'Tour Show.wlab'))

    expect(resolved.missingMedia).toEqual([])
    expect((resolved.workspace.cues[0] as AudioCue).filePath).toBe(media)
    // The save-time shape must not leak into the running session.
    expect((resolved.workspace.cues[0] as unknown as Record<string, unknown>).media).toBeUndefined()
    expect(resolved.workspace.name).toBe('Tour Show')
  })

  it('leaves external media on its absolute path', () => {
    const media = write(join(dir, 'external'), 'sting.wav')

    const resolved = resolveWorkspaceMedia(
      workspaceWith([audioCue('a1', media)]),
      join(dir, 'Tour Show.wlab')
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

    const resolved = resolveWorkspaceMedia(workspaceWith([cue]), join(dir, 'Tour Show.wlab'))

    expect(resolved.missingMedia).toEqual([
      { cueId: 'a1', path: 'media/walk-in.wav', originalPath: original }
    ])
    expect((resolved.workspace.cues[0] as AudioCue).filePath).toBe(original)
  })

  it('does not call an audio cue with no file missing', () => {
    const blank = audioCue('a1', '')

    const resolved = resolveWorkspaceMedia(
      workspaceWith([blank]),
      join(dir, 'Tour Show.wlab')
    )

    expect(resolved.missingMedia).toEqual([])
    expect(resolved.workspace.cues[0]).toEqual(blank)
  })

  it('reports a legacy workspace whose absolute paths are gone', () => {
    const gone = join(dir, 'old-machine', 'walk-in.wav')

    const resolved = resolveWorkspaceMedia(
      workspaceWith([audioCue('a1', gone)]),
      join(dir, 'Tour Show.wlab')
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

    const saved = join(showDir, 'Tour Show.wlab')
    await saveWorkspace({} as never, workspace, saved)

    const onDisk = JSON.parse(readFileSync(saved, 'utf-8')) as Workspace
    const [insideCue, outsideCue] = onDisk.cues as AudioCue[]
    const insideMedia = (insideCue as unknown as Record<string, unknown>).media as Record<string, string>
    const outsideMedia = (outsideCue as unknown as Record<string, unknown>).media as Record<string, string>
    expect(insideMedia).toEqual({ path: join('media', 'walk-in.wav'), originalPath: inside })
    expect(outsideMedia).toEqual({ path: outside, originalPath: outside })
    // The runtime path stays in the file too: an older reader sees what it always saw.
    expect(insideCue.filePath).toBe(inside)
    // Saving must not mutate the workspace the renderer is holding.
    expect((workspace.cues[0] as unknown as Record<string, unknown>).media).toBeUndefined()

    // The operator copies the show folder to another machine; the outside file stays put.
    const moved = join(dir, 'other-machine')
    renameSync(showDir, moved)
    const reopened = await openWorkspaceFromPath(join(moved, 'Tour Show.wlab'))

    expect(reopened.missingMedia).toEqual([])
    const [movedInside, movedOutside] = reopened.workspace.cues as AudioCue[]
    expect(movedInside.filePath).toBe(join(moved, 'media', 'walk-in.wav'))
    expect(movedOutside.filePath).toBe(outside)
  })

  it('keeps the last known location of a missing file across another save', async () => {
    const gone = join(dir, 'old-machine', 'media', 'walk-in.wav')
    const saved = join(dir, 'Tour Show.wlab')
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
    expect((second.workspace.cues[0] as AudioCue).filePath).toBe(gone)
  })

  it('reports missing media in a recovered snapshot', async () => {
    const gone = join(dir, 'old-machine', 'walk-in.wav')
    await writeRecovery(workspaceWith([audioCue('a1', gone)]), join(dir, 'Tour Show.wlab'), null)

    const recovered = await openRecovery()

    expect(recovered?.missingMedia).toEqual([{ cueId: 'a1', path: gone, originalPath: gone }])
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
      join(dir, 'Tour Show.wlab'),
      'a'
    )

    expect(result.missingMedia).toEqual([])
    expect((result.workspace.cues[0] as AudioCue).filePath).toBe(chosen)
    expect((result.workspace.cues[1] as AudioCue).filePath).toBe(join(newFolder, 'b.wav'))
    // Nothing about the cues besides their file changed.
    expect((result.workspace.cues[0] as AudioCue).name).toBe('Cue a')
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
    // The demo ships its audio beside its .wlab and is materialised on open; the media
    // fields described here are for saved workspaces and must not have crept into it.
    const demo = JSON.parse(readFileSync(join(process.cwd(), 'resources/demo/Demo Show.wlab'), 'utf-8'))
    for (const cue of demo.cues as Array<Record<string, unknown>>) {
      if (cue.type !== 'audio') continue
      expect(existsSync(join(process.cwd(), 'resources/demo', cue.filePath as string))).toBe(true)
      expect(cue.media).toBeUndefined()
    }
  })
})
