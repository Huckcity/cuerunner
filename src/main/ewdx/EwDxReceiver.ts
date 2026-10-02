import type { TelemetryChannel } from '../../shared/show'
import type { EwDxFound } from '../../shared/ipc/show'
import type { EwDxCredentials } from './credentials'
import type { DiscoverResult } from './discovery'
import { EwDxError } from './EwDxClient'

// One receiver, followed rather than merely addressed.
//
// A source names an address, and an address is where a receiver was: a DHCP lease that changes
// would otherwise leave a show watching nothing, with an alarm that says "connection refused"
// about a receiver that is working perfectly well one number along. This holds the client for the
// address, and when that address stops answering — or turns out to be someone else — looks for the
// receiver *by its serial* and carries on from wherever it is.
//
// It is only ever the serial that is followed. A receiver this machine has never reached has no
// serial yet and is not looked for; one that refused (a wrong password, a changed certificate) is
// not looked for either, because moving does not change an answer it chose to give.

/** The slice of a client this needs, so a test can stand one in. */
export interface ReceiverClient {
  start(): void
  stop(): void
  snapshot(waitMs: number): Promise<TelemetryChannel[]>
  /** Mutes or unmutes a channel's output at the receiver, and says so if it did not take. */
  setMute?(channel: number, mute: boolean): Promise<void>
}

export interface ClientParts {
  origin: string
  /** Which receiver it is meant to be, once this machine has met it. */
  expectedSerial?: string
  onSerial(serial: string): void
}

export interface EwDxReceiverOptions {
  sourceId: string
  /** What the show names, as the operator typed it: what a remembered move is a move *from*. */
  target: string
  /** That address as an origin: `https://host[:port]`. */
  origin: string
  credentials: EwDxCredentials
  makeClient(parts: ClientParts): ReceiverClient
  discover(): Promise<DiscoverResult>
  now?: () => number
  /** The least gap between two looks, however long the receiver stays away. */
  seekEveryMs?: number
}

/** A look is a multicast query and a handful of HTTPS requests; this is how often a receiver may cause one. */
const SEEK_EVERY_MS = 30_000

/** `address`, or `address:port` off the usual one: the form a source's address is written in. */
export function addressOf(found: Pick<EwDxFound, 'address' | 'port'>): string {
  return found.port === 443 ? found.address : `${found.address}:${found.port}`
}

function originOf(found: Pick<EwDxFound, 'address' | 'port'>): string {
  return new URL(`https://${addressOf(found)}`).origin
}

export class EwDxReceiver implements ReceiverClient {
  private client: ReceiverClient | null = null
  private current: string
  private stopped = true
  private seeking: Promise<void> | null = null
  private lastSeek: number | undefined

  constructor(private readonly options: EwDxReceiverOptions) {
    this.current = options.origin
  }

  start(): void {
    this.stopped = false
    const held = this.options.credentials.get(this.options.sourceId)
    // A move is remembered against the address the show named when it was found. If the operator
    // has since typed another, they have said where the receiver is, and that is what stands.
    const moved = held?.moved?.from === this.options.target ? held.moved.to : undefined
    this.current = moved === undefined ? this.options.origin : new URL(`https://${moved}`).origin
    this.open()
  }

  stop(): void {
    this.stopped = true
    this.client?.stop()
    this.client = null
  }

  async snapshot(waitMs: number): Promise<TelemetryChannel[]> {
    if (!this.client) throw new Error('receiver is not started')
    try {
      return await this.client.snapshot(waitMs)
    } catch (error) {
      if (error instanceof EwDxError && (error.kind === 'unreachable' || error.kind === 'wrong-receiver')) this.seek()
      throw error
    }
  }

  /** The serial of the receiver this machine has met at this source, once it has. */
  serial(): string | undefined {
    return this.options.credentials.get(this.options.sourceId)?.serial
  }

  /** Mutes or unmutes a channel on whichever address the receiver is at now. */
  async setMute(channel: number, mute: boolean): Promise<void> {
    if (!this.client?.setMute) throw new Error('receiver is not started')
    return this.client.setMute(channel, mute)
  }

  private open(): void {
    this.client = this.options.makeClient({
      origin: this.current,
      expectedSerial: this.serial(),
      onSerial: serial => {
        if (serial !== this.serial()) void this.options.credentials.remember(this.options.sourceId, { serial })
      }
    })
    this.client.start()
  }

  /** Looks for the receiver by its serial, at most once at a time and not more often than `seekEveryMs`. */
  private seek(): void {
    const serial = this.serial()
    if (serial === undefined || this.seeking !== null || this.stopped) return
    const now = (this.options.now ?? Date.now)()
    if (this.lastSeek !== undefined && now - this.lastSeek < (this.options.seekEveryMs ?? SEEK_EVERY_MS)) return
    this.lastSeek = now
    this.seeking = this.look(serial).finally(() => {
      this.seeking = null
    })
  }

  private async look(serial: string): Promise<void> {
    // A network that cannot be asked is a reason not to move, and not a fault of the show.
    const result = await this.options.discover().catch(() => null)
    if (result === null || this.stopped) return
    const found = result.receivers.find(receiver => receiver.serial === serial)
    if (found === undefined || originOf(found) === this.current) return

    this.client?.stop()
    this.current = originOf(found)
    // Back at the address the show names is no move at all.
    const home = this.current === this.options.origin
    await this.options.credentials.remember(this.options.sourceId, {
      moved: home ? null : { from: this.options.target, to: addressOf(found) }
    })
    if (!this.stopped) this.open()
  }
}
