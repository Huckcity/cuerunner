// The saved form, declared once.
//
// A `.cuerunner` file is one shape with four readers: the serialiser that writes it, the
// constructor the window builds it with, the settings diff that compares it and the merge
// that blends two of them. Each of those used to carry its own list of the shape's
// sections, and a section kept in one list but not another was written by the file and
// then invisible — never compared, never merged, silently kept ours. This is the one list.
//
// An entry is a key of the `Workspace`, the route the settings diff reports the section's
// changes under (none for the keys that are not settings a person reads) and what a merge
// does with it. The entries are in the order the file's keys are written: the bytes are
// held to that order, and both writers build through `savedShape`, so the order changes
// here and nowhere else.
//
// A section added here is a section all four see. The builders take their values through
// `WorkspaceValues`, so a required section added here is a value no call site can leave
// out; the serialiser writes it, the diff compares it under its route, and the merge
// blends it the way its behaviour says. The walk test
// (`src/main/workspace/savedShape.test.ts`) fails on a section that reaches only some of
// them, and on a section of the workspace that this declaration does not carry.
//
// The show's own settings are a shape of their own inside `showSettings`, so they are
// declared here too: `SHOW_SETTINGS_SECTIONS` is what the load funnel's shape check reads,
// and the same walk test holds it total against `ShowSettings`.
//
// Sections are not enough to tell a file this build can read from one it cannot: a
// settings section is an object whose fields the window dereferences, so the same
// declaration goes on to name every field inside them — `SHOW_SETTINGS_SHAPE` — and, with
// the kind each field's own type writes it as, the fields a cue of each type carries —
// `CUE_FIELD_SHAPE` — and the kind of each of the form's own sections nothing walks field
// by field — `WORKSPACE_SECTION_SHAPE`. What the shape check reads is these three, and
// nothing else reads them: a settings field this build does not write is a refusal rather
// than a value the window finds `undefined` under, which is what a file written before a
// field existed would otherwise load as, and a declared field carrying the wrong kind is
// refused with a sentence rather than left for the reader that dereferences it — a cue's
// `messages` holding a number is a fault at `messages.flatMap(…)`, a `history` holding one
// is a fault at `[...history]`, and the funnel promises a sentence. A cue keeps what the
// declaration does not name, because a cue on disk carries `media`; the settings' table is
// this build's own whole, so there a field it does not name refuses.

import type { Cue, CueBase, CueType } from './cue'
import type { ShowSettings } from './show'
import type { Workspace } from './workspace'

/**
 * A section of the saved form. The route is required exactly when a merge blends the
 * section, and may be absent otherwise:
 *
 * - `section` and `keys` blend, and report their changes under the route the settings
 *   diff reads — a blending section with no route would be merged under `null.<field>`
 *   and never compared, so the two cannot be declared apart;
 * - `ours` and `cue` are left to the merge's own handling; `name` is the one of those
 *   that is still a setting a person reads.
 */
export type WorkspaceSection =
  | {
      /** The key in the saved form, which is a key of the `Workspace` too. */
      readonly key: keyof Workspace
      /** The route the settings diff reports this section's changes under. */
      readonly route: string
      /** The merge blends this section: the whole section, or a key at a time. */
      readonly merge: 'section' | 'keys'
    }
  | {
      readonly key: keyof Workspace
      /** A setting a person reads, or nothing when the section is not one. */
      readonly route: string | null
      /** The merge leaves this section alone: it is the destination's, or the cue list. */
      readonly merge: 'ours' | 'cue'
    }

/**
 * The saved form's sections, in the order the file's keys are written. The `satisfies`
 * holds the entries to the shape above, and the `key`s to `keyof Workspace`; that the
 * declaration carries every key of a `Workspace` is what the walk test holds.
 */
export const WORKSPACE_SECTIONS = [
  { key: 'version', route: null, merge: 'ours' },
  { key: 'id', route: null, merge: 'ours' },
  { key: 'name', route: 'name', merge: 'ours' },
  { key: 'createdAt', route: null, merge: 'ours' },
  { key: 'history', route: null, merge: 'ours' },
  { key: 'audioSettings', route: 'audio', merge: 'section' },
  { key: 'midiSettings', route: 'midi', merge: 'section' },
  { key: 'showSettings', route: 'show', merge: 'keys' },
  { key: 'triggerGuard', route: 'guard', merge: 'section' },
  { key: 'cues', route: null, merge: 'cue' }
] as const satisfies readonly WorkspaceSection[]

/** Every key of the saved form, from the declaration itself. */
export type WorkspaceKey = (typeof WORKSPACE_SECTIONS)[number]['key']

/**
 * The sections a show's settings carry, in the order `ShowSettings` declares them and
 * `defaultShowSettings` builds them. This is the list the load funnel's shape check reads:
 * a file that carries a `showSettings` has to carry exactly these — one this build does not
 * declare is a refusal, and one it leaves out is a refusal too. Loading no longer fills a
 * section in, so a file that is missing one is a file this build cannot read rather than
 * one it quietly completes.
 *
 * Like `WORKSPACE_SECTIONS`, the `satisfies` holds each entry to a key of `ShowSettings`;
 * that the list carries every key — and no key twice — is what the walk test holds.
 */
export const SHOW_SETTINGS_SECTIONS = [
  'oscIn',
  'midiIn',
  'desk',
  'rf',
  'presence',
  'script',
  'companion',
  'scenes',
  'cast'
] as const satisfies readonly (keyof ShowSettings)[]

/** A section of a show's settings, from the declaration itself. */
export type ShowSettingsSection = (typeof SHOW_SETTINGS_SECTIONS)[number]

/**
 * The fields of one object, as the declaration carries them: a name per field of `T`.
 *
 * An entry is one of six things, and the kinds are the types' — a leaf of `'string'`,
 * `'number'` or `'boolean'`, what a value nothing inside is read has to be on disk; the
 * `'object'` leaf, for a type with more than one field set — a union of variants, or an open
 * record whose keys are the document's — because a declaration written for one variant would
 * refuse the others; `{ oneOf: […] }`, for a value whose type allows more than one kind — a
 * union of mixed kinds, which no single tag could hold — with every kind it allows;
 * `{ items }`, for a list of one primitive kind or of objects where the elements are a union
 * of variants; `{ elements }`, for a list whose every element is an object with those fields;
 * and an object's own fields, declared the same way. A union of strings is still a string.
 * A field whose type allows `null` is declared `{ nothing: true, of: … }` around its shape,
 * mirroring the `{ absent: true, of: … }` a field `T` marks `?:` gets, and a field that is
 * both optional and null-able carries both wrappers: `null` is legal exactly where the types
 * allow it, and a runtime tag has to be one value. `absent`, `nothing`, `of`, `elements`,
 * `items` and `oneOf` are the declaration's own names, so a field called any of them fails
 * to compile here rather than being read as a flag or a list.
 *
 * This is the reach of the `satisfies` on the shapes below: it holds the declaration to the
 * types, at every level — every field of every settings object is named and no name the
 * type does not carry is accepted, so a field added to `ShowSettings` fails to compile
 * until it is declared, and so does a field the declaration invents, and so does a tag that
 * disagrees with the field's type. What no value-level `satisfies` can hold is that a
 * *document* is read the way the declaration says; that is the walk test's half
 * (`src/main/workspace/savedShape.test.ts` walks a whole value of the settings against the
 * declaration), and the funnel tests' half (a document off that shape refuses).
 */
export type ShapeFields<T> = {
  readonly [K in keyof T]-?: {} extends Pick<T, K>
    ? { readonly absent: true; readonly of: ShapeNode<T[K]> }
    : ShapeNode<T[K]>
} & {
  readonly absent?: never
  readonly of?: never
  readonly elements?: never
  readonly items?: never
  readonly nothing?: never
  readonly oneOf?: never
}

/** A leaf's declared kind: the one value a leaf of that kind may be on disk. */
export type ShapeLeaf = 'string' | 'number' | 'boolean' | 'object'

/** A primitive's own tag: what a leaf of that kind is on disk, or nothing for any other type. */
type LeafTagOf<T> = [T] extends [string]
  ? 'string'
  : [T] extends [number]
    ? 'number'
    : [T] extends [boolean]
      ? 'boolean'
      : never

/**
 * The kinds a primitive's type allows, as its own tags: a union of strings is one kind —
 * `advance` is a string either way — and `number | string | boolean` is three.
 */
type AllowedKinds<T> = T extends string
  ? 'string'
  : T extends number
    ? 'number'
    : T extends boolean
      ? 'boolean'
      : never

/**
 * Whether `T` is a union rather than one type — the fact that a value has more than one field
 * set, or more than one kind. The comparison is bracketed so the union is read whole, and the
 * check itself distributes over it: each member asks whether the whole union is assignable to
 * that member alone, which is false exactly when another member exists, so the members answer
 * alike. `never` answers false rather than distributing over nothing, which is what leaves a
 * type with no kind of its own — a function, a symbol — failing on the tag it has none.
 */
type IsUnion<T, U = T> = [T] extends [never]
  ? false
  : T extends unknown
    ? [U] extends [T]
      ? false
      : true
    : never

/**
 * Whether `T` is an open record: a type whose keys are the document's rather than the types' —
 * `network.headers`, whose every entry is a string this build never named. Its fields cannot be
 * declared and a document's own are no refusal, so the value is held to being an object and what
 * is inside it is read as it stands.
 */
type IsRecord<T> = string extends keyof T ? true : false

/**
 * One field's shape, as the types give the field: a field `T` marks `?:` carries `undefined`
 * in its type, and that is the one thing the `absent` wrapper already declares, so it comes off
 * before any shape is asked for. An optional list of objects, an optional list of primitives and
 * an optional primitive therefore take the shape of the value they would carry.
 */
export type ShapeNode<T> = ShapeNodeOf<Exclude<T, undefined>>

/**
 * The shape of a value that is there: a primitive leaf, a list of primitives, a list of objects,
 * or an object's own fields — a leaf the types allow `null` for wrapped in `{ nothing: true,
 * of: … }`, so the declaration says where a document may carry `null`.
 *
 * Every test is bracketed, so a union type is read as one type rather than distributed over: a
 * union of strings is still a `string` and takes that tag, while a union of objects or of mixed
 * kinds meets the two rules below. A list whose elements are a union of variants is bounded at
 * its elements — `{ items: 'object' }`, every element an object while the variants' own fields
 * are not declared — because one variant's fields are not another's, and a declaration written
 * for either would refuse the other.
 */
type ShapeNodeOf<T> = null extends T
  ? { readonly nothing: true; readonly of: ShapeNode<Exclude<T, null>> }
  : [T] extends [readonly (infer E)[]]
    ? [E] extends [object]
      ? IsUnion<E> extends true
        ? { readonly items: 'object' }
        : { readonly elements: ShapeFields<E> }
      : { readonly items: LeafTagOf<E> }
    : [T] extends [object]
      ? ObjectNodeOf<T>
      : LeafNodeOf<T>

/**
 * A field whose type is an object: its own fields where the type has one field set, and
 * `'object'` where it has more than one — a union of variants, no one of which a declaration
 * could describe without refusing the others, and an open record, whose fields are the
 * document's. `'object'` is the value's own kind and the end of the walk for that field: the
 * variants' fields are not declared, which is the rule a field this build does not name already
 * gets.
 */
type ObjectNodeOf<T> = IsUnion<T> extends true
  ? 'object'
  : IsRecord<T> extends true
    ? 'object'
    : ShapeFields<T>

/**
 * A field whose type is a primitive: its own tag where the type allows one kind, and
 * `{ oneOf: […] }` — every kind it allows — where it allows several, which no single tag could
 * hold. A union of strings is one kind and stays a string; `OscArg.value`, a number, a string or
 * a boolean, is the mixed case, and the refusal a document meets there names all three.
 */
type LeafNodeOf<T> = IsUnion<AllowedKinds<T>> extends true
  ? { readonly oneOf: readonly AllowedKinds<T>[] }
  : LeafTagOf<T> | (T extends number ? BoundedNumber : never)

/**
 * A number the form writes within bounds — the one thing a type cannot say, so it is written
 * where it applies rather than derived: a value of this kind's type is still `number`, and
 * `volume: 5` is a number the app's own control cannot produce (its range is `min={0} max={1}`)
 * and the engine reads as a gain of five.
 *
 * The bounds are inclusive and the value must be finite, so `NaN` and `Infinity` are refused
 * here as well as being outside every range a field declares.
 */
export type BoundedNumber = { readonly bounded: readonly [min: number, max: number] }

/**
 * A show's settings, field by field: the one declaration of the field shape the load
 * funnel's check reads, in the order `ShowSettings` and the types under it declare their
 * fields. The shape check reads a document with it in both directions — a field it does not
 * carry is refused, and a declared field the document leaves out is refused too, because a
 * field a later build added is a field the window dereferences — and each field's value is
 * then held to the kind its tag declares, down to a list's elements. A field the types mark
 * `?:` is the one exception to the field itself, and today none is: every field of
 * `ShowSettings` is a field a document has to carry. What the types allow `null` for is
 * declared `{ nothing: true, of: … }`, and `null` anywhere else is the wrong kind rather
 * than a value to be read. `TelemetryChannel` is the external bridge document's own shape —
 * what a telemetry source is asked to produce — and it is not part of these settings, so it
 * is not declared here and a receiver's channel fields are not read.
 *
 * The `satisfies` binds each section's fields to that section's type, as `ShapeFields`
 * describes; that the declaration carries every section's fields — and no others — is
 * therefore a compile error away. What it cannot reach is the *document*: the walk test
 * holds the declaration against a value of the whole of `ShowSettings`.
 */
export const SHOW_SETTINGS_SHAPE = {
  oscIn: {
    enabled: 'boolean',
    port: 'number',
    remote: { absent: true, of: 'boolean' },
    allowFrom: { absent: true, of: { items: 'string' } }
  },
  midiIn: { enabled: 'boolean', portNames: { items: 'string' } },
  desk: {
    kind: 'string',
    profile: 'string',
    midiPort: 'string',
    midiChannel: 'number',
    host: 'string',
    port: 'number',
    tcpPort: 'number',
    address: 'string',
    // The desk's own buttons: an object of its own inside the section, which is why the
    // declaration nests rather than stopping at the section's fields.
    buttons: {
      go: { nothing: true, of: 'number' },
      back: { nothing: true, of: 'number' },
      goNote: { nothing: true, of: 'number' },
      backNote: { nothing: true, of: 'number' }
    }
  },
  rf: {
    plot: {
      packs: {
        elements: {
          id: 'string',
          label: 'string',
          channelId: { nothing: true, of: 'string' },
          performerId: { nothing: true, of: 'string' },
          notes: 'string'
        }
      }
    },
    sources: {
      elements: {
        id: 'string',
        label: 'string',
        kind: 'string',
        target: 'string',
        pollMs: 'number',
        timeoutMs: 'number'
      }
    },
    thresholds: {
      batteryWarning: 'number',
      batteryCritical: 'number',
      rfWarningDbm: 'number',
      offlineAfterSeconds: 'number'
    },
    swaps: {
      elements: {
        at: 'number',
        packId: 'string',
        packLabel: 'string',
        from: { nothing: true, of: 'string' },
        to: { nothing: true, of: 'string' }
      }
    }
  },
  presence: { enabled: 'boolean', services: { items: 'string' }, goneAfterSeconds: 'number' },
  script: { path: 'string', fontSize: 'number' },
  companion: { enabled: 'boolean', port: 'number', token: 'string' },
  scenes: {
    list: {
      elements: {
        id: 'string',
        name: 'string',
        dcas: {
          elements: { dcaId: 'string', kind: 'string', memberId: 'string' }
        },
        notes: 'string'
      }
    },
    allowDuplicateAssignment: 'boolean',
    highestWins: { absent: true, of: 'boolean' }
  },
  cast: {
    channels: { elements: { id: 'string', name: 'string' } },
    performers: {
      elements: {
        id: 'string',
        name: 'string',
        role: 'string',
        notes: 'string',
        channelId: { nothing: true, of: 'string' }
      }
    },
    ensembles: { elements: { id: 'string', name: 'string', channelIds: { items: 'string' } } },
    dcas: { elements: { id: 'string', deskNumber: { nothing: true, of: 'number' } } }
  }
} as const satisfies { readonly [S in ShowSettingsSection]: ShapeFields<ShowSettings[S]> }

/**
 * The sections of the form whose kind the load funnel's shape check reads: the show's own id,
 * name and date, its history, and the two settings. These are the sections the window reads
 * as the types say and no walk reads field by field, so the kind is the level a file carrying
 * something else differs at — a `history` that is not a list is a fault at `[...history]` in
 * the changes dialog and at `appendHistory` in a save, and the funnel promises a sentence.
 *
 * `showSettings` and `cues` are not here: the check reads them through their own declarations
 * above. Nor is `triggerGuard`, which a load completes through `normalizeTriggerGuard` — a
 * guard of the wrong kind is read as the default rather than refused — or `version`, whose
 * one value the check reads as the literal it is.
 */
type KindOnlySectionKey = 'id' | 'name' | 'createdAt' | 'history' | 'audioSettings' | 'midiSettings'

/**
 * The kind a section of the form is read as, from the field's own type: the leaf a primitive
 * writes it as, a list of objects where the type is a list, and an object otherwise. It is
 * the coarse half of `ShapeNode`, for the sections whose fields the declaration does not name
 * one by one: what is read there is the section's kind, which is the level the window's own
 * reads of it differ at.
 */
type SectionKindOf<T> = [T] extends [string]
  ? 'string'
  : [T] extends [number]
    ? 'number'
    : [T] extends [boolean]
      ? 'boolean'
      : [T] extends [readonly object[]]
        ? { readonly items: 'object' }
        : 'object'

/**
 * The kind of each of those sections, as the check reads it. Like the tables above, the
 * `satisfies` holds each entry to the field it names — read without the `undefined` a field
 * the types mark `?:` carries where it is absent, since an absent section is one the walk
 * does not read: a kind that disagrees with the field's type is a compile error until it is
 * put right.
 */
export const WORKSPACE_SECTION_SHAPE = {
  id: 'string',
  name: 'string',
  createdAt: 'string',
  history: { items: 'object' },
  audioSettings: 'object',
  midiSettings: 'object'
} as const satisfies {
  readonly [K in KindOnlySectionKey]: SectionKindOf<NonNullable<Workspace[K]>>
}

/**
 * The declaration as the check reads it: the value above with the types left out. A field's
 * entry is what `ShapeFields` says it is — a leaf's own `'string' | 'number' | 'boolean' |
 * 'object'`, `{ items }` for a list of primitives or of objects where their type is a union,
 * `{ elements }` for a list of objects, `{ oneOf: […] }` for a value whose type allows more
 * than one kind, an object's own fields otherwise — wrapped as `{ absent: true, of: … }`
 * where the types mark the field `?:` and `{ nothing: true, of: … }` where they allow `null`,
 * which a field may carry both of.
 */
export type DeclaredFields = { readonly [field: string]: unknown }

/** The fields every cue carries, from `CueBase`, with the kind each is written as. */
const CUE_BASE_SHAPE = {
  id: 'string',
  number: 'string',
  name: 'string',
  colorLabel: 'string',
  parentId: { nothing: true, of: 'string' },
  preWait: 'number',
  postWait: 'number',
  timelineOffset: 'number',
  duration: 'number',
  advance: 'string',
  isArmed: 'boolean',
  notes: 'string',
  // The fields the types mark `?:`: absent-marked, so a cue may leave them out. A trigger's
  // clauses are a union — what one carries another has not got — so a trigger is held to
  // being an object and the clauses' own fields are not declared.
  triggers: { absent: true, of: { items: 'object' } },
  refire: { absent: true, of: 'string' },
  scriptLine: { absent: true, of: { nothing: true, of: 'number' } }
} as const satisfies ShapeFields<CueBase>

/**
 * A cue's fields, by type, with the kind each is written as: the base every cue carries, the
 * type's own, and the `type` every cue is read by. The load funnel's check reads a document
 * with it, the way it reads the settings' — a declared field the document has not got refuses
 * unless the types mark it `?:`, and a declared field's value is held to the kind its entry
 * declares, down to a list's elements — with one thing the settings' walk refuses and this
 * one keeps: a field the declaration does not name. A cue on disk carries `media`, which the
 * runtime cue type does not declare, so the walk reads the declaration and never the
 * document's own fields.
 *
 * The `satisfies` binds each type's entry to that type, as `ShapeFields` describes: every
 * field of the type is named — a mapped type over the type's keys demands them all — and no
 * name the type does not carry is accepted, so a field added to a cue type, a kind that
 * disagrees with its field, or a name the declaration invents is a compile error until it is
 * put right. What it cannot hold is that the *document* is read the way the declaration says;
 * that is the walk test's half (`src/main/workspace/savedShape.test.ts` walks a cue of every
 * type against this declaration).
 */
export const CUE_FIELD_SHAPE = {
  audio: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    filePath: 'string',
    startTime: 'number',
    endTime: { nothing: true, of: 'number' },
    fadeInDuration: 'number',
    fadeOutDuration: { absent: true, of: 'number' },
    // Bounded where the app's own controls bound them: the inspector's sliders are min={0}
    // max={1} and min={-1} max={1}, and a hand-edited file reached the engine as a gain of
    // five before this was declared.
    volume: { bounded: [0, 1] },
    pan: { bounded: [-1, 1] },
    // Crosspoints, or `null` for the automatic routing this build reads as spread across the
    // pair — so the wrapper is around the list and not around its entries.
    outputs: {
      nothing: true,
      of: { elements: { inputChannel: 'number', outputChannel: 'number', gain: 'number' } }
    },
    loopCount: 'number',
    playbackRate: 'number',
    trim: 'number',
    trimSilence: { absent: true, of: 'boolean' },
    // The last measurement's record: a shape of its own, `null` until the file has been
    // scanned, and absent on a cue this build's earlier writers left one off.
    soundRegion: {
      absent: true,
      of: {
        nothing: true,
        of: { startMs: 'number', endMs: 'number', durationMs: 'number', silent: 'boolean' }
      }
    }
  },
  // A message is one of five variants — note on, note off, cc, program change, sysex — so the
  // list is bounded at its elements and what a message carries is not declared.
  midi: { ...CUE_BASE_SHAPE, type: 'string', portName: 'string', messages: { items: 'object' } },
  osc: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    host: 'string',
    port: 'number',
    address: 'string',
    // An argument is an object of two fields, and its value is the one field in the saved
    // form whose type allows more than one kind: a number, a string or a boolean.
    args: {
      elements: {
        type: 'string',
        value: { oneOf: ['number', 'string', 'boolean'] }
      }
    }
  },
  wait: { ...CUE_BASE_SHAPE, type: 'string' },
  fade: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    targetCueId: 'string',
    fadeProperty: 'string',
    targetValue: 'number',
    panTargetValue: { absent: true, of: { nothing: true, of: { bounded: [-1, 1] } } },
    curve: 'string',
    stopTargetWhenDone: 'boolean'
  },
  stop: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    targetCueId: 'string',
    fadeOut: 'boolean',
    fadeOutDuration: 'number',
    waitForFade: 'boolean'
  },
  group: { ...CUE_BASE_SHAPE, type: 'string', mode: 'string' },
  // The headers are an open record: the operator's own names for fields this build never
  // composes, so a header is held to being an object and its fields are the document's.
  network: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    method: 'string',
    url: 'string',
    body: 'string',
    headers: 'object',
    timeout: 'number'
  },
  script: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    language: 'string',
    script: 'string',
    timeout: 'number'
  },
  scene: { ...CUE_BASE_SHAPE, type: 'string', sceneId: 'string' },
  devamp: { ...CUE_BASE_SHAPE, type: 'string', targetCueId: 'string' },
  mic: { ...CUE_BASE_SHAPE, type: 'string', channelId: 'string', label: 'string', action: 'string' },
  memo: { ...CUE_BASE_SHAPE, type: 'string' },
  msc: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    command: 'string',
    format: 'string',
    deviceId: 'number',
    cueNumber: 'string',
    cueList: 'string',
    destination: 'string',
    portName: 'string'
  },
  midiFile: {
    ...CUE_BASE_SHAPE,
    type: 'string',
    filePath: 'string',
    portName: 'string',
    playbackRate: 'number',
    startTime: 'number',
    endTime: { nothing: true, of: 'number' },
    loopCount: 'number',
    // Sixteen output channels, one per channel of the file; the bounds are the player's to
    // refuse, where a channel map that is not one is a sentence rather than a load failure.
    channelMap: { items: 'number' },
    transpose: 'number',
    transposeDrums: 'boolean'
  }
} as const satisfies { readonly [K in CueType]: ShapeFields<Extract<Cue, { type: K }>> }

/**
 * The values a saved form is built from, keyed by the declaration: the type is `Pick`ed
 * from `Workspace` through the declared keys, so a section added to the declaration is a
 * value every builder must supply — and no builder can carry a key the shape does not
 * declare.
 */
export type WorkspaceValues = Pick<Workspace, WorkspaceKey>

/**
 * The saved form, its keys in the declared order. Both writers build through here: the
 * serialiser turns the result into the file's bytes and the constructor hands it to the
 * window, so the file's key order lives in exactly one place. A declared key the values
 * leave unset — an empty history, a file saved before the show services existed — stays
 * absent from the bytes, which is what `JSON.stringify` dropping an `undefined` gives.
 */
export function savedShape(values: WorkspaceValues): Workspace {
  const shape: Record<string, unknown> = {}
  for (const section of WORKSPACE_SECTIONS) shape[section.key] = values[section.key]
  return shape as unknown as Workspace
}
