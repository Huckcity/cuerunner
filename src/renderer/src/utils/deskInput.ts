import type { ShowEvent } from '../types/show'
import type { DeskProfile } from '../types/show'
import type { MidiMessageKind } from '../types/cue'

/**
 * The desk's own buttons, read out of what it sends back.
 *
 * A console reports a key press only when the key does something the console can name —
 * "these consoles do not provide a method to detect UDK/Soft button presses without
 * assigning them to console functions" is how TheatreMix puts it — and a mute group is
 * what a theatre show has spare, because the muting is done with DCAs. So a show's GO and
 * BACK buttons are mute groups: each is assigned to a key at the desk, the key toggles it,
 * and the desk transmits the message the group would have sent anyway. Nothing is assigned
 * as a MIDI note, and the operator's setup is two fields.
 *
 * The two ranges say it differently. An SQ transmits NRPN — `B0 63 04 B0 62 <group-1>
 * B0 06 00 B0 26 <01|00>`, page 04 being its mute groups, and the absolute form is the one
 * a key press sends; the increment/decrement toggles are ignored, since nothing this app
 * sends is one. An Avantis transmits a note, `9N <0x46+n> <velocity>`, where 40–7F is on
 * and 01–3F is off and 00 ends the message.
 *
 * **A button is a change, and the first sighting of a group is not one.** A desk reports
 * its state — when a client connects, and in answer to a get — and a group that happens to
 * be muted would otherwise run the show the moment it opened or reconnected. So the reader
 * remembers where each group was last seen and reports a press only when it moved. What
 * the desk sends on its own is the *mute*, which is also what this app sends when a scene
 * recalls a DCA — and a DCA's mute is deliberately not read at all, on either range, or a
 * show would run itself every time a scene moved the desk.
 */

/** A button on the desk's surface, as the desk itself numbers it. */
export interface DeskButton {
  /** Where it came from: an input port name, or the desk's socket as "host:port". */
  device: string
  control: 'muteGroup'
  /** The group's number, counted the way the desk's own panel counts it: 1 is the first. */
  number: number
  /** Which way the group went. A key press is a toggle, and both directions mean a press. */
  on: boolean
}

/** The SQ's mute pages: page 04 is its mute groups, and there are eight of them. */
const SQ_MUTE_GROUP_PAGE = 0x04
/** An Avantis's mute groups are notes 0x46–0x4D: the eight after mains in its N+4 block. */
const AVANTIS_MUTE_GROUP_FIRST_NOTE = 0x46

/** How many mute groups either range has, and so how many buttons a show can have. */
export const MUTE_GROUP_COUNT = 8

/**
 * The messages that ask an SQ where one of its mute groups stands.
 *
 * "A 'get' command can be sent to the SQ in order to return the current value of any mute,
 * level, pan/balance or assignment parameter": the page and the parameter are selected, and
 * then the increment message carrying 7F asks instead of moving. The answer arrives as the
 * group's own mute message, which is what primes the reader without a hand on the key.
 *
 * An Avantis has no published mute get, so there the desk's own report or the first press
 * is what primes — which is why the reader treats a first sighting as no press at all.
 */
export function muteGroupGet(profile: DeskProfile, channel: number, group: number): MidiMessageKind[] {
  if (profile !== 'sq') return []
  const cc = (controller: number, value: number): MidiMessageKind =>
    ({ kind: 'cc', channel, controller, value })
  return [cc(0x63, SQ_MUTE_GROUP_PAGE), cc(0x62, group - 1), cc(0x60, 0x7f)]
}

/** What one message says about one group, before the reader decides whether it is a press. */
interface GroupReading {
  device: string
  number: number
  on: boolean
}

/**
 * Reads the buttons off the message river.
 *
 * The messages arrive one at a time — the desk's NRPN mute is four of them — so the reader
 * holds the latch per device, exactly as the desk does: it is MIDI state, and it belongs to
 * the connection rather than to the app.
 */
export class DeskButtons {
  /** The NRPN a device is in the middle of: page from `63`, parameter from `62`. */
  private latch = new Map<string, { page: number | null; parameter: number | null }>()
  /** Where each group was last seen, so a press can be told from a report. */
  private seen = new Map<string, boolean>()

  /** The button this message means, or null when it means none or is not a change. */
  read(profile: DeskProfile, event: ShowEvent): DeskButton | null {
    const reading = this.reading(profile, event)
    if (reading === null) return null

    const key = `${reading.device} muteGroup ${reading.number}`
    const was = this.seen.get(key)
    this.seen.set(key, reading.on)
    if (was === undefined || was === reading.on) return null
    return { ...reading, control: 'muteGroup' }
  }

  /** Forgets everything: a show that has just loaded has no button half-pressed. */
  reset(): void {
    this.latch.clear()
    this.seen.clear()
  }

  private reading(profile: DeskProfile, event: ShowEvent): GroupReading | null {
    if (event.kind !== 'midi') return null
    const { device, message } = event

    if (profile === 'avantis') {
      if (message.kind !== 'noteOn' || message.velocity === 0) return null
      const group = message.note - AVANTIS_MUTE_GROUP_FIRST_NOTE + 1
      if (message.note < AVANTIS_MUTE_GROUP_FIRST_NOTE || group > MUTE_GROUP_COUNT) return null
      // 40–7F is on and 01–3F is off: the OFF is a note-on too, and 00 is the end of the
      // pair rather than a state.
      return { device, number: group, on: message.velocity >= 0x40 }
    }

    if (profile !== 'sq' || message.kind !== 'cc') return null

    const latch = this.latch.get(device) ?? { page: null, parameter: null }
    this.latch.set(device, latch)

    if (message.controller === 0x63) {
      latch.page = message.value
      latch.parameter = null
      return null
    }
    if (message.controller === 0x62) {
      latch.parameter = message.value
      return null
    }
    // The fine byte ends an SQ parameter message, and it is where the mute's own state is.
    if (message.controller !== 0x26) return null
    const parameter = latch.parameter
    latch.parameter = null
    if (latch.page !== SQ_MUTE_GROUP_PAGE || parameter === null) return null
    if (parameter >= MUTE_GROUP_COUNT) return null
    return { device, number: parameter + 1, on: message.value !== 0 }
  }
}
