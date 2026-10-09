// A show saved before a fade or a stop could name several cues, and before an OSC cue could send
// several messages, opens as it stands and saves the bytes it was opened with: the one target
// and the one message are read as lists of one (`shared/cueTargets.ts`) without the file being
// rewritten. The show's OSC patches are an optional section of their own, read field by field.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { migrateWorkspace, openWorkspaceFromPath, saveWorkspace } from './WorkspaceManager'
import { serialiseWorkspace } from './serialise'
import { fadeTargetIds, oscMessages, stopTargetIds } from '../../shared/cueTargets'
import type { FadeCue, OscCue, StopCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const userData = mkdtempSync(join(tmpdir(), 'feat-control-osc-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: {}
  }
})

const base = {
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
  advance: 'none', isArmed: true, notes: ''
}

/** A show as the build before lists wrote it: one target, one message, on the cue itself. */
const legacy = (): Workspace => ({
  version: 1,
  id: 'w-legacy-targets',
  name: 'Press Night',
  createdAt: '2026-01-01T00:00:00.000Z',
  audioSettings: { outputDeviceId: 'default' },
  midiSettings: { outputPortName: '' },
  triggerGuard: { windowMs: 300 },
  cues: [
    { ...base, id: 'w1', number: '1', name: 'Hold', type: 'wait', duration: 5000 },
    { ...base, id: 'f1', number: '2', name: 'Fade hold', type: 'fade', duration: 3000, targetCueId: 'w1', fadeProperty: 'volume', targetValue: 0, curve: 'linear', stopTargetWhenDone: true },
    { ...base, id: 's1', number: '3', name: 'Stop hold', type: 'stop', targetCueId: 'w1', fadeOut: false, fadeOutDuration: 500, waitForFade: false },
    { ...base, id: 's2', number: '4', name: 'Stop all', type: 'stop', targetCueId: 'all', fadeOut: true, fadeOutDuration: 500, waitForFade: false },
    { ...base, id: 'o1', number: '5', name: 'Desk GO', type: 'osc', host: '10.0.0.30', port: 8000, address: '/eos/key/go', args: [{ type: 'i', value: 1 }] }
  ]
} as unknown as Workspace)

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'feat-control-osc-'))
  file = join(dir, 'Press Night.cuerunner')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function openAndSave(): Promise<{ bytes: string; workspace: Workspace }> {
  const { workspace } = await openWorkspaceFromPath(file)
  await saveWorkspace({} as never, workspace, file)
  return { bytes: readFileSync(file, 'utf-8'), workspace }
}

describe('a show saved before a cue could name several', () => {
  it('opens with its one target and its one message read as lists of one', async () => {
    writeFileSync(file, serialiseWorkspace(legacy(), dir))
    const { workspace } = await openWorkspaceFromPath(file)
    const byId = new Map(workspace.cues.map(cue => [cue.id, cue]))
    expect(fadeTargetIds(byId.get('f1') as FadeCue)).toEqual(['w1'])
    expect(stopTargetIds(byId.get('s1') as StopCue)).toEqual(['w1'])
    expect(stopTargetIds(byId.get('s2') as StopCue)).toBe('all')
    expect(oscMessages(byId.get('o1') as OscCue)).toEqual([
      { patchId: '', host: '10.0.0.30', port: 8000, address: '/eos/key/go', args: [{ type: 'i', value: 1 }] }
    ])
    // Nothing was rewritten on the way in.
    expect('targetCueIds' in (byId.get('f1') as object)).toBe(false)
    expect('messages' in (byId.get('o1') as object)).toBe(false)
  })

  it('saves the bytes it was opened with, and is a fixed point from there', async () => {
    const written = serialiseWorkspace(legacy(), dir)
    writeFileSync(file, written)
    const { bytes: first } = await openAndSave()
    expect(first).toBe(written)
    expect((await openAndSave()).bytes).toBe(written)
    // No patches section appears: a show with none writes none.
    expect('oscPatches' in JSON.parse(first)).toBe(false)
  })

  it('opens a show that carries the lists, and a cue that carries both spellings reads the list', async () => {
    const show = legacy()
    const fade = show.cues[1] as FadeCue
    fade.targetCueIds = ['w1', 'gone']
    writeFileSync(file, serialiseWorkspace(show, dir))
    const { workspace } = await openWorkspaceFromPath(file)
    expect(fadeTargetIds(workspace.cues[1] as FadeCue)).toEqual(['w1', 'gone'])
  })

  it('refuses a list of the wrong kind with a sentence, rather than a fault later', () => {
    const show = legacy()
    ;(show.cues[1] as unknown as Record<string, unknown>).targetCueIds = 'w1'
    expect(() => migrateWorkspace(show, 'the test file')).toThrow(/targetCueIds/)
    const osc = legacy()
    ;(osc.cues[4] as unknown as Record<string, unknown>).messages = [{ address: '/a' }]
    expect(() => migrateWorkspace(osc, 'the test file')).toThrow(/messages/)
  })
})

describe('the show’s OSC patches', () => {
  const patched = (): Workspace => ({
    ...legacy(),
    oscPatches: [
      { id: 'p-desk', name: 'Lighting desk', host: '10.0.0.30', port: 8000 },
      { id: 'p-video', name: 'Video', host: '10.0.0.40', port: 9000 }
    ]
  })

  it('travel through a save in their declared place, after the timecode and before the cues', async () => {
    const written = serialiseWorkspace(patched(), dir)
    writeFileSync(file, written)
    const { bytes, workspace } = await openAndSave()
    expect(bytes).toBe(written)
    expect(workspace.oscPatches).toEqual(patched().oscPatches)
    const keys = Object.keys(JSON.parse(bytes))
    expect(keys.indexOf('oscPatches')).toBe(keys.indexOf('cues') - 1)
  })

  it('refuse a section this build did not write: a missing field, a port past UDP’s, two under one id', () => {
    const refuse = (mutate: (patches: Record<string, unknown>[]) => void, pattern: RegExp): void => {
      const show = patched()
      mutate(show.oscPatches as unknown as Record<string, unknown>[])
      expect(() => migrateWorkspace(show, 'the test file')).toThrow(pattern)
    }
    refuse(patches => { delete patches[0].host }, /host/)
    refuse(patches => { patches[0].port = 70000 }, /from 1 to 65535/)
    refuse(patches => { patches[1].id = 'p-desk' }, /two OSC patches under one id \(p-desk\)/)
    refuse(patches => { patches[0].colour = 'red' }, /colour/)
    const notAList = patched() as unknown as Record<string, unknown>
    notAList.oscPatches = { id: 'p' }
    expect(() => migrateWorkspace(notAList as unknown as Workspace, 'the test file')).toThrow(/oscPatches/)
  })
})
