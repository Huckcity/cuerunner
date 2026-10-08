// Every service owns part of the machine, and two facts about that ownership belong to
// the app rather than to the service:
//
// - a timer it leaves ref'd is a poller holding the whole app open after the window is
//   gone, and nothing before this held the services' `unref`s;
// - an error on a socket it opened that reaches nobody takes the main process down, so
//   each one is swallowed into a status or an alarm and the process survives.
//
// Each service is driven through the seam its own tests use — an injected factory, a
// stand-in link, a fake track — over the real timers, patched only to be counted, because
// `hasRef()` on a fake clock's timer is not the question. The settings a drive hands over
// are recorded as they are read, so a section one of them turns out to read has to be one
// the service declares; the guard over the service sources is the other half of that.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  clearInterval as clearNodeInterval,
  clearTimeout as clearNodeTimeout,
  setInterval as nodeSetInterval,
  setTimeout as nodeSetTimeout
} from 'node:timers'
import { createConnection as connectTcp, createServer as createTcpServer, type Server, type Socket } from 'node:net'
import { ShowBus } from '../bus/ShowBus'
import { defaultServices } from '../show/runtime'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import { defaultRfThresholds, defaultShowSettings } from '../../shared/show'
import type { ShowSettings, TelemetrySource } from '../../shared/show'
import { defaultRedundancySettings, type RedundancySettings } from '../../shared/redundancy'
import { deskLinkName } from '../../shared/deskLink'
import { SqNativeEngine } from '../desk/SqNativeEngine'
import { OscInputService } from './OscInputService'
import { MidiInputService } from './MidiInputService'
import { MidiTcpService, type DeskLink } from './MidiTcpService'
import { SqNativeService } from './SqNativeService'
import { WirelessService } from './WirelessService'
import { PresenceService, type PresenceSocket } from './PresenceService'
import { CompanionService } from './CompanionService'
import { RedundancyService } from './RedundancyService'
import { TimecodeService } from './TimecodeService'
import { TimecodeHub } from '../timecode/hub'
import { MidiTimecodeTap } from '../timecode/midiTap'

const DESK = '10.0.0.5'
const DESK_PORT = 51325

/** The section vocabulary a read of the settings is judged against. */
const SECTIONS: Record<string, true> = Object.fromEntries(
  Object.keys(defaultShowSettings()).map(section => [section, true])
)

/** The rack the wireless drive polls, with delays distinctive enough to find again. */
const RACK: TelemetrySource = {
  id: 'rack',
  label: 'Shure rack',
  kind: 'http',
  target: 'http://10.0.0.9/telemetry',
  pollMs: 60_000,
  timeoutMs: 1_500
}

/** The service's own cadence for looking at the OS port list. */
const PORT_POLL_MS = 2000

/** The service's own cadences: two asks a minute, and silence measured every five seconds. */
const QUERY_MS = 10_000
const SWEEP_MS = 5_000

/** The sweep's own delay: half the offline window, kept between a tenth of a second and one. */
const RF_SWEEP_MS = Math.max(
  100,
  Math.min(1000, (defaultRfThresholds().offlineAfterSeconds * 1000) / 2)
)

/** The test's own delays, so each handle a drive arms can be told apart by its delay. */
const KEEP_ALIVE_MS = 60_000
const HEARTBEAT_MS = 61_000
const CHECK_MS = 62_000
const RETRY_MS = 63_000
// The timecode hub's push to the window, as the literal it is.
const TIMECODE_PUSH_MS = 40

// ─── What each case holds on to, and lets go of ────────────────────────────────

const services: ShowService[] = []
const buses: ShowBus[] = []
const held: Array<{ close(): void }> = []

afterEach(async () => {
  // Every service is stopped and every socket released whatever any one of them does: a
  // case that failed still leaves the process as it found it.
  const cleanup = [
    ...services.splice(0).map(async service => service.stop()),
    ...buses.splice(0).map(async bus => bus.close()),
    ...held.splice(0).map(async server => server.close())
  ]
  await Promise.allSettled(cleanup)
})

/** A listener that holds a port, so a service told to bind it meets the error the machine raises. */
async function hold(): Promise<number> {
  const server = createTcpServer()
  const bound = Promise.withResolvers<void>()
  server.once('error', bound.reject)
  server.listen(0, '0.0.0.0', () => {
    bound.resolve()
  })
  await bound.promise
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('the holder never bound')
  held.push(server)
  return address.port
}

/** A port nothing is listening on: a dial to it is refused, as dialling a dead partner is. */
async function deadPort(): Promise<number> {
  const server = createTcpServer()
  const bound = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', () => {
    bound.resolve()
  })
  await bound.promise
  const address = server.address()
  if (typeof address !== 'object' || address === null) throw new Error('the probe never bound')
  const port = address.port
  const closed = Promise.withResolvers<void>()
  server.close(() => {
    closed.resolve()
  })
  await closed.promise
  return port
}

/**
 * Lets the event loop turn until `until` holds. What a socket reports is delivered over
 * the loop rather than synchronously, and the wait is on the condition rather than on a
 * duration: the budget is turns, so a busy machine slows the case instead of failing it.
 */
async function turns(until: () => boolean, budget = 10_000): Promise<void> {
  for (let turn = 0; turn < budget && !until(); turn++) {
    await new Promise<void>(resolve => {
      setImmediate(resolve)
    })
  }
}

/** A timer the drive was handed, with what it was asked to run. */
interface CreatedTimer {
  /** The delay the runtime asked for, which is what tells one handle from another. */
  ms: number
  /** The handle itself, where `hasRef()` is read. */
  handle: NodeJS.Timeout
  /** Runs what the timer was asked to run, as the clock would when it came due. */
  fire(): void
}

/** Whether the drive armed a timer for this delay. */
function armed(created: CreatedTimer[], ms: number): boolean {
  return created.some(timer => timer.ms === ms)
}

/** What one drive armed, what it let go of, and what it returned. */
interface Capture<T> {
  result: T
  /** Every handle the runtime handed out while the drive ran, in order. */
  created: CreatedTimer[]
  /** Every handle the service let go of while the drive ran: cleared, so not kept. */
  released: NodeJS.Timeout[]
}

/**
 * Node's own timer functions, as the capture calls them: a callback and its arguments in,
 * a `Timeout` with `hasRef()` out.
 */
type NodeTimerFactory = <TArgs extends unknown[]>(
  callback: (...args: TArgs) => void,
  ms?: number,
  ...args: TArgs
) => NodeJS.Timeout

/** The clearing half of Node's timers: a handle in, and the same handle released. */
type NodeTimerRelease = (handle?: NodeJS.Timeout) => void

/**
 * Runs one drive over the process's timers, recording every handle handed out and every
 * handle released. The handles are real — `hasRef()` is the question — so the drive runs
 * on the real clock and what it starts is stopped by the case itself. The swap is restored
 * whichever way the drive leaves, so one case cannot leak timers into the next.
 */
async function captureTimers<T>(
  run: (clock: CreatedTimer[]) => Promise<T>
): Promise<Capture<T>> {
  const created: CreatedTimer[] = []
  const released: NodeJS.Timeout[] = []
  const real = {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    clearTimeout: globalThis.clearTimeout,
    clearInterval: globalThis.clearInterval
  }

  const recordCreation =
    (create: NodeTimerFactory) =>
    <TArgs extends unknown[]>(callback: (...args: TArgs) => void, ms?: number, ...args: TArgs): NodeJS.Timeout => {
      const handle = create(callback, ms, ...args)
      created.push({ ms: ms ?? 0, handle, fire: () => callback(...args) })
      return handle
    }

  const recordRelease =
    (release: NodeTimerRelease) =>
    (handle?: NodeJS.Timeout): void => {
      if (handle !== undefined) released.push(handle)
      release(handle)
    }

  // `node:timers` re-exports the globals, whose declared type here is a DOM/Node union;
  // the runtime behind it is Node's own timer, which is what hands back a `Timeout`.
  const createTimeout = nodeSetTimeout as unknown as NodeTimerFactory
  const createInterval = nodeSetInterval as unknown as NodeTimerFactory
  const releaseTimeout = clearNodeTimeout as unknown as NodeTimerRelease
  const releaseInterval = clearNodeInterval as unknown as NodeTimerRelease

  // The whole set goes to Node's own timers for the length of the drive, so what is
  // counted is a real handle with a real `hasRef()` whatever the environment's globals are
  // and a handle created here is cleared by the same functions as everything else.
  globalThis.setTimeout = recordCreation(createTimeout) as unknown as typeof globalThis.setTimeout
  globalThis.setInterval = recordCreation(createInterval) as unknown as typeof globalThis.setInterval
  globalThis.clearTimeout = recordRelease(releaseTimeout) as unknown as typeof globalThis.clearTimeout
  globalThis.clearInterval = recordRelease(releaseInterval) as unknown as typeof globalThis.clearInterval
  try {
    const result = await run(created)
    return { result, created, released }
  } finally {
    globalThis.setTimeout = real.setTimeout
    globalThis.setInterval = real.setInterval
    globalThis.clearTimeout = real.clearTimeout
    globalThis.clearInterval = real.clearInterval
  }
}

/** What a service reported through, what it read, and what it said. */
interface Harness {
  context: ServiceContext
  /** The show settings for this drive, wrapped so every section read is recorded. */
  settings(patch?: Partial<ShowSettings>): ShowSettings
  /** The sections of `settings()` that were read during the drive. */
  sectionsRead(): string[]
  /** Forgets what has been reported: the failure's own report is read after this. */
  mark(): void
  /** What the service reported since the mark — the statuses it set, then its alarms. */
  reported(): string[]
}

function harness(): Harness {
  // A window the drive cannot reach: the bus arms one flush timer when it is primed below
  // and none while the service's handles are being counted, and that timer is outside the
  // capture, so what is counted is the service's own.
  const bus = new ShowBus({ flushMs: 60 * 60 * 1000 })
  buses.push(bus)
  const setState = vi.fn()
  const read: string[] = []
  bus.alert('info', 'hygiene', 'arming the bus flush')
  let from = { states: 0, alerts: 0 }

  return {
    context: { bus, setState },
    settings(patch = {}) {
      return new Proxy(
        { ...defaultShowSettings(), ...patch },
        {
          get(target, property, receiver) {
            if (typeof property === 'string' && SECTIONS[property] === true && !read.includes(property)) {
              read.push(property)
            }
            return Reflect.get(target, property, receiver)
          }
        }
      )
    },
    sectionsRead(): string[] {
      return read
    },
    mark(): void {
      from = { states: setState.mock.calls.length, alerts: bus.snapshot().alerts.length }
    },
    reported(): string[] {
      return [
        ...setState.mock.calls.slice(from.states).map(call => `${call[0]}: ${call[1]}`),
        ...bus
          .snapshot()
          .alerts.slice(from.alerts)
          // The one alert the harness raised itself, so a drive waiting on a report waits
          // for the service's own rather than for the bus being armed.
          .filter(alert => alert.source !== 'hygiene')
          .map(alert => alert.message)
      ]
    }
  }
}

/** One service's drive: how to stand it up against the test's stand-ins, and how to break them. */
interface Driver {
  /**
   * The delays the drive must arm before the case proves anything, each one a timer the
   * service's own start() or its own failure creates. A count of handles would prove
   * nothing — the bus arms one of its own outside the capture — so the delay names it.
   */
  arms: readonly number[]
  /** What the report of the failure must name, so a report is not taken for an account. */
  names: string
  /** Starts the service with the seam in place, so it binds, dials or polls for real. */
  start(harness: Harness): ShowService | Promise<ShowService>
  /**
   * Fails the thing this service opened, the way the machine does, and waits for the
   * account of it. `clock` is everything the service has been given to run, so a poll can
   * be made to come due without waiting out its interval.
   */
  crash(harness: Harness, clock: CreatedTimer[]): void | Promise<void>
}

// ─── The fakes each seam takes ─────────────────────────────────────────────────

/** Stands in for node-osc's server, so a drive opens no UDP port. */
class FakeOscServer extends EventEmitter {
  readonly port: number

  constructor(port: number) {
    super()
    this.port = port
  }

  close(): void {
    // Nothing was opened, so there is nothing to release.
  }
}

/** Stands in for the optional `midi` package's view of the machine: a port list and inputs. */
class FakeMidiOs {
  failWith: Error | null = null

  constructor(readonly ports: string[]) {}

  create(): FakeMidiPort {
    if (this.failWith) throw this.failWith
    return new FakeMidiPort(this)
  }
}

class FakeMidiPort {
  constructor(private readonly os: FakeMidiOs) {}

  getPortCount(): number {
    return this.os.ports.length
  }

  getPortName(index: number): string {
    return this.os.ports[index]
  }

  openPort(_index: number): void {}
  ignoreTypes(_sysex: boolean, _timing: boolean, _activeSense: boolean): void {}
  on(_event: 'message', _listener: (deltaTime: number, message: number[]) => void): void {}
  closePort(): void {}
}

/** Stands in for dgram's socket, so a drive opens no UDP port. */
class FakeSocket extends EventEmitter {
  bind(): void {
    // A real bind answers over the loop; the drive's account of it starts here.
    this.emit('listening')
  }

  addMembership(_group: string): void {}
  send(_packet: Buffer, _port: number, _address: string): void {}
  close(): void {}
}

// ─── The drives ────────────────────────────────────────────────────────────────

function oscDriver(): Driver {
  const servers: FakeOscServer[] = []
  return {
    // The OSC listener holds no clock of its own.
    arms: [],
    names: 'EADDRINUSE',
    start(h) {
      const service = new OscInputService(port => {
        const server = new FakeOscServer(port)
        servers.push(server)
        return server
      })
      service.start(h.context, h.settings({ oscIn: { enabled: true, port: 53000 } }))
      servers[0].emit('listening')
      return service
    },
    crash() {
      // The port somebody else holds, reported on the socket the service opened.
      servers[0].emit('error', new Error('EADDRINUSE'))
    }
  }
}

function midiInputDriver(): Driver {
  const os = new FakeMidiOs(['Stage Rack'])
  return {
    // The poll of the OS port list.
    arms: [PORT_POLL_MS],
    names: 'no such interface',
    start(h) {
      const service = new MidiInputService(() => os.create())
      service.start(h.context, h.settings({ midiIn: { enabled: true, portNames: ['Stage Rack'] } }))
      return service
    },
    crash(_h, clock) {
      // The interface left the machine, and the poll is what sees it: let the poll come
      // due rather than waiting out its two seconds.
      os.failWith = new Error('no such interface')
      const poll = clock.find(timer => timer.ms === PORT_POLL_MS)
      if (!poll) throw new Error('the drive never armed the poll it was to make come due')
      poll.fire()
    }
  }
}

function midiTcpDriver(): Driver {
  const link: DeskLink = { open: vi.fn(), closeAll: vi.fn(), onMessage: null, onStatus: null }
  return {
    // The desk's socket and its retry timer belong to the engine, which holds both in
    // MidiTcpEngine's own tests; this service reads the link's report.
    arms: [],
    names: 'ECONNREFUSED',
    start(h) {
      const service = new MidiTcpService(link)
      service.start(
        h.context,
        h.settings({ desk: { ...defaultShowSettings().desk, kind: 'midi-tcp', host: DESK, tcpPort: DESK_PORT } })
      )
      return service
    },
    crash() {
      // What the engine reports when the desk's socket fails or the dial is refused.
      link.onStatus?.(deskLinkName(DESK, DESK_PORT), false, 'ECONNREFUSED')
    }
  }
}

function wirelessDriver(): Driver {
  const fetchJson = vi.fn()
  return {
    // The abort timeout a read arms, the poll, and the sweep.
    arms: [RACK.timeoutMs, RACK.pollMs, RF_SWEEP_MS],
    names: 'connect ECONNREFUSED',
    start(h) {
      fetchJson.mockResolvedValue({ ok: true, status: 200, json: async () => ({ channels: [] }) })
      const service = new WirelessService({ fetchJson, readText: vi.fn() })
      service.start(
        h.context,
        h.settings({ rf: { plot: { packs: [] }, sources: [RACK], swaps: [], thresholds: defaultRfThresholds() } })
      )
      return service
    },
    async crash(h, clock) {
      // The rack stopped answering; the next poll is where the service finds out.
      fetchJson.mockRejectedValue(new Error('connect ECONNREFUSED'))
      const poll = clock.find(timer => timer.ms === RACK.pollMs)
      if (!poll) throw new Error('the drive never armed a poll to make come due')
      poll.fire()
      await turns(() => h.reported().length > 0)
    }
  }
}

function presenceDriver(): Driver {
  const sockets: FakeSocket[] = []
  return {
    // The query and the sweep.
    arms: [QUERY_MS, SWEEP_MS],
    names: 'EADDRINUSE',
    start(h) {
      const service = new PresenceService(() => {
        const socket = new FakeSocket()
        sockets.push(socket)
        // The real socket's methods return `this`; the service reads only these five.
        const asSocket = socket as unknown as PresenceSocket
        return asSocket
      })
      service.start(
        h.context,
        h.settings({ presence: { enabled: true, services: ['_netaudio-arc._udp.local'], goneAfterSeconds: 30 } })
      )
      return service
    },
    crash() {
      // What the OS reports when another responder already holds 5353.
      sockets[0].emit('error', new Error('EADDRINUSE'))
    }
  }
}

function companionDriver(): Driver {
  let service: CompanionService
  return {
    // The stream keep-alive, armed once the listener is up.
    arms: [KEEP_ALIVE_MS],
    names: 'EADDRINUSE',
    async start(h) {
      service = new CompanionService({ lanAddress: () => DESK, keepAliveMs: KEEP_ALIVE_MS })
      service.start(h.context, h.settings({ companion: { enabled: true, port: 0, token: 's3cret' } }))
      // Listening is the loop's to deliver, and the keep-alive is armed on it.
      await turns(() => h.reported().length > 0)
      return service
    },
    async crash(h) {
      // The operator moved the port onto one somebody else holds: the listener's own
      // error event, then the service's account of it.
      const port = await hold()
      service.start(h.context, h.settings({ companion: { enabled: true, port, token: 's3cret' } }))
      await turns(() => h.reported().length > 0)
    }
  }
}

function redundancyDriver(): Driver {
  return {
    // The heartbeat, the check, and the retry a refused dial arms.
    arms: [HEARTBEAT_MS, CHECK_MS, RETRY_MS],
    names: 'EADDRINUSE',
    async start(h) {
      const taken = await hold()
      const refused = await deadPort()
      const config: RedundancySettings = {
        ...defaultRedundancySettings('Stage', 'machine-one'),
        enabled: true,
        port: taken,
        peerHost: '127.0.0.1',
        peerPort: refused,
        token: 'pair',
        timeoutMs: 200
      }
      const service = new RedundancyService({
        settings: () => config,
        heartbeatMs: HEARTBEAT_MS,
        checkMs: CHECK_MS,
        retryMs: RETRY_MS
      })
      service.start(h.context, h.settings())
      return service
    },
    async crash(h, clock) {
      // The port is held and the partner is dead: wait for the sockets to have said so,
      // rather than assuming how many turns the loop needs.
      await turns(() => armed(clock, RETRY_MS) && h.reported().length > 0)
    }
  }
}

function timecodeDriver(): Driver {
  let refuseBind = (): void => {}
  return {
    // The push that tells the window where the clock is, armed as the receiver starts.
    arms: [TIMECODE_PUSH_MS],
    names: 'EADDRINUSE',
    async start(h) {
      // The bind answers when the drive says: the port is found taken after the mark.
      const bind = Promise.withResolvers<never>()
      refuseBind = () => bind.reject(new Error('bind EADDRINUSE 0.0.0.0:6454'))
      const hub = new TimecodeHub({
        filePath: 'timecode.json',
        // A machine set to hear ArtTimeCode, on a port another program already holds.
        readFile: () => JSON.stringify({ source: 'artnet', artnetPort: 6454 }),
        receiver: {
          now: () => Date.now(),
          tap: new MidiTimecodeTap(),
          listMidiInputs: () => [],
          openMidiInput: () => {
            throw new Error('no MIDI here')
          },
          ltc: null,
          bindUdp: () => bind.promise
        },
        generators: { now: () => Date.now(), sendMidi: () => ({ ok: true }), ltc: null, sendArtnet: () => {} },
        broadcast: () => {},
        restartReceiver: async () => {}
      })
      const service = new TimecodeService(() => hub)
      void service.start(h.context, h.settings())
      return service
    },
    async crash(h) {
      refuseBind()
      await turns(() => h.reported().length > 0)
    }
  }
}

function sqNativeDriver(): Driver {
  // The desk this drive owns: a real server the engine's dial reaches, so the session really
  // comes up and the two cadences are really armed. The ports are the desk's own, so the
  // seam the drive stands in is the dial itself.
  const sockets: Socket[] = []
  return {
    // §6's two cadences, as the literals they were measured as: the keepalive datagram each
    // second and the socket ping every three. A drive that never brought a session up would
    // arm neither.
    arms: [1000, 3000],
    names: 'needs a reset',
    async start(h) {
      const server: Server = createTcpServer(socket => {
        sockets.push(socket)
        // The desk answers the session's hello, as a real one does — the capture's own echo
        // — because a session is not up until the desk has said something.
        let answered = false
        let seen = ''
        let scanned = 0
        socket.on('data', chunk => {
          if (answered) return
          seen += chunk.toString('hex')
          if (!seen.includes('7f000200000066ae', scanned)) {
            // Keep the tail unscanned: the frame may straddle two reads.
            scanned = Math.max(scanned, seen.length - 15)
            return
          }
          answered = true
          socket.write(Buffer.from('7f00020000007cc8', 'hex'))
        })
        socket.on('error', () => {
          // The reset this drive asks for is not a failure of the desk's own.
        })
      })
      held.push(server)
      const bound = Promise.withResolvers<void>()
      server.once('error', bound.reject)
      server.listen(0, '127.0.0.1', () => bound.resolve())
      await bound.promise
      const address = server.address()
      if (typeof address !== 'object' || address === null) throw new Error('the drive’s desk never bound')

      const service = new SqNativeService(
        new SqNativeEngine((_host, _port) => connectTcp({ host: '127.0.0.1', port: address.port }))
      )
      service.start(
        h.context,
        h.settings({ desk: { ...defaultShowSettings().desk, kind: 'midi-tcp', profile: 'sq', host: DESK } })
      )
      // The session is up once the desk has read the hello and answered it: that is what
      // arms the cadences. The dial and the answer are real I/O, and `turns` counts
      // iterations rather than time, so the budget is generous and a session that never
      // comes up says what it saw instead of leaving an unarmed timer behind.
      await turns(() => h.reported().some(report => report.startsWith('running')), 1_000_000)
      if (!h.reported().some(report => report.startsWith('running'))) {
        throw new Error(`the drive’s desk never brought the session up: ${h.reported().join(' / ')}`)
      }
      return service
    },
    async crash(h) {
      // The desk the session was on goes away under it, which is the outage the row and the
      // alarm are written for.
      for (const socket of sockets.splice(0)) socket.destroy()
      await turns(() => h.reported().length > 0)
    }
  }
}

const DRIVERS: Record<string, () => Driver> = {
  OscInputService: oscDriver,
  MidiInputService: midiInputDriver,
  MidiTcpService: midiTcpDriver,
  SqNativeService: sqNativeDriver,
  WirelessService: wirelessDriver,
  PresenceService: presenceDriver,
  CompanionService: companionDriver,
  RedundancyService: redundancyDriver,
  TimecodeService: timecodeDriver
}

describe('service hygiene', () => {
  it('drives every service the app ships', () => {
    const driven = Object.keys(DRIVERS)
    const missing = defaultServices()
      .map(service => service.constructor.name)
      .filter(name => !driven.includes(name))
    expect(missing, 'a service with no hygiene drive is a timer nothing holds').toEqual([])
  })

  for (const [name, make] of Object.entries(DRIVERS)) {
    it(`${name}: leaves no timer ref'd, clears what it started, and reports what failed`, async () => {
      const driver = make()
      const h = harness()
      const capture = await captureTimers(async clock => {
        const started = await driver.start(h)
        services.push(started)
        h.mark()
        await driver.crash(h, clock)

        // Asked while the service still holds them: an unref'd timer reports so even once
        // cleared, but only if it was unref'd.
        for (const timer of clock) {
          expect(timer.handle.hasRef(), `${name} left a timer holding the app open`).toBe(false)
        }
        // Stopped inside the capture, so the handles it lets go of are the ones counted.
        await started.stop()
        return started
      })

      for (const delay of driver.arms) {
        expect(armed(capture.created, delay), `${name} never armed its ${delay}ms timer`).toBe(true)
      }
      for (const timer of capture.created) {
        expect(
          capture.released.includes(timer.handle),
          `${name} left a timer running after stop()`
        ).toBe(true)
      }

      // What a drive's read of the settings turns out to be is what the declaration must
      // own; the guard over the sources sees the spellings a scan can, this sees the drive.
      const declared: readonly string[] = capture.result.settingsSections
      const undeclared = h.sectionsRead().filter(section => !declared.includes(section))
      expect(undeclared, `${name} read a settings section it does not declare`).toEqual([])

      const reported = h.reported().join('\n')
      expect(reported, `${name} let a socket failure pass without a word`).not.toEqual('')
      expect(reported, `${name} reported the failure without naming it`).toContain(driver.names)
    })
  }
})
