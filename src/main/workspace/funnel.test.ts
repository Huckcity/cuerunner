// One funnel, every entry point: bytes this build does not know are refused wherever they
// arrive — by a path a recent entry names, by the dialog, as a recovery snapshot, inside a
// bundle, as the other side of a comparison, as the demo, and as the file a save is about
// to replace. A path that skipped the funnel would load a show nobody wrote, so each case
// drives the same refused bytes through one entry point and holds the answer: a `Refusal`
// naming the source and the fact, never a fault and never a loaded show.
//
// What is refused is a shape, and the shapes below are the levels of one: a version literal,
// a section at either level, a settings section that is missing, a field inside a settings
// section — this build's own fields, in both directions, down to a channel's or a scene's —
// a cue missing a field its own type carries, and a declared cue field carrying the wrong
// kind, down to an element of one of its lists. The last cases hold the other side of the
// same rule: the bytes this build's own serialiser wrote go in and come back untouched, and
// the fields the types make optional on disk may be there or not.
//
// The last two cases hold what surrounds the sentences: the file a save is about to
// replace is a refused one, and the save still succeeds with no history entry taken from
// it; and no entry point touches the bytes it refused, mtime included.
//
// Electron is stubbed with a real temporary directory and the filesystem is real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { defaultCastSettings, defaultShowSettings, type ShowSettings } from '../../shared/show'
import type { Workspace } from '../../shared/workspace'
import { Refusal } from '../ipc/refusal'
import { readBundle } from './bundle'
import { openDemoWorkspace } from './demo'
import { writeRecovery } from './recovery'
import {
  compareWithFile, openRecovery, openWorkspace, openWorkspaceFromPath, saveWorkspace,
  serialiseWorkspace
} from './WorkspaceManager'
import { writeZip } from './zip'

const ends = vi.hoisted(() => ({ userData: { path: '' } }))

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  ends.userData.path = mkdtempSync(join(tmpdir(), 'cuerunner-funnel-userdata-'))
  return {
    app: { getPath: () => ends.userData.path, isPackaged: false },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    BrowserWindow: {}
  }
})

/** A show this build writes: the base every refused fixture is one change away from. */
function show(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'w1',
    name: 'Press Night',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [],
    ...over
  }
}

interface Refused {
  /** What the file is, for the failure message. */
  what: string
  /** The document on disk. */
  show: Record<string, unknown>
  /** The fact the sentence has to name — the half of it that is not the source. */
  fact: string
}

/**
 * The shapes this build refuses: a cue type, a section at either level, a settings section
 * that is missing, a field inside a settings section — the unknown direction, at the
 * section's own level and down inside a list; and the missing direction — a cue without a
 * field its type carries, and the kinds a declared field has to be (an object, a list, an
 * object per entry in it, a value of one of the kinds it allows) when a document carries
 * something else there. Every entry point below drives all of them, so the funnel is held to
 * the same answer wherever the bytes come from.
 *
 * The field cases are the pre-change shape's own fields: a channel's `dcaId` and a scene's
 * `live` are what a file written before a scene owned the assignment carries, and a desk
 * with no `profile` is a file written before profiles existed. That is the file the
 * field-level rule exists to refuse. The kind cases are the other half of a field: what the
 * value beside a declared field has to be — a primitive of the kind the declaration tags,
 * a list of primitives whose every element is that kind, and `null` only where the types
 * allow it — and, for a cue's declared fields, the same reading of the kind a cue's own
 * types write: a number where a MIDI cue writes a list of messages, an element of that list
 * that is not a message, a leaf inside a crosspoint, and a value whose type allows several
 * kinds carrying none of them.
 */
const REFUSED: readonly Refused[] = [
  {
    what: 'a cue whose type names something on Object.prototype',
    // `DECLARED_CUE_FIELDS` is a plain object, so reaching it by key alone would read
    // `Object.prototype.constructor` and walk a function as a list of fields — a fault
    // where the operator is owed a refusal sentence.
    show: show({ cues: [{ id: 'v2', type: 'constructor', name: 'Clip' }] }),
    fact: 'does not know (constructor)'
  },
  {
    what: 'a cue type this build does not know',
    show: show({ cues: [{ id: 'v1', type: 'video', name: 'Clip' }] }),
    fact: 'does not know (video)'
  },
  {
    what: 'a top-level section this build does not declare',
    show: show({ futureSection: { cues: [] } }),
    fact: 'has a section this version of WinsLab does not know (futureSection)'
  },
  {
    what: 'a declared top-level section carrying another kind',
    // The half of the level above it: the section is one this build declares, so the key
    // alone is not the fact — the value is, and a `history` that is not a list is a fault
    // where the window iterates it and where a save spreads it.
    show: show({ history: 3 }),
    fact: 'has history as a number, where this version of WinsLab writes a list of objects'
  },
  {
    what: 'a settings section this build does not declare',
    show: show({ showSettings: { ...defaultShowSettings(), plot: {} } }),
    fact: 'settings have a section this version of WinsLab does not know (plot)'
  },
  {
    what: 'settings missing a section this build writes',
    show: show({
      showSettings: {
        oscIn: { enabled: true, port: 53000 },
        midiIn: { enabled: false, portNames: [] }
      }
    }),
    fact: 'settings have no desk section, which this version of WinsLab writes'
  },
  {
    what: 'a version literal other than the one this build writes',
    show: show({ version: 2 }),
    fact: 'says version 2 and this build writes version 1'
  },
  {
    what: 'a settings field this build does not declare, inside a list',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        cast: { ...defaultCastSettings(), channels: [{ id: 'channel-1', name: 'Ruth', dcaId: 'dca-1' }] }
      }
    }),
    fact: 'settings have a field this version of WinsLab does not know (cast.channels.0.dcaId)'
  },
  {
    what: 'a row holding the several channels a build before this one wrote',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        scenes: {
          list: [{
            id: 's-1',
            name: 'Wedding',
            dcas: [{ dcaId: 'dca-1', channels: ['channel-1'], ensembles: [], excluded: [] }],
            notes: ''
          }],
          allowDuplicateAssignment: true
        }
      }
    }),
    fact: 'settings have a field this version of WinsLab does not know (scenes.list.0.dcas.0.channels)'
  },
  {
    what: 'an ensemble holding the performers a build before this one grouped',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        cast: { ...defaultCastSettings(), ensembles: [{ id: 'e-1', name: 'Chorus', members: ['p-1'] }] }
      }
    }),
    fact: 'settings have a field this version of WinsLab does not know (cast.ensembles.0.members)'
  },
  {
    what: 'a fader carrying the name a build before this one wrote',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        cast: { ...defaultCastSettings(), dcas: [{ id: 'dca-1', label: 'DCA 1', deskNumber: null }] }
      }
    }),
    fact: 'settings have a field this version of WinsLab does not know (cast.dcas.0.label)'
  },
  {
    what: 'a scene field the pre-change shape carried',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        scenes: {
          list: [{ id: 's-1', name: 'Wedding', live: ['p-1'], ensembles: [], excluded: [], notes: '' }],
          allowDuplicateAssignment: true
        }
      }
    }),
    fact: 'settings have a field this version of WinsLab does not know (scenes.list.0.live)'
  },
  {
    what: 'a settings field this build writes that the file has not got',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        // A desk as a build before profiles wrote one: every field it had, and no `profile`.
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
      }
    }),
    fact: 'settings have no desk.profile field, which this version of WinsLab writes'
  },
  {
    what: 'a cue missing a field its own type carries',
    show: show({ cues: [{ id: 'w1', number: '1', name: 'Walk-in', type: 'wait' }] }),
    fact: 'cue 1 Walk-in (wait) has no colorLabel field, which this version of WinsLab writes'
  },
  {
    what: 'a cue field carrying a number where this build writes a list of objects',
    show: show({ cues: [midiCue('m1', { number: '12', name: 'Strings', messages: 3 })] }),
    fact: 'cue 12 Strings (midi) has messages as a number, ' +
      'where this version of WinsLab writes a list of objects'
  },
  {
    what: 'a cue list whose element is not the object this build writes',
    show: show({ cues: [midiCue('m1', { number: '12', name: 'Strings', messages: [3] })] }),
    fact: 'cue 12 Strings (midi) has messages.0 as a number, ' +
      'where this version of WinsLab writes an object'
  },
  {
    what: 'a cue field inside a list of objects carrying another kind',
    show: show({
      cues: [audioCue('a1', {
        number: '14',
        name: 'Walk-in',
        outputs: [{ inputChannel: 0, outputChannel: 0, gain: '0' }]
      })]
    }),
    fact: 'cue 14 Walk-in (audio) has outputs.0.gain as a string, ' +
      'where this version of WinsLab writes a number'
  },
  {
    what: 'a cue value whose type allows several kinds and carries none of them',
    show: show({
      cues: [oscCue('o1', { number: '13', name: 'LX Cue 12', args: [{ type: 'i', value: {} }] })]
    }),
    fact: 'cue 13 LX Cue 12 (osc) has args.0.value as an object, ' +
      'where this version of WinsLab writes a number, a string or a boolean'
  },
  {
    what: 'a cue list carrying null where every element is an object',
    // `null` is not a message, and `typeof null` is `'object'` — the element check has to tell
    // them apart, or a `null` message reaches the engine that sends it.
    show: show({ cues: [midiCue('m1', { number: '12', name: 'Strings', messages: [null] })] }),
    fact: 'cue 12 Strings (midi) has messages.0 as nothing, ' +
      'where this version of WinsLab writes an object'
  },
  {
    what: 'a cue field carrying null where its own type writes an object',
    show: show({ cues: [networkCue('n1', { number: '15', name: 'Trigger Video', headers: null })] }),
    fact: 'cue 15 Trigger Video (network) has headers as nothing, ' +
      'where this version of WinsLab writes an object'
  },
  {
    what: 'a cue field carrying a list where its own type writes an object',
    show: show({ cues: [networkCue('n1', { number: '15', name: 'Trigger Video', headers: [] })] }),
    fact: 'cue 15 Trigger Video (network) has headers as a list, ' +
      'where this version of WinsLab writes an object'
  },
  {
    what: 'a cue list of objects carrying null where one element stands',
    show: show({ cues: [audioCue('a1', { number: '14', name: 'Walk-in', outputs: [null] })] }),
    fact: 'cue 14 Walk-in (audio) has outputs.0 as nothing, ' +
      'where this version of WinsLab writes an object'
  },
  {
    what: 'a cue leaf carrying null where the types do not allow it',
    show: show({ cues: [midiCue('m1', { number: '12', name: 'Strings', preWait: null })] }),
    fact: 'cue 12 Strings (midi) has preWait as nothing, ' +
      'where this version of WinsLab writes a number'
  },
  {
    what: 'a settings field that is not the object this build writes',
    show: show({ showSettings: { ...defaultShowSettings(), desk: 'sq' } }),
    fact: 'settings have desk as a string, where this version of WinsLab writes an object'
  },
  {
    what: 'a settings field that is not the list this build writes',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        cast: { ...defaultCastSettings(), channels: { '0': { id: 'channel-1', name: 'Ruth' } } }
      }
    }),
    fact: 'settings have cast.channels as an object, where this version of WinsLab writes a list'
  },
  {
    what: 'a list entry that is not the object this build writes',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        cast: { ...defaultCastSettings(), channels: ['channel-1'] }
      }
    }),
    fact: 'settings have cast.channels.0 as a string, where this version of WinsLab writes an object'
  },
  {
    what: 'a cue that is not a cue at all',
    show: show({ cues: [null] }),
    fact: 'has a cue that is not the shape this version of WinsLab writes (cues.0)'
  },
  {
    what: 'a settings leaf carrying a value of another kind',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        desk: { ...defaultShowSettings().desk, midiChannel: '1' }
      }
    }),
    fact: 'settings have desk.midiChannel as a string, where this version of WinsLab writes a number'
  },
  {
    what: 'a list of primitives carrying something that is not a list',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        cast: {
          ...defaultCastSettings(),
          ensembles: [{ id: 'e-1', name: 'Chorus', channelIds: 3 }]
        }
      }
    }),
    fact: 'settings have cast.ensembles.0.channelIds as a number, ' +
      'where this version of WinsLab writes a list of strings'
  },
  {
    what: 'an element of a list of primitives carrying another kind',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        midiIn: { ...defaultShowSettings().midiIn, portNames: ['in', 3] }
      }
    }),
    fact: 'settings have midiIn.portNames.1 as a number, where this version of WinsLab writes a string'
  },
  {
    what: 'a leaf carrying null where the types do not allow it',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        presence: { ...defaultShowSettings().presence, goneAfterSeconds: null }
      }
    }),
    fact: 'settings have presence.goneAfterSeconds as nothing, ' +
      'where this version of WinsLab writes a number'
  },
  {
    what: 'a leaf the types allow null for carrying another kind instead',
    show: show({
      showSettings: {
        ...defaultShowSettings(),
        desk: {
          ...defaultShowSettings().desk,
          // Inside the `{ nothing: true, of: 'number' }` wrapper: `null` is admitted here and
          // a string is not, so the kind is checked after the wrapper is read.
          buttons: { go: '48', back: null, goNote: null, backNote: null }
        }
      }
    }),
    fact: 'settings have desk.buttons.go as a string, where this version of WinsLab writes a number'
  },
  {
    what: 'a settings field inside a scene’s row, where two element indices meet',
    show: show({
      showSettings: {
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
      }
    }),
    fact: 'settings have scenes.list.0.dcas.0.memberId as a number, ' +
      'where this version of WinsLab writes a string'
  }
]

/**
 * Drives one entry point with one refused file and holds the answer. The thrown value has
 * to be the marked refusal — a fault would reach the window as a stack rather than a
 * sentence — and the sentence has to name the source the bytes came from and the fact.
 */
async function refusedFrom(
  entry: Refused,
  source: string,
  run: () => Promise<unknown>
): Promise<void> {
  const thrown = await run().then(() => undefined, (error: unknown) => error)

  if (!(thrown instanceof Refusal)) {
    throw new Error(`${entry.what} was not refused from ${source}: ${String(thrown)}`)
  }
  expect(thrown.message).toContain(entry.fact)
  expect(thrown.message).toContain(source)
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-funnel-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Each refused shape on disk under a name of its own, so the disk check has one per shape. */
function onDisk(): Map<Refused, string> {
  const paths = new Map<Refused, string>()
  REFUSED.forEach((entry, index) => {
    const path = join(dir, `Refused ${index + 1}.cuerunner`)
    writeFileSync(path, JSON.stringify(entry.show, null, 2))
    paths.set(entry, path)
  })
  return paths
}

describe('the funnel, through every entry point', () => {
  it('refuses a file a recent entry names, and names that file', async () => {
    for (const [entry, path] of onDisk()) {
      await refusedFrom(entry, path, () => openWorkspaceFromPath(path))
    }
  })

  it('refuses the same bytes chosen through the dialog', async () => {
    for (const [entry, path] of onDisk()) {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [path] })
      await refusedFrom(entry, path, () => openWorkspace({} as never))
    }
  })

  it('refuses a snapshot this build cannot bring back, naming the snapshot', async () => {
    for (const entry of REFUSED) {
      await writeRecovery(entry.show as unknown as Workspace, null)
      const snapshot = join(ends.userData.path, 'recovery.cuerunner')
      await refusedFrom(entry, snapshot, () => openRecovery())
    }
  })

  it('refuses the showfile a bundle carries, naming the entry it came out of', async () => {
    for (const entry of REFUSED) {
      const bundle = join(dir, 'Handover.cuerunnerx')
      await writeZip(bundle, [{
        name: 'show.cuerunner',
        data: Buffer.from(JSON.stringify(entry.show), 'utf8')
      }])
      await refusedFrom(entry, `${bundle}’s show.cuerunner entry`, () => readBundle(bundle))
    }
  })

  it('refuses the other side of a comparison, naming that file', async () => {
    const ourShow = show() as unknown as Workspace
    for (const [entry, path] of onDisk()) {
      await refusedFrom(entry, path, () => compareWithFile(ourShow, path))
    }
  })

  it('refuses the demo when the file it ships as is not this shape, naming that file', async () => {
    for (const [entry, path] of onDisk()) {
      await refusedFrom(entry, path, () => openDemoWorkspace(path))
    }
  })

  it('saves over a refused file, and takes no history entry from it', async () => {
    // The save's own history pass reads the file it is about to replace, through the same
    // funnel. A refused file has nothing to compare against, and a history entry is not
    // worth failing a save for — so the save runs, the show lands, and the file's contents
    // leave no trace in the history.
    const target = join(dir, 'Taken.cuerunner')
    writeFileSync(target, JSON.stringify(REFUSED[4].show, null, 2))
    const ourShow = show({ name: 'Hamlet', history: undefined }) as unknown as Workspace

    const saved = await saveWorkspace({} as never, ourShow, target)

    expect(saved?.path).toBe(target)
    expect(saved?.history).toEqual([])
    const written = JSON.parse(readFileSync(target, 'utf-8'))
    expect(written.name).toBe('Hamlet')
    expect(written.history).toBeUndefined()
  })

  it('leaves every refused file exactly as it was found', async () => {
    // Loading never writes: the refusal is a value the window shows, and what the operator
    // picked is theirs — bytes and mtime both. Each shape is driven through every loading
    // entry point before the file is read back.
    for (const [entry, path] of onDisk()) {
      const before = readFileSync(path)
      const beforeStat = statSync(path)

      await refusedFrom(entry, path, () => openWorkspaceFromPath(path))
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [path] })
      await refusedFrom(entry, path, () => openWorkspace({} as never))
      await writeRecovery(entry.show as unknown as Workspace, null)
      await refusedFrom(entry, join(ends.userData.path, 'recovery.cuerunner'), () => openRecovery())
      const bundle = join(dir, 'Handover.cuerunnerx')
      await writeZip(bundle, [{
        name: 'show.cuerunner',
        data: Buffer.from(JSON.stringify(entry.show), 'utf8')
      }])
      await refusedFrom(entry, `${bundle}’s show.cuerunner entry`, () => readBundle(bundle))
      await refusedFrom(entry, path, () => compareWithFile(show() as unknown as Workspace, path))
      await refusedFrom(entry, path, () => openDemoWorkspace(path))

      expect(readFileSync(path).equals(before)).toBe(true)
      expect(statSync(path).mtimeMs).toBe(beforeStat.mtimeMs)
    }
  })
})

/** A wait cue in this build's own shape: the base every cue carries, and whatever the case adds. */
function waitCue(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    number: id,
    name: id,
    type: 'wait',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 1000,
    advance: 'none',
    isArmed: true,
    notes: '',
    ...over
  }
}

/**
 * A MIDI cue in this build's own shape: every field its type requires, and the case's own on
 * top. The message list is a union of variants, so a case about it carries whichever variant
 * it is about.
 */
function midiCue(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return waitCue(id, {
    type: 'midi',
    portName: '',
    messages: [{ kind: 'programChange', channel: 1, program: 12 }],
    ...over
  })
}

/** An OSC cue in this build's own shape, with one argument of each kind a value may be. */
function oscCue(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return waitCue(id, {
    type: 'osc',
    host: '127.0.0.1',
    port: 53000,
    address: '/lx/12',
    args: [{ type: 'i', value: 12 }, { type: 'f', value: 3.5 }, { type: 's', value: 'warm' }, { type: 'T', value: true }],
    ...over
  })
}

/**
 * A network cue in this build's own shape: a request, and the headers it carries — which are an
 * open record, so the object itself is what is declared and its own field names are the case's.
 */
function networkCue(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return waitCue(id, {
    type: 'network',
    method: 'POST',
    url: 'http://127.0.0.1:8080/scene',
    body: '',
    headers: { 'Content-Type': 'application/json' },
    timeout: 5000,
    ...over
  })
}

/** An audio cue in this build's own shape: a file, the crosspoints it is routed through. */
function audioCue(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return waitCue(id, {
    type: 'audio',
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: [{ inputChannel: 0, outputChannel: 1, gain: 1 }],
    loopCount: 0,
    playbackRate: 1,
    trim: 0,
    ...over
  })
}

/** A show in this build's own shape: every settings section, and cues on both sides of the optional fields. */
function ours(): Workspace {
  return show({
    showSettings: defaultShowSettings(),
    // One cue without the fields the types make optional on disk and one with them, because
    // both are this build's own shape and the check has to read either. Beside them the kinds
    // the cue declaration carries, on bytes this build itself writes: a message of the union a
    // MIDI cue sends, all four kinds of OSC argument a value may be, crosspoints on an audio
    // cue, and the `null`s the types allow — an `endTime` and a `parentId`.
    cues: [
      waitCue('w1'),
      waitCue('w2', { triggers: [], refire: 'ignore', scriptLine: 12 }),
      midiCue('m1', {
        number: '3',
        name: 'Strings',
        messages: [
          { kind: 'cc', channel: 1, controller: 7, value: 64 },
          { kind: 'sysex', data: [0x7e, 0x00] }
        ]
      }),
      oscCue('o1', { number: '4', name: 'LX Cue 12' }),
      // A blank file, so nothing is resolved and nothing is reported missing: the cue is here
      // for its crosspoints and its `null` `endTime`, not for a file.
      audioCue('a1', { number: '5', name: 'Walk-in' })
    ]
  }) as unknown as Workspace
}

describe('this build’s own write, through the funnel', () => {
  it('reads back a document its own serialiser wrote, with nothing refused and nothing repaired', async () => {
    // The other half of the shape check, and what lets it be this strict: what this build
    // writes, it reads. The document is built here and written by the build's own serialiser,
    // so the check is held to the bytes the app leaves on disk rather than to a fixture
    // written for the check's own convenience.
    const path = join(dir, 'Ours.cuerunner')
    writeFileSync(path, serialiseWorkspace(ours(), dir))

    const opened = await openWorkspaceFromPath(path)

    expect(opened.loadNotes).toEqual([])
    expect(opened.workspace.showSettings).toEqual(defaultShowSettings())

    // And the write of a read is a read: the second pass has nothing to refuse either, and
    // the show that comes back is the show that went in.
    const settled = join(dir, 'Ours, saved.cuerunner')
    writeFileSync(settled, serialiseWorkspace(opened.workspace, dir))
    const reopened = await openWorkspaceFromPath(settled)

    expect(reopened.loadNotes).toEqual([])
    expect(reopened.workspace).toEqual(opened.workspace)
  })

  it('reads a leaf carrying the null the types allow, wherever the file carries one', async () => {
    // The other side of the kind check: `null` is the one value a null-able leaf may carry,
    // and it is legal exactly there. The desk's buttons, a pack nobody is on, a swap that
    // changed no one, a performer between channels and a fader nobody has numbered are the
    // fields the types allow it for, and a file carrying all of them is this build's own.
    // Each wrapper also carries a real value somewhere — a mute group, a channel id — because
    // a wrapper that admitted `null` and nothing else would be the wrong check wearing the
    // right sentence.
    const settings = defaultShowSettings()
    const path = join(dir, 'Nulls.cuerunner')
    const document = show({
      showSettings: {
        ...settings,
        midiIn: { enabled: true, portNames: ['Desk', 'Keys'] },
        desk: { ...settings.desk, buttons: { go: 48, back: null, goNote: null, backNote: null } },
        rf: {
          ...settings.rf,
          plot: {
            packs: [{ id: 'pack-1', label: 'Belt pack', channelId: 'channel-1', performerId: null, notes: '' }]
          },
          swaps: [{ at: 0, packId: 'pack-1', packLabel: 'Belt pack', from: null, to: null }]
        },
        cast: {
          ...defaultCastSettings(),
          performers: [{ id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: null }],
          ensembles: [{ id: 'e-1', name: 'Chorus', channelIds: ['channel-1', 'channel-2'] }],
          dcas: [{ id: 'dca-1', deskNumber: null }]
        }
      },
      cues: []
    }) as unknown as Workspace
    writeFileSync(path, serialiseWorkspace(document, dir))

    const opened = await openWorkspaceFromPath(path)
    const read = opened.workspace.showSettings as ShowSettings

    expect(opened.loadNotes).toEqual([])
    expect(read.desk.buttons.go).toBe(48)
    expect(read.desk.buttons.back).toBeNull()
    expect(read.midiIn.portNames).toEqual(['Desk', 'Keys'])
    expect(read.rf.plot.packs[0].channelId).toBe('channel-1')
    expect(read.rf.plot.packs[0].performerId).toBeNull()
    expect(read.rf.swaps[0].to).toBeNull()
    expect(read.cast.performers[0].channelId).toBeNull()
    expect(read.cast.ensembles[0].channelIds).toEqual(['channel-1', 'channel-2'])
    expect(read.cast.dcas[0].deskNumber).toBeNull()
  })

  it('reads a cue whether the fields the types make optional are there or not', async () => {
    // `triggers`, `refire` and `scriptLine` are the fields the types mark `?:`, and a cue
    // without them is as much this build's own shape as one with them. Neither gains the
    // other's: what the file gave each cue is what the load hands the window.
    const path = join(dir, 'Optional.cuerunner')
    writeFileSync(path, serialiseWorkspace(ours(), dir))

    const opened = await openWorkspaceFromPath(path)
    const cues = opened.workspace.cues.map(cue => cue as unknown as Record<string, unknown>)

    expect(cues.map(cue => cue.id)).toEqual(['w1', 'w2', 'm1', 'o1', 'a1'])
    expect(Object.hasOwn(cues[0], 'triggers')).toBe(false)
    expect(Object.hasOwn(cues[0], 'refire')).toBe(false)
    expect(cues[1].triggers).toEqual([])
    expect(cues[1].refire).toBe('ignore')
    expect(cues[1].scriptLine).toBe(12)
  })

  it('reads the kinds a cue’s own fields carry, as the declaration writes them', async () => {
    // The other side of the cue-field kind check, and what keeps it from refusing a show this
    // build wrote: a list whose elements are a union of message variants, an OSC argument of
    // every kind a value may be, the crosspoints of an audio cue and the `null`s the types
    // allow there are all this build's own shape, and they come back exactly as they went in.
    const path = join(dir, 'Kinds.cuerunner')
    writeFileSync(path, serialiseWorkspace(ours(), dir))

    const opened = await openWorkspaceFromPath(path)
    const cues = opened.workspace.cues.map(cue => cue as unknown as Record<string, unknown>)
    const midi = cues.find(cue => cue.id === 'm1')
    const osc = cues.find(cue => cue.id === 'o1')
    const audio = cues.find(cue => cue.id === 'a1')

    expect(opened.loadNotes).toEqual([])
    expect(midi?.messages).toEqual([
      { kind: 'cc', channel: 1, controller: 7, value: 64 },
      { kind: 'sysex', data: [0x7e, 0x00] }
    ])
    expect(osc?.args).toEqual([
      { type: 'i', value: 12 },
      { type: 'f', value: 3.5 },
      { type: 's', value: 'warm' },
      { type: 'T', value: true }
    ])
    expect(audio?.outputs).toEqual([{ inputChannel: 0, outputChannel: 1, gain: 1 }])
    expect(audio?.endTime).toBeNull()
    expect(audio?.parentId).toBeNull()
  })
})
