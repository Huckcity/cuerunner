// The saved shape is one declaration, and this file walks it. The show's own settings are
// a shape inside it, declared beside it and walked here too: its sections, the fields inside
// each of them, and the fields a cue of each type has to carry.
//
// `src/shared/workspaceSections.ts` names the shape's sections in the order the file's
// keys are written, the route the settings diff reports each one under, and what a merge
// does with it. Everything below is driven by that list: the serialiser writes it in
// order, every settings-bearing section is moved and has to be reported under its route,
// and every section is moved again to see the merge take the change or keep this show's.
// A section that reaches disk but is never compared or blended — the bug this shape's one
// declaration exists to prevent — fails here, and so does a workspace key the declaration
// does not carry. The settings list inside it is held to `ShowSettings` the same way: a
// section the type has and the declaration does not is a section the load funnel would
// refuse in a file this build itself wrote.
//
// The field declarations are the funnel's shape check's own — what it reads a document
// against — and what the types' `satisfies` there cannot reach is the value: this is where
// a whole value of the settings and a cue of every type are walked beside the declaration,
// so a field the value carries and the declaration has not learned fails here, at whatever
// level it sits.
//
// The fixture is hand-written on purpose. Fixtures are input, not writers: the rule the
// declaration holds is about the app's own writers, and the fixture is what they are held
// to.
import { describe, it, expect, vi } from 'vitest'
import { serialiseWorkspace } from './serialise'
import { defaultRfSettings, defaultShowSettings } from '../../shared/show'
import { diffWorkspaces } from '../../shared/showfile'
import { mergeWorkspaces } from '../../shared/showfileMerge'
import {
  CUE_FIELD_SHAPE,
  SHOW_SETTINGS_SHAPE,
  SHOW_SETTINGS_SECTIONS,
  WORKSPACE_SECTIONS,
  type DeclaredFields,
  type ShapeLeaf,
  type WorkspaceKey
} from '../../shared/workspaceSections'
import { CUE_TYPES, type AudioCue, type Cue, type CueBase } from '../../shared/cue'
import type { ShowSettings } from '../../shared/show'
import type { Workspace } from '../../shared/workspace'

vi.mock('electron', () => ({
  // Nothing here touches the user-data folder; the serialiser needs no Electron at all.
  app: { getPath: () => '/tmp' },
  dialog: {},
  BrowserWindow: {}
}))

/** Where the fixture's files would live; no cue names a file, so nothing is resolved. */
const SHOWS = '/shows/press-night'

function cue(id: string, name: string): AudioCue {
  return {
    id,
    number: id,
    name,
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
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 1,
    playbackRate: 1,
    trim: 0
  }
}

/**
 * The whole shape, every optional section set: the walk needs a value it can move in every
 * section, including the ones a file need not carry, and `Required` keeps the fixture
 * honest if the `Workspace` type gains a key.
 */
const fixture: Required<Workspace> = {
  version: 1,
  id: 'w-press-night',
  name: 'Press Night',
  createdAt: '2026-09-01T00:00:00.000Z',
  history: [{ at: '2026-09-02T00:00:00.000Z', by: 'adam', cues: [], settings: ['name'] }],
  audioSettings: { outputDeviceId: 'default', sampleRate: 48000 },
  midiSettings: { outputPortName: 'Desk' },
  showSettings: defaultShowSettings(),
  triggerGuard: { windowMs: 300 },
  cues: [cue('a1', 'Walk-in'), cue('a2', 'Interval')]
}

/**
 * A value with something about it moved: the first field of an object, the first entry of
 * an array, a string with a suffix. Enough for a diff or a merge to see the section is
 * not what it was, whatever kind of value the section holds.
 */
function movedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 0 ? [movedValue(value[0]), ...value.slice(1)] : ['moved']
  if (value !== null && typeof value === 'object') {
    const fields = Object.keys(value)
    if (fields.length === 0) return { moved: true }
    return { ...(value as Record<string, unknown>), [fields[0]]: movedValue((value as Record<string, unknown>)[fields[0]]) }
  }
  if (typeof value === 'string') return `${value} — moved`
  if (typeof value === 'number') return value + 1
  if (typeof value === 'boolean') return !value
  return 'moved'
}

/**
 * The fixture with one section moved, as another writer would have left it. The cues move
 * by renaming the first cue — an edit the cue merge blends — rather than by moving a
 * field the walk happens to find first, because a cue's identity is not an edit.
 */
function moved(section: WorkspaceKey): Workspace {
  const value = section === 'cues'
    ? fixture.cues.map(entry => ({ ...entry, name: `${entry.name} — moved` }))
    : movedValue(fixture[section])
  return { ...fixture, [section]: value } as Workspace
}

/**
 * The file's keys, in the order its bytes carry them. The declaration is the one edit
 * point for that order — which is exactly why the test pins it here: a reorder there
 * would silently rewrite every showfile this machine has written, and a test that only
 * compared the serialiser with the declaration would compare the new order with itself.
 * The type ties each name back to the declaration, so a dropped section fails to compile
 * before it fails below.
 */
const declared: readonly WorkspaceKey[] = [
  'version',
  'id',
  'name',
  'createdAt',
  'history',
  'audioSettings',
  'midiSettings',
  'showSettings',
  'triggerGuard',
  'cues'
]

describe('the saved shape', () => {
  it('writes every declared section, in the declared order, and nothing else', () => {
    const onDisk = JSON.parse(serialiseWorkspace(fixture, SHOWS)) as Record<string, unknown>

    // The file carries the pinned keys, in the pinned order — which is the declaration's
    // order, unless the declaration was reordered, and then this is the only place that
    // says so.
    expect(Object.keys(onDisk)).toEqual(declared)
    // The declaration carries the whole shape: a key the workspace holds but the
    // declaration never learned would be written by nobody and compared by nothing.
    expect(Object.keys(fixture)).toEqual(declared)
  })

  it('leaves an unset section out of the file rather than writing an empty one', () => {
    const bare = serialiseWorkspace(
      { ...fixture, history: undefined, showSettings: undefined, triggerGuard: undefined },
      SHOWS
    )

    expect(Object.keys(JSON.parse(bare))).toEqual(
      declared.filter(key => key !== 'history' && key !== 'showSettings' && key !== 'triggerGuard')
    )
  })

  it('compares every settings-bearing section under its declared route, and nothing else', () => {
    for (const section of WORKSPACE_SECTIONS) {
      const paths = diffWorkspaces(fixture, moved(section.key)).settings.map(setting => setting.path)
      if (section.route === null) {
        expect(paths, `${section.key} is not a setting`).toEqual([])
        continue
      }
      expect(paths.length, `${section.key} is not compared`).toBeGreaterThan(0)
      for (const path of paths) {
        expect(
          path === section.route || path.startsWith(`${section.route}.`),
          `${section.key} reported under ${path}`
        ).toBe(true)
      }
    }

    // The same show on both sides of a compare: the settings have nothing to say.
    expect(diffWorkspaces(fixture, fixture).settings).toEqual([])
  })

  it('blends every declared section the way the declaration says', () => {
    for (const section of WORKSPACE_SECTIONS) {
      const theirs = moved(section.key)
      const merged = mergeWorkspaces(fixture, fixture, theirs, { onConflict: 'ours' }).workspace

      // A one-sided change is taken by every blending behaviour — the section, the key
      // inside it, the cue — and refused by `ours`, whose value is the destination's.
      const expected = section.merge === 'ours' ? fixture[section.key] : theirs[section.key]
      expect(merged[section.key], section.key).toEqual(expected)
    }
  })
})

/**
 * The sections a show's settings carry, pinned the way the saved shape's keys are: the list
 * in `workspaceSections.ts` is the one the load funnel's shape check reads, and this is
 * where a section that reached the type but not the list — or the list but not the type —
 * fails. The type ties each name back to a key of a `ShowSettings`, so a section the type
 * loses fails to compile before it fails below.
 */
const declaredSettings: readonly (keyof ShowSettings)[] = [
  'oscIn',
  'midiIn',
  'desk',
  'rf',
  'presence',
  'script',
  'companion',
  'scenes',
  'cast'
]

describe('the show-settings shape', () => {
  it('declares every section a show’s settings carry, and nothing else', () => {
    expect(SHOW_SETTINGS_SECTIONS).toEqual(declaredSettings)
    // `defaultShowSettings` is the one value typed as the whole of a `ShowSettings`, and it
    // builds a section per key: the list has to carry them all, or a file this build wrote
    // would be refused by the check the list exists for.
    expect(Object.keys(defaultShowSettings())).toEqual(declaredSettings)
  })
})

/**
 * A field named the way a sentence names it, from the path of the object it sits in.
 */
const fieldOf = (path: string, field: string): string => (path === '' ? field : `${path}.${field}`)

/** Whether the declaration marks a field as one a document may leave out (`?:` in the types). */
function isAbsentOnDisk(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false
  return 'absent' in node && node.absent === true
}

/** A declaration node read as the fields it carries: called only where the node is one. */
const asFields = (node: object): DeclaredFields => node as DeclaredFields

/** A field's node with its `absent` wrapper — where the types put one — taken off. */
function shapeOf(node: unknown): unknown {
  if (typeof node !== 'object' || node === null) return node
  if (!('absent' in node) || node.absent !== true) return node
  return 'of' in node ? node.of : undefined
}

/**
 * Whether a value is the kind the declaration names, read as the funnel reads it: an object for
 * `'object'`, and never a list or `null`, whose own kinds the walk names separately.
 */
const admitsKind = (kind: ShapeLeaf, value: unknown): boolean =>
  kind === 'object'
    ? typeof value === 'object' && value !== null && !Array.isArray(value)
    : typeof value === kind

/**
 * Every way one value and the declaration node beside it disagree: a leaf of another kind, a
 * list that is not a list or whose element is not the kind the list carries, `null` where the
 * types do not allow one, a value whose type allows several kinds and carries none of them, or
 * an object whose fields are not the declared ones. The declaration is read the way the funnel
 * reads it, so what this names is what the funnel refuses: the wrappers are the types' own —
 * `{ absent: true, of: … }` around a field the types mark `?:` and `{ nothing: true, of: … }`
 * around a leaf they allow `null` for — and a node is told from the others by its own reserved
 * name, never by the value beside it. `'object'` is a leaf whose value is held to being an
 * object and not read any further, and `{ oneOf: […] }` admits the kinds it lists. Every kind it
 * reports is one the funnel refuses a document for, on either half of the walk.
 */
function valueDifferences(value: unknown, node: unknown, path: string): string[] {
  const shape = shapeOf(node)
  if (typeof shape === 'object' && shape !== null && 'nothing' in shape && shape.nothing === true) {
    return value === null ? [] : valueDifferences(value, 'of' in shape ? shape.of : undefined, path)
  }
  if (shape === 'string' || shape === 'number' || shape === 'boolean' || shape === 'object') {
    if (admitsKind(shape, value)) return []
    return [`${path} is ${typeof value}, not the ${shape} the declaration writes`]
  }
  if (typeof shape === 'object' && shape !== null && 'oneOf' in shape) {
    const kinds = Array.isArray(shape.oneOf) ? (shape.oneOf as unknown[]) : []
    return kinds.some(kind => admitsKind(kind as ShapeLeaf, value))
      ? []
      : [`${path} is ${typeof value}, not one of the kinds the declaration writes (${kinds.join(', ')})`]
  }
  const kind = typeof shape === 'object' && shape !== null && 'items' in shape ? shape.items : undefined
  if (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'object') {
    if (!Array.isArray(value)) return [`${path} is not a list`]
    if (value.length === 0) return [`${path} is empty, so nothing inside it is walked`]
    const wrong = value.findIndex(item => !admitsKind(kind, item))
    return wrong === -1
      ? []
      : [`${path}.${wrong} is ${typeof value[wrong]}, not the ${kind} the declaration writes`]
  }
  if (typeof shape !== 'object' || shape === null) return [`${path} is declared as ${String(shape)}`]
  if ('elements' in shape) {
    if (!Array.isArray(value)) return [`${path} is not a list`]
    if (value.length === 0) return [`${path} is empty, so nothing inside it is walked`]
    // Every element of a list is read against the one shape the declaration gives it, as the
    // funnel reads them: an element's own type may allow several kinds — an OSC argument's
    // value — so it is not only the first that is worth walking.
    return value.flatMap((element, at) =>
      shapeDifferences(element, asFields(shape.elements as object), `${path}.${at}`)
    )
  }
  return shapeDifferences(value, asFields(shape), path)
}

/**
 * Every way a value and the declaration beside it disagree about its fields: a field the value
 * carries that the declaration does not name, a declared field the value has not got, or a
 * declared field whose value is not what the declaration writes there — which
 * `valueDifferences` reads, at every level. What comes back empty is a value of the declared
 * shape, and what it names is the fact the funnel would refuse: the same reading, over a value
 * rather than a document.
 *
 * The missing field and the wrong kind are the funnel's own, on both halves. The unknown field
 * is the settings' rule alone: a cue keeps a field the declaration does not name — `media`,
 * which the runtime cue type does not declare — so for a cue the report of one is this walk's
 * own strictness, and what it holds is that a cue of this build carries no such field to begin
 * with.
 */
function shapeDifferences(value: unknown, fields: DeclaredFields, path: string): string[] {
  if (typeof value !== 'object' || value === null) return [`${path} is ${typeof value}, not an object`]

  // The value is an object — the check above said so, and a document's objects are the only
  // ones this reads — so its own fields are what there is to walk.
  const carried = value as Record<string, unknown>
  const differences = Object.keys(carried)
    .filter(field => !Object.hasOwn(fields, field))
    .map(field => `${fieldOf(path, field)} is not declared`)

  for (const [field, node] of Object.entries(fields)) {
    const here = fieldOf(path, field)
    if (!Object.hasOwn(carried, field)) {
      if (!isAbsentOnDisk(node)) differences.push(`${here} is missing`)
      continue
    }
    differences.push(...valueDifferences(carried[field], node, here))
  }
  return differences
}

/**
 * A value of the whole of a show's settings with every list populated, which is what the
 * walk needs to see the fields inside a list's elements — the defaults leave the cast, the
 * plot and the scenes empty. It is built from those defaults and typed as the whole of
 * `ShowSettings`, so a field the types gain is a field this fixture is missing: a compile
 * error before it is a field the declaration has not learned. Every field the types mark
 * `?:` is left out, which is the other half of the same rule.
 */
const SETTINGS: ShowSettings = {
  ...defaultShowSettings(),
  // The defaults leave the port list empty, and an empty list is a list nothing inside is
  // walked — the element's own kind is one of the things this fixture exists to check.
  midiIn: { enabled: true, portNames: ['Desk', 'Keys'] },
  rf: {
    ...defaultRfSettings(),
    plot: { packs: [{ id: 'pack-1', label: 'Belt pack', channelId: null, performerId: 'p-1', notes: '' }] },
    sources: [{ id: 'demo-rack', label: 'Demo rack', kind: 'demo', target: '', pollMs: 2000, timeoutMs: 1500 }],
    swaps: [{ at: 0, packId: 'pack-1', packLabel: 'Belt pack', from: null, to: 'p-1' }]
  },
  scenes: {
    list: [{
      id: 's-1',
      name: 'Wedding',
      dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 'channel-1' }],
      notes: ''
    }],
    allowDuplicateAssignment: true
  },
  cast: {
    channels: [{ id: 'channel-1', name: 'Ruth' }],
    performers: [{ id: 'p-1', name: 'Ruth', role: 'lead', notes: '', channelId: 'channel-1' }],
    ensembles: [{ id: 'e-1', name: 'Chorus', channelIds: ['channel-1'] }],
    dcas: [{ id: 'dca-1', deskNumber: null }]
  }
}

describe('the settings-field shape', () => {
  it('declares every field a show’s settings carry, and nothing else', () => {
    // A value of the whole of `ShowSettings`, walked beside the declaration at every level.
    // A field the value carries and the declaration has not learned fails here, and so does
    // a declared field the value has not got — which is what the load funnel refuses a
    // document for, in the same two directions.
    expect(shapeDifferences(SETTINGS, SHOW_SETTINGS_SHAPE, '')).toEqual([])
  })
})

/** One cue's own fields, from `CueBase`: what every cue carries, without the optionals. */
function cueBase(id: string): Omit<CueBase, 'triggers' | 'refire' | 'scriptLine'> {
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
 * One cue of every type this build knows, in this build's own shape: the base every cue
 * carries, the fields the type adds, and — on the audio and MIDI cues — the fields the types
 * mark `?:`, so the declaration of those is walked too. The rest carry none of them, because a
 * cue without them is this build's own shape as much as one with them: a declaration that
 * demanded one fails here on those cues. Each cue is typed as its own cue type, so a field the
 * types gain is a field this fixture is missing: a compile error before it is a field the
 * declaration has not learned.
 *
 * The lists are populated rather than empty (an empty list is a list nothing inside is
 * walked): the MIDI cue sends messages of the union's own variants, the OSC cue's arguments
 * carry every kind a value may be — a number, a string and a boolean — the network cue carries
 * the headers an open record holds, and the audio cue carries a crosspoint list, a trigger, a
 * sound region, the `null` its `endTime` is allowed and a script line pinned to the script.
 */
const CUE_OF_TYPE: { readonly [K in (typeof CUE_TYPES)[number]]: Extract<Cue, { type: K }> } = {
  audio: {
    ...cueBase('a1'),
    type: 'audio',
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: [{ inputChannel: 0, outputChannel: 1, gain: 0.5 }],
    loopCount: 1,
    playbackRate: 1,
    trim: 0,
    // The fields the types mark `?:`, in the shape a cue this build wrote carries them: a
    // trigger (a list whose elements are a union of clauses), the re-fire policy, a script line
    // that is a number here, the trim and the measurement it plays by.
    triggers: [{ id: 't-a1', kind: 'osc', address: '/go' }],
    refire: 'restart',
    scriptLine: 12,
    trimSilence: true,
    soundRegion: { startMs: 0, endMs: 4000, durationMs: 5200, silent: false }
  },
  midi: {
    ...cueBase('m1'),
    type: 'midi',
    portName: '',
    // The list's elements are a union of five variants: each is an object, and what a variant
    // carries — the note, the controller, the data — is not declared.
    messages: [
      { kind: 'cc', channel: 1, controller: 7, value: 64 },
      { kind: 'sysex', data: [0x7e, 0x00] }
    ],
    // The other reading of the one field that is both optional and null-able: the audio cue
    // pins a number, this one is pinned to nothing.
    scriptLine: null
  },
  osc: {
    ...cueBase('o1'),
    type: 'osc',
    host: '',
    port: 0,
    address: '',
    // An argument's `value` is the one field whose type allows more than one kind, so all
    // three are carried: a declaration that named one of them would be caught here.
    args: [
      { type: 'i', value: 12 },
      { type: 'f', value: 3.5 },
      { type: 's', value: '/lx/12' },
      { type: 'T', value: true }
    ]
  },
  wait: { ...cueBase('w1'), type: 'wait' },
  fade: {
    ...cueBase('f1'),
    type: 'fade',
    targetCueId: '',
    fadeProperty: 'volume',
    targetValue: 1,
    curve: 'linear',
    stopTargetWhenDone: false
  },
  stop: {
    ...cueBase('s1'),
    type: 'stop',
    targetCueId: 'all',
    fadeOut: false,
    fadeOutDuration: 0,
    waitForFade: false
  },
  group: { ...cueBase('g1'), type: 'group', mode: 'playlist' },
  network: {
    ...cueBase('n1'),
    type: 'network',
    method: 'GET',
    url: '',
    body: '',
    // An open record: the header names are the operator's, so what is inside it is not
    // declared and only the object itself is walked.
    headers: { 'Content-Type': 'application/json' },
    timeout: 5000
  },
  script: { ...cueBase('sc1'), type: 'script', language: 'javascript', script: '', timeout: 60000 },
  scene: { ...cueBase('sn1'), type: 'scene', sceneId: '' },
  devamp: { ...cueBase('d1'), type: 'devamp', targetCueId: '' },
  msc: {
    ...cueBase('ms1'),
    type: 'msc',
    command: 'go',
    format: 'all',
    deviceId: 127,
    cueNumber: '',
    cueList: '',
    destination: 'desk',
    portName: ''
  }
}

describe('the cue-field shape', () => {
  it('declares every field a cue of every type carries, with the kind it is written as', () => {
    for (const type of CUE_TYPES) {
      // A cue of the build's own shape, walked beside the declaration at every level: a field
      // the cue carries and the declaration has not learned fails here, and so does a declared
      // field the cue has not got — which is what the load funnel refuses a document for. The
      // cue carries no field the types make optional, so a declaration that demanded one fails
      // on the same walk.
      //
      // This is the half the `satisfies` cannot reach, and the one the union rules exist for:
      // a variant-shaped list or a mixed-kind value declared as one of its variants compiles
      // and would then refuse a document this build itself wrote — a `cc` message under a
      // declaration written for `noteOn`, a boolean OSC argument under one written for a
      // number — and the fixture carries both.
      expect(shapeDifferences(CUE_OF_TYPE[type], CUE_FIELD_SHAPE[type], ''), type).toEqual([])
    }
  })
})
