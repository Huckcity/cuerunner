import type { Cue } from './cue'
import type { ShowSettings } from './show'
import type { ShowHistoryEntry } from './showfile'
import type { LightingSettings } from './dmx'
import type { TimecodeShowSettings } from './timecode'
import type { PictureSettings, VideoOutput } from './visual'
import type { CueListInfo } from './cueLists'

export interface AudioSettings {
  /**
   * The audio system the show asks the engine to use. Absent means the engine's own
   * default, which is the platform's own audio stack.
   */
  backend?: 'auto' | 'asio'
  outputDeviceId: string
  /** Requested sample rate, Hz. Absent leaves the device's own rate. */
  sampleRate?: number
  /** Requested output channels. Absent leaves the device's own count. */
  channels?: number
  /** Take the device exclusively, where the driver allows it. */
  exclusive?: boolean
  /** Requested buffer size in frames. Absent leaves the engine's own. */
  bufferFrames?: number
  /**
   * Whether a new audio cue is born trimming the silence from its file's edges. A
   * default, not a switch: it is copied into the cue when the cue is made, so turning
   * it on or off changes nothing that is already in the show.
   */
  autoTrimSilence?: boolean
}

export interface MidiSettings {
  outputPortName: string
}

/**
 * The guard that stands in front of every way a cue can be fired: the keyboard, an OSC
 * datagram, a MIDI message. A press whose hand shakes, or a desk that sends the same
 * message twice, should start one cue rather than two — and a cue that is already
 * running should not be restarted by the second one unless it was asked to be.
 *
 * A window rather than a set of per-surface timings, because an operator who has just
 * watched a doubled note truncate a cue reaches for one number, not three. It travels
 * with the show: the desk on the other end is part of the show.
 */
export interface TriggerGuardSettings {
  /**
   * How long, in milliseconds, one surface stays deaf after it fires a cue. Zero turns
   * the window off — which is a thing a show may want, and the reason it is a field
   * rather than a constant.
   */
  windowMs: number
  /**
   * How long the operator's STOP fades everything over, ms. Optional, and absent or 0 is the
   * cut STOP has always been; a show that fades has a second STOP during the fade cut it.
   */
  stopFadeMs?: number
}

/**
 * What a new show's guard is: long enough to swallow the bounce of a key, a footswitch
 * or a desk sending twice, and short enough that two cues meant as two cues are two
 * cues. Nothing musical lives inside a third of a second.
 */
export const DEFAULT_TRIGGER_GUARD: TriggerGuardSettings = { windowMs: 300 }

/**
 * The name a show has until somebody gives it one. A save that puts such a show in a file
 * for the first time names it after the file (`saveWorkspace`), because a show called
 * "Untitled" in a file called "Macbeth" is two names for one thing.
 */
export const UNTITLED_SHOW = 'Untitled'

/** Whether a show's name is still the one it was born with, or nothing at all. */
export function isUnnamedShow(name: string | undefined): boolean {
  return name === undefined || name.trim() === '' || name === UNTITLED_SHOW
}

/** The guard's editable range. A window past two seconds is a cue that refused to fire. */
export const TRIGGER_GUARD_MIN_MS = 0
export const TRIGGER_GUARD_MAX_MS = 2000

/** The longest STOP fade the setting takes: past this, STOP is a fade cue. */
export const STOP_FADE_MAX_MS = 10_000

/** Fills in a gate a workspace saved by an older build never wrote. */
export function normalizeTriggerGuard(
  guard: Partial<TriggerGuardSettings> | undefined
): TriggerGuardSettings {
  const windowMs = guard?.windowMs
  const stopFadeMs = guard?.stopFadeMs
  // Carried only when it is a fade: a show that cuts writes no field, so its file is the
  // bytes it always was.
  const fade = typeof stopFadeMs === 'number' && Number.isFinite(stopFadeMs) && stopFadeMs > 0
    ? { stopFadeMs: Math.min(Math.round(stopFadeMs), STOP_FADE_MAX_MS) }
    : {}
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs)) return { ...DEFAULT_TRIGGER_GUARD, ...fade }
  return {
    windowMs: Math.min(Math.max(windowMs, TRIGGER_GUARD_MIN_MS), TRIGGER_GUARD_MAX_MS),
    ...fade
  }
}

/**
 * A show's identity as it is stored: minted once, when the show is made, and carried by
 * every save afterwards. Saving is not a new show, so nothing about a save may change
 * these — a file that rewrites its own id and date on every write cannot be diffed, and
 * a version history is the point of the format.
 */
export interface WorkspaceIdentity {
  id: string
  createdAt: string
}

/**
 * One repair a load made to a file's cue grouping: a group's children gathered behind
 * it, a cue whose group is not in the file returned to the top level, or a loop of
 * groups dissolved. Loading never writes a file, so the repair lives in the session
 * only until a save writes it — the note is how the operator hears that the grouping on
 * screen is not the bytes on disk.
 */
export interface LoadNote {
  /** The cue the note is about: the orphan, the loop member, or the group whose children moved. */
  cueId: string
  kind: 'reordered' | 'missing-group' | 'cycle' | 'missing-list' | 'list-in-group'
  /** What happened, in one line, ready for the dialog that lists it. */
  detail: string
}

export interface Workspace {
  version: 1
  id: string
  name: string
  createdAt: string
  /**
   * What the file's saves have changed, oldest first, written by the app rather than by
   * the renderer. Optional: a workspace saved before the history existed has none, and
   * the first save that changes something adds the first entry. A save that changes
   * nothing adds nothing, which is what keeps an untouched showfile byte-identical.
   */
  history?: ShowHistoryEntry[]
  audioSettings: AudioSettings
  midiSettings: MidiSettings
  /**
   * Ports and listeners for the show services. Optional: a workspace saved before the
   * services existed carries no such section, and no load fills one in — the window's own
   * defaults stand in for settings a file does not have. A file that does carry one has to
   * carry exactly the sections this build declares, or it is refused.
   */
  showSettings?: ShowSettings
  /**
   * How long a firing surface stays deaf afterwards. Optional for the same reason: a
   * workspace saved before the guard existed has none, and this is the one section a load
   * still completes — the default, because a show with no guard is a show whose first
   * bounced key truncates a cue.
   */
  triggerGuard?: TriggerGuardSettings
  /**
   * The lighting rig: fixtures, their types, groups, and where each universe goes. Optional:
   * a show with no lights carries no such section, and a show saved before lighting existed
   * opens with an empty rig rather than being refused.
   */
  lighting?: LightingSettings
  /**
   * How the show follows an incoming SMPTE clock: chase, what the cues do when it stops, the
   * offset and the rate it is read at. Optional: a show that leaves every one of them at its
   * default carries no such section, so a show saved before timecode existed — or never
   * touched it — writes the bytes it always wrote. Which port or input the clock arrives on
   * is the machine's, not here.
   */
  timecode?: TimecodeShowSettings
  /**
   * The windows the show's pictures go to (src/shared/visual.ts). Optional: a show with no
   * video output carries none, which is every show written before outputs existed — so
   * their bytes are what they were. Where each output is on a machine is that machine's.
   */
  videoOutputs?: VideoOutput[]
  /**
   * The show's cue lists, in tab order: each one's id, name, colour and what it decides for
   * its cues (`./cueLists`). Optional: a show with only its main list, under its own name,
   * carries no such section, so a show saved before lists existed writes the bytes it always
   * wrote. A cue names its list with `listId`; one that names none is in the main list.
   */
  cueLists?: CueListInfo[]
  /**
   * What the show says about its pictures as a whole (src/shared/visual.ts). Optional: a show
   * that leaves them at the defaults carries none, so its bytes are what they were.
   */
  pictures?: PictureSettings
  cues: Cue[]
}

/**
 * Whether a document an operator picked is a show at all: it carries a cue list, and the
 * cue list is a list.
 *
 * The four load funnels that ask this before they hand a document to `migrateWorkspace` are
 * the plain `.cuerunner` read, a bundle's show entry, the app's own recovery snapshot and
 * the demo the app ships, and each has the bytes parsed by the time it can ask. The funnel
 * is called with documents that were not read this way too (the save's `historyForSave` and
 * `compareWithFile` parse a value they built or were handed), and those callers are not
 * this check's business.
 *
 * What the funnel does with a document that is not a show is iterate the cue list first —
 * `refuseForeignCues`'s `for (const cue of cues)` — and throw V8's own text about it:
 * `undefined is not iterable` where the key is absent, `… is not iterable` where it is
 * there and holds a value that cannot be iterated. Neither names the file; a refusal
 * written here does.
 *
 * The check is the cue list alone. It is the key every reader of a workspace walks first,
 * so a document without one is not a show whichever of its other keys happen to be there,
 * and it is the one key this build cannot invent: a file saved by any build this app has
 * ever shipped carries it. Whether the rest of the shape is a show is the funnel's
 * business, and its refusals are its own.
 */
export function hasCueList(value: unknown): value is { cues: unknown[] } {
  if (typeof value !== 'object' || value === null) return false
  if (!('cues' in value)) return false
  return Array.isArray(value.cues)
}
