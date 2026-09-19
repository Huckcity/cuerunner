import { createSocket, type Socket } from 'node:dgram'
import type { DeviceState, ShowSettings } from '../../shared/show'
import { describe } from '../bus/ServiceHost'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import { buildPtrQuery, parseDnsRecords, presenceDevices } from './mdns'
import type { PresenceDevice } from './mdns'

/**
 * The slice of a dgram socket this service uses. The real socket satisfies it
 * directly; a test's stand-in needs only these five methods and no UDP port at all.
 */
export type PresenceSocket = Pick<Socket, 'on' | 'bind' | 'addMembership' | 'send' | 'close'>

/** Every responder in the room is on this address, and this is the port they share. */
const MDNS_ADDRESS = '224.0.0.251'
const MDNS_PORT = 5353

/** Two asks a minute is the rate mDNS is built for; browsing is already the noise. */
const QUERY_MS = 10_000

/** How often silence is measured. A missed answer is not the same as a lost device. */
const SWEEP_MS = 5_000

/** What the service believes about one instance, keyed by its full mDNS name. */
interface DevicePresence {
  name: string
  model: string
  lastSeen: number
  offline: boolean
}

/**
 * Watches the show network for devices that only ever name themselves.
 *
 * An audio interface, a Dante endpoint and an amplifier are all invisible to a poller:
 * they answer mDNS or they answer nothing. Browsing the group is therefore the only
 * evidence they exist — and their silence is the only evidence they are gone — so the
 * service reports what it hears and ages out what it stops hearing, without letting a
 * port conflict or somebody else's malformed packet disturb the show.
 */
export class PresenceService implements ShowService {
  readonly id = 'presence'
  readonly label = 'Network devices'
  readonly pro = true
  readonly settingsSections = ['presence'] as const

  private context: ServiceContext | null = null
  private services: string[] = []
  private goneAfterMs = 0
  private timers: NodeJS.Timeout[] = []
  private devices = new Map<string, DevicePresence>()
  private socket: PresenceSocket | null = null
  /** Why the socket failed, while it is still failing; null while it works. */
  private failure: string | null = null

  constructor(
    private readonly open: () => PresenceSocket = () =>
      createSocket({ type: 'udp4', reuseAddr: true })
  ) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    this.stop()
    const { enabled, services, goneAfterSeconds } = settings.presence
    if (!enabled) {
      // The operator asked for no traffic on this network; there is nothing to time
      // out and no socket worth opening.
      context.setState('stopped', 'disabled')
      return
    }

    this.context = context
    this.services = services
    this.goneAfterMs = goneAfterSeconds * 1000

    const socket = this.open()
    this.socket = socket

    // An 'error' with no listener takes the main process down, and the likeliest error
    // is the one that matters here: another responder already holds 5353.
    socket.on('error', error => this.degrade(context, describe(error)))
    socket.on('message', packet => this.receive(context, packet))
    socket.on('listening', () => this.listen(context))

    try {
      // Shared 5353 with address reuse: the point is to sit beside the machine's own
      // responder, not to replace it, and the machine's own responder does not move.
      socket.bind({ port: MDNS_PORT, exclusive: false })
    } catch (error) {
      this.degrade(context, describe(error))
    }
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    const socket = this.socket
    this.socket = null
    this.context = null
    this.services = []
    this.devices.clear()
    this.failure = null
    if (!socket) return
    try {
      socket.close()
    } catch {
      // A socket that never bound is already closed; there is nothing to release.
    }
  }

  command(action: string): unknown {
    if (action !== 'rescan') throw new Error(`Unknown action "${action}"`)
    // Asking again is the only way to hurry an answer out of a responder that missed
    // the last ask; the count is what the operator can already see on the panel.
    this.query()
    return { devices: this.devices.size }
  }

  /** The socket is up: join the group, ask, and keep asking while the show runs. */
  private listen(context: ServiceContext): void {
    if (this.context !== context || !this.socket) return
    try {
      this.socket.addMembership(MDNS_ADDRESS)
    } catch (error) {
      // A machine with no multicast route can still get answers to its queries; giving
      // up on the whole service over the join would lose the devices that do reply.
      this.degrade(context, describe(error))
    }
    if (this.failure === null) {
      context.setState('running', `browsing ${this.services.length} services`)
    }
    this.query()
    this.timers.push(this.every(QUERY_MS, () => this.query()))
    this.timers.push(this.every(SWEEP_MS, () => this.age(context)))
  }

  private receive(context: ServiceContext, packet: Buffer): void {
    if (this.context !== context) return
    // Anything at all on the wire means the socket is working again, even when the
    // packet itself turns out to be somebody else's noise.
    this.recover(context)
    // We are in a multicast group and therefore hear the whole building; only the
    // service types the operator asked for are part of the show.
    for (const device of presenceDevices(parseDnsRecords(packet))) {
      const model = this.serviceType(device.id)
      if (model !== null) this.report(device, model, context)
    }
  }

  /** One announcement: the device on the bus, fresh, with what it said about itself. */
  private report(device: PresenceDevice, model: string, context: ServiceContext): void {
    const now = Date.now()
    const detail: Record<string, string> = {}
    if (device.address) detail.address = device.address
    if (device.port > 0) detail.port = String(device.port)
    for (const [key, value] of Object.entries(device.txt)) detail[key] = value

    this.devices.set(device.id, { name: device.name, model, lastSeen: now, offline: false })
    const state: DeviceState = {
      id: `presence:${device.id}`,
      service: this.id,
      name: device.name,
      model,
      online: true,
      lastSeen: now,
      ...(Object.keys(detail).length === 0 ? {} : { detail })
    }
    context.bus.device(state)
  }

  /** The silence rule: a device that stops announcing leaves, once, until it returns. */
  private age(context: ServiceContext): void {
    if (this.context !== context) return
    const now = Date.now()
    for (const [id, state] of this.devices) {
      if (state.offline || now - state.lastSeen < this.goneAfterMs) continue
      state.offline = true
      const deviceId = `presence:${id}`
      context.bus.device({
        id: deviceId,
        service: this.id,
        name: state.name,
        model: state.model,
        online: false,
        lastSeen: state.lastSeen
      })
      context.bus.alert('warning', this.id, `${state.name} left the network`, deviceId)
    }
  }

  private query(): void {
    const socket = this.socket
    if (!socket) return
    for (const service of this.services) {
      socket.send(buildPtrQuery(service), MDNS_PORT, MDNS_ADDRESS)
    }
  }

  /** The configured service an instance belongs to, or null when it is not ours. */
  private serviceType(instance: string): string | null {
    for (const service of this.services) {
      if (instance === service || instance.endsWith(`.${service}`)) return service
    }
    return null
  }

  /** One alarm per outage: the current state is already on the panel. */
  private degrade(context: ServiceContext, reason: string): void {
    if (this.context !== context) return
    const first = this.failure === null
    this.failure = reason
    context.setState('degraded', reason)
    if (first) context.bus.alert('warning', this.id, `${this.label}: ${reason}`)
  }

  /** A responder answered, so the socket is working again and the outage is over. */
  private recover(context: ServiceContext): void {
    if (this.failure === null) return
    this.failure = null
    context.setState('running', `browsing ${this.services.length} services`)
  }

  private every(ms: number, run: () => void): NodeJS.Timeout {
    const timer = setInterval(run, ms)
    // Browsing must not be what keeps the app alive on quit.
    timer.unref?.()
    return timer
  }
}
