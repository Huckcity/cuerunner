// A showfile that churns when nothing changed is a showfile nobody can diff — and every
// later idea about a show's history (what changed between preview and press night, a
// merge between two people's work, a bundle) sits on this property.
//
// The contract, as the code keeps it today: the bytes on disk are a function of the
// show's state and the folder it is saved into, and nothing else. No wall clock, no map
// iteration order, no field that comes out differently the second time. A file this
// version wrote, opened and saved without editing, is the same file; a file an older
// version wrote converges on one shape at its first save and is left alone after that.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { openWorkspaceFromPath, saveWorkspace } from './WorkspaceManager'
import { DEFAULT_TRIGGER_GUARD } from '../../shared/workspace'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-determinism-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: {}
  }
})

/**
 * A show as an older version wrote it: no `triggers` on the cues, no show-services
 * section, media stored relative to the folder — plus a field this version does not
 * know, which is what a *newer* version's file looks like coming the other way. Every key
 * at the top level is one this build declares and every cue type is one it knows, so the
 * file loads: what it misses is the app's own bookkeeping, not a shape this build refuses.
 */
const LEGACY_SHOW = `{
  "version": 1,
  "id": "w-determinism",
  "name": "Press Night",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "audioSettings": {
    "outputDeviceId": "default"
  },
  "midiSettings": {
    "outputPortName": ""
  },
  "cues": [
    {
      "id": "a1",
      "number": "1",
      "name": "Walk-in Music",
      "type": "audio",
      "colorLabel": "blue",
      "parentId": null,
      "preWait": 0,
      "postWait": 0,
      "timelineOffset": 0,
      "duration": 4000,
      "advance": "none",
      "isArmed": true,
      "notes": "",
      "filePath": "walk-in.wav",
      "startTime": 0,
      "endTime": null,
      "fadeInDuration": 800,
      "volume": 0.8,
      "pan": -0.2,
      "outputs": null,
      "loopCount": -1,
      "playbackRate": 1,
      "trim": 1,
      "someFutureField": {
        "kept": true
      },
      "media": {
        "path": "walk-in.wav",
        "originalPath": "/shows/press-night/walk-in.wav"
      }
    },
    {
      "id": "g1",
      "number": "2",
      "name": "Interval",
      "type": "group",
      "colorLabel": "none",
      "parentId": null,
      "preWait": 0,
      "postWait": 0,
      "timelineOffset": 0,
      "duration": 0,
      "advance": "none",
      "isArmed": true,
      "notes": "",
      "mode": "sequence"
    },
    {
      "id": "w1",
      "number": "2.1",
      "name": "Count",
      "type": "wait",
      "colorLabel": "none",
      "parentId": "g1",
      "preWait": 0,
      "postWait": 0,
      "timelineOffset": 0,
      "duration": 60000,
      "advance": "on-end",
      "isArmed": true,
      "notes": ""
    },
    {
      "id": "m1",
      "number": "3",
      "name": "Q-Light",
      "type": "midi",
      "colorLabel": "none",
      "parentId": null,
      "preWait": 250,
      "postWait": 0,
      "timelineOffset": 0,
      "duration": 0,
      "advance": "none",
      "isArmed": false,
      "notes": "",
      "portName": "",
      "messages": [
        {
          "id": "msg1",
          "kind": "cc",
          "channel": 1,
          "controller": 20,
          "value": 127,
          "delayMs": 0
        }
      ]
    }
  ]
}
`

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-determinism-'))
  file = join(dir, 'Press Night.cuerunner')
  // A real file where the show says its media is, so the load resolves it rather than
  // reporting it missing.
  writeFileSync(join(dir, 'walk-in.wav'), Buffer.alloc(44))
  writeFileSync(file, LEGACY_SHOW)
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function openAndSave(): Promise<string> {
  const { workspace } = await openWorkspaceFromPath(file)
  await saveWorkspace({} as never, workspace, file)
  return readFileSync(file, 'utf-8')
}

describe('the showfile on disk', () => {
  it('reads an older file as it stands, fills nothing in, and is a fixed point from there', async () => {
    const first = await openAndSave()
    // Nothing arrives on that save beyond the one thing a load still completes: a show with
    // no trigger guard gets the default window. No other section is filled in, no cue field
    // is defaulted, and the route the file came with is kept — the pair names the file this
    // session resolved, so its absolute half stays the file's own record rather than this
    // machine's path.
    expect(JSON.parse(first)).toEqual({
      ...JSON.parse(LEGACY_SHOW),
      triggerGuard: { ...DEFAULT_TRIGGER_GUARD }
    })

    // And nothing after that. This is the property a version control history needs: one
    // diff, not one diff per save.
    const second = await openAndSave()
    const third = await openAndSave()
    expect(second).toBe(first)
    expect(third).toBe(first)
  })

  it('keeps a route the file spells its own way, rather than rewriting it to this machine’s', async () => {
    // A show written elsewhere may spell the same route `./walk-in.wav`, with a doubled
    // separator, or with the other platform's separator. Every one of those names the file
    // this session resolved, so every one of them is the show's own record: a save that
    // compared the text instead would rewrite the route and replace the pair's absolute
    // half — the other machine's path — with this one's, on a file nobody edited.
    const respelled = LEGACY_SHOW.replace('"path": "walk-in.wav"', '"path": "./walk-in.wav"')
    expect(respelled).not.toBe(LEGACY_SHOW)
    writeFileSync(file, respelled)

    const after = await openAndSave()

    expect(JSON.parse(after).cues[0].media).toEqual({
      path: './walk-in.wav',
      originalPath: '/shows/press-night/walk-in.wav'
    })
  })

  it('leaves a file this version wrote byte-for-byte alone', async () => {
    await openAndSave()
    const settled = readFileSync(file, 'utf-8')

    const after = await openAndSave()

    expect(after).toBe(settled)
  })

  it('carries a show’s own timecode section through a save unchanged, and writes it nowhere else', async () => {
    const timecode = { rate: '25', holdMs: 1500, chase: true, offsetFrames: -90000, onStop: 'continue', toleranceFrames: 8 }
    const withTimecode = JSON.stringify({ ...JSON.parse(LEGACY_SHOW), timecode }, null, 2) + '\n'
    writeFileSync(file, withTimecode)

    const first = await openAndSave()
    expect(JSON.parse(first).timecode).toEqual(timecode)
    // In the declared place: after the trigger guard, before the cues.
    const keys = Object.keys(JSON.parse(first))
    expect(keys.indexOf('timecode')).toBe(keys.indexOf('cues') - 1)
    expect(await openAndSave()).toBe(first)
  })

  it('keeps a field this version does not know about', async () => {
    const after = await openAndSave()

    expect(JSON.parse(after).cues[0].someFutureField).toEqual({ kept: true })
  })

  it('writes no save-time key anywhere in the file', async () => {
    const after = await openAndSave()

    const keys: string[] = []
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk)
        return
      }
      if (value === null || typeof value !== 'object') return
      for (const [key, child] of Object.entries(value)) {
        keys.push(key)
        walk(child)
      }
    }
    walk(JSON.parse(after))

    expect(keys.filter(key => /savedat|updatedat|modifiedat|timestamp/i.test(key))).toEqual([])
    // `createdAt` is the show's own date, written once when the show is made and carried
    // by the file from then on — not a save timestamp.
    expect(keys.filter(key => key === 'createdAt')).toEqual(['createdAt'])
  })

  it('does not write the wall clock into the file', async () => {
    const { workspace } = await openWorkspaceFromPath(file)
    await saveWorkspace({} as never, workspace, file)
    const first = readFileSync(file, 'utf-8')

    // Days later, same show: nothing in the file may have moved.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-06-01T12:00:00.000Z'))
    await saveWorkspace({} as never, workspace, file)
    vi.useRealTimers()

    expect(readFileSync(file, 'utf-8')).toBe(first)
  })
})
