// The OSC listener is the show's ear: one socket, every desk that talks to it, and a port
// conflict that must be refused and said rather than shared in silence or allowed to take the
// main process with it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Mock } from 'vitest'
import { EventEmitter } from 'node:events'
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { OscInputService, refusalSentence, type OscSocket } from './OscInputService'
import type { ServiceContext } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import type { ShowEvent, ShowSettings } from '../../shared/show'
import { defaultShowSettings } from '../../shared/show'
import type { OscArg } from '../../shared/cue'
import { decodePacket, encodeMessage } from '../osc/codec'
import type { OscFeedbackSnapshot } from '../../shared/oscFeedback'

type OscEvent = Extract<ShowEvent, { kind: 'osc' }>

/** Stands in for the listener's dgram socket, so no UDP port is ever opened. */
class FakeSocket extends EventEmitter {
  readonly closed = vi.fn()
  readonly sent: Array<{ packet: Buffer; port: number; address: string }> = []
  bound: { port: number; address?: string } | null = null
  boundPort: number | null = null

  bind(port: number, address?: string): void {
    this.bound = { port, address }
  }

  address(): { address: string; port: number } {
    return { address: this.bound?.address ?? '0.0.0.0', port: this.boundPort ?? this.bound?.port ?? 0 }
  }

  send(packet: Buffer, port: number, address: string, callback?: (error: Error | null) => void): void {
    this.sent.push({ packet, port, address })
    callback?.(null)
  }

  close(): void {
    this.closed()
  }

  /** A datagram arriving from a sender. */
  arrive(packet: Buffer, address: string, port = 9000): void {
    const remote: RemoteInfo = { address, port, family: 'IPv4', size: packet.length }
    this.emit('message', packet, remote)
  }
}

function settings(enabled: boolean, port: number): ShowSettings {
  return { ...defaultShowSettings(), oscIn: { enabled, port }, midiIn: { enabled: false, portNames: [] } }
}

function oscEvents(bus: ShowBus): OscEvent[] {
  return bus.snapshot().events.filter((event): event is OscEvent => event.kind === 'osc')
}

const message = (address: string, ...args: OscArg[]): Buffer => encodeMessage(address, args)

/** A bundle of packets, as OSC 1.0 writes one: tag, time tag, and size-prefixed elements. */
function bundle(...elements: Buffer[]): Buffer {
  const head = Buffer.alloc(16)
  head.write('#bundle', 0, 'ascii')
  head.writeUInt32BE(0, 8)
  head.writeUInt32BE(1, 12)
  return Buffer.concat([head, ...elements.flatMap(element => {
    const size = Buffer.alloc(4)
    size.writeInt32BE(element.length)
    return [size, element]
  })])
}

interface Harness {
  service: OscInputService
  sockets: FakeSocket[]
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

function harness(options: { binding?: () => { address: string | null; name: string | null; missing: boolean } } = {}): Harness {
  const sockets: FakeSocket[] = []
  const service = new OscInputService({
    open: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket as unknown as OscSocket
    },
    binding: options.binding,
    appVersion: () => '9.9.9'
  })
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, sockets, context: { bus, setState }, setState, bus }
}

const open: OscInputService[] = []
const raw: Socket[] = []
afterEach(() => {
  for (const service of open.splice(0)) service.stop()
  for (const socket of raw.splice(0)) {
    try { socket.close() } catch { /* already closed */ }
  }
})

describe('OscInputService', () => {
  it('binds nothing when OSC input is disabled', () => {
    const { service, sockets, context, setState } = harness()

    service.start(context, settings(false, 53000))

    expect(sockets).toHaveLength(0)
    expect(setState).toHaveBeenCalledWith('stopped', 'disabled')
  })

  it('reports the port the socket actually bound, not the one that was asked for', () => {
    const { service, sockets, context, setState } = harness()

    service.start(context, settings(true, 53000))

    expect(sockets).toHaveLength(1)
    expect(sockets[0].bound).toEqual({ port: 53000, address: '0.0.0.0' })
    expect(setState).toHaveBeenCalledWith('starting', 'binding 0.0.0.0:53000')

    // The operator asked for 53000; the socket came back on another port.
    sockets[0].boundPort = 51234
    sockets[0].emit('listening')

    expect(setState).toHaveBeenCalledWith('running', 'listening on port 51234')
  })

  it('binds the interface this machine pinned it to, and names it', () => {
    const { service, sockets, context, setState } = harness({
      binding: () => ({ address: '10.0.0.2', name: 'eth1', missing: false })
    })
    service.start(context, settings(true, 53000))
    expect(sockets[0].bound).toEqual({ port: 53000, address: '10.0.0.2' })
    sockets[0].emit('listening')
    expect(setState).toHaveBeenCalledWith('running', 'listening on port 53000 on eth1 (10.0.0.2)')
  })

  it('says an interface that has gone, and listens on every interface rather than none', () => {
    const { service, sockets, context, bus } = harness({
      binding: () => ({ address: null, name: 'eth1', missing: true })
    })
    service.start(context, settings(true, 53000))
    expect(sockets[0].bound).toEqual({ port: 53000, address: '0.0.0.0' })
    expect(bus.snapshot().alerts.map(alert => alert.message)).toEqual([
      'OSC input: eth1 is not on this machine — listening on every interface'
    ])
  })

  it('publishes a message with its sender and the types it was sent with', () => {
    const { service, sockets, context, bus } = harness()
    service.start(context, settings(true, 53000))

    sockets[0].arrive(message('/cue/1/start',
      { type: 'i', value: 7 }, { type: 'f', value: 1.5 }, { type: 'T', value: true },
      { type: 'F', value: false }, { type: 's', value: 'go' }, { type: 'f', value: 2 }
    ), '192.168.1.24', 8000)

    expect(oscEvents(bus)).toEqual([
      expect.objectContaining({
        kind: 'osc',
        from: '192.168.1.24:8000',
        address: '/cue/1/start',
        args: [
          { type: 'i', value: 7 },
          { type: 'f', value: 1.5 },
          { type: 'T', value: true },
          { type: 'F', value: false },
          { type: 's', value: 'go' },
          // A float that happens to be whole is still the float the sender sent.
          { type: 'f', value: 2 }
        ]
      })
    ])
  })

  it('publishes one event per bundle element, in order', () => {
    const { service, sockets, context, bus } = harness()
    service.start(context, settings(true, 53000))

    sockets[0].arrive(bundle(
      message('/a', { type: 'i', value: 1 }),
      message('/b', { type: 's', value: 'x' }),
      message('/c', { type: 'f', value: 2.5 })
    ), '10.0.0.2')

    expect(oscEvents(bus).map(event => event.address)).toEqual(['/a', '/b', '/c'])
    expect(oscEvents(bus).map(event => event.from)).toEqual(['10.0.0.2:9000', '10.0.0.2:9000', '10.0.0.2:9000'])
  })

  it('publishes the messages inside a bundle that holds bundles', () => {
    // OSC 1.0 allows a bundle of bundles, and a message one level down must not be dropped.
    const { service, sockets, context, bus } = harness()
    service.start(context, settings(true, 53000))

    sockets[0].arrive(bundle(
      message('/a'),
      bundle(bundle(message('/deep')), message('/b'))
    ), '10.0.0.2')

    expect(oscEvents(bus).map(event => event.address)).toEqual(['/a', '/deep', '/b'])
  })

  it('degrades and warns instead of throwing when the socket errors after it bound', () => {
    const { service, sockets, context, setState, bus } = harness()
    service.start(context, settings(true, 53000))
    sockets[0].emit('listening')

    expect(() => sockets[0].emit('error', new Error('recv ENOBUFS'))).not.toThrow()

    expect(setState).toHaveBeenCalledWith('degraded', 'stopped listening: recv ENOBUFS')
    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({ level: 'warning', source: 'osc-in', message: 'OSC input: stopped listening: recv ENOBUFS' })
    ])
  })

  it('ignores a datagram that is not OSC instead of latching the service degraded', () => {
    // Anyone on the show network may send junk to this port. The listener is fine, so the
    // row stays running and the messages that do arrive keep firing cues; one line says it
    // happened, and a flood of junk is not a flood of alarms.
    const { service, sockets, context, setState, bus } = harness()
    service.start(context, settings(true, 53000))
    sockets[0].emit('listening')

    sockets[0].arrive(Buffer.from('hello there'), '10.0.0.9')
    sockets[0].arrive(Buffer.from([0x2f, 0x61, 0x00, 0x00, 0x2c, 0x69, 0x00, 0x00]), '10.0.0.9')
    sockets[0].arrive(message('/go'), '10.0.0.9')

    expect(setState).not.toHaveBeenCalledWith('degraded', expect.anything())
    expect(setState).toHaveBeenLastCalledWith('running', 'listening on port 53000')
    expect(bus.snapshot().alerts.filter(alert => alert.level === 'info')).toHaveLength(1)
    expect(oscEvents(bus)).toHaveLength(1)
  })

  it('closes the socket on stop, once', () => {
    const { service, sockets, context } = harness()
    service.start(context, settings(true, 53000))

    service.stop()
    service.stop()

    expect(sockets[0].closed).toHaveBeenCalledTimes(1)
  })

  describe('the allow list', () => {
    function allowing(allowFrom: string[]): ShowSettings {
      const base = settings(true, 53000)
      return { ...base, oscIn: { ...base.oscIn, allowFrom } }
    }

    it('hears a sender on the list, and drops everyone else before the bus', () => {
      const { service, sockets, context, bus } = harness()
      service.start(context, allowing(['10.0.0.0/24']))

      sockets[0].arrive(message('/go'), '10.0.0.7')
      sockets[0].arrive(message('/go'), '172.16.0.9')
      sockets[0].arrive(bundle(message('/stop')), '172.16.0.9')

      expect(oscEvents(bus).map(event => event.from)).toEqual(['10.0.0.7:9000'])
    })

    it('names a refused sender once, however much it sends', () => {
      const { service, sockets, context, bus } = harness()
      service.start(context, allowing(['10.0.0.5']))

      for (let i = 0; i < 5; i++) sockets[0].arrive(message('/go'), '172.16.0.9')

      const refusals = bus.snapshot().alerts.filter(alert => alert.message.includes('172.16.0.9'))
      expect(refusals).toHaveLength(1)
      expect(refusals[0].message).toBe('OSC input: ignored 172.16.0.9, which is not on the allow list')
    })

    it('hears an IPv4 sender that arrives on a dual-stack socket', () => {
      const { service, sockets, context, bus } = harness()
      service.start(context, allowing(['10.0.0.5']))

      sockets[0].arrive(message('/go'), '::ffff:10.0.0.5')

      expect(oscEvents(bus)).toHaveLength(1)
    })

    it('answers no query from a sender off the list', () => {
      const { service, sockets, context } = harness()
      service.start(context, allowing(['10.0.0.5']))
      sockets[0].arrive(message('/thump'), '172.16.0.9')
      expect(sockets[0].sent).toHaveLength(0)
    })
  })

  describe('the feedback', () => {
    const snapshot: OscFeedbackSnapshot = {
      workspaceId: 'WS-1',
      workspaceName: 'Show',
      listId: 'main',
      playhead: { id: 'c2', number: '2', name: 'Storm', type: 'audio' },
      running: [],
      cues: [
        { id: 'c1', number: '1', name: 'Walk-in', type: 'audio', parentId: null, isArmed: true, colorName: 'none', notes: '' },
        { id: 'c2', number: '2', name: 'Storm', type: 'audio', parentId: null, isArmed: true, colorName: 'none', notes: '' }
      ]
    }

    it('answers a QLab query on /reply to the sender, from the state the window published, and fires nothing', () => {
      const { service, sockets, context, bus } = harness()
      service.start(context, settings(true, 53000))
      service.command('feedback', snapshot)

      sockets[0].arrive(message('/workspace/WS-1/cue/selected/number'), '10.0.0.7', 53001)

      expect(oscEvents(bus)).toHaveLength(0)
      expect(sockets[0].sent).toHaveLength(1)
      const [reply] = decodePacket(sockets[0].sent[0].packet)
      expect(sockets[0].sent[0]).toMatchObject({ port: 53001, address: '10.0.0.7' })
      expect(reply.address).toBe('/reply/workspace/WS-1/cue/selected/number')
      expect(JSON.parse(String(reply.args[0].value))).toEqual({
        workspace_id: 'WS-1',
        address: '/workspace/WS-1/cue/selected/number',
        status: 'ok',
        data: '2'
      })
    })

    it('leaves a command on a cue to the window', () => {
      const { service, sockets, context, bus } = harness()
      service.start(context, settings(true, 53000))
      service.command('feedback', snapshot)

      sockets[0].arrive(message('/cue/2/start'), '10.0.0.7')

      expect(oscEvents(bus).map(event => event.address)).toEqual(['/cue/2/start'])
      expect(sockets[0].sent).toHaveLength(0)
    })

    it('refuses a snapshot that is not one', () => {
      const { service, context } = harness()
      service.start(context, settings(true, 53000))
      expect(() => service.command('feedback', { cues: 3 })).toThrow()
      expect(() => service.command('dance')).toThrow()
    })
  })
})

describe('the listener binds its port exclusively', () => {
  /** A real service on a real socket, with a status and a log to read. */
  function real(): { service: OscInputService; setState: Mock; bus: ShowBus; context: ServiceContext } {
    const service = new OscInputService()
    open.push(service)
    const bus = new ShowBus({ now: () => 1000 })
    const setState = vi.fn()
    return { service, setState, bus, context: { bus, setState } }
  }

  async function listening(setState: Mock): Promise<number> {
    await vi.waitFor(() => expect(setState).toHaveBeenCalledWith('running', expect.stringMatching(/^listening on port \d+/)))
    const detail = setState.mock.calls.find(call => call[0] === 'running')![1] as string
    return Number(/port (\d+)/.exec(detail)![1])
  }

  it('refuses a second listener on the port it holds, and says so in the status and the log', async () => {
    const first = real()
    first.service.start(first.context, settings(true, 0))
    const port = await listening(first.setState)

    const second = real()
    second.service.start(second.context, settings(true, port))

    await vi.waitFor(() => expect(second.setState).toHaveBeenCalledWith('degraded', expect.stringContaining('EADDRINUSE')))
    const sentence = refusalSentence(Object.assign(new Error('x'), { code: 'EADDRINUSE' }), '0.0.0.0', port)
    expect(second.setState).toHaveBeenCalledWith('degraded', sentence)
    expect(sentence).toBe(
      `port ${port} is in use by another program (QLab, another Cuerunner, a bridge) — ` +
      'this show cannot hear OSC there until it is let go or the port is changed (EADDRINUSE)'
    )
    // The log is the alert's: the operator reads the same sentence there.
    expect(second.bus.snapshot().alerts).toEqual([
      expect.objectContaining({ level: 'warning', source: 'osc-in', message: `OSC input: ${sentence}` })
    ])
    // The first listener is untouched: it still holds the port and still hears it.
    expect(first.setState).not.toHaveBeenCalledWith('degraded', expect.anything())
  })

  it('cannot be joined by a program that binds with address reuse, as QLab’s listener does', async () => {
    const ours = real()
    ours.service.start(ours.context, settings(true, 0))
    const port = await listening(ours.setState)

    const intruder = createSocket({ type: 'udp4', reuseAddr: true })
    raw.push(intruder)
    const refused = await new Promise<string | null>(resolve => {
      intruder.once('error', error => resolve((error as NodeJS.ErrnoException).code ?? error.message))
      intruder.once('listening', () => resolve(null))
      intruder.bind(port, '0.0.0.0')
    })
    expect(refused).toBe('EADDRINUSE')
  })

  it('is refused by a port another program already shares with address reuse, rather than splitting its traffic', async () => {
    const holder = createSocket({ type: 'udp4', reuseAddr: true })
    raw.push(holder)
    await new Promise<void>(resolve => holder.bind(0, '0.0.0.0', () => resolve()))
    const port = holder.address().port

    const ours = real()
    ours.service.start(ours.context, settings(true, port))
    await vi.waitFor(() => expect(ours.setState).toHaveBeenCalledWith('degraded', expect.stringContaining(`port ${port} is in use`)))
  })
})
