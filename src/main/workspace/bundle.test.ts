// A show and its media as one artifact: what goes in, what comes out, and what happens
// when the two do not line up.
//
// Electron is stubbed with a real temporary directory and the filesystem is real: a
// bundle is nothing but bytes on a disk, and the interesting failures are the ones about
// paths, missing files and names that collide.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// The one thing this file needs from the codec: a zip that is not a bundle.
import { writeZip } from './zip'
import { Refusal } from '../ipc/refusal'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-bundle-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: {},
    BrowserWindow: {}
  }
})

const { BundleCollision, bundleFileName, readBundle, unpackBundle, writeBundle } = await import('./bundle')
import type { AudioCue, Cue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

function audioCue(id: string, number: string, name: string, filePath: string): Cue {
  return {
    type: 'audio',
    id,
    number,
    name,
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
    loopCount: 1,
    playbackRate: 1,
    trim: 0
  } as AudioCue as Cue
}

function workspace(cues: Cue[], over: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Press Night',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues,
    ...over
  }
}

let dir: string
let bundled: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-bundle-'))
  mkdirSync(join(dir, 'music'))
  writeFileSync(join(dir, 'music', 'walk-in.wav'), Buffer.alloc(2048, 3))
  writeFileSync(join(dir, 'music', 'bows.wav'), Buffer.alloc(512, 9))
  bundled = join(dir, 'Press Night.cuerunnerx')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('exporting a show as a bundle', () => {
  it('carries the show and every file it plays, once each', async () => {
    const show = workspace([
      audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav')),
      audioCue('a2', '2', 'Bows', join(dir, 'music', 'bows.wav')),
      // The same file as cue 1, which is one entry and not two.
      audioCue('a3', '3', 'Walk-in again', join(dir, 'music', 'walk-in.wav'))
    ])

    const exported = await writeBundle(show, join(dir, 'Press Night.cuerunner'), bundled)
    expect(exported.missing).toEqual([])

    const bundle = await readBundle(bundled)
    expect(bundle.media.map(entry => entry.name)).toEqual(['media/bows.wav', 'media/walk-in.wav'])
    expect(bundle.workspace.name).toBe('Press Night')

    // Inside the bundle the show points at its own entries, and says where each file came
    // from, so a workspace unpacked somewhere else can still find it.
    const stored = JSON.parse((await readBundle(bundled)).show.toString('utf8')) as {
      cues: Array<{ id: string; media: { path: string; originalPath: string } }>
    }
    expect(stored.cues[0].media).toEqual({
      path: 'media/walk-in.wav',
      originalPath: join(dir, 'music', 'walk-in.wav')
    })
    expect(stored.cues[1].media.path).toBe('media/bows.wav')
  })

  it('writes the same bytes for the same show', async () => {
    const show = workspace([audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav'))])
    const first = join(dir, 'first.cuerunnerx')
    const second = join(dir, 'second.cuerunnerx')

    await writeBundle(show, null, first)
    await writeBundle(show, null, second)

    expect(readFileSync(first).equals(readFileSync(second))).toBe(true)
  })

  it('leaves out a file the machine does not have, and says which', async () => {
    const gone = join(dir, 'music', 'gone.wav')
    const show = workspace([
      audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav')),
      audioCue('a2', '2', 'Interval', gone)
    ])

    const exported = await writeBundle(show, null, bundled)

    expect(exported.missing).toEqual([gone])
    const bundle = await readBundle(bundled)
    expect(bundle.media.map(entry => entry.name)).toEqual(['media/walk-in.wav'])
    // The cue that is missing its file keeps the path it had: the next save of this show
    // is not the place to lose where the file was.
    expect((bundle.workspace.cues[1] as AudioCue).filePath).toBe(gone)
  })

  it('gives two files with the same name an entry each', async () => {
    mkdirSync(join(dir, 'act2'))
    writeFileSync(join(dir, 'act2', 'walk-in.wav'), Buffer.alloc(64, 5))
    const show = workspace([
      audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav')),
      audioCue('a2', '2', 'Walk-in (act 2)', join(dir, 'act2', 'walk-in.wav'))
    ])

    await writeBundle(show, null, bundled)

    const bundle = await readBundle(bundled)
    expect(bundle.media.map(entry => entry.name)).toEqual(['media/walk-in-2.wav', 'media/walk-in.wav'])
    expect((bundle.workspace.cues[0] as AudioCue).filePath).toBe('media/walk-in.wav')
    expect((bundle.workspace.cues[1] as AudioCue).filePath).toBe('media/walk-in-2.wav')
  })

  it('treats two names that differ only in case as the same name', async () => {
    // The bundle is unpacked onto the filesystem that will hold it, and Windows and
    // macOS do not tell those two names apart: one entry would extract over the other,
    // and a cue would play the other file's audio with nothing said about it.
    mkdirSync(join(dir, 'act2'))
    writeFileSync(join(dir, 'act2', 'WALK-IN.WAV'), Buffer.alloc(64, 5))
    const show = workspace([
      audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav')),
      audioCue('a2', '2', 'Walk-in (act 2)', join(dir, 'act2', 'WALK-IN.WAV'))
    ])

    await writeBundle(show, null, bundled)

    const bundle = await readBundle(bundled)
    expect(bundle.media.map(entry => entry.name))
      .toEqual(['media/WALK-IN-2.WAV', 'media/walk-in.wav'])
  })
})

describe('unpacking a bundle', () => {
  it('gives back a show whose media is where it says', async () => {
    const show = workspace([
      audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav')),
      audioCue('a2', '2', 'Bows', join(dir, 'music', 'bows.wav'))
    ])
    await writeBundle(show, null, bundled)

    const elsewhere = join(dir, 'handover')
    const bundle = await readBundle(bundled)
    const unpacked = await unpackBundle(bundled, elsewhere, bundle)

    expect(unpacked.path).toBe(join(elsewhere, 'Press Night.cuerunner'))
    expect(unpacked.missingMedia).toEqual([])
    expect(readFileSync(join(elsewhere, 'media', 'walk-in.wav')).length).toBe(2048)
    expect((unpacked.workspace.cues[0] as AudioCue).filePath)
      .toBe(join(elsewhere, 'media', 'walk-in.wav'))
    // What is on disk is a show this build can open, with the same cues.
    expect(JSON.parse(readFileSync(unpacked.path, 'utf-8')).cues).toHaveLength(2)
  })

  it('names the show after itself rather than after the bundle file', async () => {
    await writeBundle(workspace([], { name: 'Hamlet: act 2/3' }), null, bundled)
    const bundle = await readBundle(bundled)
    const elsewhere = join(dir, 'handover')
    const unpacked = await unpackBundle(bundled, elsewhere, bundle)

    expect(bundleFileName('Hamlet: act 2/3')).toBe('Hamlet- act 2-3.cuerunner')
    expect(unpacked.path).toBe(join(elsewhere, 'Hamlet- act 2-3.cuerunner'))
  })

  it('refuses to land on files that are already there, unless it is told to replace them', async () => {
    await writeBundle(workspace([audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav'))]), null, bundled)
    const bundle = await readBundle(bundled)

    const elsewhere = join(dir, 'handover')
    mkdirSync(join(elsewhere, 'media'), { recursive: true })
    writeFileSync(join(elsewhere, 'media', 'walk-in.wav'), Buffer.from('something else'))
    writeFileSync(join(elsewhere, 'Press Night.cuerunner'), '{}')

    await expect(unpackBundle(bundled, elsewhere, bundle)).rejects.toBeInstanceOf(BundleCollision)
    // The collision is a marked refusal, so `workspace:importBundle` answers a sentence
    // rather than rejecting; the class itself is what still names the colliding files.
    await expect(unpackBundle(bundled, elsewhere, bundle)).rejects.toBeInstanceOf(Refusal)
    // Nothing was touched by the refusal.
    expect(readFileSync(join(elsewhere, 'media', 'walk-in.wav')).toString()).toBe('something else')
    expect(readFileSync(join(elsewhere, 'Press Night.cuerunner'), 'utf-8')).toBe('{}')

    const unpacked = await unpackBundle(bundled, elsewhere, bundle, { overwrite: true })
    expect(unpacked.missingMedia).toEqual([])
    expect(readFileSync(join(elsewhere, 'media', 'walk-in.wav')).length).toBe(2048)
    expect(JSON.parse(readFileSync(unpacked.path, 'utf-8')).id).toBe('w1')
  })

  it('reports media a hand-made bundle does not carry', async () => {
    // A bundle written without its media: the showfile inside points at a file that is
    // not in the archive.
    await writeBundle(workspace([audioCue('a1', '1', 'Walk-in', join(dir, 'music', 'walk-in.wav'))]), null, bundled)
    const elsewhere = join(dir, 'handover')
    const bundle = await readBundle(bundled)
    const unpacked = await unpackBundle(bundled, elsewhere, {
      ...bundle,
      media: [],
      workspace: {
        ...bundle.workspace,
        cues: [audioCue('a1', '1', 'Walk-in', 'media/walk-in.wav')]
      }
    })

    expect(unpacked.missingMedia).toHaveLength(1)
    expect(unpacked.missingMedia[0].path).toBe('media/walk-in.wav')
    expect(existsSync(join(elsewhere, 'media', 'walk-in.wav'))).toBe(false)
  })

  it('refuses a file that is not a bundle', async () => {
    const notAnArchive = join(dir, 'notes.cuerunnerx')
    writeFileSync(notAnArchive, 'this is not an archive')
    await expect(readBundle(notAnArchive)).rejects.toThrow('not a zip archive')
    await expect(readBundle(notAnArchive)).rejects.toBeInstanceOf(Refusal)

    // A zip with no show in it is not a bundle either, whatever else it carries: a reader
    // must not unpack a folder of media and call it a show.
    const mediaOnly = join(dir, 'media-only.cuerunnerx')
    await writeZip(mediaOnly, [
      { name: 'media/walk-in.wav', file: join(dir, 'music', 'walk-in.wav') }
    ])
    await expect(readBundle(mediaOnly)).rejects.toThrow('carries no show')
  })
})
