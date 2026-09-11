import type { Cue, CueTrigger } from '../types/cue'
import type { ShowEvent } from '../types/show'

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
 * the value is how the desk expresses itself, not whether it meant this cue.
 */
export function matchesTrigger(trigger: CueTrigger, event: ShowEvent): boolean {
  if (trigger.kind === 'osc') {
    return event.kind === 'osc' && event.address === trigger.address
  }

  if (event.kind !== 'midi') return false
  if (event.device !== trigger.device) return false

  const incoming = event.message
  const wanted = trigger.message
  // Sysex has no channel and no note to match on, so it can never answer a trigger.
  if (incoming.kind === 'sysex') return false
  if (incoming.channel !== wanted.channel) return false

  switch (wanted.kind) {
    case 'noteOn':
      return incoming.kind === 'noteOn' && incoming.note === wanted.note
    case 'noteOff':
      return incoming.kind === 'noteOff' && incoming.note === wanted.note
    case 'cc':
      return incoming.kind === 'cc' && incoming.controller === wanted.controller
    case 'programChange':
      return incoming.kind === 'programChange' && incoming.program === wanted.program
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
