// Where a show's sound goes, by name: output patches, the mixer's faders, the audition
// output, and the loudness a show normalises its cues to.
//
// An output patch is a named set of device outputs — "Mains" is outputs 1–2, "Foldback" is 5
// and 6 — that a cue can play through instead of naming raw device channels. A cue routed
// through a patch addresses the patch's own channels (its matrix's outputs are the patch's
// channels 1, 2, …), so a rig that moves the mains to outputs 3–4 changes one patch, not every
// cue. Each patch has a fader and a mute in the mixer, and so does each device output; the
// engine applies them (native/audio/src/mixer.cpp, the buses) and meters each one after them.
//
// All of it is the show's, kept in its audio settings, and all of it optional: a show written
// before patches existed carries none of these fields, saves without them, and plays every
// cue on raw device channels exactly as it did.

import type { AudioSettings } from './workspace'
import { AUDIO_PATCH_SLOTS } from './audio'

export interface OutputPatch {
  id: string
  name: string
  /**
   * The output device the patch was made for, or '' for whichever the show is using. The
   * engine plays one device at a time: a patch made for another device plays on the
   * device's outputs of the same numbers, and the window says so beside it.
   */
  deviceId: string
  /** Device outputs, zero-based, one per patch channel: [0, 1] is outputs 1 and 2. */
  channels: number[]
  /** The patch's fader, dB; −60 and below is silence. */
  gainDb: number
  muted: boolean
}

/** One device output's own fader in the mixer. */
export interface OutputFader {
  gainDb: number
  muted: boolean
}

/** The show's EBU R128 target, and the true-peak ceiling a normalised cue stays under. */
export const DEFAULT_LOUDNESS_TARGET_LUFS = -23
export const DEFAULT_TRUE_PEAK_CEILING_DB = -1
/** The faders' floor and top, dB: the same scale as the master's. */
export const FADER_FLOOR_DB = -60
export const FADER_TOP_DB = 12

/** The routing fields of the show's audio settings, with this build's defaults in. */
export interface AudioRouting {
  patches: OutputPatch[]
  /** Index is the device output; a missing entry is a fader at 0 dB, unmuted. */
  outputs: OutputFader[]
  /** The patch audition plays through, or null for none chosen yet. */
  auditionPatchId: string | null
  loudnessTargetLufs: number
  truePeakCeilingDb: number
}

const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clampDb = (db: number): number => Math.min(FADER_TOP_DB, Math.max(FADER_FLOOR_DB, db))

/** A patch as a file may carry it, its numbers held to their ranges; null for one that is not. */
export function normalizePatch(value: unknown, index: number): OutputPatch | null {
  if (typeof value !== 'object' || value === null) return null
  const patch = value as Record<string, unknown>
  if (typeof patch.id !== 'string' || patch.id === '') return null
  const channels = Array.isArray(patch.channels)
    ? patch.channels.filter((c): c is number => typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < 32).slice(0, 32)
    : []
  return {
    id: patch.id,
    name: typeof patch.name === 'string' && patch.name.trim() !== '' ? patch.name : `Patch ${index + 1}`,
    deviceId: typeof patch.deviceId === 'string' ? patch.deviceId : '',
    channels,
    gainDb: clampDb(finite(patch.gainDb, 0)),
    muted: patch.muted === true
  }
}

/** The routing a show's audio settings carry, read with this build's defaults for what is absent. */
export function audioRoutingOf(settings: AudioSettings): AudioRouting {
  const patches: OutputPatch[] = []
  const seen = new Set<string>()
  for (const [index, entry] of (Array.isArray(settings.outputPatches) ? settings.outputPatches : []).entries()) {
    const patch = normalizePatch(entry, index)
    if (patch === null || seen.has(patch.id) || patches.length >= AUDIO_PATCH_SLOTS) continue
    seen.add(patch.id)
    patches.push(patch)
  }
  const outputs = (Array.isArray(settings.outputFaders) ? settings.outputFaders : []).slice(0, 32).map(entry => ({
    gainDb: clampDb(finite((entry as OutputFader | null)?.gainDb, 0)),
    muted: (entry as OutputFader | null)?.muted === true
  }))
  const audition = settings.auditionPatchId
  return {
    patches,
    outputs,
    auditionPatchId: typeof audition === 'string' && seen.has(audition) ? audition : null,
    loudnessTargetLufs: Math.min(0, Math.max(-60, finite(settings.loudnessTargetLufs, DEFAULT_LOUDNESS_TARGET_LUFS))),
    truePeakCeilingDb: Math.min(0, Math.max(-20, finite(settings.truePeakCeilingDb, DEFAULT_TRUE_PEAK_CEILING_DB)))
  }
}

/**
 * The audio settings with a routing written back into them — each field only when it says
 * something, so a show that has never touched patches, faders or the loudness target saves
 * the bytes it always did.
 */
export function withAudioRouting(settings: AudioSettings, routing: AudioRouting): AudioSettings {
  const next: AudioSettings = { ...settings }
  delete next.outputPatches
  delete next.outputFaders
  delete next.auditionPatchId
  delete next.loudnessTargetLufs
  delete next.truePeakCeilingDb
  if (routing.patches.length > 0) next.outputPatches = routing.patches
  // Trailing faders at unity are what an absent entry means: they are not written.
  const outputs = [...routing.outputs]
  while (outputs.length > 0 && outputs[outputs.length - 1].gainDb === 0 && !outputs[outputs.length - 1].muted) outputs.pop()
  if (outputs.length > 0) next.outputFaders = outputs
  if (routing.auditionPatchId !== null) next.auditionPatchId = routing.auditionPatchId
  if (routing.loudnessTargetLufs !== DEFAULT_LOUDNESS_TARGET_LUFS) next.loudnessTargetLufs = routing.loudnessTargetLufs
  if (routing.truePeakCeilingDb !== DEFAULT_TRUE_PEAK_CEILING_DB) next.truePeakCeilingDb = routing.truePeakCeilingDb
  return next
}

/** A fader in dB as the engine's linear gain, with its mute: the floor is silence. */
export function faderGain(gainDb: number, muted: boolean): number {
  if (muted || gainDb <= FADER_FLOOR_DB) return 0
  return Math.pow(10, gainDb / 20)
}

/** The fader for device output `output`, at unity when the show has not moved it. */
export function outputFader(routing: AudioRouting, output: number): OutputFader {
  return routing.outputs[output] ?? { gainDb: 0, muted: false }
}

/** The routing with output `output`'s fader replaced, the list grown to reach it. */
export function withOutputFader(routing: AudioRouting, output: number, fader: OutputFader): AudioRouting {
  const outputs = [...routing.outputs]
  while (outputs.length <= output) outputs.push({ gainDb: 0, muted: false })
  outputs[output] = { gainDb: clampDb(fader.gainDb), muted: fader.muted }
  return { ...routing, outputs }
}

/**
 * Which engine slot each patch plays on. A patch keeps its slot for as long as it exists —
 * a voice playing through one is never moved to another's bus because a patch before it
 * was deleted — and a new patch takes the lowest slot free.
 */
export function assignPatchSlots(patches: readonly OutputPatch[], previous: ReadonlyMap<string, number>): Map<string, number> {
  const slots = new Map<string, number>()
  const taken = new Set<number>()
  for (const patch of patches) {
    const slot = previous.get(patch.id)
    if (slot !== undefined && !taken.has(slot)) {
      slots.set(patch.id, slot)
      taken.add(slot)
    }
  }
  for (const patch of patches) {
    if (slots.has(patch.id)) continue
    for (let slot = 0; slot < AUDIO_PATCH_SLOTS; slot++) {
      if (taken.has(slot)) continue
      slots.set(patch.id, slot)
      taken.add(slot)
      break
    }
  }
  return slots
}

/** A patch's channels as the window writes them: "1–2", "5, 7". */
export function patchChannelsLabel(channels: readonly number[]): string {
  if (channels.length === 0) return 'no outputs'
  const ones = channels.map(c => c + 1)
  const consecutive = ones.every((c, i) => i === 0 || c === ones[i - 1] + 1)
  if (consecutive && ones.length > 1) return `${ones[0]}–${ones[ones.length - 1]}`
  return ones.join(', ')
}

/** A new patch's id: unique within the show it is added to. */
export function newPatchId(existing: readonly OutputPatch[]): string {
  let n = existing.length + 1
  while (existing.some(patch => patch.id === `patch-${n}`)) n++
  return `patch-${n}`
}
