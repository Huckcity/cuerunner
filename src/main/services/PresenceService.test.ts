// The presence service has to browse a network without being able to require one:
// every socket comes from an injected factory, so a test drives announcements, errors
// and silence by hand and the clock is fake so a device can be waited out in a tick.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { Buffer } from 'node:buffer'
import { PresenceService } from './PresenceService'
import type { PresenceSocket } from './PresenceService'
import { buildPtrQuery } from './mdns'
import type { ServiceContext } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import { defaultShowSettings } from '../../shared/show'
import type { DeviceState, PresenceSettings, ShowSettings } from '../../shared/show'

const BASE = Date.parse('2026-01-01T00:00:00.000Z')
const SERVICE = '_netaudio-arc._udp.local'
const INSTANCE = 'Amp 1'
const DEVICE_ID = `presence:${INSTANCE}.${SERVICE}`
const GROUP = '224.0.0.251'
const PORT = 5000

function u16(value: number): Buffer {
  const bytes = Buffer.alloc(2)
  bytes.writeUInt16BE(value)
  return bytes
}

/** A name as length-prefixed labels with the root label that ends it. */
function name(text: string): Buffer {
  const labels = text
    .split('.')
    .filter(part => part.length > 0)
    .map(part => {
      const bytes = Buffer.from(part, 'utf8')
      return Buffer.concat([Buffer.from([bytes.length]), bytes])
    })
  return Buffer.concat([...labels, Buffer.from([0x00])])
}

function record(owner: Buffer, type: number, ttl: number, data: Buffer): Buffer {
  return Buffer.concat([owner, u16(type), u16(1), u32(ttl), u16(data.length), data])
}

function u32(value: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(value)
  return bytes
}

/**
 * One browse answer, uncompressed and entirely literal: a PTR naming the instance,
 * then the SRV, TXT and A records that describe it.
 */
function announcement(
  service = SERVICE,
  options: { address?: number[]; txt?: string[] } = {}
): Buffer {
  const address = options.address ?? [10, 0, 0, 7]
  const txt = options.txt ?? ['device-name=Amp 1', 'apiver=1', 'noequals', 'empty=']
  const serviceName = name(service)
  const instanceName = name(`${INSTANCE}.${service}`)
  const hostName = name('amp1.local')

  const header = Buffer.alloc(12)
  header.writeUInt16BE(0x8400, 2)
  header.writeUInt16BE(2, 6)
  header.writeUInt16BE(2, 10)

  const ptr = record(serviceName, 12, 3600, instanceName)
  const srv = record(instanceName, 33, 120, Buffer.concat([u16(0), u16(0), u16(PORT), hostName]))
  const txtRecord = record(instanceName, 16, 4500, Buffer.concat(txt.map(name)))
  const a = record(hostName, 1, 120, Buffer.from(address))
  return Buffer.concat([header, ptr, srv, txtRecord, a])
}

/** Stands in for dgram's socket so no UDP port is ever opened. */
class FakeSocket {
  readonly sent: Array<{ packet: Buffer; port: number; address: string }> = []
  readonly groups: string[] = []
  readonly closed = vi.fn()
  bound: { port: number; exclusive?: boolean } | null = null
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  constructor(private readonly bindFailure: string | null = null) {}

  on(event: string, listener: (...args: unknown[]) => void): void {
    const existing = this.listeners[event] ?? []
    existing.push(listener)
    this.listeners[event] = existing
  }

  bind(options: { port: number; exclusive?: boolean }): void {
    this.bound = options
    if (this.bindFailure !== null) {
      this.emit('error', new Error(this.bindFailure))
      return
    }
    this.emit('listening')
  }

  addMembership(group: string): void {
    this.groups.push(group)
  }

  send(packet: Buffer, port: number, address: string): void {
    this.sent.push({ packet, port, address })
  }

  close(): void {
    this.closed()
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners[event] ?? []) listener(...args)
  }
}

function settings(patch: Partial<PresenceSettings> = {}): ShowSettings {
  const defaults = defaultShowSettings()
  return { ...defaults, presence: { ...defaults.presence, enabled: true, ...patch } }
}

interface Harness {
  service: PresenceService
  sockets: FakeSocket[]
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

function harness(bindFailure: string | null = null): Harness {
  const sockets: FakeSocket[] = []
  const service = new PresenceService(() => {
    const socket = new FakeSocket(bindFailure)
    sockets.push(socket)
    return socket as unknown as PresenceSocket
  })
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, sockets, context: { bus, setState }, setState, bus }
}

function device(bus: ShowBus, id = DEVICE_ID): DeviceState | undefined {
  return bus.snapshot().devices.find(candidate => candidate.id === id)
}

function messages(bus: ShowBus): string[] {
  return bus.snapshot().alerts.map(alert => alert.message)
}

function deviceEvents(bus: ShowBus): number {
  return bus.snapshot().events.filter(event => event.kind === 'device').length
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(BASE)
})
afterEach(() => vi.useRealTimers())

describe('PresenceService', () => {
  it('opens nothing when browsing is disabled', async () => {
    const { service, sockets, context, setState, bus } = harness()

    service.start(context, settings({ enabled: false }))

    expect(setState).toHaveBeenCalledWith('stopped', 'disabled')
    expect(sockets).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(bus.snapshot().devices).toEqual([])
    expect(messages(bus)).toEqual([])
  })

  it('binds 5353, joins the group and asks once per service, then every ten seconds', async () => {
    const { service, sockets, context, setState } = harness()
    const services = [SERVICE, '_netaudio-cmc._udp.local']

    service.start(context, settings({ services }))

    const socket = sockets[0]
    expect(socket.bound).toEqual({ port: 5353, exclusive: false })
    expect(socket.groups).toEqual([GROUP])
    expect(setState).toHaveBeenCalledWith('running', 'browsing 2 services')
    expect(socket.sent).toHaveLength(2)
    expect(socket.sent.map(entry => entry.port)).toEqual([5353, 5353])
    expect(socket.sent.map(entry => entry.address)).toEqual([GROUP, GROUP])
    expect(socket.sent[0].packet.equals(buildPtrQuery(services[0]))).toBe(true)
    expect(socket.sent[1].packet.equals(buildPtrQuery(services[1]))).toBe(true)

    await vi.advanceTimersByTimeAsync(10_000)
    expect(socket.sent).toHaveLength(4)
  })

  it('publishes a device with the address, port and text it announced', () => {
    const { service, sockets, context, bus } = harness()
    service.start(context, settings())

    sockets[0].emit('message', announcement(), { address: '10.0.0.7', port: 5353 })

    expect(device(bus)).toEqual({
      id: DEVICE_ID,
      service: 'presence',
      name: INSTANCE,
      model: SERVICE,
      online: true,
      lastSeen: BASE,
      detail: {
        address: '10.0.0.7',
        port: '5000',
        'device-name': 'Amp 1',
        apiver: '1',
        noequals: '',
        empty: ''
      }
    })
    expect(messages(bus)).toEqual([])
  })

  it('refreshes lastSeen without publishing the same device twice', async () => {
    const { service, sockets, context, bus } = harness()
    service.start(context, settings())

    sockets[0].emit('message', announcement())
    await vi.advanceTimersByTimeAsync(2000)
    sockets[0].emit('message', announcement())

    expect(device(bus)?.lastSeen).toBe(BASE + 2000)
    expect(bus.snapshot().devices).toHaveLength(1)
    expect(deviceEvents(bus)).toBe(1)
    expect(messages(bus)).toEqual([])
  })

  it('ages a device out once, and re-arms the alarm when it returns', async () => {
    const { service, sockets, context, bus } = harness()
    service.start(context, settings({ goneAfterSeconds: 30 }))

    sockets[0].emit('message', announcement())
    expect(device(bus)?.online).toBe(true)

    await vi.advanceTimersByTimeAsync(25_000)
    expect(device(bus)?.online).toBe(true)
    expect(messages(bus)).toEqual([])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(device(bus)).toMatchObject({ online: false, name: INSTANCE, lastSeen: BASE })
    expect(messages(bus)).toEqual([`${INSTANCE} left the network`])
    expect(bus.snapshot().alerts[0]).toMatchObject({
      level: 'warning',
      source: 'presence',
      deviceId: DEVICE_ID
    })

    // Still gone: the leaving was said once, not once per sweep.
    await vi.advanceTimersByTimeAsync(30_000)
    expect(messages(bus)).toHaveLength(1)

    sockets[0].emit('message', announcement())
    expect(device(bus)?.online).toBe(true)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(messages(bus)).toEqual([
      `${INSTANCE} left the network`,
      `${INSTANCE} left the network`
    ])
  })

  it('degrades without throwing on a socket error, and keeps sweeping', async () => {
    const { service, sockets, context, setState, bus } = harness()
    service.start(context, settings({ goneAfterSeconds: 30 }))
    sockets[0].emit('message', announcement())

    expect(() => sockets[0].emit('error', new Error('EADDRINUSE'))).not.toThrow()
    expect(setState).toHaveBeenCalledWith('degraded', 'EADDRINUSE')
    expect(messages(bus)).toEqual(['Network devices: EADDRINUSE'])

    // One alarm per outage, not one per error event.
    sockets[0].emit('error', new Error('EADDRINUSE'))
    expect(messages(bus)).toHaveLength(1)

    // The device that was already found still ages out honestly.
    await vi.advanceTimersByTimeAsync(35_000)
    expect(device(bus)?.online).toBe(false)
    expect(messages(bus)).toEqual(['Network devices: EADDRINUSE', `${INSTANCE} left the network`])
  })

  it('degrades when the bind fails, as it does when another responder holds 5353', async () => {
    const { service, sockets, context, setState, bus } = harness('EADDRINUSE')

    expect(() => service.start(context, settings())).not.toThrow()

    expect(setState).toHaveBeenCalledWith('degraded', 'EADDRINUSE')
    expect(messages(bus)).toEqual(['Network devices: EADDRINUSE'])
    expect(sockets[0].groups).toEqual([])
    await vi.advanceTimersByTimeAsync(20_000)
    expect(sockets[0].sent).toEqual([])
  })

  it('ignores garbage and services it was not asked to browse', () => {
    const { service, sockets, context, bus } = harness()
    service.start(context, settings())
    sockets[0].emit('message', announcement())
    expect(bus.snapshot().devices).toHaveLength(1)

    // Noise, an empty datagram, a name pointing at itself, and another network's service.
    const loop = Buffer.alloc(12)
    loop.writeUInt16BE(0x8400, 2)
    loop.writeUInt16BE(1, 6)
    const selfPointer = Buffer.concat([
      loop,
      Buffer.from([0xc0, 0x0c, 0x00, 0x0c, 0x00, 0x01, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x00])
    ])
    expect(() => sockets[0].emit('message', Buffer.from([0xde, 0xad, 0xbe, 0xef]))).not.toThrow()
    expect(() => sockets[0].emit('message', Buffer.alloc(0))).not.toThrow()
    expect(() => sockets[0].emit('message', selfPointer)).not.toThrow()
    sockets[0].emit('message', announcement('_http._tcp.local'))

    expect(bus.snapshot().devices).toHaveLength(1)
    expect(device(bus)?.online).toBe(true)
    expect(messages(bus)).toEqual([])
  })

  it('rescans on demand and answers with what it knows', () => {
    const { service, sockets, context } = harness()
    service.start(context, settings({ services: [SERVICE] }))
    const socket = sockets[0]
    expect(socket.sent).toHaveLength(1)

    sockets[0].emit('message', announcement())

    expect(service.command('rescan')).toEqual({ devices: 1 })
    expect(socket.sent).toHaveLength(2)
    expect(socket.sent[1].packet.equals(buildPtrQuery(SERVICE))).toBe(true)
    expect(() => service.command('reboot')).toThrow('Unknown action "reboot"')
  })

  it('stops its timers, its socket and its reporting', async () => {
    const { service, sockets, context, setState, bus } = harness()
    service.start(context, settings())
    const socket = sockets[0]
    socket.emit('message', announcement())

    service.stop()
    service.stop()

    expect(socket.closed).toHaveBeenCalledTimes(1)
    const sentWhenStopped = socket.sent.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(socket.sent).toHaveLength(sentWhenStopped)
    // The device was on the network when browsing stopped, and is not reported again.
    expect(messages(bus)).toEqual([])
    expect(device(bus)?.online).toBe(true)

    // A socket that nobody is listening to changes nothing after the fact.
    socket.emit('error', new Error('late'))
    socket.emit('message', announcement())
    expect(setState).not.toHaveBeenCalledWith('degraded', expect.anything())
    expect(service.command('rescan')).toEqual({ devices: 0 })
    expect(socket.sent).toHaveLength(sentWhenStopped)
  })
})
