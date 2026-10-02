// The SQ's native session against real sockets, because what this engine is is a client of
// a desk: the only honest test of one is a server on the other end. Every case owns its desk
// — a TCP server on 51326, the desk's own door on 51321 and a datagram socket on UDP 51324,
// the three ports §6 measured — and asserts what the desk received or what the service was
// told, never what the engine says it did.
//
// The cadences are driven on a fake clock so a case can watch a second and three seconds
// pass, with the timers recorded as they are armed: `hasRef()` on the handle is what says
// whether a cadence would have held the app open on quit.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { createSocket, type Socket as DatagramSocket } from 'node:dgram'
import { setImmediate as yieldTurn } from 'node:timers/promises'
import { CONNECT_DEADLINE_MS, RETRY_MS, SqNativeEngine, type SqSessionCause } from './SqNativeEngine'
import { GOODBYE, NATIVE_KEEPALIVE_PORT, NATIVE_LEAVE_PORT, NATIVE_TCP_PORT, sessionFrames } from './frames'
import { drainMainErrors } from '../errors'

/**
 * The desk's name here, and the name the moving case dials it by after the show moves: two
 * loopback addresses that no other lane binds — the unit, integration and e2e lanes each keep
 * to aliases of their own — so this file's three ports are its own sockets, and the session
 * bytes a case reads are its own client's.
 *
 * Linux and Windows carry the whole 127/8; macOS configures 127.0.0.1 alone, and a second
 * address there fails the bind with `EADDRNOTAVAIL`. The aliases are therefore chosen per
 * platform, and only the moving case — the one that needs two — is darwin-skipped, which is
 * the platform where the two names would collapse into one.
 */
const ALIASES = process.platform === 'darwin' ? ['127.0.0.1'] : processLoopbacks()

/**
 * Two loopback addresses that no other process is using. The ports are the desk's own — 51321,
 * 51324 and 51326 are fixed by its protocol — so the only thing that can differ between two runs
 * of this file is the address, and CI runs it under two Node versions at once on one machine.
 * Fixed addresses made them race for the same sockets and fail with `EADDRINUSE`, a different
 * test each time. The process id is unique among the processes running now, and spelled out as the
 * three middle octets it names an address nobody else has; the last octet leaves room for the second.
 */
function processLoopbacks(): [string, string] {
  const id = process.pid
  const last = 2 + (id % 250)
  const middle = Math.floor(id / 250) % 250
  const first = Math.floor(id / 62_500) % 250
  return [`127.${first}.${middle}.${last}`, `127.${first}.${middle}.${last + 1}`]
}
const [HOST, MOVED = HOST] = ALIASES

const hex = (bytes: readonly number[] | Uint8Array): string => Buffer.from(bytes).toString('hex')

/** The session's own bytes, which is what a desk that accepts the connection should read first. */
const SESSION = sessionFrames().flat()
const SESSION_BYTES = SESSION.length

/**
 * The hello the client opens with and repeats every three seconds: the one `7f 00 02` write
 * the capture holds. A real desk answers it, and the desks below do the same — a session is
 * not up until the desk has said something.
 */
const HELLO = [0x7f, 0x00, 0x02, 0x00, 0x00, 0x00, 0x66, 0xae]

/** The capture's own answer to that hello, which is the echo a desk gives. */
const ANSWER = Buffer.from('7f00020000007cc8', 'hex')

/**
 * What a membership writes, in the capture's own bytes: input 1 on DCA 1 placed, input 2 on
 * DCA 1 cleared, and the channel's flag both ways — `00 00` for the channel that rides a DCA
 * and `01` for the one that rides none. Spelled here rather than read out of the codec, so
 * that a codec which moved would not move its own expectation with it; `frames.test.ts` holds
 * these same literals against the fixture.
 */
const PLACED = 'f707071d00000100'
const CLEARED = 'f707071d01000000'
const FLAG_RIDES = 'f707070c00000000'
const FLAG_NONE = 'f707070c01000100'

interface DeskOptions {
  /**
   * Whether the desk answers the hello and each ping, as the capture measures one doing.
   * Off is the state §6 also measures: TCP taken, and nothing said.
   */
  answers?: boolean
}

interface Desk {
  /** Every byte the session wrote on the control connection, in the order it arrived. */
  received: number[]
  /** Every byte the client wrote on the desk's own leave port. */
  leaveReceived: number[]
  /** The connections the leave port has taken: the dial count, so a second dial shows here. */
  leaves: Socket[]
  /** Every datagram the keepalive sent, in the order they arrived. */
  datagrams: number[][]
  /** The control connections this desk has accepted, newest last. */
  controls: Socket[]
  /** Pushes bytes at the session, the way the desk pushes state while a show moves. */
  push(bytes: string): void
  /** Ends the control connection the way a desk that goes away does. */
  drop(): void
  close(): Promise<void>
}

async function startDesk(options: DeskOptions = {}): Promise<Desk> {
  const answers = options.answers ?? true
  const received: number[] = []
  const leaveReceived: number[] = []
  const datagrams: number[][] = []
  const controls: Socket[] = []
  const leaves: Socket[] = []

  // The desk's control service, on the port §6 measured, under both of the names a case
  // dials it by: one server holds one address, so each of this machine's two names gets its
  // own listener onto the same desk.
  const onControl = (socket: Socket): void => {
    controls.push(socket)
    let scanned = 0
    socket.on('data', chunk => {
      received.push(...chunk)
      if (!answers) return
      // Every hello the client writes is answered, the way a real desk answers the session's
      // open and then each ping: that echo is what makes the session one the panel is told
      // about.
      for (let at = scanned; at + HELLO.length <= received.length; at++) {
        if (!HELLO.every((byte, offset) => received[at + offset] === byte)) continue
        socket.write(ANSWER)
        scanned = at + HELLO.length
      }
      scanned = Math.max(scanned, received.length - HELLO.length + 1)
    })
    socket.on('error', () => {
      // A connection this test reset is a connection it already knows about.
    })
  }
  // The desk's own door, on the range's leave port. It answers nothing; it listens, so that
  // a client that dials it here can hold the channel its goodbye goes out on.
  const onLeave = (socket: Socket): void => {
    leaves.push(socket)
    socket.on('data', chunk => leaveReceived.push(...chunk))
    socket.on('error', () => {
      // Same: a reset this test asked for.
    })
  }
  const names = ALIASES
  const control: Server[] = names.map(() => createServer(onControl))
  const leave: Server[] = names.map(() => createServer(onLeave))
  const keepalives: DatagramSocket[] = names.map(() => createSocket('udp4'))

  // Bound on this machine's two names rather than on every interface: the desk's ports are
  // the same numbers every lane uses, and a wildcard bind would take them from another
  // lane's app — and read that app's client as this file's own desk.
  const listening = (server: Server, port: number, address: string): Promise<void> => {
    const bound = Promise.withResolvers<void>()
    server.once('error', bound.reject)
    server.listen(port, address, () => bound.resolve())
    return bound.promise
  }
  const boundKeepalive = (socket: DatagramSocket, address: string): Promise<void> => {
    const bound = Promise.withResolvers<void>()
    socket.on('message', message => datagrams.push([...message]))
    socket.once('error', bound.reject)
    socket.bind(NATIVE_KEEPALIVE_PORT, address, () => bound.resolve())
    return bound.promise
  }

  await Promise.all([
    ...names.map((name, at) => listening(control[at], NATIVE_TCP_PORT, name)),
    ...names.map((name, at) => listening(leave[at], NATIVE_LEAVE_PORT, name)),
    ...names.map((name, at) => boundKeepalive(keepalives[at], name))
  ])

  return {
    received,
    leaveReceived,
    leaves,
    datagrams,
    controls,
    push: bytes => {
      for (const socket of controls) socket.write(Buffer.from(bytes, 'hex'))
    },
    drop: () => {
      for (const socket of controls.splice(0)) socket.resetAndDestroy()
    },
    close: async () => {
      for (const socket of [...controls, ...leaves]) socket.destroy()
      for (const socket of keepalives) socket.close()
      await Promise.all(
        [...control, ...leave].map(server => {
          const done = Promise.withResolvers<void>()
          server.close(() => done.resolve())
          return done.promise
        })
      )
    }
  }
}

async function until(condition: () => boolean, timeoutMs = 3000, saw?: () => string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      // A wait that gives up says what it was looking at: a bare timeout leaves the next
      // reader guessing which half of a compound condition never came true.
      throw new Error(`timed out waiting for the desk${saw === undefined ? '' : `: ${saw()}`}`)
    }
    await yieldTurn()
  }
}

/**
 * Lets the loop turn a few times, so that bytes a case believes were not written have had
 * every chance to arrive: an absence is evidence only once something could have happened.
 */
async function turns(count = 4): Promise<void> {
  for (let turn = 0; turn < count; turn++) await yieldTurn()
}

/**
 * What the engine armed, over whatever clock is installed at the time — with fake timers
 * these are the fake clock's own handles, and `hasRef()` on one is the question the app
 * cares about. `fire()` runs a callback the way the clock would when it came due, which is
 * how a cadence that fires after the session was released can be driven at all.
 */
function recordTimers(): {
  armed: Array<{ ms: number; handle: NodeJS.Timeout; fire: () => void }>
  restore: () => void
} {
  const armed: Array<{ ms: number; handle: NodeJS.Timeout; fire: () => void }> = []
  const real = { setTimeout: globalThis.setTimeout, setInterval: globalThis.setInterval }
  const record =
    (create: (callback: () => void, ms?: number) => NodeJS.Timeout) =>
    (callback: () => void, ms?: number): NodeJS.Timeout => {
      const handle = create(callback, ms)
      armed.push({ ms: ms ?? 0, handle, fire: callback })
      return handle
    }
  const factory = (value: unknown): ((callback: () => void, ms?: number) => NodeJS.Timeout) =>
    value as (callback: () => void, ms?: number) => NodeJS.Timeout
  globalThis.setTimeout = record(factory(real.setTimeout)) as unknown as typeof globalThis.setTimeout
  globalThis.setInterval = record(factory(real.setInterval)) as unknown as typeof globalThis.setInterval
  return {
    armed,
    restore: () => {
      globalThis.setTimeout = real.setTimeout
      globalThis.setInterval = real.setInterval
    }
  }
}

interface Status {
  online: boolean
  detail?: string
  cause?: SqSessionCause
}

const desks: Desk[] = []
const engines: SqNativeEngine[] = []

async function desk(options: DeskOptions = {}): Promise<Desk> {
  const started = await startDesk(options)
  desks.push(started)
  return started
}

function engine(connect?: (host: string, port: number) => Socket): { engine: SqNativeEngine; statuses: Status[] } {
  const created = new SqNativeEngine(connect)
  engines.push(created)
  const statuses: Status[] = []
  created.onStatus = (online, detail, cause) => {
    statuses.push({ online, ...(detail === undefined ? {} : { detail }), ...(cause === undefined ? {} : { cause }) })
  }
  return { engine: created, statuses }
}

beforeEach(() => {
  // Whatever a previous case reported through the app's own log is not this case's business.
  drainMainErrors()
})

afterEach(async () => {
  for (const created of engines.splice(0)) created.closeAll()
  for (const created of desks.splice(0)) await created.close()
  vi.useRealTimers()
})

describe('opening the session', () => {
  it('writes the measured session, in the wire’s own order', async () => {
    const underTest = await desk()
    const { engine: session, statuses } = engine()

    session.open(HOST)

    await until(() => underTest.received.length >= SESSION_BYTES)
    expect(hex(underTest.received.slice(0, SESSION_BYTES))).toBe(hex(SESSION))
    // And the desk's own answer is what made it a session the panel was told about.
    await until(() => statuses.length === 1)
    expect(statuses).toEqual([
      { online: true, detail: `session open with ${HOST}:${NATIVE_TCP_PORT}` }
    ])
  })

  it('opens the desk’s own door with the session, and never at teardown', async () => {
    const underTest = await desk()
    const { engine: session } = engine()

    session.open(HOST)
    await until(() => underTest.leaves.length === 1)

    session.closeAll()

    // The leave channel was dialled when the session came up and not a moment later: the
    // quit path is where this matters, and nothing there may start a dial.
    expect(underTest.leaves).toHaveLength(1)
    await until(() => underTest.leaveReceived.length >= GOODBYE.length)
    expect(hex(underTest.leaveReceived)).toBe('4259452e')
    expect(Buffer.from(underTest.leaveReceived).toString('latin1')).toBe('BYE.')
    expect(underTest.leaves).toHaveLength(1)
    // And the session really ended: the desk's own connection is gone, and so is the channel.
    await until(() => underTest.controls.length === 1 && underTest.controls[0].destroyed)
    await until(() => underTest.leaves[0].destroyed)
  })

  it('opens the session again, and says so, when the show is reconfigured', async () => {
    // A configure stops every service it moves and starts it again (`ServiceHost.bringUp`),
    // so the same desk comes back with the show's settings. A session that came up then is
    // news: a row and a status left from the session before it would say the desk is where
    // nobody has looked since.
    const underTest = await desk()
    const { engine: session, statuses } = engine()

    session.open(HOST)
    await until(() => statuses.length === 1)
    session.closeAll()
    session.open(HOST)
    await until(() => statuses.length === 2)

    expect(statuses).toEqual([
      { online: true, detail: `session open with ${HOST}:${NATIVE_TCP_PORT}` },
      { online: true, detail: `session open with ${HOST}:${NATIVE_TCP_PORT}` }
    ])
    await until(() => underTest.received.length >= 2 * SESSION_BYTES)
    expect(hex(underTest.received.slice(0, SESSION_BYTES))).toBe(hex(SESSION))
    expect(hex(underTest.received.slice(SESSION_BYTES, 2 * SESSION_BYTES))).toBe(hex(SESSION))
  })

  it('stays up past three periods when the desk answers each ping, and says so once', async () => {
    const underTest = await desk()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      await until(() => statuses.length === 1)

      // Three periods, each with the desk's own echo: the session is a session, and the
      // panel was told that once rather than once a period.
      await vi.advanceTimersByTimeAsync(9000)
      await until(() => underTest.received.length >= SESSION_BYTES + 3 * 8)
      expect(hex(underTest.received.slice(SESSION_BYTES))).toBe(
        '7f000200000066ae7f000200000066ae7f000200000066ae'
      )
      expect(statuses).toEqual([
        { online: true, detail: `session open with ${HOST}:${NATIVE_TCP_PORT}` }
      ])

      // And both cadences are still flowing.
      const datagrams = underTest.datagrams.length
      const written = underTest.received.length
      await vi.advanceTimersByTimeAsync(3000)
      await until(() => underTest.datagrams.length > datagrams)
      await until(() => underTest.received.length > written)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays up on the desk’s own pushes, with no echo at all', async () => {
    // §6 measures the desk pushing its state (`7f 08 …` strip names among it) while the
    // client works, so the silence that ends a session is *no frame at all* — a desk that
    // keeps talking is a desk that is there, whatever it is saying.
    const underTest = await desk({ answers: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      await until(() => underTest.received.length >= SESSION_BYTES)

      // The desk's own strip-name push is the first thing it says, and the push is what
      // makes the session up.
      underTest.push('7f080e00000018180c0100000047726f75700000')
      await until(() => statuses.length === 1)

      // Three periods, each with one push in it and no answer to any ping.
      for (let period = 0; period < 3; period++) {
        await vi.advanceTimersByTimeAsync(3000)
        underTest.push('7f080e00000018180c0100000047726f75700000')
      }

      expect(statuses).toEqual([
        { online: true, detail: `session open with ${HOST}:${NATIVE_TCP_PORT}` }
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  // macOS, and only there: the desk fixture's leave channel is reset on that machine
  // (`read ECONNRESET`, which the engine reports as "not holding its leave channel… was not
  // told goodbye"), so the desk never reads the bytes this case is about. It is a fixture race
  // on a machine with the protocol's fixed ports, not a claim about the engine — which is why
  // the goodbye itself is asserted on every platform by the case above, where the session is
  // not moved — and it is in the deferred-work ledger with the line the engine printed.
  it.skipIf(process.platform === 'darwin')(
    'says goodbye where the session was, and opens another where the show moved',
    async () => {
    const underTest = await desk()
    const { engine: session, statuses } = engine()

    session.open(HOST)
    await until(() => statuses.length === 1)
    await until(() => underTest.leaves.length === 1)

    session.open(MOVED)
    await until(() => statuses.length === 2)
    expect(statuses[1]).toEqual({ online: true, detail: `session open with ${MOVED}:${NATIVE_TCP_PORT}` })

    // The desk that moved was left the way a quit leaves one: `BYE.` on the channel its
    // session was holding.
    await until(() => underTest.leaveReceived.length >= 4)
    expect(Buffer.from(underTest.leaveReceived.slice(0, 4)).toString('latin1')).toBe('BYE.')
    // The new session wrote its own frames and opened its own door while it came up.
    await until(() => underTest.received.length >= 2 * SESSION_BYTES)
    await until(() => underTest.leaves.length === 2)

    session.closeAll()
    // Teardown dials nothing: the second channel was opened with the second session, and the
    // first was released when the show moved off it.
    expect(underTest.leaves).toHaveLength(2)
    await until(() => underTest.leaveReceived.length >= 8)
    expect(Buffer.from(underTest.leaveReceived.slice(4)).toString('latin1')).toBe('BYE.')
  })

  it('reads what the desk pushes and answers it with nothing', async () => {
    const underTest = await desk()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session } = engine()
      session.open(HOST)
      await until(() => underTest.received.length >= SESSION_BYTES)

      // The desk's own strip-name push, as the capture holds it, and the form it answers a
      // hello with: both are the desk speaking, and neither is answered — no read is sent,
      // because what the desk says about a membership is the unmeasured half of this
      // protocol (Story 11.5's lane).
      underTest.push('7f080e00000018180c0100000047726f75700000')
      underTest.push('7f00020000007cc8')

      // Three seconds on: the client's only write since the session opened is its own ping.
      await vi.advanceTimersByTimeAsync(3000)
      await until(() => underTest.received.length >= SESSION_BYTES + 8)
      expect(hex(underTest.received.slice(SESSION_BYTES))).toBe('7f000200000066ae')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a membership', () => {
  it('writes the pair and then the channel’s flag, in the capture’s own bytes', async () => {
    const underTest = await desk()
    // The fake clock keeps the pings out of the bytes these cases read: after the session's
    // own frames, the membership is the only thing written.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      // The desk's answer is what makes this a session a membership may be written on.
      await until(() => statuses.length === 1)
      const opened = underTest.received.length

      expect(session.sendMembership({ channel: 1, dca: 1, placed: true, rides: true })).toBe(2)
      await until(() => underTest.received.length >= opened + 16)

      // Input 1 on fader 1, placed as the capture places it, and the channel's own flag after
      // it: `00 00` is the channel that rides a DCA.
      expect(hex(underTest.received.slice(opened))).toBe(PLACED + FLAG_RIDES)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears a pair with the same frame, and the flag that says it rides none', async () => {
    const underTest = await desk()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      await until(() => statuses.length === 1)
      const opened = underTest.received.length

      expect(session.sendMembership({ channel: 2, dca: 1, placed: false, rides: false })).toBe(2)
      await until(() => underTest.received.length >= opened + 16)

      // Input 2 off fader 1 — the frame the capture writes `00 00` — and the flag `00 01 00`,
      // which is the channel the capture's pairing leaves riding none.
      expect(hex(underTest.received.slice(opened))).toBe(CLEARED + FLAG_NONE)
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes nothing, and answers 0, until the desk has spoken — and writes once it has', async () => {
    // §6's other state: the desk took the connection and says nothing. It is not a session to
    // write into — the bytes would be accepted and do nothing — so the recall is told nothing
    // went, while the panel is not told of a session either.
    const underTest = await desk({ answers: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      await until(() => underTest.received.length >= SESSION_BYTES)
      const written = underTest.received.length

      expect(session.sendMembership({ channel: 1, dca: 1, placed: true, rides: true })).toBe(0)
      await turns()
      expect(underTest.received, 'bytes written to a desk that has not answered').toHaveLength(written)
      expect(statuses).toEqual([])

      // The desk's own push is what makes the session one, and the same call then goes out:
      // what decided it is the desk having spoken, not the socket being connected.
      underTest.push('7f080e00000018180c0100000047726f75700000')
      await until(() => statuses.length === 1)
      expect(session.sendMembership({ channel: 1, dca: 1, placed: true, rides: true })).toBe(2)
      await until(() => underTest.received.length >= written + 16)
      expect(hex(underTest.received.slice(written))).toBe(PLACED + FLAG_RIDES)
    } finally {
      vi.useRealTimers()
    }
  })

  it('writes nothing, and answers 0, on a session the desk has ended', async () => {
    const underTest = await desk()
    const { engine: session, statuses } = engine()
    session.open(HOST)
    await until(() => statuses.length === 1)

    underTest.drop()
    await until(() => statuses.length === 2)

    const written = underTest.received.length
    expect(session.sendMembership({ channel: 1, dca: 1, placed: true, rides: true })).toBe(0)
    await turns()
    expect(underTest.received).toHaveLength(written)
    // And no session was opened to write it on: a desk that went without its goodbye takes a
    // client again only after it is reset, so a membership has nowhere to arrive.
    expect(underTest.controls).toHaveLength(0)
  })

  it('writes nothing, and answers 0, once the show has let the desk go', async () => {
    const underTest = await desk()
    const { engine: session, statuses } = engine()
    session.open(HOST)
    await until(() => statuses.length === 1)

    session.closeAll()
    const written = underTest.received.length

    expect(session.sendMembership({ channel: 1, dca: 1, placed: true, rides: true })).toBe(0)
    await turns()
    // The show stopped naming the desk: nothing was written on the session that ended and
    // nothing was dialled for a membership nobody has a desk to send it to.
    expect(underTest.received).toHaveLength(written)
    expect(underTest.controls).toHaveLength(1)
  })
})

describe('the cadences', () => {
  it('keeps the session alive at 1 s and 3 s, with every timer unref’d', async () => {
    const underTest = await desk()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const timers = recordTimers()
    try {
      const { engine: session } = engine()
      session.open(HOST)
      await until(() => underTest.received.length >= SESSION_BYTES)

      // The two measured cadences, as the literals §6 records: the keepalive datagram every
      // second, the socket ping every three.
      expect(timers.armed.filter(timer => timer.ms === 1000)).toHaveLength(1)
      expect(timers.armed.filter(timer => timer.ms === 3000).length).toBeGreaterThanOrEqual(1)
      for (const timer of timers.armed) {
        expect(timer.handle.hasRef(), 'a cadence that would hold the app open on quit').toBe(false)
      }

      await vi.advanceTimersByTimeAsync(1000)
      await until(() => underTest.datagrams.length > 0)
      expect(hex(underTest.datagrams[0])).toBe('f705000000000000')
      const first = underTest.datagrams.length

      await vi.advanceTimersByTimeAsync(1000)
      await until(() => underTest.datagrams.length > first)

      // And the ping, on the socket, at three: the measured form the session opened with.
      const written = underTest.received.length
      await vi.advanceTimersByTimeAsync(1000)
      await until(() => underTest.received.length > written)
      expect(hex(underTest.received.slice(written))).toBe('7f000200000066ae')
    } finally {
      timers.restore()
    }
  })

  it('is lost with the reset cause the deadline names when two periods pass in silence', async () => {
    // The desk that accepted the connection and says nothing at all: the state §6 measured,
    // and the one an operator has to be told about rather than left reading "online".
    const underTest = await desk({ answers: false })
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      await until(() => underTest.received.length >= SESSION_BYTES)

      await vi.advanceTimersByTimeAsync(3000)
      await until(() => underTest.received.length >= SESSION_BYTES + 8)
      // One period of silence is a ping in flight, not a session that has gone — and the
      // desk has not been reported as one anything could be sent to either.
      expect(statuses).toEqual([])

      await vi.advanceTimersByTimeAsync(3000)
      await until(() => statuses.length === 1)
      expect(statuses[0]).toEqual({
        online: false,
        detail: 'the pings went unanswered',
        cause: 'lost'
      })

      // Both cadences stop with the session, and a desk left mute is not dialled again: it
      // takes a client only after it is reset, so a retry would be noise about a state the
      // alarm has already named.
      const datagrams = underTest.datagrams.length
      const written = underTest.received.length
      await vi.advanceTimersByTimeAsync(30_000)
      expect(underTest.datagrams).toHaveLength(datagrams)
      expect(underTest.received).toHaveLength(written)
      expect(underTest.controls).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a session that ends', () => {
  it('ends a session whose frames could not be written rather than opening it', async () => {
    // The connection came up and went while the session was being written: there is no
    // session to report, and the panel is not told the desk is one it can talk to.
    const { engine: session, statuses } = engine(() => {
      const socket = brokenSocket()
      queueMicrotask(() => socket.emit('connect'))
      return socket
    })

    session.open(HOST)

    await until(() => statuses.length === 1)
    expect(statuses[0]).toEqual({
      online: false,
      detail: 'the connection went while the session was being written',
      cause: 'unreachable'
    })
  })

  it('reports a connection the desk ended as lost, once, and does not dial a mute desk again', async () => {
    const underTest = await desk()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    try {
      const { engine: session, statuses } = engine()
      session.open(HOST)
      // The desk's answer is what makes the session one the panel knows about; only then is
      // a drop a *lost* session rather than a desk that never spoke.
      await until(() => statuses.length === 1)

      underTest.drop()
      await until(() => statuses.length >= 2)
      expect(statuses).toEqual([
        { online: true, detail: `session open with ${HOST}:${NATIVE_TCP_PORT}` },
        { online: false, detail: 'read ECONNRESET', cause: 'lost' }
      ])

      // A desk whose session went without its goodbye takes a client again only after it is
      // reset, so a redial would be a loop of sessions that answer nothing.
      await vi.advanceTimersByTimeAsync(3 * RETRY_MS)
      expect(underTest.controls).toHaveLength(0)
      expect(statuses).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a dial that reaches nothing', () => {
  it('reports the address once and tries it again', async () => {
    // Nothing is listening on the native port: this case owns no desk.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    let dials = 0
    try {
      const { engine: session, statuses } = engine((host, port) => {
        dials += 1
        return createConnection({ host, port })
      })
      session.open(HOST)

      await until(() => statuses.length === 1)
      expect(statuses[0].online).toBe(false)
      expect(statuses[0].cause).toBe('unreachable')
      expect(statuses[0].detail).toContain('ECONNREFUSED')

      // The desk may simply not be up yet: the dial is tried again, and the operator is not
      // told the same thing on every attempt.
      await vi.advanceTimersByTimeAsync(RETRY_MS * 2)
      expect(dials).toBeGreaterThan(1)
      expect(statuses).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives one attempt a deadline, and dials again after it', async () => {
    // A connect the kernel never answers — a desk gone away mid-handshake, a network that
    // dropped the SYN — hangs for a minute and a half without one, and until then there is
    // no session to lose and no retry armed.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    let dials = 0
    const attempts: Array<EventEmitter & Socket> = []
    try {
      const { engine: session, statuses } = engine(() => {
        dials += 1
        // A connection that is open at the socket layer and never reaches `connect`: the
        // deadline is the only thing that can end the attempt.
        const socket = silentSocket()
        attempts.push(socket)
        return socket
      })
      session.open(HOST)

      // Nothing is reported while the attempt is in flight: an attempt is not a refusal.
      await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS - 100)
      expect(statuses).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(200)
      expect(statuses).toHaveLength(1)
      expect(statuses[0].online).toBe(false)
      expect(statuses[0].cause).toBe('unreachable')
      expect(statuses[0].detail).toContain('did not answer within 500 ms')

      // The attempt was let go of, and the desk is tried again rather than left wedged.
      expect(attempts[0].destroyed).toBe(true)
      await vi.advanceTimersByTimeAsync(RETRY_MS)
      expect(dials).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not leave a connector that throws with a dial in flight', async () => {
    // The connector is a seam a test drives and the platform owns in production: a factory
    // that throws before it returns a socket is an attempt that never started, and the flag
    // it would have set is what `open()` reads as a dial already running — with nothing
    // left to clear it, that desk is never dialled again.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    let dials = 0
    try {
      const { engine: session, statuses } = engine((host, port) => {
        dials += 1
        if (dials === 1) throw new Error('getaddrinfo ENOTFOUND the-desk')
        return createConnection({ host, port })
      })
      session.open(HOST)

      await until(() => statuses.length === 1)
      expect(statuses[0].online).toBe(false)
      expect(statuses[0].cause).toBe('unreachable')
      expect(statuses[0].detail).toBe('getaddrinfo ENOTFOUND the-desk')

      // The next attempt is a real dial: the wedge would keep this at one.
      await vi.advanceTimersByTimeAsync(RETRY_MS)
      expect(dials).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('the faults', () => {
  it('logs a goodbye that cannot go out, releases the socket anyway, and survives a late cadence', async () => {
    const underTest = await desk()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
    const timers = recordTimers()
    try {
      // The desk's own door, opened and already gone: a channel a goodbye cannot be written
      // to. The dial is the engine's one seam, and this is the state a channel that the
      // desk closed under a session is in — which a case cannot drive on a real socket
      // without guessing how long the reset takes to arrive.
      const { engine: session, statuses } = engine((host, port) =>
        port === NATIVE_LEAVE_PORT ? (releasedSocket() as unknown as Socket) : createConnection({ host, port })
      )
      session.open(HOST)
      await until(() => statuses.length === 1)

      session.closeAll()

      const log = drainMainErrors().join('\n')
      expect(log).toContain('was not told goodbye')
      expect(log).toContain(HOST)

      // The session is released either way: the connection the frames arrived on is gone,
      // by the desk's own reading of it. That connection is the newest one it accepted —
      // the engine holds one at a time — so the wait asks about the session's own, not
      // about a count a retried dial would be free to move.
      const connection = underTest.controls.at(-1)
      if (connection === undefined) throw new Error('the desk never accepted the session’s connection')
      await until(
        () => connection.destroyed,
        undefined,
        () =>
          `the desk still holds the session’s connection (${underTest.controls.length} accepted, ` +
          `${underTest.received.length} bytes read, statuses ${JSON.stringify(statuses)})`
      )

      // And it stayed the only one: this release left nothing wanting, so no retry has dialled.
      expect(underTest.controls, 'the desk took a second connection after the session was released').toHaveLength(1)

      // A cadence that fires after the session was released: a write on a socket that is
      // gone is swallowed, not a throw out of a timer into the main process.
      const written = underTest.received.length
      const datagrams = underTest.datagrams.length
      for (const timer of timers.armed) {
        expect(() => timer.fire()).not.toThrow()
      }

      expect(underTest.received).toHaveLength(written)
      expect(underTest.datagrams).toHaveLength(datagrams)
    } finally {
      timers.restore()
    }
  })
})

/**
 * The desk's own door as a socket the desk has already let go of: not writable, destroyed,
 * and answering the four things the engine does with it — the cast is the price of standing
 * in for a socket with only the surface this engine uses, the way `MidiTcpEngine.test.ts`
 * stands in for a dial.
 */
function releasedSocket(): Socket {
  const socket = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    writable: boolean
    unref: () => void
    end: () => void
    destroy: () => void
  }
  socket.destroyed = true
  socket.writable = false
  socket.unref = () => {}
  socket.end = () => {}
  socket.destroy = () => {}
  return socket as unknown as Socket
}

/** A connection that came up and is already gone: a write to it throws, as the machine's does. */
function brokenSocket(): EventEmitter & Socket {
  const socket = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    writable: boolean
    unref: () => void
    end: () => void
    destroy: () => void
    write: () => void
  }
  socket.destroyed = false
  socket.writable = true
  socket.unref = () => {}
  socket.end = () => {}
  socket.destroy = () => {}
  socket.write = () => {
    throw new Error('write EPIPE')
  }
  return socket as unknown as EventEmitter & Socket
}

/**
 * A connection that never reaches `connect`: what a desk which has gone away mid-handshake
 * or a network that dropped the SYN looks like from here, where only the deadline can end
 * the attempt. It records its own destruction, so a case can say the attempt was let go of.
 */
function silentSocket(): EventEmitter & Socket & { destroyed: boolean } {
  const socket = new EventEmitter() as EventEmitter & {
    destroyed: boolean
    writable: boolean
    unref: () => void
    end: () => void
    destroy: () => void
    write: () => boolean
  }
  socket.destroyed = false
  socket.writable = true
  socket.unref = () => {}
  socket.end = () => {}
  socket.destroy = () => {
    socket.destroyed = true
  }
  socket.write = () => true
  return socket as unknown as EventEmitter & Socket & { destroyed: boolean }
}
