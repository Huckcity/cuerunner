// The sockets of the lighting engine: one that sends every universe's packets, and the ones
// that listen — to the consoles a show monitors or merges, and to the Art-Net nodes that
// answer a poll.
//
// Every socket swallows its own errors into the owner's report (AD-16: an unhandled `'error'`
// takes main down), and none holds the app open. A send that fails is counted and named, and
// the next frame tries again: a node that went away comes back to a stream that never stopped.

import { createSocket, type RemoteInfo } from 'node:dgram'
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'
import {
  ARTNET_PORT,
  DMX_LIMITS,
  SACN_PORT,
  sacnMulticastAddress,
  type UniverseInput,
  type UniverseOutput
} from '../../shared/dmx'
import type { ArtNetNode, DmxConfig, DmxInterface } from '../../shared/dmxWire'
import {
  decodeArtDmx,
  decodeArtPollReply,
  decodeSacnData,
  encodeArtDmx,
  encodeArtPoll,
  encodeArtSync,
  encodeSacnData,
  encodeSacnSync,
  pollReplyPortAddresses,
  SACN_OPTION_PREVIEW,
  SACN_OPTION_TERMINATED
} from './packets'

/** The slice of a dgram socket the lighting engine uses, so a test can stand one in. */
export interface DmxSocket {
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'message', listener: (message: Buffer, remote: RemoteInfo) => void): unknown
  on(event: 'listening', listener: () => void): unknown
  bind(port?: number, address?: string): unknown
  send(packet: Buffer, port: number, address: string, callback?: (error: Error | null) => void): void
  close(): void
  setBroadcast?(flag: boolean): void
  setMulticastInterface?(address: string): void
  setMulticastLoopback?(flag: boolean): boolean
  setMulticastTTL?(ttl: number): number
  addMembership?(group: string, iface?: string): void
  address?(): { address: string; port: number }
  unref?(): unknown
}

export type DmxSocketFactory = () => DmxSocket

/**
 * The listening sockets: sACN's port with its universes' multicast groups, and Art-Net's port,
 * where nodes broadcast. Address reuse is required here and is kept: E1.31 is multicast and
 * Art-Net is broadcast, so every listener on the machine — a visualiser, the console's own
 * software, this app's timecode receiver on Art-Net's port — is handed its own copy of each
 * packet. Without reuse the second program to start would simply not hear the rig. A unicast
 * datagram to the port goes to one of them; the inputs are for the broadcast traffic.
 */
export const defaultSocketFactory: DmxSocketFactory = () =>
  createSocket({ type: 'udp4', reuseAddr: true }) as unknown as DmxSocket

/**
 * The sending socket: bound to an ephemeral port that nothing else can want, so it has no
 * reason to share an address, and does not.
 */
export const senderSocketFactory: DmxSocketFactory = () =>
  createSocket({ type: 'udp4' }) as unknown as DmxSocket

/** The interface traffic is pinned to, or nothing for whatever the OS routes by. */
export interface DmxBinding {
  /** The interface's own IPv4 address. */
  address: string | null
  /** Its subnet's directed broadcast address, for Art-Net broadcast. */
  broadcast: string | null
}

export const UNPINNED: DmxBinding = { address: null, broadcast: null }

/** Who this machine is on the wire. */
export interface DmxIdentity {
  cid: Buffer
  sourceName: string
}

/** A universe frame is re-sent unchanged this often, inside both protocols' timeouts. */
export const KEEP_ALIVE_MS = 800

/** How long a heard source is believed after its last packet: E1.31's data-loss timeout. */
export const SOURCE_TIMEOUT_MS = 2500

/** Sources one input universe may hold at once: past it a new one is not heard. */
export const SOURCES_PER_INPUT = 16

/** How long a poll waits for Art-Net nodes to answer: the spec gives them three seconds. */
export const POLL_WAIT_MS = 3000

/** The interfaces this machine has, IPv4 only, with each one's broadcast address. */
export function listInterfaces(
  read: () => NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces
): DmxInterface[] {
  const found: DmxInterface[] = []
  for (const [name, entries] of Object.entries(read())) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4') continue
      found.push({
        name,
        address: entry.address,
        netmask: entry.netmask,
        broadcast: directedBroadcast(entry.address, entry.netmask),
        internal: entry.internal
      })
    }
  }
  return found
}

function directedBroadcast(address: string, netmask: string): string {
  const a = address.split('.').map(Number)
  const m = netmask.split('.').map(Number)
  return a.map((part, at) => (part | (~m[at] & 0xff)) & 0xff).join('.')
}

/**
 * The binding a choice resolves to on this machine now: by name first, then by the address it
 * had when it was chosen — so a renamed adapter and a renewed lease are both still found — and
 * unpinned, with `missing` set, when neither is here.
 */
export function resolveBinding(
  choice: { name: string | null; address: string | null },
  interfaces: readonly DmxInterface[]
): { binding: DmxBinding; missing: boolean } {
  if (choice.name === null) return { binding: UNPINNED, missing: false }
  const found =
    interfaces.find(entry => entry.name === choice.name) ??
    interfaces.find(entry => choice.address !== null && entry.address === choice.address)
  if (found === undefined) return { binding: UNPINNED, missing: true }
  return { binding: { address: found.address, broadcast: found.broadcast }, missing: false }
}

/** "host" or "host:port", as an output's address is typed. */
export function splitDestination(text: string, port: number): { host: string; port: number } {
  const trimmed = text.trim()
  const match = /^(.*):(\d{1,5})$/.exec(trimmed)
  if (match !== null && Number(match[2]) > 0 && Number(match[2]) < 65536) {
    return { host: match[1], port: Number(match[2]) }
  }
  return { host: trimmed, port }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ─── Sending ──────────────────────────────────────────────────────────────────

export interface TransmitterOptions {
  createSocket?: DmxSocketFactory
  /** The destination ports, for a test that cannot use the protocols' own. */
  sacnPort?: number
  artnetPort?: number
  /** A socket failure, named, for the service's status and its alarm. */
  onError?: (message: string) => void
}

/**
 * Sends every configured universe: sACN data to the universe's multicast group or a unicast
 * receiver, Art-Net ArtDmx to the broadcast address or a node, and — when the show
 * synchronises — one sACN sync packet and one ArtSync after each frame's universes.
 */
export class DmxTransmitter {
  private socket: DmxSocket | null = null
  private bound: DmxBinding | null = null
  private ready = false
  private config: DmxConfig | null = null
  private identity: DmxIdentity | null = null
  private readonly sequences = new Map<string, number>()
  private syncSequence = 0
  private sent = 0
  private lastError: string | null = null
  private readonly create: DmxSocketFactory
  private readonly sacnPort: number
  private readonly artnetPort: number

  constructor(private readonly options: TransmitterOptions = {}) {
    this.create = options.createSocket ?? senderSocketFactory
    this.sacnPort = options.sacnPort ?? SACN_PORT
    this.artnetPort = options.artnetPort ?? ARTNET_PORT
  }

  get packets(): number {
    return this.sent
  }

  get error(): string | null {
    return this.lastError
  }

  /** The port packets leave from, so a listener on this machine can tell them from another's. */
  localPort(): number | null {
    try {
      return this.ready ? (this.socket?.address?.().port ?? null) : null
    } catch {
      return null
    }
  }

  /** Takes a configuration; a different interface rebinds the socket, anything else does not. */
  configure(config: DmxConfig, identity: DmxIdentity, binding: DmxBinding): void {
    this.config = config
    this.identity = identity
    if (this.socket !== null && this.bound !== null && sameBinding(this.bound, binding)) return
    this.closeSocket()
    this.bound = binding
    this.open(binding)
  }

  /** The universes some enabled output sends. */
  universes(): number[] {
    const found = new Set<number>()
    for (const output of this.config?.outputs ?? []) if (output.enabled) found.add(output.universe)
    return [...found]
  }

  /**
   * One universe's frame, to every enabled output that carries it. False when nothing could go
   * — the socket is still binding — so the caller sends the frame again rather than counting
   * it as out.
   */
  send(universe: number, frame: Uint8Array, options = 0): boolean {
    if (this.config === null || this.identity === null || !this.ready) return false
    for (const output of this.config.outputs) {
      if (!output.enabled || output.universe !== universe) continue
      if (output.protocol === 'sacn') this.sendSacn(output, frame, options)
      else this.sendArtDmx(output, frame)
    }
    return true
  }

  /** The frame's universes are all out: release them together. */
  sync(): void {
    if (this.config === null || this.identity === null || !this.config.sync) return
    const sacn = new Set<string>()
    const artnet = new Set<string>()
    for (const output of this.config.outputs) {
      if (!output.enabled) continue
      if (output.protocol === 'sacn') {
        if (output.transport === 'multicast') {
          sacn.add(`${sacnMulticastAddress(this.config.syncUniverse)}:${this.sacnPort}`)
        } else {
          const destination = splitDestination(output.address, this.sacnPort)
          sacn.add(`${destination.host}:${destination.port}`)
        }
      } else {
        const destination = this.artnetDestination(output)
        artnet.add(`${destination.host}:${destination.port}`)
      }
    }
    if (sacn.size > 0) {
      this.syncSequence = (this.syncSequence + 1) & 0xff
      const packet = encodeSacnSync({
        cid: this.identity.cid,
        sequence: this.syncSequence,
        syncAddress: this.config.syncUniverse
      })
      for (const target of sacn) this.transmit(packet, target)
    }
    if (artnet.size > 0) {
      const packet = encodeArtSync()
      for (const target of artnet) this.transmit(packet, target)
    }
  }

  /**
   * Ends the streams: E1.31 asks a source that stops to send three packets with
   * Stream_Terminated set, so receivers let go at once rather than holding the last look for
   * the data-loss timeout. Art-Net has no such packet; its nodes time out on their own.
   */
  terminate(frames: ReadonlyMap<number, Uint8Array>): void {
    if (this.config !== null && this.identity !== null && this.ready) {
      for (let round = 0; round < 3; round++) {
        for (const output of this.config.outputs) {
          if (!output.enabled || output.protocol !== 'sacn') continue
          this.sendSacn(output, frames.get(output.universe) ?? new Uint8Array(DMX_LIMITS.slots), SACN_OPTION_TERMINATED)
        }
      }
    }
    // The socket is let go once those packets have left it: a send is queued, and a socket
    // closed under its queue drops it. Every send answers — sent or failed — so the last
    // answer is what closes it, and no timer outlives the stop.
    this.closeSocket()
    this.bound = null
  }

  /** Sends still queued on each socket, and the sockets to close once theirs have left. */
  private readonly pending = new Map<DmxSocket, number>()
  private readonly draining = new Set<DmxSocket>()

  private sendSacn(output: UniverseOutput, frame: Uint8Array, options: number): void {
    const sequence = ((this.sequences.get(output.id) ?? -1) + 1) & 0xff
    this.sequences.set(output.id, sequence)
    const packet = encodeSacnData({
      cid: this.identity!.cid,
      sourceName: this.identity!.sourceName,
      priority: output.priority,
      syncAddress: this.config!.sync ? this.config!.syncUniverse : 0,
      sequence,
      options,
      universe: output.wireUniverse,
      slots: frame
    })
    if (output.transport === 'multicast') {
      this.transmit(packet, `${sacnMulticastAddress(output.wireUniverse)}:${this.sacnPort}`)
      return
    }
    const destination = splitDestination(output.address, this.sacnPort)
    this.transmit(packet, `${destination.host}:${destination.port}`)
  }

  private sendArtDmx(output: UniverseOutput, frame: Uint8Array): void {
    // Sequence 0 means "not sequenced" to a node, so the count runs 1–255.
    const sequence = ((this.sequences.get(output.id) ?? 0) % 255) + 1
    this.sequences.set(output.id, sequence)
    const packet = encodeArtDmx({ sequence, physical: 0, portAddress: output.wireUniverse, slots: frame })
    const destination = this.artnetDestination(output)
    this.transmit(packet, `${destination.host}:${destination.port}`)
  }

  private artnetDestination(output: UniverseOutput): { host: string; port: number } {
    if (output.transport === 'broadcast' && output.address.trim() === '') {
      return { host: this.bound?.broadcast ?? '255.255.255.255', port: this.artnetPort }
    }
    return splitDestination(output.address, this.artnetPort)
  }

  private transmit(packet: Buffer, target: string): void {
    const socket = this.socket
    if (!this.ready || socket === null) return
    const split = target.lastIndexOf(':')
    const host = target.slice(0, split)
    const port = Number(target.slice(split + 1))
    if (host === '') return
    const settle = (): void => {
      const left = (this.pending.get(socket) ?? 1) - 1
      if (left > 0) {
        this.pending.set(socket, left)
        return
      }
      this.pending.delete(socket)
      if (this.draining.delete(socket)) closeQuietly(socket)
    }
    this.pending.set(socket, (this.pending.get(socket) ?? 0) + 1)
    try {
      socket.send(packet, port, host, error => {
        if (error) this.fault(`sending to ${host}: ${describe(error)}`)
        settle()
      })
      this.sent++
    } catch (error) {
      settle()
      this.fault(`sending to ${host}: ${describe(error)}`)
    }
  }

  private open(binding: DmxBinding): void {
    const socket = this.create()
    this.socket = socket
    this.ready = false
    socket.on('error', error => this.fault(describe(error)))
    socket.on('listening', () => {
      if (this.socket !== socket) return
      try {
        socket.setBroadcast?.(true)
        socket.setMulticastTTL?.(16)
        // A visualiser on this machine hears the multicast too.
        socket.setMulticastLoopback?.(true)
        if (binding.address !== null) socket.setMulticastInterface?.(binding.address)
      } catch (error) {
        this.fault(describe(error))
      }
      this.ready = true
    })
    socket.unref?.()
    try {
      socket.bind(0, binding.address ?? undefined)
    } catch (error) {
      this.fault(describe(error))
    }
  }

  private fault(message: string): void {
    // Named once per kind of failure: a node that is gone fails every frame, and the report is
    // the fact that it is gone, not forty-four of them a second.
    if (this.lastError === message) return
    this.lastError = message
    this.options.onError?.(message)
  }

  /** Lets the socket go once what is queued on it has left. */
  private closeSocket(): void {
    const socket = this.socket
    this.socket = null
    this.ready = false
    if (socket === null) return
    if ((this.pending.get(socket) ?? 0) === 0) closeQuietly(socket)
    else this.draining.add(socket)
  }
}

function closeQuietly(socket: DmxSocket): void {
  try {
    socket.close()
  } catch {
    // Already closed: nothing is held.
  }
}

function sameBinding(a: DmxBinding, b: DmxBinding): boolean {
  return a.address === b.address && a.broadcast === b.broadcast
}

// ─── Listening ────────────────────────────────────────────────────────────────

interface HeardSource {
  name: string
  priority: number
  at: number
  data: Uint8Array
}

/** A universe heard from the network, merged the way a receiver merges it. */
export interface HeardFrame {
  data: Uint8Array
  merge: boolean
  /** Who it is from: the highest-priority source's name, and how many others share it. */
  source: string
}

export interface ReceiverOptions {
  createSocket?: DmxSocketFactory
  /** The ports listened on, for a test that cannot take the protocols' own. */
  sacnPort?: number
  artnetPort?: number
  now?: () => number
  onError?: (message: string) => void
  /** Whether a packet is this machine's own, come back on the loop or the broadcast. */
  isOwn?: (remote: RemoteInfo, cid: string | null) => boolean
}

/**
 * Listens for the universes a show monitors or merges, and for the nodes a poll finds.
 *
 * sACN sources are merged as E1.31 asks a receiver to: the highest priority heard within the
 * data-loss timeout wins, and sources sharing that priority are merged highest takes
 * precedence. Art-Net carries no priority, so every live source of a universe is merged
 * highest takes precedence, which is what an Art-Net node does with two controllers.
 */
export class DmxReceiver {
  private sacn: DmxSocket | null = null
  private artnet: DmxSocket | null = null
  private inputs: UniverseInput[] = []
  private binding: DmxBinding = UNPINNED
  private readonly heard = new Map<string, Map<string, HeardSource>>()
  private polls: Array<(reply: Buffer, remote: RemoteInfo) => void> = []
  private readonly create: DmxSocketFactory
  private readonly sacnPort: number
  private readonly artnetPort: number
  private readonly now: () => number

  constructor(private readonly options: ReceiverOptions = {}) {
    this.create = options.createSocket ?? defaultSocketFactory
    this.sacnPort = options.sacnPort ?? SACN_PORT
    this.artnetPort = options.artnetPort ?? ARTNET_PORT
    this.now = options.now ?? Date.now
  }

  /** Opens what the inputs need and closes what they no longer do. */
  configure(inputs: readonly UniverseInput[], binding: DmxBinding): void {
    const enabled = inputs.filter(input => input.enabled)
    const rebound = !sameBinding(binding, this.binding)
    this.binding = binding
    this.inputs = enabled
    for (const id of [...this.heard.keys()]) if (!enabled.some(input => input.id === id)) this.heard.delete(id)

    const wantsSacn = enabled.some(input => input.protocol === 'sacn')
    if (this.sacn !== null && (!wantsSacn || rebound)) this.closeSacn()
    if (wantsSacn && this.sacn === null) this.openSacn()
    else if (wantsSacn) this.joinGroups()

    const wantsArtnet = enabled.some(input => input.protocol === 'artnet') || this.polls.length > 0
    if (this.artnet !== null && (!wantsArtnet || rebound)) this.closeArtnet()
    if (wantsArtnet && this.artnet === null) this.openArtnet()
  }

  /** The universes some enabled input is shown as. */
  universes(): number[] {
    return [...new Set(this.inputs.map(input => input.universe))]
  }

  /** What is heard on a show universe now, merged, or null when nothing live is. */
  frame(universe: number): HeardFrame | null {
    const now = this.now()
    let best: HeardFrame | null = null
    for (const input of this.inputs) {
      if (input.universe !== universe) continue
      const sources = this.heard.get(input.id)
      if (sources === undefined) continue
      let top = -1
      for (const [key, source] of sources) {
        if (now - source.at > SOURCE_TIMEOUT_MS) {
          sources.delete(key)
          continue
        }
        top = Math.max(top, source.priority)
      }
      const winners = [...sources.values()].filter(source => source.priority === top)
      if (winners.length === 0) continue
      const data = new Uint8Array(DMX_LIMITS.slots)
      for (const source of winners) {
        for (let at = 0; at < source.data.length && at < data.length; at++) data[at] = Math.max(data[at], source.data[at])
      }
      const name = winners.length === 1 ? winners[0].name : `${winners[0].name} and ${winners.length - 1} more`
      if (best === null) best = { data, merge: input.merge, source: name }
      else {
        for (let at = 0; at < data.length; at++) best.data[at] = Math.max(best.data[at], data[at])
        best.merge = best.merge || input.merge
      }
    }
    return best
  }

  /**
   * Asks the Art-Net network who is there and gathers the replies for the poll's wait. A poll
   * goes to the interface's broadcast address — every node answers one — or to `target`.
   */
  async discover(target?: string, waitMs = POLL_WAIT_MS): Promise<ArtNetNode[]> {
    const found = new Map<string, ArtNetNode>()
    const collect = (reply: Buffer, remote: RemoteInfo): void => {
      const read = decodeArtPollReply(reply)
      if (read === null) return
      const ports = pollReplyPortAddresses(read)
      const node: ArtNetNode = {
        address: read.address === '0.0.0.0' ? remote.address : read.address,
        shortName: read.shortName,
        longName: read.longName,
        outputs: ports.outputs,
        inputs: ports.inputs,
        mac: read.mac,
        bindIndex: read.bindIndex
      }
      // A node with several ports answers once per bound index; each one is a row.
      if (found.size < 256) found.set(`${node.address}#${node.bindIndex}`, node)
    }
    this.polls.push(collect)
    this.configure(this.inputs, this.binding)
    const socket = this.artnet
    const destination = splitDestination(
      target ?? this.binding.broadcast ?? '255.255.255.255',
      this.artnetPort
    )
    try {
      await this.whenListening(socket)
      socket?.send(encodeArtPoll(), destination.port, destination.host, error => {
        if (error) this.options.onError?.(`polling Art-Net: ${describe(error)}`)
      })
      await new Promise<void>(resolve => {
        const timer = setTimeout(resolve, waitMs)
        timer.unref?.()
      })
    } finally {
      this.polls = this.polls.filter(poll => poll !== collect)
      this.configure(this.inputs, this.binding)
    }
    return [...found.values()].sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }))
  }

  /** The port sACN is heard on, once it is bound. */
  sacnLocalPort(): number | null {
    try {
      return this.sacn?.address?.().port ?? null
    } catch {
      return null
    }
  }

  /** The port Art-Net is heard on, once it is bound. */
  artnetLocalPort(): number | null {
    try {
      return this.artnet?.address?.().port ?? null
    } catch {
      return null
    }
  }

  close(): void {
    this.closeSacn()
    this.closeArtnet()
    this.heard.clear()
  }

  private listening = new WeakSet<DmxSocket>()

  private whenListening(socket: DmxSocket | null): Promise<void> {
    if (socket === null || this.listening.has(socket)) return Promise.resolve()
    return new Promise(resolve => {
      socket.on('listening', () => resolve())
      // A socket that fails to bind never says it is listening; the poll still ends.
      const timer = setTimeout(resolve, 500)
      timer.unref?.()
    })
  }

  private openSacn(): void {
    const socket = this.create()
    this.sacn = socket
    socket.on('error', error => this.options.onError?.(`listening for sACN: ${describe(error)}`))
    socket.on('listening', () => {
      this.listening.add(socket)
      if (this.sacn === socket) this.joinGroups()
    })
    socket.on('message', (message, remote) => this.hearSacn(message, remote))
    socket.unref?.()
    try {
      socket.bind(this.sacnPort)
    } catch (error) {
      this.options.onError?.(`listening for sACN: ${describe(error)}`)
    }
  }

  private joined = new Set<string>()

  private joinGroups(): void {
    const socket = this.sacn
    if (socket === null || !this.listening.has(socket)) return
    for (const input of this.inputs) {
      if (input.protocol !== 'sacn') continue
      const group = sacnMulticastAddress(input.wireUniverse)
      if (this.joined.has(group)) continue
      try {
        socket.addMembership?.(group, this.binding.address ?? undefined)
        this.joined.add(group)
      } catch (error) {
        this.options.onError?.(`joining ${group}: ${describe(error)}`)
      }
    }
  }

  private openArtnet(): void {
    const socket = this.create()
    this.artnet = socket
    socket.on('error', error => this.options.onError?.(`listening for Art-Net: ${describe(error)}`))
    socket.on('listening', () => {
      this.listening.add(socket)
      try {
        socket.setBroadcast?.(true)
      } catch (error) {
        this.options.onError?.(describe(error))
      }
    })
    socket.on('message', (message, remote) => this.hearArtnet(message, remote))
    socket.unref?.()
    try {
      socket.bind(this.artnetPort)
    } catch (error) {
      this.options.onError?.(`listening for Art-Net: ${describe(error)}`)
    }
  }

  private hearSacn(message: Buffer, remote: RemoteInfo): void {
    const packet = decodeSacnData(message)
    if (packet === null) return
    if (this.options.isOwn?.(remote, packet.cid) === true) return
    // Preview data is for a visualiser, never for levels.
    if ((packet.options & SACN_OPTION_PREVIEW) !== 0) return
    for (const input of this.inputs) {
      if (input.protocol !== 'sacn' || input.wireUniverse !== packet.universe) continue
      const sources = this.heard.get(input.id) ?? new Map<string, HeardSource>()
      this.heard.set(input.id, sources)
      if ((packet.options & SACN_OPTION_TERMINATED) !== 0) {
        sources.delete(packet.cid)
        continue
      }
      if (!sources.has(packet.cid) && sources.size >= SOURCES_PER_INPUT) continue
      sources.set(packet.cid, {
        name: packet.sourceName || remote.address,
        priority: packet.priority,
        at: this.now(),
        data: packet.slots
      })
    }
  }

  private hearArtnet(message: Buffer, remote: RemoteInfo): void {
    if (this.polls.length > 0) for (const poll of this.polls) poll(message, remote)
    const packet = decodeArtDmx(message)
    if (packet === null) return
    if (this.options.isOwn?.(remote, null) === true) return
    for (const input of this.inputs) {
      if (input.protocol !== 'artnet' || input.wireUniverse !== packet.portAddress) continue
      const sources = this.heard.get(input.id) ?? new Map<string, HeardSource>()
      this.heard.set(input.id, sources)
      const key = `${remote.address}:${remote.port}`
      if (!sources.has(key) && sources.size >= SOURCES_PER_INPUT) continue
      sources.set(key, { name: remote.address, priority: 0, at: this.now(), data: packet.slots })
    }
  }

  private closeSacn(): void {
    const socket = this.sacn
    this.sacn = null
    this.joined.clear()
    if (socket === null) return
    try {
      socket.close()
    } catch {
      // Already closed: nothing is held.
    }
  }

  private closeArtnet(): void {
    const socket = this.artnet
    this.artnet = null
    if (socket === null) return
    try {
      socket.close()
    } catch {
      // Already closed: nothing is held.
    }
  }
}
