import type { DeskMessage, SqMembershipAnswer } from '../../../shared/show'
import type { OscArg } from '../../../shared/cue'

export interface DeskSendResult {
  ok: boolean
  /** What the operator is told when it did not go. */
  error?: string
}

/**
 * Sends one desk write on the transport it is addressed to.
 *
 * One place, because everything that talks to a desk needs the same three lines and the same
 * answer when nobody is at the other end: the scene recall, the show control cue, and the
 * question the app asks a desk about its own buttons. A desk that is not there is a failure
 * to report rather than a reason to stop the show.
 *
 * The SQ's membership is the one write this app does not put on the wire itself: those
 * frames are the desk's own control protocol, main owns the codec for them, and the renderer
 * sends the intent through the one channel that addresses a service. Nothing is opened here,
 * and the payload is the four facts the frames carry.
 */
export async function sendDeskMessage(message: DeskMessage): Promise<DeskSendResult> {
  try {
    if (message.kind === 'midi') {
      return await window.cuerunner.midi.send({
        portName: message.portName,
        messages: message.messages
      })
    }
    if (message.kind === 'midi-tcp') {
      return await window.cuerunner.midi.sendTcp({
        host: message.host,
        port: message.port,
        messages: message.messages
      })
    }
    if (message.kind === 'sq-native') {
      const answer = await window.cuerunner.show.command('sq-native', 'membership', {
        channel: message.channel,
        dca: message.dca,
        placed: message.placed,
        rides: message.rides
      })
      // Two answers, because two things can be wrong: the service never took the command
      // (not running, not licensed), or it took it and had no session to write on. Both are
      // the same sentence to the operator, and neither is the show stopping.
      if (!answer.ok) return { ok: false, error: answer.error ?? 'the SQ service did not take it' }
      const written = answer.result as SqMembershipAnswer | undefined
      if (written?.ok !== true) {
        return { ok: false, error: written?.error ?? 'the SQ service answered and wrote nothing' }
      }
      return { ok: true }
    }
    if (message.kind === 'sq-native-rides') {
      const answer = await window.cuerunner.show.command('sq-native', 'rides', {
        channel: message.channel,
        dcas: message.dcas,
        wrote: message.wrote,
        highest: message.highest
      })
      if (!answer.ok) return { ok: false, error: answer.error ?? 'the SQ service did not take it' }
      const written = answer.result as SqMembershipAnswer | undefined
      if (written?.ok !== true) {
        return { ok: false, error: written?.error ?? 'the SQ service answered and wrote nothing' }
      }
      return { ok: true }
    }
    return await window.cuerunner.osc.send({
      host: message.host,
      port: message.port,
      address: message.address,
      args: message.args.map(toOscArg)
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** The desk model carries plain numbers; the OSC bridge wants them typed. */
function toOscArg(value: number): OscArg {
  return { type: Number.isInteger(value) ? 'i' : 'f', value }
}
