// The show's output patches and mixer faders, kept in the engine.
//
// The show holds patches by id and faders in dB (src/shared/audioRouting.ts); the engine holds
// sixteen patch slots and a linear gain per output. This is the one place the two meet: it
// gives each patch a slot that stays its own for as long as it exists, sends a slot only
// when what it holds has changed, and sends everything again to an engine that replaced the
// last one — so a fader moved during a show is one message, and a crash does not leave the
// new engine playing every cue on raw device channels.
//
// A cue resolves its patch here at the moment it is fired (`patchSlotOf`): a cue that names
// a patch the show no longer has plays on the device's own channels, which is what it did
// before patches existed, rather than not at all.
//
// A patch names its output device too, and the engine opens every device the show's patches
// name and keeps it open, so the first cue on it starts on a stream already running. What the
// engine answers about a device it could not open is kept here (`patchDeviceReasons`) for the
// window's fallback notice, and a device no patch names any more is closed, so a show that has
// moved on does not keep an interface it no longer uses.

import {
  assignPatchSlots,
  audioRoutingOf,
  faderGain,
  outputFader,
  patchDevices,
  type AudioRouting
} from '../../../shared/audioRouting'
import { AUDIO_PATCH_SLOTS } from '../../../shared/audio'
import type { AudioSettings } from '../../../shared/workspace'
import { audioEngine } from './audioEngineClient'

let slots = new Map<string, number>()
/** What each slot was last sent as, so an unchanged patch is not sent again. */
let sentSlots: string[] = new Array<string>(AUDIO_PATCH_SLOTS).fill('')
let sentGains = ''
/** The devices the show's patches named at the last sync, so a device dropped is closed once. */
let sentDevices = ''
/** What the engine said about each device a patch named and it could not open, by device id. */
let deviceReasons = new Map<string, string>()

/** The engine slot a patch plays on, or −1 for none — no patch named, or one the show lacks. */
export function patchSlotOf(patchId: string | null | undefined): number {
  if (patchId === null || patchId === undefined || patchId === '') return -1
  return slots.get(patchId) ?? -1
}

/** The engine's sentence about each device a patch named and it could not open, by device id. */
export function patchDeviceReasons(): ReadonlyMap<string, string> {
  return deviceReasons
}

/** The slots the show's patches are on right now. */
export function currentPatchSlots(): ReadonlyMap<string, number> {
  return slots
}

/** The output faders as the engine's gains, one per output up to the last one moved. */
export function outputGainsOf(routing: AudioRouting): number[] {
  return routing.outputs.map((_, output) => {
    const fader = outputFader(routing, output)
    return faderGain(fader.gainDb, fader.muted)
  })
}

/**
 * Brings the engine to the show's routing: each slot whose patch changed, and the output
 * faders when they did. `force` sends everything — an engine that has just started knows
 * nothing of what the last one held.
 */
export async function syncAudioRouting(settings: AudioSettings, force = false): Promise<void> {
  const routing = audioRoutingOf(settings)
  slots = assignPatchSlots(routing.patches, slots)
  if (force) {
    sentSlots = new Array<string>(AUDIO_PATCH_SLOTS).fill('?')
    sentGains = '?'
    sentDevices = '?'
    deviceReasons = new Map()
  }
  const sends: Promise<unknown>[] = []
  for (let slot = 0; slot < AUDIO_PATCH_SLOTS; slot++) {
    const patch = routing.patches.find(entry => slots.get(entry.id) === slot)
    const outputs = patch ? patch.channels : null
    const gain = patch ? faderGain(patch.gainDb, patch.muted) : 1
    const device = patch?.deviceId ?? ''
    const key = outputs === null ? '' : `${outputs.join(',')}@${gain}@${device}`
    if (key === sentSlots[slot]) continue
    sentSlots[slot] = key
    sends.push(audioEngine.patch(slot, outputs !== null && outputs.length > 0 ? outputs : null, gain, device)
      .then(result => {
        if (device === '') return
        if (result.fallback && result.reason !== null) deviceReasons.set(device, result.reason)
        else deviceReasons.delete(device)
      }))
  }
  const gains = outputGainsOf(routing)
  const gainsKey = gains.join(',')
  if (gainsKey !== sentGains) {
    sentGains = gainsKey
    sends.push(audioEngine.outputGains(gains))
  }
  await Promise.allSettled(sends)
  // Every patch is on its device now; a device none of them names is let go.
  const named = patchDevices(routing.patches, null)
  const namedKey = named.join('\n')
  if (namedKey !== sentDevices) {
    sentDevices = namedKey
    try {
      for (const open of await audioEngine.outputStatus()) {
        if (!named.includes(open.device)) await audioEngine.outputClose(open.device)
      }
    } catch {
      // An engine that cannot say what it holds is being replaced; the next one opens only
      // what the show names.
    }
  }
}

/** Forgets what was sent: the next sync sends everything. For tests, and a show change. */
export function resetAudioRoutingSync(): void {
  slots = new Map()
  sentSlots = new Array<string>(AUDIO_PATCH_SLOTS).fill('')
  sentGains = ''
  sentDevices = ''
  deviceReasons = new Map()
}
