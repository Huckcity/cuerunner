import { describeMsc, parseMsc } from '../utils/msc'
import type { Cue, CueTrigger } from '../../../shared/cue'
import type { ShowEvent } from '../../../shared/show'

/** The triggers on a cue, in the order they were added. */
export function cueTriggers(cue: Cue): CueTrigger[] {
  return cue.triggers ?? []
}

/**
 * True when this trigger is the one the event is talking to.
 *
 * An OSC address is matched exactly: patterns and wildcards belong to the sender, and
 * matching prefixes here would let one message fire two cues that were meant to be
 * separate. A MIDI trigger ignores velocity and controller values for the same reason —
 * the value is how the desk expresses itself, not whether it meant this cue. A show
 * control trigger is the exception that looks like the rule: every field of the command
 * is identity, including the cue number, because a console going to cue 12 is not a
 * console going to the next one.
 */
export function matchesTrigger(trigger: CueTrigger, event: ShowEvent): boolean {
  if (trigger.kind === 'osc') {
    return event.kind === 'osc' && event.address === trigger.address
  }
  // A timecode trigger answers the clock, not a message: the follower fires it
  // (engine/timecodeFollow.ts).
  if (trigger.kind === 'timecode') return false
  // A key and a time of day are this machine's own, and answer no message: the keyboard
  // fires one (hooks/useHotkeyTriggers.ts) and the wall clock the other (engine/clockTriggers.ts).
  if (trigger.kind === 'hotkey' || trigger.kind === 'clock') return false

  if (event.kind !== 'midi') return false
  if (event.device !== trigger.device) return false

  if (trigger.kind === 'msc') {
    const message = parseMsc(event.message)
    if (message === null) return false
    return message.deviceId === trigger.deviceId &&
      message.format === trigger.format &&
      message.command === trigger.command &&
      message.cueNumber === trigger.cueNumber &&
      message.cueList === trigger.cueList
  }

  const incoming = event.message
  const wanted = trigger.message
  // Sysex has no channel and no note to match on, so it can never answer a plain MIDI
  // trigger — a console's command does, and that is what the `msc` kind is for.
  if (incoming.kind === 'sysex') return false
  if (incoming.channel !== wanted.channel) return false

  switch (wanted.kind) {
    case 'noteOn':
      return incoming.kind === 'noteOn' && incoming.note === wanted.note
    case 'cc':
      return incoming.kind === 'cc' && incoming.controller === wanted.controller
    case 'programChange':
      return incoming.kind === 'programChange' && incoming.program === wanted.program
    // A show saved while the picker still offered releases can carry one. It has no
    // case here — and no event that could answer it, since learning skips note-offs —
    // so it stays inert rather than falling off the end of the switch.
    default:
      return false
  }
}

/**
 * The cues that answer to this event, in cue order.
 *
 * Only armed cues are returned: disarming a cue is how the operator takes it out of the
 * show, and a trigger that ignored that would fire a cue the operator had already
 * decided was not happening tonight.
 */
export function triggeredCues(cues: Cue[], event: ShowEvent): Cue[] {
  if (event.kind !== 'osc' && event.kind !== 'midi') return []
  return cues.filter(cue =>
    cue.isArmed && cueTriggers(cue).some(trigger => matchesTrigger(trigger, event)))
}

/** How the trigger is written in the session log, e.g. `OSC /eos/cue/12/fire from 10.0.0.5:8000`. */
export function describeTriggerSource(event: ShowEvent): string {
  if (event.kind === 'osc') {
    const args = event.args.length > 0
      ? ' ' + event.args.map(arg => String(arg.value)).join(' ')
      : ''
    return `OSC ${event.address}${args} from ${event.from}`
  }
  if (event.kind === 'midi') {
    const message = event.message
    // A show control command is worth reading as the command it is rather than as a
    // number of bytes: the log line is how an operator confirms which console spoke.
    const msc = parseMsc(message)
    if (msc !== null) return `MSC ${describeMsc(msc)} from "${event.device}"`
    const detail =
      message.kind === 'cc' ? `cc ${message.controller}` :
      message.kind === 'programChange' ? `program ${message.program}` :
      message.kind === 'sysex' ? `${message.data.length} bytes` :
      `note ${message.note}`
    // A sysex has no channel to name, so it is described by what it is instead.
    const where = message.kind === 'sysex'
      ? `from "${event.device}"`
      : `on ch${message.channel} from "${event.device}"`
    return `MIDI ${message.kind} ${detail} ${where}`
  }
  return event.kind
}
