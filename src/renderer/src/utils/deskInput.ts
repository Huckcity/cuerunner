import type { ShowEvent } from '../types/show'
import type { DeskProfile } from '../types/show'

/**
 * The desk's own buttons, read out of what it sends back.
 *
 * A console reports a key press only when the key does something the console can name —
 * "these consoles do not provide a method to detect UDK/Soft button presses without
 * assigning them to console functions" is how TheatreMix puts it — and a mood group is
 * what a theatre show has spare, because the muting is done with DCAs. So the desktop's
 * GO and BACK buttons are mute groups: each is assigned to a key at the desk, the key
 * toggles it, and the desk transmits the message the group would have sent if a hand had
 * muted it. Nothing is assigned as a MIDI note, and the operator's setup is two fields.
 *
 * The two ranges say it differently. An SQ transmits NRPN — `B0 63 04 B0 62 <n-1> B0 06 00
 * B0 26 <01|00>`, page 04 being its mute groups — so the button is read on the fine byte
 * that ends the sequence, and both values mean the key was pressed: a key press is a
 * toggle, and the show should move whichever way the mute went. An Avantis transmits a
 * note, `9N <0x46+n> <velocity>`, where the velocity says which half of the pair it is and
 * 00 ends the message, so any note in the mute-group range is a press either way.
 *
 * A DCA mute is *not* a button, on either range, and that is the whole reason the page and
 * the note range are checked: the app drives DCAs itself, and a desk that echoes a recall
 * back would otherwise fire the show every time a scene moved it.
 */

/** A button on the desk's surface, as the desk itself numbers it. */
export interface DeskButton {
  /** Where it came from: an input port name, or the desk's socket as "host:port". */
  device: string
  control: 'muteGroup'
  /** The group's number, counted the way the desk's own panel counts it: 1 is the first. */
  number: number
}

/** The SQ's mute pages: page 04 is its mute groups, and there are eight of them. */
const SQ_MUTE_GROUP_PAGE = 0x04
/** An Avantis's mute groups are notes 0x46–0x4D: the eight after mains in its N+4 block. */
const AVANTIS_MUTE_GROUP_FIRST_NOTE = 0x46

/** How many mute groups either range has, and so how many buttons a show can have. */
export const MUTE_GROUP_COUNT = 8

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

  /** The button this message means, or null when it means none. */
  read(profile: DeskProfile, event: ShowEvent): DeskButton | null {
    if (event.kind !== 'midi') return null
    const { device, message } = event

    if (profile === 'avantis' && message.kind === 'noteOn') {
      // Velocity 00 ends the message rather than saying anything: the button either way is
      // the note, which is what the desk's own mute pair is made of.
      if (message.velocity === 0) return null
      const group = message.note - AVANTIS_MUTE_GROUP_FIRST_NOTE + 1
      if (message.note < AVANTIS_MUTE_GROUP_FIRST_NOTE || group > MUTE_GROUP_COUNT) return null
      return { device, control: 'muteGroup', number: group }
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
    // The fine byte ends an SQ parameter message: it is where the mute's own state is, and
    // a group's is a press whether the key muted it or unmuted it.
    if (message.controller !== 0x26) return null
    const parameter = latch.parameter
    latch.parameter = null
    if (latch.page !== SQ_MUTE_GROUP_PAGE || parameter === null) return null
    if (parameter >= MUTE_GROUP_COUNT) return null
    return { device, control: 'muteGroup', number: parameter + 1 }
  }

  /** Forgets the latches: a show that has just loaded has no message half-read. */
  reset(): void {
    this.latch.clear()
  }
}
