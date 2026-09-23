// The load funnel runs in the main process on every workspace load, and what it does
// now is check a file's shape rather than migrate one: what this build wrote, it reads;
// what it does not know, it refuses by name. Electron is not available in the test
// environment, so the module is imported with it stubbed.
import { describe, it, expect, vi } from 'vitest'
import type { AudioCue, CueBase, GroupCue, WaitCue } from '../../shared/cue'
import type { LoadNote, Workspace } from '../../shared/workspace'
import { defaultShowSettings } from '../../shared/show'
import { Refusal } from '../ipc/refusal'
import { migrateWorkspace, serialiseWorkspace } from './WorkspaceManager'

// Hoisted above the import above, so WorkspaceManager never loads the real Electron.
vi.mock('electron', () => ({ app: {}, dialog: {}, BrowserWindow: {} }))

/** The file a fixture's bytes are said to have come from, as a refusal names it. */
const SHOW = '/shows/Press Night.cuerunner'

function workspaceWith(cues: unknown[]): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Press Night',
    createdAt: '2024-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: cues as Workspace['cues']
  }
}

/** One cue's own fields, from `CueBase`: what every cue of a file this build wrote carries. */
function baseCue(id: string): Omit<CueBase, 'triggers' | 'refire' | 'scriptLine'> {
  return {
    id,
    number: id,
    name: id,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: ''
  }
}

/**
 * A cue as this build writes one: the base every cue carries, and the fields a case is about
 * on top. The documents here are files this build could have written — the shape check
 * refuses a cue missing a field its type requires, which has cases of its own below — so
 * nothing here is a cue with fields missing, and the fields the types mark `?:` are left out
 * on purpose: a cue without them is this build's own shape too.
 */
function wait(id: string, over: Partial<WaitCue> = {}): WaitCue {
  return { ...baseCue(id), type: 'wait', ...over }
}

function group(id: string, over: Partial<GroupCue> = {}): GroupCue {
  return { ...baseCue(id), type: 'group', mode: 'playlist', ...over }
}

function audio(id: string, over: Partial<AudioCue> = {}): AudioCue {
  return {
    ...baseCue(id),
    type: 'audio',
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 0,
    ...over
  }
}

/** A workspace with no version key at all: the literal this build writes is never absent. */
function workspaceWithMissingVersion(): Workspace {
  const workspace = workspaceWith([]) as unknown as Record<string, unknown>
  delete workspace.version
  return workspace as unknown as Workspace
}

describe('migrateWorkspace', () => {
  it('refuses a cue type this build does not know rather than losing the window to it', () => {
    // A file from a newer build, or a hand edit: the row renders its icon from the type,
    // and an unknown one takes the whole window down. Dropping the cue quietly would be
    // worse — a show saved back without it is a show with a cue missing. It is a marked
    // refusal rather than a plain error, so the load channels answer it as a value, and the
    // sentence says which file it came out of.
    const fromANewerBuild = workspaceWith([
      wait('w1', { duration: 1000 }),
      { id: 'v1', type: 'video', filePath: 'clip.mp4' }
    ])
    expect(() => migrateWorkspace(fromANewerBuild, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(fromANewerBuild, SHOW)).toThrow(
      'that show has a cue this version of WinsLab does not know (video)' +
      ` — ${SHOW} was probably saved by a newer version`
    )
  })

  it('accepts a cue of a type this build does know', () => {
    expect(() => migrateWorkspace(workspaceWith([
      wait('w1', { duration: 1000 }),
      audio('a1', { filePath: '' }),
      group('g1', { mode: 'sequence' })
    ]), SHOW)).not.toThrow()
  })
})

describe('the shape check', () => {
  it('refuses a top-level section this build does not declare', () => {
    // A file from a newer build — or another tool's export — with a section this build has
    // never heard of. Reading it would keep the section invisible or drop it on the next
    // save, so the file is refused instead.
    const fromANewerBuild = { ...workspaceWith([]), futureSection: { cues: [] } } as unknown as Workspace

    expect(() => migrateWorkspace(fromANewerBuild, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(fromANewerBuild, SHOW)).toThrow(
      'that show has a section this version of WinsLab does not know (futureSection)' +
      ` — ${SHOW} was probably saved by a newer version`
    )
  })

  it('refuses a settings section this build does not declare', () => {
    const settings = { ...defaultShowSettings(), plot: {} } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have a section this version of WinsLab does not know (plot)' +
      ` — ${SHOW} was probably saved by a newer version`
    )
  })

  it('refuses settings that leave out a section this build writes, naming the one', () => {
    // The load no longer fills a section in. A file that carries settings and is missing
    // one of them is a file this build cannot read, and the sentence says which is absent
    // — "desk" is the first the declaration names without one.
    const settings = {
      oscIn: { enabled: true, port: 53000 },
      midiIn: { enabled: false, portNames: [] }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have no desk section, which this version of WinsLab writes' +
      ` — ${SHOW} was probably saved by an older build`
    )
  })

  it('refuses settings that are not a section per setting at all', () => {
    // A `showSettings` that is there and is not an object took the check down with V8's own
    // text — `Object.keys(null)`, or the `in` operator on a number — which the window answers
    // as a fault rather than the sentence every load refusal is. Each value is named, so the
    // operator can see what the file carried there.
    for (const carried of [null, 7, true, 'oscIn', ['oscIn']]) {
      const document = { ...workspaceWith([]), showSettings: carried } as unknown as Workspace

      expect(() => migrateWorkspace(document, SHOW), String(carried)).toThrow(Refusal)
      expect(() => migrateWorkspace(document, SHOW)).toThrow(
        'that show’s settings are not the sections this version of WinsLab writes'
      )
      expect(() => migrateWorkspace(document, SHOW)).toThrow(SHOW)
    }
    expect(() => migrateWorkspace(
      { ...workspaceWith([]), showSettings: null } as unknown as Workspace,
      SHOW
    )).toThrow(`${SHOW} carries nothing instead`)
  })

  it('refuses a version literal other than the one this build writes, naming its value', () => {
    const newer = { ...workspaceWith([]), version: 2 } as unknown as Workspace
    const aString = { ...workspaceWith([]), version: '1' } as unknown as Workspace

    expect(() => migrateWorkspace(newer, SHOW)).toThrow(
      `that show says version 2 and this build writes version 1 — ${SHOW} was probably saved by another build`
    )
    // Named as JSON, so the number this build writes is told from the string a hand edit
    // may leave: `"1"` is not the literal, and a file with neither says "nothing".
    expect(() => migrateWorkspace(aString, SHOW)).toThrow('says version "1"')
    expect(() => migrateWorkspace(workspaceWithMissingVersion(), SHOW)).toThrow('says version nothing')
  })

  it('reads a file whose top level is this build’s own shape, settings or none', () => {
    const withSettings = migrateWorkspace(
      { ...workspaceWith([]), showSettings: defaultShowSettings() },
      SHOW
    )

    expect(withSettings.showSettings).toEqual(defaultShowSettings())
    // Nothing is filled in: a workspace with no settings section comes back without one,
    // and the window's own defaults are what stand in for it.
    expect(migrateWorkspace(workspaceWith([]), SHOW).showSettings).toBeUndefined()
  })

  it('leaves a cue the fields the file gave it, and invents none', () => {
    // The other half of "no fill": the cue comes back with exactly the keys it carried. The
    // fields the deleted pass used to default and this build's own shape does not require —
    // `triggers`, `refire` — stay absent rather than arriving as an empty list, while a cue
    // whose file left out a field its type requires is refused above rather than completed
    // here.
    const given = wait('w1', { duration: 1000 })
    const loaded = migrateWorkspace(workspaceWith([given]), SHOW)

    expect(Object.keys(loaded.cues[0]).sort()).toEqual(Object.keys(given).sort())
  })

  it('names the missing section before a field missing inside another one', () => {
    // The arms run in order, and the order is the sentence an operator sees: a settings
    // object that leaves a section out — the shape a file written before the show services
    // existed has — is refused for that section, whatever the sections it does carry are
    // missing inside. A file with both faults names the section, which is the bigger fact.
    const settings = {
      desk: {
        kind: 'osc',
        midiPort: '',
        midiChannel: 1,
        host: '127.0.0.1',
        port: 8000,
        tcpPort: 51325,
        address: '/dca/{n}/on',
        buttons: { go: null, back: null, goNote: null, backNote: null }
      }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have no oscIn section, which this version of WinsLab writes' +
      ` — ${SHOW} was probably saved by an older build`
    )
  })
})

// The grouping repair: array order is the running order, a group's children belong
// contiguously behind it, and a cue whose group is not in the file must still fire with
// the show. What the load repaired is reported through the notes out-array, and a file
// that needed nothing is untouched.
describe('migrateWorkspace — cue grouping', () => {
  it('leaves a well-formed file exactly as it is, with no notes', () => {
    const cues = migrateWorkspace(workspaceWith([
      group('g1', { mode: 'sequence' }),
      wait('c1', { duration: 1000, parentId: 'g1' }),
      wait('c2', { duration: 2000, parentId: 'g1' }),
      wait('x1', { duration: 3000 })
    ]), SHOW).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'c1', 'c2', 'x1'])

    // The fixed point: a repaired (here, already healthy) workspace re-normalises to
    // nothing, so a silent second repair cannot happen.
    const notes: LoadNote[] = []
    const again = migrateWorkspace({ ...workspaceWith([]), cues }, SHOW, notes)
    expect(again.cues).toEqual(cues)
    expect(notes).toEqual([])
  })

  it('gathers scattered children into one block behind their group, sibling order kept', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      group('g1', { mode: 'playlist' }),
      wait('c1', { duration: 1000, parentId: 'g1' }),
      wait('x1', { duration: 1000 }),
      wait('c2', { duration: 2000, parentId: 'g1' })
    ]), SHOW, notes).cues

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
      group('g1', { mode: 'playlist' }),
      group('g2', { mode: 'playlist', parentId: 'g1' }),
      wait('c1', { duration: 1000 }),
      wait('c2', { duration: 2000, parentId: 'g2' }),
      wait('c3', { duration: 3000, parentId: 'g1' })
    ]), SHOW, notes).cues

    expect(cues.map(c => c.id)).toEqual(['g1', 'g2', 'c2', 'c3', 'c1'])
    expect(notes.map(note => [note.kind, note.cueId])).toEqual([
      ['reordered', 'g1'],
      ['reordered', 'g2']
    ])
  })

  it('returns an orphan to the top level, keeping its place among the top-level cues', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      group('g1', { mode: 'sequence' }),
      wait('c1', { duration: 1000, parentId: 'g1' }),
      wait('o1', { duration: 500, parentId: 'gone' }),
      wait('c2', { duration: 2000, parentId: 'g1' }),
      wait('x1', { duration: 1000 })
    ]), SHOW, notes).cues

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
      wait('w1', { duration: 1000 }),
      wait('c1', { duration: 1000, parentId: 'w1' })
    ]), SHOW, notes).cues

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
      group('a', { mode: 'sequence', parentId: 'b' }),
      group('b', { mode: 'sequence', parentId: 'a' }),
      wait('c', { duration: 1000, parentId: 'b' })
    ]), SHOW, notes).cues

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
      group('g1', { mode: 'sequence', parentId: 'g1' }),
      wait('c1', { duration: 1000, parentId: 'g1' })
    ]), SHOW, notes).cues

    expect(cues.map(c => [c.id, c.parentId])).toEqual([['g1', null], ['c1', 'g1']])
    expect(notes.map(note => [note.kind, note.cueId])).toEqual([['cycle', 'g1']])
  })

  it('gathers a timeline group’s children without touching their offsets', () => {
    const notes: LoadNote[] = []
    const cues = migrateWorkspace(workspaceWith([
      group('g1', { mode: 'timeline' }),
      audio('c2', { timelineOffset: 5000, parentId: 'g1' }),
      wait('x1', { duration: 1000 }),
      audio('c1', { timelineOffset: 0, parentId: 'g1' })
    ]), SHOW, notes).cues

    // Array order is kept exactly as it was — the gather never sorts by timelineOffset,
    // which is the timeline's own authority.
    expect(cues.map(c => c.id)).toEqual(['g1', 'c2', 'c1', 'x1'])
    expect((cues[1] as AudioCue).timelineOffset).toBe(5000)
    expect((cues[2] as AudioCue).timelineOffset).toBe(0)
    expect(notes.map(note => note.kind)).toEqual(['reordered'])
  })

  it('keeps every cue of a file whose id repeats, on load and on save', () => {
    const notes: LoadNote[] = []
    const workspace = migrateWorkspace(workspaceWith([
      group('g1', { mode: 'playlist' }),
      wait('c1', { duration: 1000, parentId: 'g1' }),
      wait('c2', { duration: 2000, parentId: 'g1' }),
      group('g1', { mode: 'playlist' })
    ]), SHOW, notes)

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
      group('g1', { mode: 'playlist' }),
      wait('c1', { duration: 1000, parentId: 'g1' }),
      wait('x1', { duration: 1000 }),
      wait('c2', { duration: 2000, parentId: 'g1' })
    ])
    const repaired = migrateWorkspace(damaged, SHOW, loading)
    expect(loading.map(note => note.kind)).toEqual(['reordered'])

    // What a save writes is a healthy file: the next open has nothing to say about it,
    // and writing it again puts the same bytes back.
    const first = serialiseWorkspace(repaired, '/shows')
    const reopened: LoadNote[] = []
    const again = migrateWorkspace(JSON.parse(first) as Workspace, SHOW, reopened)
    expect(reopened).toEqual([])
    expect(serialiseWorkspace(again, '/shows')).toBe(first)
  })

  it('takes the same damaged bytes to the same notes every time', () => {
    // A file nobody saves is read the same way twice: loading never repairs the file
    // itself, so the same damage comes back with the same report.
    const bytes = JSON.stringify(workspaceWith([
      group('g1', { mode: 'playlist' }),
      wait('c1', { duration: 1000, parentId: 'g1' }),
      wait('x1', { duration: 1000 }),
      wait('c2', { duration: 2000, parentId: 'g1' })
    ]))
    const first: LoadNote[] = []
    const second: LoadNote[] = []
    migrateWorkspace(JSON.parse(bytes) as Workspace, SHOW, first)
    migrateWorkspace(JSON.parse(bytes) as Workspace, SHOW, second)

    expect(second).toEqual(first)
    expect(first.map(note => [note.kind, note.cueId])).toEqual([['reordered', 'g1']])
  })
})
