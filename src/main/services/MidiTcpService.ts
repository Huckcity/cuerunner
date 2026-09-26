import { midiTcp, type DeskLinkCause } from '../midi/MidiTcpEngine'
import { deskLinkName } from '../../shared/deskLink'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { MidiMessageKind } from '../../shared/cue'
import type { ShowSettings } from '../../shared/show'

/**
 * What this service needs of the desk link. The engine behind it also owns a socket and a
 * retry timer — a test only has to be the four things the service actually talks to.
 */
export interface DeskLink {
  open(host: string, port: number): void
  closeAll(): void
  onMessage: ((device: string, message: MidiMessageKind) => void) | null
  /**
   * A link coming up or going down, with why when it goes: `reset` is a connection the
   * desk ended, which is a different thing to report from a dial nothing answered.
   */
  onStatus: ((device: string, online: boolean, detail?: string, cause?: DeskLinkCause) => void) | null
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
  readonly settingsSections = ['desk'] as const

  /** The context to publish through, so the desk's row can be taken offline on stop. */
  private context: ServiceContext | null = null
  /** The row this service published, so stopping can take that same row offline. */
  private device: string | null = null

  constructor(private readonly engine: DeskLink = midiTcp) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    const { desk } = settings
    this.context = context
    this.device = null
    if (desk.kind !== 'midi-tcp') {
      context.setState('stopped', 'the show drives no desk over the network')
      return
    }
    if (desk.host.trim() === '') {
      context.setState('degraded', 'no desk address')
      return
    }

    // The same address the row is named from and the dial reaches: what the renderer stores
    // is what was typed, and a paste that left whitespace around it is still this desk.
    const host = desk.host.trim()
    const device = deskLinkName(host, desk.tcpPort)
    this.engine.onMessage = (from, message) => {
      context.bus.publish({ kind: 'midi', at: Date.now(), device: from, message })
    }
    this.engine.onStatus = (from, online, detail, cause) => {
      this.device = `midi-tcp:${from}`
      context.bus.device({
        id: this.device,
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
      // one alarm per outage — which is what an alarm is for. A connection the desk took
      // and reset is not a desk that is not answering: the desk answered, so the alarm
      // says what happened rather than sending the operator to look at the address.
      context.setState('degraded', detail ? `${from}: ${detail}` : `not connected to ${from}`)
      context.bus.alert(
        'warning',
        this.id,
        cause === 'reset'
          ? `Desk ${from}: the connection was taken or reset`
          : `Desk ${from} is not answering`
      )
    }

    context.setState('starting', `dialling ${device}`)
    this.engine.open(host, desk.tcpPort)
  }

  stop(): void {
    // The desk's row is taken offline before the engine lets go of the link, the way the
    // MIDI input's rows are: a desk that is not being talked to is not connected, and the
    // panel would otherwise read "online" for the rest of the session.
    if (this.context !== null && this.device !== null) {
      this.context.bus.device({
        id: this.device,
        service: this.id,
        name: this.device.slice('midi-tcp:'.length),
        model: 'Desk (MIDI over TCP)',
        online: false,
        lastSeen: Date.now()
      })
    }
    this.context = null
    this.device = null
    this.engine.onMessage = null
    this.engine.onStatus = null
    this.engine.closeAll()
  }
}
