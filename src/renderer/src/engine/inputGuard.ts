import { parseMsc } from '../utils/msc'
import type { MscMessage } from '../utils/msc'
import type { Cue, MidiMessageKind, RefirePolicy } from '../../../shared/cue'
import type { OscInEvent, ShowEvent } from '../../../shared/show'

/**
 * The two guards that stand between a press and a cue, kept apart from the runner that
 * fires it because neither of them is about playback.
 *
 * A night with a doubling problem looks the same whoever reports it: a footswitch that
 * bounced, a desk with two sends of the same message, a note repeated while it is held,
 * a hand that shook on Space. Every one of them arrives as *two* firings of one cue, and
 * the cue that is running is the cue that was meant. So there are two questions and they
 * are answered in different places: whether this surface may fire at all right now, and
 * what happens to a cue that is already running when it does.
 */

/** How the guard tells one firing surface from another. */
export type FireSurface = 'key' | 'osc' | 'midi'

/**
 * How long a note may stay down before the guard treats it as never released. Two
 * minutes: far longer than any hold on a cue trigger, short enough that a cable pulled
 * mid-number does not take that control out for the night.
 */
export const HOLD_LIMIT_MS = 120_000

/**
 * Whether this is a firing at all, and the identity of what arrived.
 *
 * `null` means the event is not a way of firing a cue — a device reading, an alarm, a
 * note-off, which ends a press rather than starting one.
 */
export function firingIdentity(event: ShowEvent): { surface: FireSurface; key: string } | null {
  if (event.kind === 'osc') return { surface: 'osc', key: datagramKey(event) }
  if (event.kind !== 'midi') return null

  const message = event.message
  // A show control command fires a cue like anything else, and a console that sends the
  // same GO twice is the doubling this guard exists for. A sysex for anything else has
  // no identity to match on, and neither does a note coming up: a release ends a press
  // rather than starting one.
  if (message.kind === 'sysex') {
    const msc = parseMsc(message)
    return msc === null ? null : { surface: 'midi', key: mscKey(event.device, msc) }
  }
  if (message.kind === 'noteOff') return null

  return { surface: 'midi', key: midiKey(event.device, message) }
}

/**
 * The identity of the note a MIDI event plays, when it plays one — pressed or released.
 * The same note on another port is another hand, so the device is part of it.
 */
export function noteKey(event: ShowEvent): string | null {
  if (event.kind !== 'midi') return null
  const message = event.message
  if (message.kind !== 'noteOn' && message.kind !== 'noteOff') return null
  return midiKey(event.device, message)
}

/**
 * What makes two datagrams the same message. The address alone is not enough: `/go/1`
 * with a different argument is a different instruction, and swallowing it would be the
 * guard dropping a cue the operator did mean to fire. Two identical datagrams arriving
 * inside the window are the same message arriving twice — usually the same message.
 */
function datagramKey(event: OscInEvent): string {
  return `${event.address} ${event.args.map(arg => `${arg.type}:${String(arg.value)}`).join(' ')}`
}

/** The message kinds that can fire a cue at all: a sysex only when it is show control. */
type FiringMidiKind = Exclude<MidiMessageKind, { kind: 'sysex' }>

/**
 * What makes two MIDI firings the same one: the control, not the value. A note is fired
 * by its identity — a velocity is how hard it was hit, not which cue it meant — and the
 * same note on another device is another hand, so the device is part of the key.
 */
function midiKey(device: string, message: FiringMidiKind): string {
  switch (message.kind) {
    case 'noteOn':
    case 'noteOff':
      return `${device} note:${message.channel}:${message.note}`
    case 'cc':
      return `${device} cc:${message.channel}:${message.controller}`
    case 'programChange':
      return `${device} pc:${message.channel}:${message.program}`
  }
}

/**
 * The same for a show control command, where the value *is* the identity: the command
 * and the cue it names are the instruction, so a console going to cue 12 and then to 13
 * is two firings however close together they arrive.
 */
function mscKey(device: string, message: MscMessage): string {
  return `${device} msc:${message.deviceId}:${message.format}:${message.command}:` +
    `${message.cueNumber}:${message.cueList}`
}

/**
 * The guard's memory: what each surface last fired, and which notes are still down.
 *
 * Per surface, so a MIDI note pressed while the keyboard is being tapped is not blamed
 * for the tap. Bounded by the surfaces a show actually has — a note is dropped as soon
 * as it is released, and everything older than the window is dropped on the way past.
 */
export class InputGuard {
  private lastAccepted = new Map<string, number>()
  /** Notes still down, and when each went down — the age is what catches a lost note-off. */
  private held = new Map<string, number>()

  /**
   * Config read per press, not latched: the window is a field the operator can change
   * while the show is loaded, and the next press should obey it.
   */
  constructor(private readonly windowMs: () => number) {}

  /**
   * True when this firing is the operator's, false when it is the second half of one
   * that already happened.
   *
   * The window is measured from the firing that was allowed, not from the attempts that
   * were not: a desk repeating every 100 ms would otherwise keep pushing the window out
   * from under the next real message, and the surface would never open again.
   */
  accepts(surface: FireSurface, key: string, nowMs: number): boolean {
    const id = `${surface}:${key}`
    // A note that is still down does not fire again, whatever the window says: a
    // repeated note-on is the key being held, and the desk that repeats it is the desk
    // behaving normally.
    const downSince = this.held.get(id)
    if (downSince !== undefined) {
      // A note-off that never arrives — the pad unplugged mid-hold, the cable pulled —
      // would otherwise block that control for the rest of the session, silently. No
      // hand holds a cue trigger for two minutes; past that it is a lost release, and
      // the next note-on is a new press.
      if (nowMs - downSince < HOLD_LIMIT_MS) return false
      this.held.delete(id)
    }

    const window = Math.max(0, this.windowMs())
    const last = this.lastAccepted.get(id)
    if (window > 0 && last !== undefined && nowMs - last < window) return false

    this.lastAccepted.set(id, nowMs)
    this.forget(nowMs, window)
    return true
  }

  /** A note going down is a firing; whether it fires is `accepts`'s answer. */
  pressNote(key: string, nowMs: number): void {
    this.held.set(`midi:${key}`, nowMs)
  }

  /** A note coming up is a release, and a release is never gated. */
  releaseNote(key: string): void {
    this.held.delete(`midi:${key}`)
  }

  /**
   * Forgets everything — a show that has just loaded has no history to be deaf to — and
   * takes the held notes with it: a note that was down when the last show ended is a
   * note nobody is holding now.
   */
  reset(): void {
    this.lastAccepted.clear()
    this.held.clear()
  }

  private forget(nowMs: number, window: number): void {
    for (const [id, at] of this.lastAccepted) {
      if (nowMs - at > window && !this.held.has(id)) this.lastAccepted.delete(id)
    }
  }
}

/**
 * What a second firing does while this cue is running. A cue with no policy recorded
 * is `ignore`: blocked is what the show expects, and the field exists to opt out.
 */
export function refirePolicy(cue: Cue): RefirePolicy {
  return cue.refire ?? 'ignore'
}
