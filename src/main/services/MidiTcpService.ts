import { midiTcp } from '../midi/MidiTcpEngine'
import { deskLinkName } from '../../shared/deskLink'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { MidiMessageKind } from '../../renderer/src/types/cue'
import type { ShowSettings } from '../../renderer/src/types/show'

/**
 * What this service needs of the desk link. The engine behind it also owns a socket and a
 * retry timer — a test only has to be the four things the service actually talks to.
 */
export interface DeskLink {
  open(host: string, port: number): void
  closeAll(): void
  onMessage: ((device: string, message: MidiMessageKind) => void) | null
  onStatus: ((device: string, online: boolean, detail?: string) => void) | null
}

/**
 * The desk over the network — an SQ or an Avantis on its MIDI-over-TCP port.
 *
 * A service rather than part of the cue path because the conversation is not one-way:
 * the desk sends its own scene recalls, and its answers to a get, back down the same
 * socket. A show that only ever spoke would never hear the operator move the desk. The
 * socket itself belongs to the engine, which the cues that send on it share.
 */
export class MidiTcpService implements ShowService {
  readonly id = 'midi-tcp'
  readonly label = 'Desk (MIDI over TCP)'
  readonly pro = true

  constructor(private readonly engine: DeskLink = midiTcp) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    const { desk } = settings
    if (desk.kind !== 'midi-tcp') {
      context.setState('stopped', 'the show drives no desk over the network')
      return
    }
    if (desk.host.trim() === '') {
      context.setState('degraded', 'no desk address')
      return
    }

    const device = deskLinkName(desk.host, desk.tcpPort)
    this.engine.onMessage = (from, message) => {
      context.bus.publish({ kind: 'midi', at: Date.now(), device: from, message })
    }
    this.engine.onStatus = (from, online, detail) => {
      context.bus.device({
        id: `midi-tcp:${from}`,
        service: this.id,
        name: from,
        model: 'Desk (MIDI over TCP)',
        online,
        lastSeen: Date.now()
      })
      if (online) {
        context.setState('running', `connected to ${from}`)
        return
      }
      // The engine reports a change of state rather than every failed dial, so this is
      // one alarm per outage — which is what an alarm is for.
      context.setState('degraded', detail ? `${from}: ${detail}` : `not connected to ${from}`)
      context.bus.alert('warning', this.id, `Desk ${from} is not answering`)
    }

    context.setState('starting', `dialling ${device}`)
    this.engine.open(desk.host, desk.tcpPort)
  }

  stop(): void {
    this.engine.onMessage = null
    this.engine.onStatus = null
    this.engine.closeAll()
  }
}
