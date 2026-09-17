import type { DeskMessage } from '../../../shared/show'
import type { OscArg } from '../../../shared/cue'

export interface DeskSendResult {
  ok: boolean
  /** What the operator is told when it did not go. */
  error?: string
}

/**
 * Sends one desk message on the transport it is addressed to.
 *
 * One place, because everything that talks to a desk needs the same three lines and the same
 * answer when nobody is at the other end: the scene recall, the show control cue, and the
 * question the app asks a desk about its own buttons. A desk that is not there is a failure
 * to report rather than a reason to stop the show.
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
