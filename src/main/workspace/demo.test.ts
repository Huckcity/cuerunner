// The demo ships as data, so nothing type-checks the shipped .cuerunner and no compiler
// catches a cue that points at a missing parent or an audio file that is not in the
// folder. Electron is not available here, so the loader is imported with it stubbed — with
// a real temporary user-data folder and a packaged flag a test can turn on, because the
// demo's own path is the one part of it that depends on where the app was installed.
//
// The shipped bytes are the serialiser's output for the show they hold, and this is the
// recipe that produces them, run inside that stubbed harness because every module it names
// reaches Electron through its own imports:
//
//   1. Read `resources/demo/Demo Show.cuerunner` and parse it.
//   2. Stand this build's defaults in through `heldShowSettings` (`src/shared/show.ts`) —
//      the object the window holds, which is the object the serialiser writes. For the file as
//      it ships the step changes nothing: its settings carry every declared section, it carries
//      its `triggerGuard`, and the one declared key it goes without is `history`, which a show
//      earns with the first save that changes something. The step is here for what that means:
//      the recipe writes the window's object, so it stays the recipe if a section ever leaves
//      the file or a default moves.
//   3. Write it back with `serialiseWorkspace` (`./WorkspaceManager`), in the folder the show
//      lives in: that folder is the route its audio cues are written against, which is what
//      keeps them workspace-relative.
//
// No tool regenerates the file — the recipe is here to be followed by hand — and the last
// case holds the equivalence it promises: the demo opened through `openDemoWorkspace` and
// saved through `saveWorkspace` writes the bytes it was opened with, so the shipped file,
// the loader, the serialiser and a save of the freshly opened demo cannot drift apart.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { copyFileSync, existsSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join } from 'path'
import { materialiseDemoAssets, openDemoWorkspace } from './demo'
import { migrateWorkspace, saveWorkspace } from './WorkspaceManager'
import type { AudioCue, ScriptCue } from '../../shared/cue'
import type { LoadNote, Workspace } from '../../shared/workspace'

const ends = vi.hoisted(() => ({ userData: { path: '' }, packaged: { on: false } }))

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  ends.userData.path = mkdtempSync(join(tmpdir(), 'cuerunner-demo-userdata-'))
  return {
    app: {
      getPath: () => ends.userData.path,
      get isPackaged() {
        return ends.packaged.on
      }
    },
    dialog: {},
    BrowserWindow: {}
  }
})

// Vitest runs from the repository root, as the E2E helpers also assume.
const demoDir = join(process.cwd(), 'resources/demo')

function audioCue(id: string, filePath: string): AudioCue {
  return {
    id,
    number: '1',
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

function workspaceWith(cues: AudioCue[]): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Demo Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  }
}

function loadDemo(raw: string, notes?: LoadNote[]): Workspace {
  return migrateWorkspace(JSON.parse(raw) as Workspace, join(demoDir, 'Demo Show.cuerunner'), notes)
}

function readDemo(): Promise<string> {
  return readFile(join(demoDir, 'Demo Show.cuerunner'), 'utf-8')
}

let workDir: string

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'cuerunner-demo-'))
})

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true })
})

describe('materialiseDemoAssets', () => {
  it('copies a relative asset into the destination and points the cue at the copy', async () => {
    const source = join(workDir, 'source')
    const dest = join(workDir, 'dest')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'walk-in.wav'), 'RIFF....WAVE')

    const workspace = workspaceWith([audioCue('a1', 'walk-in.wav')])
    await materialiseDemoAssets(workspace, source, dest)

    const copied = (workspace.cues[0] as AudioCue).filePath
    expect(isAbsolute(copied)).toBe(true)
    expect(copied.startsWith(dest)).toBe(true)
    expect(await readFile(copied, 'utf-8')).toBe('RIFF....WAVE')
  })

  it('copies a shared asset once for every cue that uses it', async () => {
    const source = join(workDir, 'source')
    const dest = join(workDir, 'dest')
    await mkdir(source, { recursive: true })
    await writeFile(join(source, 'walk-in.wav'), 'RIFF....WAVE')

    const workspace = workspaceWith([audioCue('a1', 'walk-in.wav'), audioCue('a2', 'walk-in.wav')])
    await materialiseDemoAssets(workspace, source, dest)

    const [first, second] = workspace.cues as AudioCue[]
    expect(first.filePath).toBe(second.filePath)
    expect(existsSync(first.filePath)).toBe(true)
  })

  it('leaves an absolute path alone', async () => {
    const absolute = join(workDir, 'mine.wav')
    await writeFile(absolute, 'RIFF....WAVE')

    const workspace = workspaceWith([audioCue('a1', absolute)])
    await materialiseDemoAssets(workspace, join(workDir, 'source'), join(workDir, 'dest'))

    expect((workspace.cues[0] as AudioCue).filePath).toBe(absolute)
  })
})

describe('the bundled demo workspace', () => {
  it('loads with nothing to repair, and every reference inside it resolving', async () => {
    const notes: LoadNote[] = []
    const workspace = loadDemo(await readDemo(), notes)

    expect(workspace.name).toBe('Demo Show')
    // A file this build writes needs no repair: the demo opens with nothing to report.
    expect(notes).toEqual([])
    expect(workspace.cues.length).toBeGreaterThan(0)

    const ids = new Set(workspace.cues.map(cue => cue.id))
    expect(workspace.cues.filter(cue => cue.parentId !== null && !ids.has(cue.parentId))).toEqual([])
    expect(workspace.cues.filter(cue => cue.type === 'fade' && !ids.has(cue.targetCueId))).toEqual([])
  })

  it('points every audio cue at a file shipped beside it', async () => {
    const audioCues = loadDemo(await readDemo()).cues.filter(
      (cue): cue is AudioCue => cue.type === 'audio'
    )

    expect(audioCues.length).toBeGreaterThan(0)
    for (const cue of audioCues) {
      // Relative, or the demo would only work on the machine that built it.
      expect(isAbsolute(cue.filePath)).toBe(false)
      const asset = join(demoDir, cue.filePath)
      expect(existsSync(asset)).toBe(true)
      expect((await readFile(asset)).subarray(0, 4).toString()).toBe('RIFF')
    }
  })

  it('covers every cue type the app can create', async () => {
    const types = new Set(loadDemo(await readDemo()).cues.map(cue => cue.type))

    expect([...types].sort()).toEqual(
      ['audio', 'fade', 'group', 'midi', 'network', 'osc', 'script', 'stop', 'wait']
    )
  })

  it('refuses a demo file that is JSON and not a show, naming the file', async () => {
    // The demo is the app's own file and it goes through the same funnel, so the guard the
    // other load funnels put in front of it belongs here too: without it the funnel's first
    // read of the cue list throws V8's own text, which reaches the window as a fault where
    // the demo channel declares a refusal.
    const notAShow = join(workDir, 'no-cues.cuerunner')
    await writeFile(notAShow, '{"version":1}')

    await expect(openDemoWorkspace(notAShow)).rejects.toThrow(
      `that file is not a show — ${notAShow} holds no cue list`
    )
  })

  it('carries the cue fields this build writes, with the legacy routing gone', async () => {
    const workspace = loadDemo(await readDemo())

    for (const cue of workspace.cues) {
      if (cue.type !== 'audio') continue
      // The old shape carried a list of outputs whose first entry was the only one that
      // ever played; this build writes a master level and pan on the cue, and the routing
      // as crosspoints or nothing at all. Nothing fills that in at load any more, so the
      // demo's own cues have to carry it.
      expect(typeof cue.volume, cue.name).toBe('number')
      expect(typeof cue.pan, cue.name).toBe('number')
      expect(cue.outputs, cue.name).toBeNull()
      expect((cue as unknown as Record<string, unknown>).media).toEqual({
        path: cue.filePath,
        // No last-known absolute: the demo's audio ships beside the show on every machine,
        // and a path recorded here would only be the machine that regenerated the file.
        originalPath: ''
      })
    }

    const script = workspace.cues.find((cue): cue is ScriptCue => cue.type === 'script')
    expect(typeof script?.timeout).toBe('number')
  })

  it('opens with nothing to repair and saves back the bytes it was opened with', async () => {
    // The demo as the File menu opens it: read out of the app's resources, its audio copied
    // into userData, and each cue re-pointed at the copy. The save writes the pair's route
    // back unchanged — it names the file the session resolved, so nothing about where the
    // show points moved — and the file it writes is the file it opened, byte for byte.
    // `demoSourceDir` reads the packaged build's extra-resource folder, so the packaged
    // branch is the one driven here, with `process.resourcesPath` put back as it was found.
    const resources = join(workDir, 'resources')
    const shippedDir = join(resources, 'demo')
    await mkdir(shippedDir, { recursive: true })
    const shippedShow = join(shippedDir, 'Demo Show.cuerunner')
    copyFileSync(join(demoDir, 'Demo Show.cuerunner'), shippedShow)
    copyFileSync(join(demoDir, 'walk-in.wav'), join(shippedDir, 'walk-in.wav'))
    const shipped = readFileSync(shippedShow, 'utf-8')

    const runtimePaths = process as unknown as { resourcesPath?: string }
    const hadResourcesPath = Object.prototype.hasOwnProperty.call(process, 'resourcesPath')
    const wasPackaged = runtimePaths.resourcesPath
    runtimePaths.resourcesPath = resources
    ends.packaged.on = true
    try {
      const opened = await openDemoWorkspace()
      const target = join(ends.userData.path, 'demo', 'Demo Show.cuerunner')
      await saveWorkspace({} as never, opened, target)

      expect(readFileSync(target, 'utf-8')).toBe(shipped)
    } finally {
      ends.packaged.on = false
      if (hadResourcesPath) runtimePaths.resourcesPath = wasPackaged
      else delete runtimePaths.resourcesPath
    }
  })
})
