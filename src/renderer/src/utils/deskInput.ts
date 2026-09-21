import type { ShowEvent } from '../../../shared/show'
import type { DeskProfile } from '../../../shared/show'
import type { MidiMessageKind } from '../../../shared/cue'

/**
 * The desk's own buttons, read out of what it sends back.
 *
 * A console reports a key press only when the key does something the console can name —
 * "these consoles do not provide a method to detect UDK/Soft button presses without
 * assigning them to console functions" is how TheatreMix puts it — and a mute group is
 * what a theatre show has spare, because the muting is done with DCAs. So a show's GO and
 * BACK buttons are mute groups: each is assigned to a key at the desk, the key toggles it,
 * and the desk transmits the message the group would have sent anyway. A key that latches
 * is not what every press means, though — a press that only means "next cue" would leave
 * the indicator lit — so a show may name a MIDI note instead: an SQ's soft key set to a
 * MIDI note transmits note on at `7F` and note off at `00` while it is held.
 *
 * The two ranges say it differently. An SQ transmits NRPN for a mute group — `B0 63 04
 * B0 62 <group-1> B0 06 00 B0 26 <01|00>`, page 04 being its mute groups, and the absolute
 * form is the one a key press sends; the increment/decrement toggles are ignored, since
 * nothing this app sends is one — and a bare note pair for a soft key assigned to a note:
 * "the SQ does not send note on/off messages when a Soft Key is pressed unless the Soft Key
 * is set to a MIDI note on/off function". An Avantis transmits a note, `9N <0x46+n>
 * <velocity>`, where 40–7F is on and 01–3F is off and 00 ends the message; there the mute
 * groups *are* notes and its surface keys latch, and the app's own DCA mutes are notes too,
 * so the note route is not read off it — a note would be indistinguishable from the app's
 * own echo.
 *
 * **A group is a change, and the first sighting of a group is not one.** A desk reports
 * its state — when a client connects, and in answer to a get — and a group that happens to
 * be muted would otherwise run the show the moment it opened or reconnected. So the reader
 * remembers where each group was last seen and reports a press only when it moved. What
 * the desk sends on its own is the *mute*, which is also what this app sends when a scene
 * recalls a DCA — and a DCA's mute is deliberately not read at all, on either range, or a
 * show would run itself every time a scene moved the desk.
 *
 * **A note is momentary instead.** No get exists for a soft key — the desk transmits only
 * while a hand is on it — so a note-on is a press the first time as well, a note-off is
 * the release that ends it and says nothing, and the same note-on arriving again while the
 * key is down is not a second press. The pair is the one event it is, and nothing latches.
 */

/** A button on the desk's surface, as the desk itself numbers it. */
export type DeskButton =
  | {
      /** Where it came from: an input port name, or the desk's socket as "host:port". */
      device: string
      control: 'muteGroup'
      /** The group's number, counted the way the desk's own panel counts it: 1 is the first. */
      number: number
      /** Which way the group went. A key press is a toggle, and both directions mean a press. */
      on: boolean
    }
  | {
      /** Where it came from: an input port name, or the desk's socket as "host:port". */
      device: string
      control: 'note'
      /** The note the key transmits, as the show's own field numbers it. */
      number: number
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
  control: 'muteGroup'
  device: string
  number: number
  on: boolean
}

/** What one soft key's note says, before the reader decides whether it is a press. */
interface NoteReading {
  control: 'note'
  device: string
  number: number
  /**
   * The channel the note came on. Part of the latch's identity, so two channels cannot read
   * as one key — not a condition on the read, because the desk transmits on whichever
   * channel its own MIDI setup sends.
   */
  channel: number
  /** Which way the key went: a key set to a note transmits note on while it is held. */
  down: boolean
}

type Reading = GroupReading | NoteReading

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
  /** Whether each soft key's note is down, so a held key does not repeat its press. */
  private held = new Map<string, boolean>()

  /** The button this message means, or null when it means none or is not a press. */
  read(profile: DeskProfile, event: ShowEvent): DeskButton | null {
    const reading = this.reading(profile, event)
    if (reading === null) return null

    if (reading.control === 'note') {
      const key = `${reading.device} note ${reading.channel}:${reading.number}`
      const was = this.held.get(key) ?? false
      this.held.set(key, reading.down)
      // A note's first sighting is a press — the desk transmits only while the key is down,
      // and no get exists to prime it — and a release or a repeat is not.
      if (!reading.down || was) return null
      return { device: reading.device, control: 'note', number: reading.number }
    }

    const key = `${reading.device} muteGroup ${reading.number}`
    const was = this.seen.get(key)
    this.seen.set(key, reading.on)
    if (was === undefined || was === reading.on) return null
    return reading
  }

  /** Forgets everything: a show that has just loaded has no button half-pressed. */
  reset(): void {
    this.latch.clear()
    this.seen.clear()
    this.held.clear()
  }

  private reading(profile: DeskProfile, event: ShowEvent): Reading | null {
    if (event.kind !== 'midi') return null
    const { device, message } = event

    if (profile === 'avantis') {
      if (message.kind !== 'noteOn' || message.velocity === 0) return null
      const group = message.note - AVANTIS_MUTE_GROUP_FIRST_NOTE + 1
      if (message.note < AVANTIS_MUTE_GROUP_FIRST_NOTE || group > MUTE_GROUP_COUNT) return null
      // 40–7F is on and 01–3F is off: the OFF is a note-on too, and 00 is the end of the
      // pair rather than a state.
      return { control: 'muteGroup', device, number: group, on: message.velocity >= 0x40 }
    }

    // A soft key assigned to a MIDI note, which is the one range whose own traffic cannot
    // be a note: an SQ mutes with NRPN, so a note here is not the desk echoing the app
    // back. The pair is read as one event — note on is the press, note off is the release
    // — and `decode` has already read a velocity-0 note-on as the note-off it is.
    if (profile === 'sq' && (message.kind === 'noteOn' || message.kind === 'noteOff')) {
      return {
        control: 'note',
        device,
        number: message.note,
        channel: message.channel,
        down: message.kind === 'noteOn'
      }
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
    return { control: 'muteGroup', device, number: parameter + 1, on: message.value !== 0 }
  }
}
