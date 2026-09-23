import { sqNative, type SqSessionCause } from '../desk/SqNativeEngine'
import { NATIVE_TCP_PORT } from '../desk/frames'
import { reportMainError } from '../errors'
import { deskLinkName } from '../../shared/deskLink'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { ShowSettings } from '../../shared/show'

/**
 * What this service needs of the session. The engine behind it owns a socket, the channel to
 * the desk's own leave port and three timers — a test only has to be the three things the
 * service actually talks to.
 */
export interface NativeSession {
  open(host: string): void
  closeAll(): void
  /**
   * A session coming up or going down, with why when it goes: `lost` is a session the desk
   * was holding and is not, which is the state that leaves a desk mute until it is reset.
   */
  onStatus: ((online: boolean, detail?: string, cause?: SqSessionCause) => void) | null
}

/**
 * The SQ's own control service, on the desk's TCP 51326 — the route a DCA membership is
 * written over, because the MIDI link on 51325 has no input-to-DCA assignment at all.
 *
 * The desk's session is a conversation rather than a cue: this opens it, keeps it alive the
 * two ways the capture measures, reads what the desk pushes, and leaves by the desk's own
 * door when the show stops. Nothing sends an assignment yet — the recall that does is Story
 * 11.2's, and the frames it will write are held by the capture until then.
 */
export class SqNativeService implements ShowService {
  readonly id = 'sq-native'
  readonly label = 'Desk (SQ native control)'
  readonly pro = true
  readonly settingsSections = ['desk'] as const

  /** The context to publish through, so the desk's row can be taken offline on stop. */
  private context: ServiceContext | null = null
  /** The desk this service published, so stopping can take that same row offline. */
  private desk: string | null = null

  constructor(private readonly session: NativeSession = sqNative) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    const { desk } = settings
    this.context = context
    this.desk = null

    // The desk's own route and nobody else's: what an SQ takes on 51326 is not what any
    // other range takes, so a show pointed at one is left alone rather than spoken to.
    if (desk.kind !== 'midi-tcp' || desk.profile !== 'sq') {
      context.setState('stopped', 'the show drives no SQ over its own control service')
      return
    }
    const host = desk.host.trim()
    if (host === '') {
      context.setState('stopped', 'no desk address')
      return
    }

    // The desk's own name for it, from the same function the MIDI link's row uses: the row
    // is `<id>:<host>:51326`, and only the port says which of the desk's two services it is.
    const device = deskLinkName(host, NATIVE_TCP_PORT)
    this.session.onStatus = (online, detail, cause) => {
      this.desk = device
      // No `detail`: the Monitor's device row renders a name and a reading, and the desk's
      // state is said where an operator reads a sentence rather than in a field nothing
      // shows.
      context.bus.device({
        id: `${this.id}:${device}`,
        service: this.id,
        name: device,
        model: this.label,
        online,
        lastSeen: Date.now()
      })
      if (online) {
        context.setState('running', `session open with ${device}`)
        return
      }
      if (cause === 'lost') {
        // A session lost without its goodbye is the state §6 measures: the desk takes a
        // client again only after it is reset. Three surfaces carry that, because a session
        // that quietly stopped writing would leave an operator with a desk that answers
        // nothing and nothing to read about why: the row, the alarm, and the log.
        const why = `the session was lost without its goodbye${detail === undefined ? '' : ` (${detail})`}`
        context.setState('degraded', `${device}: ${why} — the desk needs a reset`)
        const said = `Desk ${device} needs a reset — ${why}`
        context.bus.alert('warning', this.id, said)
        reportMainError(`[main] ${said}`)
        return
      }
      context.setState('degraded', detail === undefined ? `not connected to ${device}` : `${device}: ${detail}`)
      context.bus.alert('warning', this.id, `Desk ${device} is not answering`)
    }

    context.setState('starting', `dialling ${device}`)
    this.session.open(host)
  }

  stop(): void {
    // The desk's row is taken offline before the session is let go, the way the MIDI
    // service's is: a desk nobody is talking to is not connected, and the panel would
    // otherwise read "online" for the rest of the session. Then the goodbye, on the channel
    // the session was holding — a client that leaves without it leaves a real desk mute.
    if (this.context !== null && this.desk !== null) {
      this.context.bus.device({
        id: `${this.id}:${this.desk}`,
        service: this.id,
        name: this.desk,
        model: this.label,
        online: false,
        lastSeen: Date.now()
      })
    }
    this.context = null
    this.desk = null
    this.session.onStatus = null
    this.session.closeAll()
  }
}
