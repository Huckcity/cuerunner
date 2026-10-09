// The load funnel runs in the main process on every workspace load, and what it does
// now is check a file's shape rather than migrate one: what this build wrote, it reads;
// what it does not know, it refuses by name. Electron is not available in the test
// environment, so the module is imported with it stubbed.
import { describe, it, expect, vi } from 'vitest'
import type { AudioCue, CueBase, GroupCue, MidiCue, NetworkCue, OscCue, WaitCue } from '../../shared/cue'
import type { LoadNote, Workspace } from '../../shared/workspace'
import { defaultShowSettings } from '../../shared/show'
import { Refusal } from '../ipc/refusal'
import { migrateWorkspace } from './WorkspaceManager'
import { serialiseWorkspace } from './serialise'

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

/** A MIDI cue as this build writes one: its own fields, and the messages a case is about. */
function midi(id: string, over: Partial<MidiCue> = {}): MidiCue {
  return {
    ...baseCue(id),
    type: 'midi',
    portName: '',
    messages: [{ kind: 'programChange', channel: 1, program: 12 }],
    ...over
  }
}

/** An OSC cue as this build writes one, with one argument of each kind a value may be. */
function osc(id: string, over: Partial<OscCue> = {}): OscCue {
  return {
    ...baseCue(id),
    type: 'osc',
    host: '127.0.0.1',
    port: 53000,
    address: '/lx/12',
    args: [{ type: 'i', value: 12 }, { type: 'f', value: 3.5 }, { type: 's', value: 'warm' }, { type: 'T', value: true }],
    ...over
  }
}

/**
 * A network cue as this build writes one, with the headers it carries: an open record, whose
 * field names are the operator's rather than the declaration's.
 */
function network(id: string, over: Partial<NetworkCue> = {}): NetworkCue {
  return {
    ...baseCue(id),
    type: 'network',
    method: 'POST',
    url: 'http://127.0.0.1:8080/scene',
    body: '',
    headers: { 'Content-Type': 'application/json' },
    timeout: 5000,
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
      { id: 'v1', type: 'hologram', filePath: 'clip.mp4' }
    ])
    expect(() => migrateWorkspace(fromANewerBuild, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(fromANewerBuild, SHOW)).toThrow(
      'that show has a cue this version of Cuerunner does not know (hologram)' +
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
      'that show has a section this version of Cuerunner does not know (futureSection)' +
      ` — ${SHOW} was probably saved by a newer version`
    )
  })

  it('refuses a settings section this build does not declare', () => {
    const settings = { ...defaultShowSettings(), plot: {} } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have a section this version of Cuerunner does not know (plot)' +
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
      'that show’s settings have no desk section, which this version of Cuerunner writes' +
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
        'that show’s settings are not the sections this version of Cuerunner writes'
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

  it('refuses a settings leaf carrying a value of the kind its type does not write', () => {
    // The declaration carries the kinds, so a leaf is checked as well as the fields around it:
    // `desk.midiChannel` is a number this build's services hand the desk, and a file carrying
    // `"1"` there would walk into them as a string. The sentence names the field's path, the
    // kind the file carried and the kind this build writes, in the family the object and list
    // mismatches already use.
    const settings = {
      ...defaultShowSettings(),
      desk: { ...defaultShowSettings().desk, midiChannel: '1' }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have desk.midiChannel as a string, where this version of Cuerunner writes a number' +
      ` — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses a leaf the types allow null for carrying another kind instead', () => {
    // The wrapper admits `null` and nothing else: the kind inside it is what the value is
    // checked against, so a string at a mute group refuses rather than being read as the
    // group's number by whatever asked for it.
    const settings = {
      ...defaultShowSettings(),
      desk: {
        ...defaultShowSettings().desk,
        buttons: { go: '48', back: null, goNote: null, backNote: null }
      }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have desk.buttons.go as a string, where this version of Cuerunner writes a number' +
      ` — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses a settings field inside a scene’s row, where two element indices meet', () => {
    // The path a sentence builds from two lists is the deepest one: `scenes.list[0]` and then
    // that scene's `dcas[0]`, whose `memberId` the grid resolves against the cast. A number
    // there opens nothing and says nothing about why, so the sentence names both indices.
    const settings = {
      ...defaultShowSettings(),
      scenes: {
        list: [{
          id: 's-1',
          name: 'Wedding',
          dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 3 }],
          notes: ''
        }],
        allowDuplicateAssignment: true
      }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have scenes.list.0.dcas.0.memberId as a number, ' +
      `where this version of Cuerunner writes a string — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses a list of primitives that is not a list, naming what the list carries', () => {
    // A list of primitives is the other leaf the declaration tags: a number where the list
    // should be is the shape a file from another build would carry, and the sentence says what
    // this build writes there rather than leaving the window to iterate it.
    const settings = {
      ...defaultShowSettings(),
      cast: {
        ...defaultShowSettings().cast,
        ensembles: [{ id: 'e-1', name: 'Chorus', channelIds: 3 }]
      }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have cast.ensembles.0.channelIds as a number, ' +
      'where this version of Cuerunner writes a list of strings' +
      ` — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses an element of a list of primitives that is another kind, naming its index', () => {
    // The element is where a list of primitives can be wrong inside itself, so the sentence
    // names the index the file got wrong: a scene builder reading `portNames` would otherwise
    // open a port called `3`.
    const settings = {
      ...defaultShowSettings(),
      midiIn: { ...defaultShowSettings().midiIn, portNames: ['in', 3] }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: settings }, SHOW)).toThrow(
      'that show’s settings have midiIn.portNames.1 as a number, ' +
      `where this version of Cuerunner writes a string — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses null where the types do not allow it, and reads it where they do', () => {
    // `null` is legal exactly where the types allow it, so the same value is a refusal at
    // `presence.goneAfterSeconds` — a number no build writes as nothing — and this build's own
    // shape at the desk's buttons, an unpatched pack, a swap with nobody on it, a performer
    // between channels and a fader nobody has numbered. Each of those also carries a real
    // value somewhere, because a wrapper that took `null` and refused everything else would be
    // the wrong check wearing the right sentence.
    const withNull = {
      ...defaultShowSettings(),
      presence: { ...defaultShowSettings().presence, goneAfterSeconds: null }
    } as unknown as Workspace['showSettings']
    const allowed = {
      ...defaultShowSettings(),
      desk: {
        ...defaultShowSettings().desk,
        buttons: { go: 48, back: null, goNote: null, backNote: null }
      },
      rf: {
        ...defaultShowSettings().rf,
        plot: { packs: [{ id: 'pack-1', label: 'Belt pack', channelId: 'channel-1', performerId: null, notes: '' }] },
        swaps: [{ at: 0, packId: 'pack-1', packLabel: 'Belt pack', from: null, to: null }]
      },
      cast: {
        ...defaultShowSettings().cast,
        performers: [{ id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: null }],
        dcas: [{ id: 'dca-1', deskNumber: null }]
      }
    } as unknown as Workspace['showSettings']

    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: withNull }, SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace({ ...workspaceWith([]), showSettings: withNull }, SHOW)).toThrow(
      'that show’s settings have presence.goneAfterSeconds as nothing, ' +
      `where this version of Cuerunner writes a number — ${SHOW} was probably saved by another build`
    )
    const loaded = migrateWorkspace({ ...workspaceWith([]), showSettings: allowed }, SHOW).showSettings
    expect(loaded?.desk.buttons.go).toBe(48)
    expect(loaded?.desk.buttons.back).toBeNull()
    expect(loaded?.rf.plot.packs[0].channelId).toBe('channel-1')
    expect(loaded?.rf.swaps[0].to).toBeNull()
    expect(loaded?.cast.performers[0].channelId).toBeNull()
    expect(loaded?.cast.dcas[0].deskNumber).toBeNull()
  })

  it('refuses a cue field carrying a value of a kind its own type does not write', () => {
    // The cue half of the kind check, and the sentence the funnel owes where it used to
    // promise one: `messages` reaches `flatMap` on its way to the desk, so a number there was
    // a fault rather than a sentence. The walk reads the declaration and names the cue, the
    // field's path, the kind the file carried and the kind this build writes.
    const numbered = { ...midi('m1', { number: '12', name: 'Strings' }), messages: 3 }

    expect(() => migrateWorkspace(workspaceWith([numbered]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([numbered]), SHOW)).toThrow(
      'that show’s cue 12 Strings (midi) has messages as a number, ' +
      `where this version of Cuerunner writes a list of objects — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses an element of a cue’s list that is not the object its own type writes', () => {
    // A list whose elements are a union of variants is bounded at its elements: every message
    // is an object, and what a message carries — this one's controller, that one's data — is
    // not declared. An element that is not an object is refused by its index, because the
    // index is the one place the field's name does not reach.
    const numbered = { ...midi('m1', { number: '12', name: 'Strings' }), messages: [3] }

    expect(() => migrateWorkspace(workspaceWith([numbered]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([numbered]), SHOW)).toThrow(
      'that show’s cue 12 Strings (midi) has messages.0 as a number, ' +
      `where this version of Cuerunner writes an object — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses null where the declaration writes an object, naming the field or the element', () => {
    // `typeof null` is `'object'`, so a check reading the kind alone would take a null message or
    // a null header set for the object it is not. An element is named by its index and a field by
    // its path, and both sentences say what this build writes there.
    const nothing = { ...midi('m1', { number: '12', name: 'Strings' }), messages: [null] }
    const headerless = { ...network('n1', { number: '15', name: 'Trigger Video' }), headers: null }

    expect(() => migrateWorkspace(workspaceWith([nothing]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([nothing]), SHOW)).toThrow(
      'that show’s cue 12 Strings (midi) has messages.0 as nothing, ' +
      `where this version of Cuerunner writes an object — ${SHOW} was probably saved by another build`
    )
    expect(() => migrateWorkspace(workspaceWith([headerless]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([headerless]), SHOW)).toThrow(
      'that show’s cue 15 Trigger Video (network) has headers as nothing, ' +
      `where this version of Cuerunner writes an object — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses a leaf inside a cue’s list of objects, down to the element’s index', () => {
    // The deepest level the cue walk reaches: a crosspoint is an object with three numbers, and
    // a gain the desk would read as a level has to be one. The sentence names both the element
    // and the field, the way a settings list's does.
    const routed = audio('a1', {
      number: '14',
      name: 'Walk-in',
      outputs: [{ inputChannel: 0, outputChannel: 0, gain: '0' }]
    } as unknown as Partial<AudioCue>)

    expect(() => migrateWorkspace(workspaceWith([routed]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([routed]), SHOW)).toThrow(
      'that show’s cue 14 Walk-in (audio) has outputs.0.gain as a string, ' +
      `where this version of Cuerunner writes a number — ${SHOW} was probably saved by another build`
    )
  })

  it('reads slices with skipped pieces and up to the engine’s count, and refuses what no build writes', () => {
    // A skipped piece (0) is a count this build writes — a QLab show's cut bars come across as
    // them — and so is a vamp. A count per piece is the shape: one missing, a count the engine
    // would refuse at the start, markers out of order, or more markers than a start can carry
    // reach the window as a sentence here rather than as a cue that fails on GO.
    const named = { number: '1', name: 'Welcome' }
    const sliced = (slices: unknown) => audio('a1', { ...named, slices } as unknown as Partial<AudioCue>)
    const markers = (count: number) => Array.from({ length: count }, (_, i) => (i + 1) * 100)

    expect(migrateWorkspace(workspaceWith([sliced({ markers: [52, 1477, 24331], playCounts: [0, -1, 0, 1] })]), SHOW).cues[0])
      .toMatchObject({ slices: { markers: [52, 1477, 24331], playCounts: [0, -1, 0, 1] } })
    expect(() => migrateWorkspace(workspaceWith([sliced({ markers: markers(127), playCounts: Array(128).fill(1) })]), SHOW))
      .not.toThrow()

    const refusal = (slices: unknown) => () => migrateWorkspace(workspaceWith([sliced(slices)]), SHOW)
    expect(refusal({ markers: markers(128), playCounts: Array(129).fill(1) })).toThrow(
      `that show’s cue 1 Welcome (audio) has 128 slice markers, and a cue has at most 127 — ${SHOW} was probably saved by another build`
    )
    expect(refusal({ markers: [1000], playCounts: [1] })).toThrow('a slice play count missing or to spare')
    expect(refusal({ markers: [1000], playCounts: [1, -2] })).toThrow('a slice play count of -2')
    expect(refusal({ markers: [1000], playCounts: [1, 1.5] })).toThrow('a slice play count of 1.5')
    expect(refusal({ markers: [2000, 1000], playCounts: [1, 1, 1] })).toThrow('slice markers out of order')
    expect(refusal({ markers: [2000, 1000], playCounts: [1, 1, 1] })).toThrow(Refusal)
  })

  it('refuses a cue value whose type allows several kinds and carries none of them', () => {
    // One field of the saved form has no single kind: an OSC argument's value is a number, a
    // string or a boolean, and the declaration says so with the kinds it allows. A value of
    // none of them — an object here — is refused with all three named, because the sentence
    // has to say what this build writes there.
    const argued = { ...osc('o1', { number: '13', name: 'LX Cue 12' }), args: [{ type: 'i', value: {} }] }

    expect(() => migrateWorkspace(workspaceWith([argued]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([argued]), SHOW)).toThrow(
      'that show’s cue 13 LX Cue 12 (osc) has args.0.value as an object, ' +
      `where this version of Cuerunner writes a number, a string or a boolean — ${SHOW} was probably saved by another build`
    )
  })

  it('refuses null at a cue field whose own types do not allow it', () => {
    // `null` is legal exactly where a cue's types allow it: a `parentId` at the top level is
    // nothing, and a `preWait` is a number the runner waits for. The same value is read in one
    // place and refused in the other.
    const nothing = { ...midi('m1', { number: '12', name: 'Strings' }), preWait: null }

    expect(() => migrateWorkspace(workspaceWith([nothing]), SHOW)).toThrow(Refusal)
    expect(() => migrateWorkspace(workspaceWith([nothing]), SHOW)).toThrow(
      'that show’s cue 12 Strings (midi) has preWait as nothing, ' +
      `where this version of Cuerunner writes a number — ${SHOW} was probably saved by another build`
    )
  })

  it('reads a message list bounded at its elements, whatever a message carries', () => {
    // The list is a union of five variants, so what the declaration says is that every element is
    // an object — not what one carries, which no single set of fields could describe. A message
    // this build's own writers would not build, one naming only its kind and one with no fields
    // at all, therefore loads, and the cue reaches the window as the file gave it.
    const loaded = migrateWorkspace(workspaceWith([
      { ...midi('m1', { number: '12', name: 'Strings' }), messages: [{ kind: 'cc' }, {}] }
    ]), SHOW)

    expect(loaded.cues[0]).toMatchObject({ messages: [{ kind: 'cc' }, {}] })
  })

  it('reads a cue’s own kinds, and keeps the fields this build does not declare', () => {
    // The other side of the cue walk: what a cue of this build carries is read, and what the
    // declaration does not name is kept rather than refused. A message of the union a MIDI cue
    // sends, an argument of every kind a value may be, the `null` a crosspoint list and a
    // parent id may carry, and the `media` pair an audio cue on disk holds — which the runtime
    // cue type does not declare, and which a refusal would take off every show this build opens.
    const loaded = migrateWorkspace(workspaceWith([
      { ...midi('m1', { number: '12', name: 'Strings' }), messages: [{ kind: 'cc', channel: 1, controller: 7, value: 64 }] },
      osc('o1', { number: '13', name: 'LX Cue 12' }),
      {
        ...audio('a1', { number: '14', name: 'Walk-in', parentId: null, outputs: [{ inputChannel: 0, outputChannel: 1, gain: 1 }] }),
        media: { path: 'walk-in.wav', originalPath: '' }
      }
    ]), SHOW)

    expect(loaded.cues[0]).toMatchObject({ messages: [{ kind: 'cc', channel: 1, controller: 7, value: 64 }] })
    expect((loaded.cues[1] as OscCue).args).toEqual([
      { type: 'i', value: 12 },
      { type: 'f', value: 3.5 },
      { type: 's', value: 'warm' },
      { type: 'T', value: true }
    ])
    expect((loaded.cues[2] as AudioCue).outputs).toEqual([{ inputChannel: 0, outputChannel: 1, gain: 1 }])
    expect((loaded.cues[2] as AudioCue).parentId).toBeNull()
    expect((loaded.cues[2] as unknown as Record<string, unknown>).media).toEqual({
      path: 'walk-in.wav',
      originalPath: ''
    })
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
      'that show’s settings have no oscIn section, which this version of Cuerunner writes' +
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
