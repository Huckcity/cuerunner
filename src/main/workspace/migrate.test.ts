// Migration runs in the main process on every workspace load. Electron is not
// available in the test environment, so the module is imported with it stubbed.
import { describe, it, expect, vi } from 'vitest'
import type { StopCue, AudioCue } from '../../renderer/src/types/cue'
import type { Workspace } from '../../renderer/src/types/workspace'
import { migrateWorkspace } from './WorkspaceManager'

// Hoisted above the import above, so WorkspaceManager never loads the real Electron.
vi.mock('electron', () => ({ app: {}, dialog: {}, BrowserWindow: {} }))

function workspaceWith(cues: unknown[]): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Legacy show',
    createdAt: '2024-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: cues as Workspace['cues']
  }
}

describe('migrateWorkspace', () => {
  it('gives a stop cue the wait-for-fade default it predates', () => {
    const stop = migrateWorkspace(workspaceWith([
      { id: 's1', type: 'stop', targetCueId: 'all', fadeOut: true, fadeOutDuration: 500 }
    ])).cues[0] as StopCue

    expect(stop.waitForFade).toBe(false)
  })

  it('keeps an explicit wait-for-fade', () => {
    const stop = migrateWorkspace(workspaceWith([
      { id: 's1', type: 'stop', targetCueId: 'all', fadeOut: true, fadeOutDuration: 500, waitForFade: true }
    ])).cues[0] as StopCue

    expect(stop.waitForFade).toBe(true)
  })

  it('drops the retired per-output device and channel-pair fields', () => {
    const audio = migrateWorkspace(workspaceWith([
      {
        id: 'a1',
        type: 'audio',
        filePath: '',
        loopCount: 0,
        playbackRate: 1,
        trim: 1,
        outputs: [{ deviceId: 'hw1', channelPair: [3, 4], volume: 0.5, pan: -0.2 }]
      }
    ])).cues[0] as AudioCue

    expect(audio.outputs[0]).toEqual({ volume: 0.5, pan: -0.2 })
  })

  it('turns a legacy childIds list into parent pointers in that order', () => {
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'sequence', childIds: ['c2', 'c1'] },
      { id: 'c1', type: 'wait', duration: 1000 },
      { id: 'c2', type: 'wait', duration: 2000 }
    ])).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'c2', 'c1'])
    expect(cues.slice(1).map(c => c.parentId)).toEqual(['g1', 'g1'])
    expect((cues[0] as unknown as Record<string, unknown>).childIds).toBeUndefined()
  })
})
