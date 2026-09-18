// Migration runs in the main process on every workspace load. Electron is not
// available in the test environment, so the module is imported with it stubbed.
import { describe, it, expect, vi } from 'vitest'
import type { StopCue, AudioCue, ScriptCue } from '../../shared/cue'
import type { LoadNote, Workspace } from '../../shared/workspace'
import { CHANNEL_START_COUNT } from '../../shared/show'
import { Refusal } from '../ipc/refusal'
import { migrateWorkspace, serialiseWorkspace } from './WorkspaceManager'

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
    // worse — a show saved back without it is a show with a cue missing. It is a marked
    // refusal rather than a plain error, so the load channels answer it as a value.
    const fromANewerBuild = workspaceWith([
      { id: 'w1', type: 'wait', duration: 1000 },
      { id: 'v1', type: 'video', filePath: 'clip.mp4' }
    ])
    expect(() => migrateWorkspace(fromANewerBuild)).toThrow(Refusal)
    expect(() => migrateWorkspace(fromANewerBuild)).toThrow('does not know (video)')
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

// The grouping repair: array order is the running order, a group's children belong
// contiguously behind it, and a cue whose group is not in the file must still fire with
// the show. What the migration changed is reported through the notes out-array, and a
// file that needed nothing is untouched.
describe('migrateWorkspace — cue grouping', () => {
  it('leaves a well-formed file exactly as it is, with no notes', () => {
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'sequence' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g1' },
      { id: 'x1', type: 'wait', duration: 3000 }
    ])).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'c1', 'c2', 'x1'])

    // The fixed point: a repaired (here, already healthy) workspace re-normalises to
    // nothing, so a silent second repair cannot happen.
    const notes: LoadNote[] = []
    const again = migrateWorkspace({ ...workspaceWith([]), cues }, notes)
    expect(again.cues).toEqual(cues)
    expect(notes).toEqual([])
  })

  it('gathers scattered children into one block behind their group, sibling order kept', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'playlist' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' },
      { id: 'x1', type: 'wait', duration: 1000 },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g1' }
    ]), notes).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'c1', 'c2', 'x1'])
    expect(notes).toEqual([{
      cueId: 'g1',
      kind: 'reordered',
      detail: 'its children were gathered into one block behind it'
    }])
  })

  it('gathers a whole subtree, inner groups included', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'playlist' },
      { id: 'g2', type: 'group', mode: 'playlist', parentId: 'g1' },
      { id: 'c1', type: 'wait', duration: 1000 },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g2' },
      { id: 'c3', type: 'wait', duration: 3000, parentId: 'g1' }
    ]), notes).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'g2', 'c2', 'c3', 'c1'])
    expect(notes.map(note => [note.kind, note.cueId])).toEqual([
      ['reordered', 'g1'],
      ['reordered', 'g2']
    ])
  })

  it('returns an orphan to the top level, keeping its place among the top-level cues', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'sequence' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' },
      { id: 'o1', type: 'wait', duration: 500, parentId: 'gone' },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g1' },
      { id: 'x1', type: 'wait', duration: 1000 }
    ]), notes).cues

    // The orphan was between c1 and c2; the gathered block goes where it now belongs, so
    // the orphan lands behind it, before x1. What is kept is the relative order of the
    // top-level cues, not the slot the orphan had inside the block it interrupted.
    expect(cues.map(c => c.id)).toEqual(['g1', 'c1', 'c2', 'o1', 'x1'])
    expect(cues[3].parentId).toBeNull()
    // Pass order: every missing-group note, then every cycle note, then every reordered.
    expect(notes.map(note => [note.kind, note.cueId])).toEqual([
      ['missing-group', 'o1'],
      ['reordered', 'g1']
    ])
    expect(notes[0].detail).toBe('it has no group in this file: still fires with the show, at the top level')
  })

  it('returns a cue whose parent is not a group to the top level', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'w1', type: 'wait', duration: 1000 },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'w1' }
    ]), notes).cues

    expect(cues.map(c => [c.id, c.parentId])).toEqual([['w1', null], ['c1', null]])
    expect(notes).toEqual([{
      cueId: 'c1',
      kind: 'missing-group',
      detail: 'it has no group in this file: still fires with the show, at the top level'
    }])
  })

  it('dissolves a loop of groups and completes the load', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'a', type: 'group', mode: 'sequence', parentId: 'b' },
      { id: 'b', type: 'group', mode: 'sequence', parentId: 'a' },
      { id: 'c', type: 'wait', duration: 1000, parentId: 'b' }
    ]), notes).cues

    // Both loop members return to the top level; the cue hanging under b was never in
    // the loop and keeps its parent.
    expect(cues.map(c => [c.id, c.parentId])).toEqual([['a', null], ['b', null], ['c', 'b']])
    expect(notes.map(note => [note.kind, note.cueId])).toEqual([
      ['cycle', 'a'],
      ['cycle', 'b']
    ])
    expect(notes[0].detail).toBe('in a loop of groups: returned to the top level')
  })

  it('treats a group that names itself as a loop of one', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'sequence', parentId: 'g1' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' }
    ]), notes).cues

    expect(cues.map(c => [c.id, c.parentId])).toEqual([['g1', null], ['c1', 'g1']])
    expect(notes.map(note => [note.kind, note.cueId])).toEqual([['cycle', 'g1']])
  })

  it('gathers a timeline group’s children without touching their offsets', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'timeline' },
      { id: 'c2', type: 'audio', filePath: '', timelineOffset: 5000, parentId: 'g1' },
      { id: 'x1', type: 'wait', duration: 1000 },
      { id: 'c1', type: 'audio', filePath: '', timelineOffset: 0, parentId: 'g1' }
    ]), notes).cues

    // Array order is kept exactly as it was — the gather never sorts by timelineOffset,
    // which is the timeline's own authority.
    expect(cues.map(c => c.id)).toEqual(['g1', 'c2', 'c1', 'x1'])
    expect((cues[1] as AudioCue).timelineOffset).toBe(5000)
    expect((cues[2] as AudioCue).timelineOffset).toBe(0)
    expect(notes.map(note => note.kind)).toEqual(['reordered'])
  })

  it('converts a legacy childIds file without calling the healthy tree damage', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'sequence', childIds: ['c2', 'c1'] },
      { id: 'c1', type: 'wait', duration: 1000 },
      { id: 'c2', type: 'wait', duration: 2000 }
    ]), notes).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'c2', 'c1'])
    expect(notes).toEqual([])
  })

  it('keeps every cue of a file whose id repeats, on load and on save', () => {
    const notes: LoadNote[] = []
    const workspace = migrateWorkspace(workspaceWith([
      { id: 'g1', type: 'group', mode: 'playlist' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g1' },
      { id: 'g1', type: 'group', mode: 'playlist' }
    ]), notes)

    // The gather emits by cue identity: the repeated id is neither dropped nor re-emitted
    // under the second occurrence, so the count survives — and no repair is claimed for a
    // duplicate id.
    expect(workspace.cues).toHaveLength(4)
    expect(workspace.cues.map(c => c.id)).toEqual(['g1', 'c1', 'c2', 'g1'])
    expect(notes).toEqual([])

    const written = JSON.parse(serialiseWorkspace(workspace, '/shows')) as { cues: Array<{ id: string }> }
    expect(written.cues).toHaveLength(4)
    expect(written.cues.map(cue => cue.id)).toEqual(['g1', 'c1', 'c2', 'g1'])
  })

  it('writes the repair once: the saved show reopens with no notes and the same bytes', () => {
    const loading: LoadNote[] = []
    const damaged = workspaceWith([
      { id: 'g1', type: 'group', mode: 'playlist' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' },
      { id: 'x1', type: 'wait', duration: 1000 },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g1' }
    ])
    const repaired = migrateWorkspace(damaged, loading)
    expect(loading.map(note => note.kind)).toEqual(['reordered'])

    // What a save writes is a healthy file: the next open has nothing to say about it,
    // and writing it again puts the same bytes back.
    const first = serialiseWorkspace(repaired, '/shows')
    const reopened: LoadNote[] = []
    const again = migrateWorkspace(JSON.parse(first) as Workspace, reopened)
    expect(reopened).toEqual([])
    expect(serialiseWorkspace(again, '/shows')).toBe(first)
  })

  it('takes the same damaged bytes to the same notes every time', () => {
    // A file nobody saves is read the same way twice: loading never repairs the file
    // itself, so the same damage comes back with the same report.
    const bytes = JSON.stringify(workspaceWith([
      { id: 'g1', type: 'group', mode: 'playlist' },
      { id: 'c1', type: 'wait', duration: 1000, parentId: 'g1' },
      { id: 'x1', type: 'wait', duration: 1000 },
      { id: 'c2', type: 'wait', duration: 2000, parentId: 'g1' }
    ]))
    const first: LoadNote[] = []
    const second: LoadNote[] = []
    migrateWorkspace(JSON.parse(bytes) as Workspace, first)
    migrateWorkspace(JSON.parse(bytes) as Workspace, second)

    expect(second).toEqual(first)
    expect(first.map(note => [note.kind, note.cueId])).toEqual([['reordered', 'g1']])
  })
})
