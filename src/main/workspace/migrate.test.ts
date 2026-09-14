// Migration runs in the main process on every workspace load. Electron is not
// available in the test environment, so the module is imported with it stubbed.
import { describe, it, expect, vi } from 'vitest'
import type { StopCue, AudioCue, ScriptCue } from '../../renderer/src/types/cue'
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

  it('gives a script cue the timeout it predates, and keeps one that is set', () => {
    const [legacy, explicit] = migrateWorkspace(workspaceWith([
      { id: 'sc1', type: 'script', language: 'javascript', script: 'console.log(1)' },
      { id: 'sc2', type: 'script', language: 'javascript', script: 'console.log(2)', timeout: 0 }
    ])).cues as ScriptCue[]

    expect(legacy.timeout).toBe(60000)
    expect(explicit.timeout).toBe(0)
  })

  it('migrates a legacy outputs list to the cue master level and pan', () => {
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

    // Only the first legacy output ever reached the audio graph, so that is what the
    // cue's master level and pan become, and the dead device routing is dropped.
    expect(audio.volume).toBe(0.5)
    expect(audio.pan).toBe(-0.2)
    expect(audio.outputs).toBeNull()
  })

  it('reads a legacy empty outputs list as automatic routing, not silence', () => {
    const audio = migrateWorkspace(workspaceWith([
      { id: 'a1', type: 'audio', filePath: '', loopCount: 0, playbackRate: 1, trim: 1, outputs: [] }
    ])).cues[0] as AudioCue

    expect(audio.volume).toBe(1)
    expect(audio.pan).toBe(0)
    expect(audio.outputs).toBeNull()
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

  it('gives a workspace that predates the show services their listener defaults', () => {
    const workspace = migrateWorkspace(workspaceWith([]))

    // Without this, a workspace saved before the services existed would hand each of
    // them `undefined` instead of a port to listen on and a plot to alarm against.
    expect(workspace.showSettings?.oscIn).toEqual({ enabled: true, port: 53000 })
    expect(workspace.showSettings?.midiIn).toEqual({ enabled: false, portNames: [] })
    expect(workspace.showSettings?.rf.sources).toEqual([])
    expect(workspace.showSettings?.rf.thresholds.batteryCritical).toBe(10)
  })

  it('keeps the show ports a workspace already carries, and fills the gaps around them', () => {
    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: { oscIn: { enabled: false } } as Workspace['showSettings']
    })

    expect(workspace.showSettings?.oscIn).toEqual({ enabled: false, port: 53000 })
    expect(workspace.showSettings?.midiIn).toEqual({ enabled: false, portNames: [] })
  })

  it('carries a performer over from the plot, with the desk group whichever pack fed them', () => {
    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: {
        rf: {
          plot: {
            performers: [{ id: 'p1', name: 'Ada', role: 'Lead', notes: '' }],
            packs: [
              { id: 'pack1', label: 'Pack 1', channelId: 'ch1', performerId: 'p1', notes: '', deskChannelId: 'dca1' }
            ]
          }
        },
        scenes: {
          channels: [{ id: 'dca1', label: 'DCA 1', mute: null, unmute: null }],
          list: []
        }
      } as unknown as Workspace['showSettings']
    })

    expect(workspace.showSettings?.cast.performers).toEqual([
      { id: 'p1', name: 'Ada', role: 'Lead', notes: '', ensembleId: null, deskChannelId: 'dca1' }
    ])
    expect(workspace.showSettings?.cast.groups.map(group => group.id)).toEqual(['dca1'])
    expect(workspace.showSettings?.cast.ensembles).toEqual([])
    // The old homes are gone, not left behind empty for the next load to trip over.
    expect((workspace.showSettings?.rf.plot as unknown as Record<string, unknown>).performers)
      .toBeUndefined()
    expect((workspace.showSettings?.scenes as unknown as Record<string, unknown>).channels)
      .toBeUndefined()
    expect((workspace.showSettings?.rf.plot.packs[0] as unknown as Record<string, unknown>).deskChannelId)
      .toBeUndefined()
  })

  it("turns a scene's open packs into the performers who were wearing them, dropping a spare", () => {
    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: {
        rf: {
          plot: {
            performers: [{ id: 'p1', name: 'Ada', role: 'Lead', notes: '' }],
            packs: [
              { id: 'pack1', label: 'Pack 1', channelId: 'ch1', performerId: 'p1', notes: '' },
              { id: 'pack2', label: 'Pack 2', channelId: 'ch2', performerId: null, notes: '' }
            ]
          }
        },
        scenes: {
          channels: [],
          list: [{ id: 's1', name: 'Opening', live: ['pack1', 'pack2'], notes: '' }]
        }
      } as unknown as Workspace['showSettings']
    })

    // Pack 2 was nobody's, so the scene it was open in only remembers Pack 1's wearer.
    expect(workspace.showSettings?.scenes.list).toEqual([
      { id: 's1', name: 'Opening', live: ['p1'], notes: '' }
    ])
  })

  it('migrates an older cast once, and leaves an already-migrated one alone', () => {
    const legacy = {
      ...workspaceWith([]),
      showSettings: {
        rf: {
          plot: {
            performers: [{ id: 'p1', name: 'Ada', role: 'Lead', notes: '' }],
            packs: [{ id: 'pack1', label: 'Pack 1', channelId: null, performerId: 'p1', notes: '', deskChannelId: 'dca1' }]
          }
        },
        scenes: { channels: [{ id: 'dca1', label: 'DCA 1', mute: null, unmute: null }], list: [] }
      } as unknown as Workspace['showSettings']
    }

    const once = migrateWorkspace(legacy)
    const twice = migrateWorkspace(once)

    expect(twice.showSettings?.cast).toEqual(once.showSettings?.cast)
  })
})
