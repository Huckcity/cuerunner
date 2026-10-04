import { sqNative, type SqSessionCause } from '../desk/SqNativeEngine'
import { NATIVE_TCP_PORT } from '../desk/frames'
import { DcaReportReader, dcaGets } from '../desk/dcaReports'
import { HighestWins, type SwitchOrder } from '../desk/HighestWins'
import { midiTcp, type DeskLinkTap } from '../midi/MidiTcpEngine'
import { reportMainError } from '../errors'
import { deskLinkName } from '../../shared/deskLink'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { MidiMessageKind } from '../../shared/cue'
import type {
  ShowSettings,
  SqMembershipAnswer,
  SqMembershipIntent,
  SqRidesIntent
} from '../../shared/show'

/**
 * What this service needs of the session. The engine behind it owns a socket, the channel to
 * the desk's own leave port and three timers — a test only has to be the four things the
 * service actually talks to.
 */
export interface NativeSession {
  open(host: string): void
  closeAll(): void
  /**
   * One membership written on the session: the pair frame and the channel's flag, and how
   * many frames went out — 0 when there is no session the desk has spoken on.
   */
  sendMembership(intent: SqMembershipIntent): number
  /**
   * Several memberships as one write, so the desk applies them together: every frame, or 0
   * when there is no session the desk has spoken on.
   */
  sendMemberships(intents: readonly SqMembershipIntent[]): number
  /**
   * A session coming up or going down, with why when it goes: `lost` is a session the desk
   * was holding and is not, which is the state that leaves a desk mute until it is reset.
   */
  onStatus: ((online: boolean, detail?: string, cause?: SqSessionCause) => void) | null
}

/**
 * What this service needs of the desk's MIDI link, beside the session: to hear the DCA masters
 * report, and to ask them where they stand. The link is the desk service's (`midiTcp`), and the
 * desk takes one MIDI client, so the asking goes down the same socket rather than a second one.
 */
export interface DeskTraffic {
  tap(tap: DeskLinkTap): () => void
  send(host: string, port: number, messages: MidiMessageKind[]): Promise<{ ok: boolean }>
}

/**
 * Which half of a highest-wins switch goes first, from `CUERUNNER_DCA_SWITCH`: `clear-first`
 * or the default, `assign-first`. A machine fact for measuring the switch with audio, not a
 * show setting — the order that is inaudible is the desk's, and when it is known it is a
 * constant.
 */
export function switchOrderFromEnv(value = process.env.CUERUNNER_DCA_SWITCH): SwitchOrder {
  return value === 'clear-first' ? 'clear-first' : 'assign-first'
}

/**
 * The membership a payload names, or the sentence saying what about it was not one.
 *
 * The renderer's intent arrives over the IPC boundary as `unknown`, so every number is
 * checked before a frame is built from it: the frames address 1-based numbers and the codec
 * subtracts one, so a zero would name the frame before the first input, and a fraction or a
 * string a form sent would be a frame written from a coerced value. The sentence names the
 * field rather than throwing, because it is what the operator reads when a recall's send is
 * refused — the rest of that recall goes on.
 */
function membershipOf(payload: unknown): SqMembershipIntent | string {
  if (typeof payload !== 'object' || payload === null) {
    return 'a membership needs a payload naming a channel, a fader, and whether the pair is placed'
  }
  const { channel, dca, placed, rides } = payload as Record<string, unknown>
  if (!isCount(channel)) return `a membership needs a channel as a whole number at or past 1${found(channel)}`
  if (channel > MAX_FRAME_NUMBER) {
    return `a membership needs a channel no larger than ${MAX_FRAME_NUMBER}${found(channel)}`
  }
  if (!isCount(dca)) return `a membership needs a fader as a whole number at or past 1${found(dca)}`
  if (dca > MAX_FRAME_NUMBER) {
    return `a membership needs a fader no larger than ${MAX_FRAME_NUMBER}${found(dca)}`
  }
  if (typeof placed !== 'boolean') return `a membership needs placed to be true or false${found(placed)}`
  if (typeof rides !== 'boolean') return `a membership needs rides to be true or false${found(rides)}`
  return { channel, dca, placed, rides }
}

/**
 * One channel's faders a payload names, or the sentence saying what about it was not one —
 * the same checks a membership's numbers get, for every number in both lists.
 */
function ridesOf(payload: unknown): SqRidesIntent | string {
  if (typeof payload !== 'object' || payload === null) {
    return 'a channel’s faders need a payload naming the channel, its faders, and what the desk was last told'
  }
  const { channel, dcas, wrote, highest } = payload as Record<string, unknown>
  if (!isCount(channel) || channel > MAX_FRAME_NUMBER) {
    return `a channel’s faders need a channel from 1 to ${MAX_FRAME_NUMBER}${found(channel)}`
  }
  for (const [name, list] of [['faders', dcas], ['last-told faders', wrote]] as const) {
    if (!Array.isArray(list) || list.length > MAX_FRAME_NUMBER) {
      return `a channel’s ${name} need to be a list of fader numbers`
    }
    const wrong = list.find(dca => !isCount(dca) || dca > MAX_FRAME_NUMBER)
    if (wrong !== undefined) {
      return `a channel’s ${name} need whole numbers from 1 to ${MAX_FRAME_NUMBER}${found(wrong)}`
    }
  }
  if (typeof highest !== 'boolean') return `a channel’s faders need highest to be true or false${found(highest)}`
  return { channel, dcas: dcas as number[], wrote: wrote as number[], highest }
}

/**
 * The largest address a frame can carry: the codec writes the number less one into a single
 * byte, so a 257th input would come out as the first — `Buffer.from` truncates rather than
 * refusing — and the desk would be told about a different one than the payload named.
 */
const MAX_FRAME_NUMBER = 256

/** A whole number at or past the first input: the shape an address has, before its ceiling. */
function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** What a refusal names when the payload carried the field at all: nothing where it did not. */
function found(value: unknown): string {
  if (value === undefined) return ''
  // A string is quoted, so that the sentence tells a `"3"` from a 3; anything else reads as it
  // would in the window. Nothing here can throw: this runs on a payload no check has passed.
  return `, not ${typeof value === 'string' ? `"${value}"` : String(value)}`
}

/**
 * The SQ's own control service, on the desk's TCP 51326 — the route a DCA membership is
 * written over, because the MIDI link on 51325 has no input-to-DCA assignment at all.
 *
 * The desk's session is a conversation rather than a cue: this opens it, keeps it alive the
 * two ways the capture measures, reads what the desk pushes, and leaves by the desk's own
 * door when the show stops. What it writes is the membership `frames.ts` holds the capture's
 * bytes for: one pair at a time, on the session already standing.
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

  /**
   * Highest wins, for the life of a session with an SQ: the resolver that keeps followed
   * channels on their highest fader, and what it reads the faders from — the desk's MIDI link,
   * where the DCA masters report themselves (`dcaReports.ts`).
   */
  private resolver: HighestWins | null = null
  private untap: (() => void) | null = null
  /** Where the DCA masters are asked about: the desk's MIDI link and the show's channel. */
  private levelsFrom: { host: string; port: number; channel: number } | null = null
  /** Whether the levels have been asked for on this link, so one link asks once. */
  private asked = false

  constructor(
    private readonly session: NativeSession = sqNative,
    private readonly traffic: DeskTraffic = midiTcp,
    private readonly order: SwitchOrder = switchOrderFromEnv()
  ) {}

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
        // A session that comes back is a desk that may have missed a switch while it was
        // gone: every followed channel is put back on its highest fader.
        this.write(this.resolver?.resolveAll() ?? [])
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

    this.followFaders(host, desk.tcpPort, desk.midiChannel)
    context.setState('starting', `dialling ${device}`)
    this.session.open(host)
  }

  /**
   * Listens to the desk's DCA masters on its MIDI link, for highest wins. Nothing is asked of
   * the desk until a channel is followed: a show that never turns highest wins on sends the
   * desk nothing it did not send before.
   */
  private followFaders(host: string, port: number, channel: number): void {
    const resolver = new HighestWins(this.order)
    const reader = new DcaReportReader(channel)
    const link = deskLinkName(host, port)
    this.resolver = resolver
    this.levelsFrom = { host, port, channel }
    this.asked = false
    this.untap = this.traffic.tap({
      message: (device, message) => {
        if (device !== link) return
        const report = reader.read(message)
        if (report !== null) this.write(resolver.report(report))
      },
      status: (device, online) => {
        if (device !== link) return
        // A link that went away may have missed the faders moving, and one that came back
        // has a desk to ask: what was read before is not what the desk holds now.
        reader.reset()
        resolver.forgetLevels()
        this.asked = false
        if (online && resolver.needsLevels()) this.askLevels()
      }
    })
  }

  /** Asks the desk where its DCA masters stand: once per link, and again if the ask did not go. */
  private askLevels(): void {
    const from = this.levelsFrom
    if (from === null || this.asked) return
    this.asked = true
    void this.traffic.send(from.host, from.port, dcaGets(from.channel))
      .then(sent => { if (!sent.ok) this.asked = false })
      .catch(() => { this.asked = false })
  }

  /**
   * Writes a channel's switch as one write — the place and the clear together, so the desk
   * never applies the moment between them (`sendMemberships`) — and records it once it has
   * gone. A write that does not go leaves the record alone, and the resolver tries again on
   * the next report. The answer is the one a recall reads: how many frames went, or why not.
   */
  private write(writes: SqMembershipIntent[]): SqMembershipAnswer {
    if (writes.length === 0) return { ok: true, frames: 0 }
    const frames = this.session.sendMemberships(writes)
    if (frames === 0) {
      return {
        ok: false,
        error: 'the SQ session is not up — the desk is not answering, so no membership was written'
      }
    }
    for (const write of writes) this.resolver?.landed(write)
    return { ok: true, frames }
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
    this.untap?.()
    this.untap = null
    this.resolver = null
    this.levelsFrom = null
    this.session.onStatus = null
    this.session.closeAll()
  }

  /**
   * `membership` writes one (channel, fader) pair and that channel's flag to the desk — the
   * frames `frames.ts` holds the capture's bytes for, and the only action this service takes.
   *
   * The payload is checked here rather than in the engine, because this is the boundary the
   * renderer's intent crosses: what a frame is built from is a number that was read, never one
   * that was assumed. A refusal is a sentence and not a throw, because a recall writes one
   * membership after another and reports the ones that did not go; a session that is not up is
   * refused the same way, which is what a 0 from the engine means.
   */
  command(action: string, payload?: unknown): SqMembershipAnswer {
    if (action === 'rides') return this.rides(payload)
    if (action !== 'membership') throw new Error(`Unknown action "${action}"`)
    const intent = membershipOf(payload)
    if (typeof intent === 'string') return { ok: false, error: intent }
    // A pair written by a recall is the show taking the channel back from highest wins.
    this.resolver?.release(intent.channel)
    const frames = this.session.sendMembership(intent)
    if (frames === 0) {
      return {
        ok: false,
        error: 'the SQ session is not up — the desk is not answering, so no membership was written'
      }
    }
    // A write is two frames — the pair and the channel's flag — so one of them is the
    // connection going between them, and the desk holds half of what the caller asked for.
    if (frames < 2) {
      return {
        ok: false,
        error: 'only the pair went — the channel’s flag did not, so the write is half made'
      }
    }
    this.resolver?.landed(intent)
    return { ok: true, frames }
  }

  /**
   * `rides` hands main one channel's faders for a show where the highest fader wins: the
   * channel is put on the highest of them now and kept there as the faders move. With
   * `highest` false it is put on all of them, which is how a show leaves highest wins.
   */
  private rides(payload: unknown): SqMembershipAnswer {
    const intent = ridesOf(payload)
    if (typeof intent === 'string') return { ok: false, error: intent }
    const resolver = this.resolver
    if (resolver === null) {
      return { ok: false, error: 'the show drives no SQ over its own control service' }
    }
    const answer = this.write(resolver.ride(intent.channel, intent.dcas, intent.wrote, intent.highest))
    if (resolver.needsLevels()) this.askLevels()
    return answer
  }
}
