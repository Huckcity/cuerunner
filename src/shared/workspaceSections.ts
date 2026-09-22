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
