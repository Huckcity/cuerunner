// The demo ships as data, so nothing type-checks the shipped .cuerunner and no compiler
// catches a cue that points at a missing parent or an audio file that is not in the
// folder. Electron is not available here, so the loader is imported with it stubbed.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import { isAbsolute, join } from 'path'
import { materialiseDemoAssets } from './demo'
import { migrateWorkspace } from './WorkspaceManager'
import type { AudioCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

vi.mock('electron', () => ({ app: {}, dialog: {}, BrowserWindow: {} }))

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

function loadDemo(raw: string): Workspace {
  return migrateWorkspace(JSON.parse(raw) as Workspace)
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
  it('loads, with every reference inside it resolving', async () => {
    const workspace = loadDemo(await readDemo())

    expect(workspace.name).toBe('Demo Show')
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
})
