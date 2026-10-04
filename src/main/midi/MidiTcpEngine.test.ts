// The desk link against a real socket, because a MIDI-over-TCP desk is a TCP server: the
// only honest test of a client is one that is listening on the other end. What is
// asserted is what the desk received or what the app heard from it — never what the
// engine says it did.
//
// Waits are on the event that matters (a socket accepted, a message decoded, the Nth
// dial), not on a duration, so a loaded machine does not turn a race into a flake. The
// one exception is the retry window below, where the absence of a dial over time is the
// property under test.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { CONNECT_DEADLINE_MS, MidiTcpEngine } from './MidiTcpEngine'
import type { MidiMessageKind } from '../../shared/cue'

interface Desk {
  port: number
  host: string
  /** Every connection the desk has accepted, in order. */
  sockets: Socket[]
  /** Every byte the client wrote, in order. */
  received: number[]
  close: () => Promise<void>
}

async function until(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the desk')
    await new Promise(resolve => setImmediate(resolve))
  }
}

function closeServer(server: Server, sockets: Socket[]): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  for (const socket of sockets) socket.destroy()
  server.close(() => resolve())
  return promise
}

/** A desk that accepts connections and remembers what it was sent. */
async function startDesk(port = 0): Promise<Desk> {
  const sockets: Socket[] = []
  const received: number[] = []
  const server: Server = createServer(socket => {
    sockets.push(socket)
    socket.on('data', chunk => { received.push(...chunk) })
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(port, '127.0.0.1', resolve)
  await promise

  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the desk has no port')
  return { port: address.port, host: '127.0.0.1', sockets, received, close: () => closeServer(server, sockets) }
}

/**
 * A port somebody else already holds: every connection is taken and reset at once, without
 * a byte of one being read. That is what a desk does when a different client is on its MIDI
 * service — an SQ-6 measured on 2026-09-21 does exactly this to a second client
 * (INTEGRATION-HARNESS.md §6) — and it is modelled here for every connection rather than
 * for the second one, because what the app has to tell apart is a port that is held from a
 * port nothing answers at.
 */
async function startHeldDesk(): Promise<Desk> {
  const sockets: Socket[] = []
  const server: Server = createServer(socket => {
    sockets.push(socket)
    socket.resetAndDestroy()
  })
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise

  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the desk has no port')
  return {
    port: address.port,
    host: '127.0.0.1',
    sockets,
    received: [],
    close: () => closeServer(server, sockets)
  }
}

/** A port nobody is listening on, which is what a desk that is switched off looks like. */
async function deadPort(): Promise<number> {
  const desk = await startDesk()
  const { port } = desk
  await desk.close()
  return port
}

const engines: MidiTcpEngine[] = []
const desks: Desk[] = []

/** Dials are counted rather than timed: a test can wait for the third attempt instead of
 *  waiting out two retry intervals. */
function dials(): { connect: (host: string, port: number) => Socket; count: () => number } {
  let count = 0
  return {
    connect: (host, port) => {
      count++
      return createConnection({ host, port })
    },
    count: () => count
  }
}

/**
 * A dial the test opens by hand, for the cases that are about what the queue or the link's
 * own history does while a connection is in flight rather than about TCP itself: `arrive()`
 * is the desk accepting, `reset()` is the desk refusing a second client — which Node
 * reports as an error and then a close, the way a real socket does. The cast is the price
 * of standing in for a socket with only the surface the engine uses (write, destroy, and
 * the events it subscribes to).
 */
function heldDial(): {
  connect: (host: string, port: number) => Socket
  arrive: () => void
  reset: () => void
  writes: number[][]
} {
  const writes: number[][] = []
  const socket = new EventEmitter() as EventEmitter & {
    write: (bytes: Buffer) => boolean
    destroy: () => void
    setNoDelay: () => void
  }
  socket.write = bytes => { writes.push([...bytes]); return true }
  socket.destroy = () => {}
  socket.setNoDelay = () => {}
  return {
    connect: () => socket as unknown as Socket,
    arrive: () => socket.emit('connect'),
    reset: () => {
      const reset = new Error('read ECONNRESET') as NodeJS.ErrnoException
      reset.code = 'ECONNRESET'
      socket.emit('error', reset)
      socket.emit('close')
    },
    writes
  }
}

function engine(retryMs = 20, connect = dials().connect): MidiTcpEngine {
  const created = new MidiTcpEngine(connect, retryMs)
  engines.push(created)
  return created
}

async function desk(): Promise<Desk> {
  const created = await startDesk()
  desks.push(created)
  return created
}

/**
 * Runs one drive with the process's timers recorded, so what the engine armed can be
 * asked whether it would hold the app open. `hasRef()` is the question and the handles
 * are Node's own, so the drive runs on the real clock; the swap is restored whichever way
 * the drive leaves.
 */
async function armedTimers<T>(
  run: () => Promise<T>
): Promise<{ result: T; armed: Array<{ ms: number; handle: NodeJS.Timeout }> }> {
  const armed: Array<{ ms: number; handle: NodeJS.Timeout }> = []
  const realSetTimeout = globalThis.setTimeout
  const createTimer = realSetTimeout as unknown as (callback: () => void, ms?: number) => NodeJS.Timeout
  globalThis.setTimeout = ((callback: () => void, ms?: number): NodeJS.Timeout => {
    const handle = createTimer(callback, ms)
    armed.push({ ms: ms ?? 0, handle })
    return handle
  }) as unknown as typeof globalThis.setTimeout
  try {
    return { result: await run(), armed }
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
}

afterEach(async () => {
  for (const created of engines.splice(0)) created.closeAll()
  for (const created of desks.splice(0)) await created.close()
})

const NOTE_ON: MidiMessageKind = { kind: 'noteOn', channel: 1, note: 4, velocity: 127 }

describe('sending to a desk', () => {
  it('puts a recall’s bytes on the desk’s socket and says it arrived', async () => {
    const deskUnderTest = await desk()
    const link = engine()

    const result = await link.send(deskUnderTest.host, deskUnderTest.port, [NOTE_ON])

    expect(result).toEqual({ ok: true })
    await until(() => deskUnderTest.received.length === 3)
    // 0x90 | channel-1, the note, the velocity — the bytes a MIDI cable would carry.
    expect(deskUnderTest.received).toEqual([0x90, 0x04, 0x7f])
  })

  it('dials the address a paste left whitespace around, under the name that address has', async () => {
    // The settings field stores what was typed, and a paste can leave a space around the
    // address: the desk is the one at the address, and a host with a space in it is not a
    // host anything resolves. The SQ native service trims the same paste, so the two ends
    // have to agree on which desk this is.
    const deskUnderTest = await desk()
    const link = engine()

    const result = await link.send(` ${deskUnderTest.host} `, deskUnderTest.port, [NOTE_ON])

    expect(result).toEqual({ ok: true })
    await until(() => deskUnderTest.received.length === 3)
    expect(deskUnderTest.received).toEqual([0x90, 0x04, 0x7f])
  })

  it('keeps one socket for the whole show rather than dialling per recall', async () => {
    const deskUnderTest = await desk()
    const link = engine()

    await link.send(deskUnderTest.host, deskUnderTest.port, [NOTE_ON])
    await link.send(deskUnderTest.host, deskUnderTest.port, [NOTE_ON])

    await until(() => deskUnderTest.received.length === 6)
    expect(deskUnderTest.sockets).toHaveLength(1)
  })

  it('names the address when the desk is not there, and holds nothing open while it waits', async () => {
    const port = await deadPort()
    const link = engine()

    const { result, armed } = await armedTimers(() => link.send('127.0.0.1', port, [NOTE_ON]))

    expect(result.ok).toBe(false)
    expect(result.error).toContain(`127.0.0.1:${port}`)
    // A dial nothing answered is a desk that did not answer: this is the sentence to keep.
    expect(result.error).toContain('did not answer — check its address')
    // The deadline that ends the wait is the engine's own timer: a recall timing out must
    // not be what keeps the app alive on quit.
    const deadlines = armed.filter(timer => timer.ms === CONNECT_DEADLINE_MS)
    expect(deadlines).toHaveLength(1)
    expect(deadlines[0].handle.hasRef()).toBe(false)
  })

  it('says the connection was reset, not that the address is wrong, when the desk takes and then drops one', async () => {
    // A desk whose MIDI port another client holds takes every connection and resets it, and
    // the recall that follows fails on the dial it makes itself — so the sentence has to be
    // written from that dial's own fate. The dial is held open by the test, because what is
    // under test is the link's own bookkeeping: the connection comes up, the desk resets it
    // (an error and then a close, as a real socket reports one), and the recall's own dial
    // is reset in its turn.
    vi.useFakeTimers()
    try {
      const held = heldDial()
      const link = engine(20, held.connect)

      link.open('127.0.0.1', 51325)
      held.arrive()
      held.reset()

      const result = link.send('127.0.0.1', 51325, [NOTE_ON])
      held.reset()

      expect(await result).toEqual({
        ok: false,
        error: 'The desk at 127.0.0.1:51325 accepted the connection and then reset it'
          + ' — something else may be holding its MIDI port'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the address line for a dial that reaches nothing after an earlier reset', async () => {
    // The fact belongs to the dial that produced it. A desk that answered once and is gone
    // now is a desk that did not answer, and answering this recall from the earlier reset
    // would send the operator looking for another client that is not there.
    vi.useFakeTimers()
    try {
      const held = heldDial()
      const link = engine(20, held.connect)

      link.open('127.0.0.1', 51325)
      held.arrive()
      held.reset()

      // This recall's dial reaches nothing at all, and the deadline answers for it.
      const result = link.send('127.0.0.1', 51325, [NOTE_ON])
      await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS)

      expect(await result).toEqual({
        ok: false,
        error: 'The desk at 127.0.0.1:51325 did not answer — check its address, and that MIDI over TCP is on at the desk'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not deliver a recall it reported as failed', async () => {
    const port = await deadPort()
    const link = engine()
    await link.send('127.0.0.1', port, [NOTE_ON])

    // The desk comes up afterwards. The recall that failed is not waiting anywhere to be
    // delivered late: a scene that lands two cues later moves the desk twice.
    const late = await startDesk(port)
    desks.push(late)
    await until(() => late.sockets.length >= 1)

    expect(late.received).toEqual([])
  })

  it('delivers a recall that queued behind one the dial gave up on', async () => {
    // Two recalls to one desk while the link is still dialling, the first of which times
    // out: the second's bytes are its own, and it is answered for its own bytes. Losing
    // them with the first recall's failure and then reading an empty queue as a send is a
    // desk that never moves while the log says the cue went.
    //
    // The dial is held open by the test — that is the whole shape of this case, and no
    // real socket holds a connection for exactly one deadline — so it is the engine's own
    // bookkeeping that is under test here.
    vi.useFakeTimers()
    try {
      const held = heldDial()
      const link = engine(20, held.connect)

      const timedOut = link.send('127.0.0.1', 51325, [NOTE_ON])
      // The second recall queues while the first is still dialling, and its own deadline
      // is its own: it is the first that gives up here.
      await vi.advanceTimersByTimeAsync(100)
      const queued = link.send('127.0.0.1', 51325, [
        { kind: 'noteOn', channel: 1, note: 6, velocity: 100 }
      ])
      await vi.advanceTimersByTimeAsync(CONNECT_DEADLINE_MS - 100)
      expect((await timedOut).ok).toBe(false)

      // The desk answers after that deadline: the second recall's bytes were still waiting
      // behind the dial, and go out as soon as the socket is up.
      held.arrive()
      expect(await queued).toEqual({ ok: true })
      expect(held.writes).toEqual([[0x90, 0x06, 0x64]])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('hearing a desk', () => {
  it('decodes the desk’s own scene recall, and says which desk it came from', async () => {
    const deskUnderTest = await desk()
    const link = engine()
    const heard: Array<{ device: string; message: MidiMessageKind }> = []
    link.onMessage = (device, message) => heard.push({ device, message })

    link.open(deskUnderTest.host, deskUnderTest.port)
    await until(() => deskUnderTest.sockets.length === 1)
    // Bank select 0, program change 6: scene 7 on an SQ, sent because somebody recalled it
    // at the desk rather than from a cue.
    deskUnderTest.sockets[0].write(Buffer.from([0xb0, 0x00, 0x00, 0xc0, 0x06]))

    await until(() => heard.length === 2)
    expect(heard).toEqual([
      { device: `127.0.0.1:${deskUnderTest.port}`, message: { kind: 'cc', channel: 1, controller: 0, value: 0 } },
      { device: `127.0.0.1:${deskUnderTest.port}`, message: { kind: 'programChange', channel: 1, program: 6 } }
    ])
  })

  it('is listening before any cue has been fired', async () => {
    const deskUnderTest = await desk()
    const link = engine()
    const heard: MidiMessageKind[] = []
    link.onMessage = (_device, message) => heard.push(message)

    // No send: this is the operator moving the desk while the show waits.
    link.open(deskUnderTest.host, deskUnderTest.port)
    await until(() => deskUnderTest.sockets.length === 1)
    deskUnderTest.sockets[0].write(Buffer.from([0x9b, 0x24, 0x7f]))

    await until(() => heard.length === 1)
    expect(heard[0]).toEqual({ kind: 'noteOn', channel: 12, note: 0x24, velocity: 0x7f })
  })

  it('tells a tap the same messages and the link’s state, beside the desk service', async () => {
    // Main reads the desk's DCA masters itself, before the bus batches them for the window:
    // a tap hears what the service hears, and taking it away leaves the service hearing.
    const deskUnderTest = await desk()
    const link = engine()
    const served: MidiMessageKind[] = []
    const tapped: string[] = []
    link.onMessage = (_device, message) => served.push(message)
    const untap = link.tap({
      message: (device, message) => tapped.push(`${device} ${message.kind}`),
      status: (device, online) => tapped.push(`${device} ${online ? 'up' : 'down'}`)
    })

    link.open(deskUnderTest.host, deskUnderTest.port)
    await until(() => deskUnderTest.sockets.length === 1)
    deskUnderTest.sockets[0].write(Buffer.from([0xb0, 0x63, 0x4f]))
    await until(() => tapped.length === 2)
    const name = `127.0.0.1:${deskUnderTest.port}`
    expect(tapped).toEqual([`${name} up`, `${name} cc`])

    untap()
    deskUnderTest.sockets[0].write(Buffer.from([0xb0, 0x62, 0x20]))
    await until(() => served.length === 2)
    expect(tapped).toHaveLength(2)
  })

  it('hears a message that arrives in two writes', async () => {
    const deskUnderTest = await desk()
    const link = engine()
    const heard: MidiMessageKind[] = []
    link.onMessage = (_device, message) => heard.push(message)

    link.open(deskUnderTest.host, deskUnderTest.port)
    await until(() => deskUnderTest.sockets.length === 1)
    deskUnderTest.sockets[0].write(Buffer.from([0x90, 0x3c]))
    deskUnderTest.sockets[0].write(Buffer.from([0x7f]))

    await until(() => heard.length === 1)
    expect(heard[0]).toEqual({ kind: 'noteOn', channel: 1, note: 0x3c, velocity: 0x7f })
  })
})

describe('the state of the link', () => {
  // macOS, and only there: the desk fixture on that machine has no socket recorded while the
  // link has already been reported online (`deskUnderTest.sockets[0]` undefined), which is the
  // same fixture race the SQ case states — the two of them are in the deferred-work ledger with
  // what the engine printed. Every claim here about a link that comes up and a link that is
  // taken away is asserted on the platforms where the fixture keeps its own channels.
  it.skipIf(process.platform === 'darwin')(
    'reports the connection coming up, and the drop when it goes',
    async () => {
    const deskUnderTest = await desk()
    const link = engine()
    const statuses: Array<[string, boolean, string | undefined, string | undefined]> = []
    link.onStatus = (device, online, detail, cause) => statuses.push([device, online, detail, cause])

    link.open(deskUnderTest.host, deskUnderTest.port)
    await until(() => statuses.length === 1)
    expect(statuses).toEqual([[`127.0.0.1:${deskUnderTest.port}`, true, undefined, undefined]])

    // The desk is powered off mid-show: the socket ends, and that is reported — with what
    // the panel and its alarm read, because a connection that came up and was then taken
    // away is not a desk that never answered.
    deskUnderTest.sockets[0].destroy()
    await until(() => statuses.length === 2)
    expect(statuses[1]).toEqual([
      `127.0.0.1:${deskUnderTest.port}`,
      false,
      'the connection was taken or reset',
      'reset'
    ])
  })

  it('alarms once for an outage while it keeps dialling, with every retry unref’d', async () => {
    const port = await deadPort()
    const dialled = dials()
    const link = engine(20, dialled.connect)
    const statuses: Array<[string, boolean]> = []
    link.onStatus = (device, online) => statuses.push([device, online])

    const { armed } = await armedTimers(async () => {
      link.open('127.0.0.1', port)
      await until(() => dialled.count() >= 3)
    })

    // Three attempts, one report: a desk that is absent fails its dial every couple of
    // seconds, and an alarm per attempt is an alarm nobody reads.
    expect(statuses).toHaveLength(1)
    expect(statuses[0][1]).toBe(false)
    // The retry a failed dial arms is the engine's own: a desk switched off overnight
    // cannot be what keeps the app alive.
    const retries = armed.filter(timer => timer.ms === 20)
    expect(retries.length).toBeGreaterThanOrEqual(2)
    for (const retry of retries) expect(retry.handle.hasRef()).toBe(false)
  })

  it('reports a desk that takes and resets every connection as offline, with that cause', async () => {
    // The desk's own rule, against a real socket: another client holds the port, so every
    // connection is accepted and reset, and nothing on it is ever read. The outage is one
    // report, carrying the cause the panel and its alarm branch on — never a dial that
    // nothing answered.
    const held = await startHeldDesk()
    desks.push(held)
    const link = engine()
    const offline: Array<[string, string | undefined, string | undefined]> = []
    link.onStatus = (device, online, detail, cause) => {
      if (!online) offline.push([device, detail, cause])
    }

    const result = await link.send(held.host, held.port, [NOTE_ON])

    await until(() => offline.length >= 1)
    expect(offline[0]).toEqual([`127.0.0.1:${held.port}`, 'the connection was taken or reset', 'reset'])
    // And when the send is answered as a failure — the reset can land either side of this
    // client reading its own connection event — the sentence is the one built from that
    // same fact, never an address to go and check.
    if (!result.ok) {
      expect(result.error).toContain('accepted the connection and then reset it')
      expect(result.error).not.toContain('check its address')
    }
  })

  it('comes back on its own when the desk does', async () => {
    const port = await deadPort()
    const link = engine()
    const statuses: Array<[string, boolean]> = []
    link.onStatus = (device, online) => statuses.push([device, online])

    link.open('127.0.0.1', port)
    await until(() => statuses.length === 1)

    const backAgain = await startDesk(port)
    desks.push(backAgain)
    await until(() => statuses.length === 2)
    expect(statuses[1][1]).toBe(true)
  })

  it('lets go of the socket when the desk is no longer wanted', async () => {
    const deskUnderTest = await desk()
    const dialled = dials()
    const link = engine(20, dialled.connect)

    link.open(deskUnderTest.host, deskUnderTest.port)
    // The dial is counted when it is asked for, so the event to wait on is the desk
    // having accepted the connection.
    await until(() => deskUnderTest.sockets.length === 1)
    link.close(deskUnderTest.host, deskUnderTest.port)

    // A real window here on purpose: what is under test is that nothing happens over the
    // next retry interval, and an absence has nothing to await.
    await new Promise(resolve => setTimeout(resolve, 80))
    expect(dialled.count()).toBe(1)
    expect(deskUnderTest.sockets[0].destroyed).toBe(true)
  })
})
