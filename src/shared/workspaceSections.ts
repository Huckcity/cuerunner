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
// declaration goes on to name every field inside them — `SHOW_SETTINGS_SHAPE` — and the
// fields a cue of each type has to carry. What the shape check reads is these two, and
// nothing else reads them: a field this build does not write is a refusal rather than a
// value the window finds `undefined` under, which is what a file written before a field
// existed would otherwise load as.

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
 * The keys a value of `T` has to carry, as the types mark them: a key the type declares
 * `?:` is one a document may leave out, and is the only difference between this and
 * `keyof T`.
 */
export type RequiredKeys<T> = { readonly [K in keyof T]-?: {} extends Pick<T, K> ? never : K }[keyof T]

/**
 * The fields of one object, as the declaration carries them: a name per field of `T`.
 *
 * An entry is one of four things, and the kinds are the types': `'string'`, `'number'` and
 * `'boolean'` are a leaf of that kind — what a value nothing inside is read has to be on
 * disk, and a union of strings is still a string while a union of mixed kinds, which no single
 * tag could hold, is a compile error. `{ items }` is a list of one primitive
 * kind. `{ elements }` is a list whose every element is an object with those fields.
 * Anything else is an object's own fields, declared the same way. A field whose type allows
 * `null` is declared `{ nothing: true, of: … }` around its shape, mirroring the
 * `{ absent: true, of: … }` a field `T` marks `?:` gets, and a field that is both optional
 * and null-able carries both wrappers: `null` is legal exactly where the types allow it,
 * and a runtime tag has to be one value. `absent`, `nothing`, `of`, `elements` and `items`
 * are the declaration's own names, so a settings field called any of them fails to compile
 * here rather than being read as a flag or a list.
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
}

/** A leaf's declared kind: the one value a leaf of that kind may be on disk. */
export type ShapeLeaf = 'string' | 'number' | 'boolean'

/** A primitive's own tag: what a leaf of that kind is on disk, or nothing for any other type. */
type LeafTagOf<T> = [T] extends [string]
  ? 'string'
  : [T] extends [number]
    ? 'number'
    : [T] extends [boolean]
      ? 'boolean'
      : never

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
 * Every test is bracketed, so a union type is read as one type rather than distributed over:
 * a union of strings is still a `string` and takes that tag, while `string | number` reaches
 * `LeafTagOf` whole and has no tag at all, so a field declared with one fails to compile
 * instead of being under-declared as its first member's kind.
 */
type ShapeNodeOf<T> = null extends T
  ? { readonly nothing: true; readonly of: ShapeNode<Exclude<T, null>> }
  : [T] extends [readonly (infer E)[]]
    ? [E] extends [object]
      ? { readonly elements: ShapeFields<E> }
      : { readonly items: LeafTagOf<E> }
    : [T] extends [object]
      ? ShapeFields<T>
      : LeafTagOf<T>

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
  oscIn: { enabled: 'boolean', port: 'number' },
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
    allowDuplicateAssignment: 'boolean'
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
 * The declaration as the check reads it: the value above with the types left out. A field's
 * entry is what `ShapeFields` says it is — a leaf's own `'string' | 'number' | 'boolean'`,
 * `{ items }` for a list of primitives, `{ elements }` for a list of objects, an object's own
 * fields otherwise — wrapped as `{ absent: true, of: … }` where the types mark the field `?:`
 * and `{ nothing: true, of: … }` where they allow `null`, which a field may carry both of.
 */
export type DeclaredFields = { readonly [field: string]: unknown }

/** The fields every cue carries, from `CueBase`: the ones the types do not mark `?:`. */
const CUE_BASE_FIELDS = [
  'id',
  'number',
  'name',
  'colorLabel',
  'parentId',
  'preWait',
  'postWait',
  'timelineOffset',
  'duration',
  'advance',
  'isArmed',
  'notes'
] as const satisfies readonly RequiredKeys<CueBase>[]

/**
 * A cue's declared-required fields, by type: the base every cue shares, the type's own, and
 * the `type` every cue is read by. The load funnel's check refuses a cue that has not got
 * one of them — a field the deleted migration pass used to fill in, which is what a file
 * written before that field existed carries — and stops there: a cue on disk carries fields
 * the runtime cue type does not declare, `media` being the one left, so a field this build
 * does not declare is kept rather than refused.
 *
 * The fields the types mark `?:` — `triggers`, `refire`, `scriptLine` — are absent from
 * every list, and a name listed here that stops being required fails to compile: the
 * `satisfies` holds each name to a required key of that type. That each list carries them
 * *all* is what the walk test holds, against the build's own cue of each type.
 */
export const CUE_SHAPE = {
  audio: [...CUE_BASE_FIELDS, 'type', 'filePath', 'startTime', 'endTime', 'fadeInDuration', 'volume', 'pan', 'outputs', 'loopCount', 'playbackRate', 'trim'],
  midi: [...CUE_BASE_FIELDS, 'type', 'portName', 'messages'],
  osc: [...CUE_BASE_FIELDS, 'type', 'host', 'port', 'address', 'args'],
  wait: [...CUE_BASE_FIELDS, 'type'],
  fade: [...CUE_BASE_FIELDS, 'type', 'targetCueId', 'fadeProperty', 'targetValue', 'curve', 'stopTargetWhenDone'],
  stop: [...CUE_BASE_FIELDS, 'type', 'targetCueId', 'fadeOut', 'fadeOutDuration', 'waitForFade'],
  group: [...CUE_BASE_FIELDS, 'type', 'mode'],
  network: [...CUE_BASE_FIELDS, 'type', 'method', 'url', 'body', 'headers', 'timeout'],
  script: [...CUE_BASE_FIELDS, 'type', 'language', 'script', 'timeout'],
  scene: [...CUE_BASE_FIELDS, 'type', 'sceneId'],
  devamp: [...CUE_BASE_FIELDS, 'type', 'targetCueId'],
  msc: [...CUE_BASE_FIELDS, 'type', 'command', 'format', 'deviceId', 'cueNumber', 'cueList', 'destination', 'portName']
} as const satisfies { readonly [K in CueType]: readonly RequiredKeys<Extract<Cue, { type: K }>>[] }

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
