// Migration runs in the main process on every workspace load. Electron is not
// available in the test environment, so the module is imported with it stubbed.
import { describe, it, expect, vi } from 'vitest'
import type { StopCue, AudioCue, ScriptCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'
import { CHANNEL_START_COUNT } from '../../shared/show'
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
  it('refuses a cue type this build does not know rather than losing the window to it', () => {
    // A file from a newer build, or a hand edit: the row renders its icon from the type,
    // and an unknown one takes the whole window down. Dropping the cue quietly would be
    // worse — a show saved back without it is a show with a cue missing.
    expect(() => migrateWorkspace(workspaceWith([
      { id: 'w1', type: 'wait', duration: 1000 },
      { id: 'v1', type: 'video', filePath: 'clip.mp4' }
    ]))).toThrow('does not know (video)')
  })

  it('accepts every cue type this build does know', () => {
    expect(() => migrateWorkspace(workspaceWith([
      { id: 'w1', type: 'wait', duration: 1000 },
      { id: 'a1', type: 'audio', filePath: '' },
      { id: 'g1', type: 'group', mode: 'sequence' }
    ]))).not.toThrow()
  })

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

  it('reads a cue saved before silence trimming as not trimming', () => {
    const audio = migrateWorkspace(workspaceWith([
      { id: 'a1', type: 'audio', filePath: '', loopCount: 0, playbackRate: 1, trim: 1, outputs: null }
    ])).cues[0] as AudioCue

    expect(audio.trimSilence).toBe(false)
    // Nothing measured the file a show was written before this existed with, and a load
    // does not start reading files on somebody's behalf.
    expect(audio.soundRegion).toBeUndefined()
  })

  it('keeps a cue that was saved trimming its silence, and the measurement with it', () => {
    const soundRegion = { startMs: 400, endMs: 3100, durationMs: 9000, silent: false }
    const audio = migrateWorkspace(workspaceWith([
      { id: 'a1', type: 'audio', filePath: '', loopCount: 0, playbackRate: 1, trim: 1, outputs: null, trimSilence: true, soundRegion }
    ])).cues[0] as AudioCue

    expect(audio.trimSilence).toBe(true)
    expect(audio.soundRegion).toEqual(soundRegion)
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

  it('carries a performer over from the plot, patched to the strip that now holds their DCA', () => {
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

    const cast = workspace.showSettings?.cast
    // The desk routing the performer carried is now their channel strip: a strip named
    // after them, assigned to the DCA that used to be on the performer.
    expect(cast?.performers).toEqual([
      { id: 'p1', name: 'Ada', role: 'Lead', notes: '', channelId: cast?.channels[0].id }
    ])
    expect(cast?.channels[0]).toMatchObject({ name: 'Ada', dcaId: 'dca1' })
    // ...and the rest of the console comes with it, so the show lands set up rather than
    // half set up.
    expect(cast?.channels).toHaveLength(CHANNEL_START_COUNT)
    expect(cast?.channels.slice(1).every(channel => channel.dcaId === null && channel.name === ''))
      .toBe(true)
    expect(cast?.dcas.map(dca => dca.id)).toEqual(['dca1'])
    expect(cast?.ensembles).toEqual([])
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

    // Pack 2 was nobody's, so the scene it was open in only remembers Pack 1's wearer —
    // and a scene that predates ensembles has none applied and closes none of them.
    expect(workspace.showSettings?.scenes.list).toEqual([
      { id: 's1', name: 'Opening', live: ['p1'], ensembles: [], excluded: [], notes: '' }
    ])
  })

  it('moves desk routing off performers and ensembles onto the strips that carry it', () => {
    // The shape the previous build wrote: the DCA was on the performer, or on the
    // ensemble they were a member of, and membership was a pointer on each performer.
    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: {
        cast: {
          groups: [
            { id: 'dca1', label: 'DCA 1 — Principals', mute: null, unmute: null },
            { id: 'dca2', label: 'DCA 2 — Chorus', mute: null, unmute: null }
          ],
          performers: [
            { id: 'p1', name: 'Ada', role: 'Lead', notes: '', ensembleId: null, deskChannelId: 'dca1' },
            { id: 'p2', name: 'Nell', role: 'Chorus', notes: '', ensembleId: 'e1', deskChannelId: null },
            { id: 'p3', name: 'Sam', role: 'Swing', notes: '', ensembleId: null, deskChannelId: null }
          ],
          ensembles: [{ id: 'e1', name: 'Chorus', deskChannelId: 'dca2' }]
        },
        scenes: { list: [] }
      } as unknown as Workspace['showSettings']
    })

    const cast = workspace.showSettings?.cast
    expect(cast?.dcas.map(dca => dca.id)).toEqual(['dca1', 'dca2'])
    // The chorus's DCA came across on the members it was carrying, not on the ensemble.
    expect(cast?.channels.map(channel => [channel.name, channel.dcaId])).toEqual([
      ['Ada', 'dca1'],
      ['Nell', 'dca2'],
      ['', null],
      ['', null],
      ['', null],
      ['', null],
      ['', null],
      ['', null],
      ['', null],
      ['', null],
      ['', null],
      ['', null]
    ])
    expect(cast?.performers.map(performer => performer.channelId)).toEqual([
      cast?.channels[0].id, cast?.channels[1].id, null
    ])
    expect(cast?.ensembles).toEqual([{ id: 'e1', name: 'Chorus', members: ['p2'] }])
    expect((cast as unknown as Record<string, unknown>).groups).toBeUndefined()
    // A show that had DCAs and drove none of them is left driving none: the derived
    // messages are the default for a show that has never been told otherwise.
    expect(workspace.showSettings?.desk.kind).toBe('none')
  })

  it('reads the desk connection back off the DCAs an older build patched', () => {
    // One connection per show now, so the pattern comes from the first patched DCA — its
    // own number swapped for {n} — and every one of them keeps what it sent as an
    // override: a show does not start sending somewhere else because the app changed.
    const osc = (address: string) => ({
      kind: 'osc', host: '10.0.0.5', port: 9000, address, args: [1]
    })
    const closed = (address: string) => ({
      kind: 'osc', host: '10.0.0.5', port: 9000, address, args: [0]
    })

    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: {
        cast: {
          dcas: [
            { id: 'dca1', label: 'DCA 1', unmute: osc('/dca/1/mute'), mute: closed('/dca/1/mute') },
            { id: 'dca2', label: 'DCA 2', unmute: osc('/show/interval'), mute: closed('/show/interval') }
          ],
          performers: [],
          ensembles: [],
          channels: []
        },
        scenes: { list: [] }
      } as unknown as Workspace['showSettings']
    })

    expect(workspace.showSettings?.desk).toMatchObject({
      kind: 'osc',
      host: '10.0.0.5',
      port: 9000,
      address: '/dca/{n}/mute'
    })
    expect(workspace.showSettings?.cast.dcas.map(dca => dca.address))
      .toEqual(['/dca/1/mute', '/show/interval'])
    // The messages themselves are gone: what a DCA sends is derived or overridden, never
    // carried as a pair.
    expect((workspace.showSettings?.cast.dcas[0] as unknown as Record<string, unknown>).unmute)
      .toBeUndefined()
  })

  it('reads a MIDI show’s port and channel back the same way', () => {
    const note = (kind: 'noteOn' | 'noteOff', note: number) => ({
      kind: 'midi', portName: 'Yamaha', message: { kind, channel: 3, note, velocity: 0 }
    })

    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: {
        cast: {
          dcas: [
            { id: 'dca1', label: 'DCA 1', unmute: note('noteOn', 60), mute: note('noteOff', 60) },
            { id: 'dca2', label: 'DCA 2', unmute: note('noteOn', 2), mute: note('noteOff', 2) }
          ],
          performers: [],
          ensembles: [],
          channels: []
        },
        scenes: { list: [] }
      } as unknown as Workspace['showSettings']
    })

    expect(workspace.showSettings?.desk).toMatchObject({
      kind: 'midi',
      midiPort: 'Yamaha',
      midiChannel: 3
    })
    expect(workspace.showSettings?.cast.dcas.map(dca => dca.note)).toEqual([60, 2])
  })

  it('leaves a console that has already been set up exactly as it was found', () => {
    // A show whose operator removed every strip is a console with nothing on it, not a
    // show that has not been set up yet: the twelve a new show starts with must not
    // come back on the next load.
    const workspace = migrateWorkspace({
      ...workspaceWith([]),
      showSettings: {
        cast: {
          channels: [],
          performers: [{ id: 'p1', name: 'Ada', role: 'Lead', notes: '', channelId: null }],
          ensembles: [],
          dcas: []
        },
        scenes: { list: [] }
      } as unknown as Workspace['showSettings']
    })

    expect(workspace.showSettings?.cast.channels).toEqual([])
    expect(workspace.showSettings?.cast.dcas).toEqual([])
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
