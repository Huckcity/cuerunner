// The show's OSC patches: the named destinations an OSC cue's messages are sent to.
//
// A section of the saved form of its own (`oscPatches`), following the optional-section rule
// the lighting and the timecode set: a show with no patches carries no section, so every show
// saved before patches existed opens and saves byte-identical. The load funnel reads a file's
// section field by field with `OSC_PATCH_SHAPE`, and then for what a kind cannot say with
// `oscPatchesRefusal`: a port outside UDP's range, two patches under one id, more patches than
// a show is allowed.

import type { OscPatch } from './cue'
import type { ShapeFields } from './workspaceSections'

/** How many patches a show may name: far past any rig, and a bound on the read. */
export const MAX_OSC_PATCHES = 256

/** How long a patch's name or host may be. */
export const MAX_OSC_PATCH_TEXT = 128

export const OSC_PATCH_SHAPE = {
  id: 'string',
  name: 'string',
  host: 'string',
  port: { bounded: [1, 65535] }
} as const satisfies ShapeFields<OscPatch>

/**
 * What is wrong with a file's patches, as the end of a sentence, or null when nothing is. The
 * kinds were read first; this is what the kinds cannot hold.
 */
export function oscPatchesRefusal(patches: readonly OscPatch[]): string | null {
  if (patches.length > MAX_OSC_PATCHES) return `${patches.length} OSC patches, more than the ${MAX_OSC_PATCHES} a show may name`
  const seen = new Set<string>()
  for (const patch of patches) {
    if (patch.id === '') return 'an OSC patch with no id'
    if (seen.has(patch.id)) return `two OSC patches under one id (${patch.id})`
    seen.add(patch.id)
    if (patch.name.length > MAX_OSC_PATCH_TEXT || patch.host.length > MAX_OSC_PATCH_TEXT) {
      return `an OSC patch whose name or host is longer than ${MAX_OSC_PATCH_TEXT} characters`
    }
    if (!Number.isInteger(patch.port)) return `an OSC patch whose port is not a whole number (${patch.port})`
  }
  return null
}

/** The section as a save writes it: nothing at all for a show with no patches. */
export function savedOscPatches(patches: readonly OscPatch[] | undefined): OscPatch[] | undefined {
  return patches === undefined || patches.length === 0 ? undefined : patches.map(patch => ({ ...patch }))
}

/** The patches a document is read as: its own, or none. */
export function heldOscPatches(patches: readonly OscPatch[] | undefined): OscPatch[] {
  return patches === undefined ? [] : patches.map(patch => ({ ...patch }))
}

/** A patch's name as a list shows it, saying where it goes. */
export function describeOscPatch(patch: OscPatch): string {
  return `${patch.name || 'Untitled patch'} (${patch.host}:${patch.port})`
}
