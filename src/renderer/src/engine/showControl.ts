import { useStore } from '../store'
import { deskMidi } from '../utils/desk'
import { encodeMsc } from '../utils/msc'
import type { MidiMessageKind, MscCue } from '../types/cue'

export interface MscSendResult {
  ok: boolean
  /** What the operator is told when the command did not go. */
  error?: string
}

/**
 * Sends a show control cue's command on its way.
 *
 * Where it goes is the cue's own choice: the show's desk connection — which is how a cue
 * list on the sound desk is told to GO without a cable from this machine — or a MIDI port
 * of this machine, which is how the lighting console on the other end of an interface is.
 * A cue pointed at neither says so rather than reporting a send it did not make, and a
 * desk driven over OSC says that too: addresses are not MIDI, and there is no honest way
 * to put a show control message on that connection.
 */
export async function sendMsc(cue: MscCue): Promise<MscSendResult> {
  const state = useStore.getState()
  const messages: MidiMessageKind[] = [encodeMsc({
    deviceId: cue.deviceId,
    format: cue.format,
    command: cue.command,
    cueNumber: cue.cueNumber,
    cueList: cue.cueList
  })]

  if (cue.destination === 'port') {
    // An empty field is the port the show already sends its MIDI to, the way a MIDI cue
    // reads it: the machine's own choice is not worth making twice.
    const portName = cue.portName || state.midiSettings.outputPortName
    if (portName === '') return { ok: false, error: 'no MIDI port chosen to send it on' }
    return report(() => window.cuerunner.midi.send({ portName, messages }))
  }

  const desk = state.showSettings.desk
  if (desk.kind === 'none') return { ok: false, error: 'the show drives no desk' }
  if (desk.kind === 'osc') {
    return { ok: false, error: 'the show’s desk is driven over OSC, which does not carry MIDI Show Control' }
  }
  const addressed = deskMidi(desk, messages)
  if (addressed === null) return { ok: false, error: 'the show’s desk has no address yet' }

  return report(() => addressed.kind === 'midi'
    ? window.cuerunner.midi.send({ portName: addressed.portName, messages: addressed.messages })
    : window.cuerunner.midi.sendTcp({
        host: addressed.host,
        port: addressed.port,
        messages: addressed.messages
      }))
}

/** A send that failed is one thing to report whether it refused or threw. */
async function report(send: () => Promise<{ ok: boolean; error?: string }>): Promise<MscSendResult> {
  try {
    const result = await send()
    return { ok: result.ok, error: result.error }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
