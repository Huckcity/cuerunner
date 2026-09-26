/**
 * The relay held to what it claims: it is a relay, not a desk.
 *
 * The desk's MIDI-over-TCP service refuses a second connection (measured on an SQ-6, firmware
 * 1.6.1: `INTEGRATION-HARNESS.md` §6), so the hardware lane's app and the spec's own wire both
 * connect to this relay while the relay holds the desk. Every assertion here is about the two
 * things that makes the lane worth anything: the desk still sees one client and the bytes, and
 * what a client reads is the desk's own stream — the relay answers nothing and invents nothing.
 *
 * The desk side is the desk peer, in one case told to refuse a second client exactly as the
 * measurement says the desk does, so "the relay is what gets two clients past one desk" is a
 * case that would fail without it.
 *
 * The desk's own control service — the session on 51326, the leave channel on 51321 and the
 * keepalive datagrams on 51324, the three ports an SQ's show dials — is carried where the caller
 * asks for it, and the cases at the end of this file hold that carriage to the same discipline:
 * a client's frames reach the desk's own service, the desk's frames reach every client attached,
 * the leave port's `BYE.` arrives on the desk's leave channel, a datagram arrives on the desk's
 * own port with its body unchanged, the record keeps the last bytes of each direction and
 * resyncs, and nothing of any of it happens when the carriage was not asked for. That peer is on
 * a loopback address of its own (see below), and its ports are ephemeral: the desk's own numbers
 * are what a show dials, and nothing here needs to hold them.
 */
import { expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { createConnection, createServer } from 'node:net'
import { createSocket } from 'node:dgram'
import type { RemoteInfo } from 'node:dgram'
import type { AddressInfo, Socket } from 'node:net'
import { startDeskPeer } from '../peers/desk.ts'
import type { DeskPeer, DeskPeerOptions } from '../peers/desk.ts'
import { startSqNativePeer } from '../peers/sqNative.ts'
import type { SqNativePeer } from '../peers/sqNative.ts'
import { startDeskRelay } from '../deskRelay.ts'
import type { DeskRelay } from '../deskRelay.ts'
// The app's own frames and their reader: what a client dialling the carried service writes is
// the codec's bytes, and a ring of them is read back the way the app reads its own wire.
import {
  GOODBYE,
  NATIVE_KEEPALIVE_PORT,
  NATIVE_LEAVE_PORT,
  NATIVE_TCP_PORT,
  assignPair,
  createFrameReader,
  dcaFlag,
  keepAliveFrame,
  sessionFrames
} from '../../src/main/desk/frames'

const DCA_1_GET = [0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x60, 0x7f]
const DCA_1_CLOSED = [0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x00]
const DCA_1_OPEN = [0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x01]
/** Scene 7, channel 1, as "SQ MIDI Protocol" §3.1 writes it: bank 00 then program 06. */
const RECALL_SCENE_7 = [0xb0, 0x00, 0x00, 0xc0, 0x06]

async function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** A socket that records what it received, and how the other end ended it. */
class RelayClient {
  readonly received: number[] = []
  /** The other end reset the connection: the desk's own way of refusing a second client. */
  reset = false
  /** Nothing was listening: a refusal, which is how a relay with no desk behind it answers. */
  refused = false
  readonly closed: Promise<void>

  constructor(private readonly socket: Socket) {
    socket.on('data', (chunk: Buffer) => this.received.push(...chunk))
    const closed = Promise.withResolvers<void>()
    this.closed = closed.promise
    socket.on('close', () => closed.resolve())
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNRESET') this.reset = true
      if (error.code === 'ECONNREFUSED') this.refused = true
      closed.resolve()
    })
  }

  send(bytes: number[]): void {
    this.socket.write(Buffer.from(bytes))
  }

  close(): void {
    this.socket.destroy()
  }
}

/**
 * Connects to `port` on `host` and hands back the client whatever the connection did: a refused or
 * reset connection is a result a test asserts on, not an exception for it to catch. The host is the
 * relay's own by default, and named where a case listens somewhere else.
 */
async function attach(port: number, host = '127.0.0.1'): Promise<RelayClient> {
  const socket = createConnection({ host, port })
  const client = new RelayClient(socket)
  await new Promise<void>((resolve) => {
    socket.once('connect', resolve)
    socket.once('error', resolve)
  })
  return client
}

/** A peer and a relay over it, both closed whatever the test does. */
async function relayed(
  options: DeskPeerOptions,
  run: (peer: DeskPeer, relay: DeskRelay) => Promise<void>
): Promise<void> {
  const peer = await startDeskPeer(options)
  const relay = await startDeskRelay({ desk: { host: '127.0.0.1', port: peer.port } })
  try {
    await run(peer, relay)
  } finally {
    await relay.close()
    await peer.close()
  }
}

test('the desk takes one client, and the relay is what gets two past it', async () => {
  const peer = await startDeskPeer({ singleClient: true })
  try {
    // The desk's own rule first, without the relay: the second client is accepted and reset.
    const first = await attach(peer.port)
    const second = await attach(peer.port)
    await second.closed
    expect(second.reset, 'a second client to the desk is reset, as the measurement says').toBe(true)
    expect(second.received).toEqual([])
    first.close()
    await expect.poll(() => peer.clients, { timeout: 5000 }).toBe(0)

    const relay = await startDeskRelay({ desk: { host: '127.0.0.1', port: peer.port } })
    try {
      const app = await attach(relay.port)
      const spec = await attach(relay.port)
      app.send(RECALL_SCENE_7)
      await expect.poll(() => peer.received.length, { timeout: 5000 }).toBeGreaterThan(0)
      expect(peer.clients, 'the desk sees the relay and nothing else').toBe(1)
      expect(relay.clients, 'both clients are on the relay').toBe(2)
      expect(spec.reset).toBe(false)
      app.close()
      spec.close()
    } finally {
      await relay.close()
    }
  } finally {
    await peer.close()
  }
})

test('what a client sends is what the desk receives', async () => {
  await relayed({}, async (peer, relay) => {
    const client = await attach(relay.port)
    client.send(RECALL_SCENE_7)
    await expect.poll(() => peer.state.scene, { timeout: 5000 }).toBe(7)
    expect(peer.received[0]).toMatchObject({ kind: 'scene', scene: 7 })
    client.close()
  })
})

test('every client hears what the desk sends', async () => {
  await relayed({}, async (peer, relay) => {
    const app = await attach(relay.port)
    const spec = await attach(relay.port)
    // The desk's own surface closes DCA 1: one desk-originated message, two clients attached.
    // Channel 0 is the desk's channel 1 — `setMute` takes the status byte's nibble.
    peer.setMute(0, 0x00, false, 0x02)
    await expect.poll(() => app.received.length, { timeout: 5000 }).toBe(DCA_1_CLOSED.length)
    await expect.poll(() => spec.received.length, { timeout: 5000 }).toBe(DCA_1_CLOSED.length)
    expect(app.received).toEqual(DCA_1_CLOSED)
    expect(spec.received).toEqual(DCA_1_CLOSED)
    app.close()
    spec.close()
  })
})

test('a get is answered with the desk’s own value, to the client that asked', async () => {
  await relayed({ singleClient: true }, async (peer, relay) => {
    const client = await attach(relay.port)

    // The desk's own surface moves DCA 1 first, so the value the get reports is a state the
    // desk holds rather than the one it started in — which is the difference between reading
    // the desk and reading a default.
    peer.setMute(0, 0x00, true, 0x02)
    await expect.poll(() => client.received.length, { timeout: 5000 }).toBe(DCA_1_OPEN.length)
    expect(client.received, 'the desk’s own move reached the client').toEqual(DCA_1_OPEN)

    client.send(DCA_1_GET)
    await expect.poll(() => client.received.length, { timeout: 5000 }).toBe(DCA_1_OPEN.length * 2)
    // The reply is the desk's, in the form the document gives: the select echoed back, then the
    // value it holds. A get is answered rather than recorded by the peer, so the bytes are the
    // evidence — and the relay had to carry the question and the answer, both ways.
    expect(client.received.slice(DCA_1_OPEN.length)).toEqual(DCA_1_OPEN)
    client.close()
  })
})

test('the relay invents nothing of its own', async () => {
  await relayed({}, async (peer, relay) => {
    const first = await attach(relay.port)
    const second = await attach(relay.port)
    await sleep(250)
    expect(first.received, 'a silent desk means silent clients').toEqual([])
    expect(second.received).toEqual([])
    expect(peer.received, 'and nothing was sent to the desk either').toEqual([])
    first.close()
    second.close()
  })
})

test('the desk going away is the relay’s end of it, and takes its clients with it', async () => {
  const peer = await startDeskPeer({})
  const relay = await startDeskRelay({ desk: { host: '127.0.0.1', port: peer.port } })
  const client = await attach(relay.port)
  await peer.close()
  await client.closed
  await expect.poll(() => relay.lost, { timeout: 5000 }).not.toBeNull()
  const later = await attach(relay.port)
  await later.closed
  expect(later.refused, 'a later client is refused rather than served nothing').toBe(true)
  await relay.close()
})

test('a desk that never answers is named with the deadline, not a bare timeout', async () => {
  // 192.0.2.1 is a TEST-NET-1 address (RFC 5737): no desk is there and nothing answers, so the
  // dial is not refused — the SYN goes out and nothing comes back, which is the state this
  // deadline exists for. A loopback port with nothing behind it refuses at once and is answered
  // by the socket's own error instead, whose sentence is a different one; what is asserted here
  // is the deadline's own words, so the case would fail if that path stopped being taken.
  await expect(
    startDeskRelay({ desk: { host: '192.0.2.1', port: 1 }, connectDeadlineMs: 500 })
  ).rejects.toThrow('Nothing answered at 192.0.2.1:1 within 500 ms')
})

test('a listen port somebody else holds is named rather than thrown', async () => {
  // The desk the relay is pointed at is there, so what fails is the relay's own socket: a
  // named port is the CLI's own decision, and a port that is taken is the one failure this
  // path has to have a sentence for rather than an `error` event with nobody on it.
  const peer = await startDeskPeer({})
  const held = createServer()
  try {
    await new Promise<void>((resolve) => held.listen(0, '127.0.0.1', () => resolve()))
    const port = (held.address() as AddressInfo).port
    await expect(startDeskRelay({ desk: { host: '127.0.0.1', port: peer.port }, port }))
      .rejects.toThrow(`cannot listen on 127.0.0.1:${port}`)
  } finally {
    held.close()
    await peer.close()
  }
})

/* -------------------------------------------------------- the carried control service */

/**
 * The desk's own control service, carried where `native` asks for it: the session on 51326, the
 * leave channel on 51321 and the keepalive datagrams on 51324, the three ports the app dials on
 * the show's desk host for an SQ.
 *
 * The peer that stands in for the desk is on a loopback address of its own rather than the
 * relay's, because a carried service's listener and its dial take the same number — the desk's
 * own — and one address cannot hold both ends of that: what a client connects to at
 * 127.0.0.1:<port> would be the desk the relay is trying to reach. So the relay listens where
 * `attach` connects (127.0.0.1) and the desk it dials is on `NATIVE_HOST`, both on ephemeral
 * ports a spec reads back rather than the desk's fixed ones, which nothing here needs to hold.
 */
const NATIVE_HOST = '127.0.0.9'

/** The app's identify: a `7f 01` the capture answers, so the desk's own frame comes back. */
const IDENTIFY = sessionFrames()[1]

/** A peer pair and a relay carrying the native service, all closed whatever the test does. */
async function carried(
  run: (peers: { desk: DeskPeer; native: SqNativePeer }, relay: DeskRelay) => Promise<void>
): Promise<void> {
  const desk = await startDeskPeer({ host: NATIVE_HOST })
  const native = await startSqNativePeer({ host: NATIVE_HOST, port: 0, leavePort: 0, keepalivePort: 0 })
  const relay = await startDeskRelay({
    desk: { host: NATIVE_HOST, port: desk.port },
    native: { tcpPort: native.port, leavePort: native.leavePort, keepalivePort: native.keepalivePort }
  })
  try {
    await run({ desk, native }, relay)
  } finally {
    await relay.close()
    await native.close()
    await desk.close()
  }
}

/** A port nothing holds, taken by binding one and letting it go. */
async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

/**
 * Whether `port` can be taken on the relay's host again — which is what says a start that failed
 * let go of a listener it had already bound.
 */
async function rebinds(port: number): Promise<void> {
  const again = createServer()
  await new Promise<void>((resolve) => again.listen(port, '127.0.0.1', () => resolve()))
  await new Promise<void>((resolve) => again.close(() => resolve()))
}

/**
 * An address of this file's own that nothing listens on: the case about a relay without the
 * carriage needs the desk's three numbers to belong to nobody else, and 127.0.0.1 is where
 * another lane's job — or an app left running — would be the thing that answers.
 */
const QUIET_HOST = '127.0.0.11'

test('what a client sends on the carried service is what the desk’s own service receives', async () => {
  await carried(async ({ native }, relay) => {
    const client = await attach(relay.native!.tcpPort)
    // The app's own session, then a membership: the frames the codec writes, so a carriage that
    // split, reordered or dropped one would show up as the peer's own reading rather than as a
    // test's idea of what the app sends.
    for (const frame of sessionFrames()) client.send(frame)
    client.send(assignPair(1, 1))
    client.send(dcaFlag(1, true))

    await expect.poll(() => native.received.filter(frame => frame.kind === 'pair').length).toBeGreaterThan(0)
    // The whole of what the client wrote, in order: the session's own frames — the `7f` family
    // read as the session and the eight-byte `f7 02 …` between them left raw, because the
    // capture's own reading of it is nothing — and then the membership's pair and flag.
    const session = sessionFrames()
    expect(native.received.map(frame => frame.kind)).toEqual([
      ...session.map(frame => (frame[0] === 0x7f ? 'session' : 'raw')),
      'pair',
      'flag'
    ])
    expect(native.received.find(frame => frame.kind === 'pair'))
      .toMatchObject({ channel: 1, dca: 1, placed: true })
    expect(native.received.find(frame => frame.kind === 'flag'))
      .toMatchObject({ channel: 1, rides: true })
    // And the record the lane reads: the bytes of that session, in arrival order, so what the
    // app wrote on this route is readable without a second client having to be on it.
    const wrote = Buffer.from(relay.native!.toDesk).toString('hex')
    expect(wrote.endsWith(Buffer.from([...assignPair(1, 1), ...dcaFlag(1, true)]).toString('hex'))).toBe(true)
    client.close()
  })
})

test('every client attached to the carried service hears what the desk says', async () => {
  await carried(async ({ native }, relay) => {
    const app = await attach(relay.native!.tcpPort)
    const witness = await attach(relay.native!.tcpPort)
    app.send(IDENTIFY)
    await expect.poll(() => native.sent.length).toBeGreaterThan(0)
    const answer = native.sent[0]
    await expect.poll(() => app.received.length).toBe(answer.length)
    await expect.poll(() => witness.received.length).toBe(answer.length)
    expect(app.received, 'the client that asked reads the desk’s own reply').toEqual(answer)
    expect(witness.received, 'and so does the client that only attached').toEqual(answer)
    // The desk answered one client through one upstream connection: two clients here are not
    // two sessions on the desk, which is what the relay exists to make true.
    expect(native.clients, 'the desk sees the relay and nothing else').toBe(1)
    app.close()
    witness.close()
  })
})

test('the leave port’s goodbye reaches the desk’s own leave channel', async () => {
  await carried(async ({ native }, relay) => {
    const client = await attach(relay.native!.leavePort)
    client.send(GOODBYE)
    await expect.poll(() => native.received.filter(frame => frame.kind === 'goodbye').length).toBe(1)
    expect(native.received.find(frame => frame.kind === 'goodbye')?.bytes).toEqual(GOODBYE)
    client.close()

    // And the relay's own goodbye when it lets the desk go — the relay holds that session, so a
    // relay stopped with the desk still holding it has to leave by the same door: one more `BYE.`
    // on the channel the app's own went through, written before that channel is let go.
    await relay.close()
    await expect.poll(() => native.received.filter(frame => frame.kind === 'goodbye').length).toBe(2)
  })
})

test('a keepalive datagram reaches the desk’s own port, unchanged', async () => {
  const desk = await startDeskPeer({ host: NATIVE_HOST })
  const native = await startSqNativePeer({ host: NATIVE_HOST, port: 0, leavePort: 0, keepalivePort: 0 })
  // The body half carries a desk of its own, so no relay in this case ever re-binds a number the
  // relay before it just released: two listeners seconds apart on the same ephemeral port is a
  // race the retry would hide, and the ports are free either way.
  const bodyDesk = await startDeskPeer({ host: NATIVE_HOST })
  const bodyNative = await startSqNativePeer({ host: NATIVE_HOST, port: 0, leavePort: 0, keepalivePort: 0 })
  const client = createSocket('udp4')
  try {
    // The desk's own keepalive port is the peer's first, because the criterion is the peer's own
    // record: what a peer witnesses is arrival and width — the capture holds no datagram, so
    // `sqNative.ts` reads no body — and the width is what says the relay carried a frame rather
    // than a datagram of its own. Then the body itself, which only a socket of this spec's own can
    // read: the desk's port is a raw socket that time, and what arrives has to be the bytes sent.
    const throughPeer = await startDeskRelay({
      desk: { host: NATIVE_HOST, port: desk.port },
      native: { tcpPort: native.port, leavePort: native.leavePort, keepalivePort: native.keepalivePort }
    })
    try {
      client.send(Buffer.from(keepAliveFrame()), throughPeer.native!.keepalivePort, throughPeer.host)
      await expect.poll(() => native.keepalives.length).toBe(1)
      expect(native.keepalives[0].length, 'the peer’s record holds the frame’s own width')
        .toBe(keepAliveFrame().length)
    } finally {
      await throughPeer.close()
    }

    const atDesk = createSocket('udp4')
    const arrived: Buffer[] = []
    atDesk.on('message', (message: Buffer, from: RemoteInfo) => {
      arrived.push(message)
      // A desk that answers its sender — the one shape the carriage must not carry: the reply comes
      // from the desk's own address and port, so the relay drops it rather than trading datagrams
      // with the desk for as long as both keep answering.
      atDesk.send(message, from.port, from.address)
    })
    try {
      await new Promise<void>((resolve, reject) => {
        atDesk.once('error', reject)
        atDesk.bind(0, NATIVE_HOST, () => resolve())
      })
      const deskPort = (atDesk.address() as AddressInfo).port
      const throughSocket = await startDeskRelay({
        desk: { host: NATIVE_HOST, port: bodyDesk.port },
        native: {
          tcpPort: bodyNative.port,
          leavePort: bodyNative.leavePort,
          keepalivePort: deskPort
        }
      })
      try {
        client.send(Buffer.from(keepAliveFrame()), throughSocket.native!.keepalivePort, throughSocket.host)
        await expect.poll(() => arrived.length).toBe(1)
        expect([...arrived[0]], 'the body the desk’s own port was handed').toEqual(keepAliveFrame())
        // Long enough for a bounce to have landed: the desk's answer would be in `arrived` twice.
        await sleep(250)
        expect(arrived.length, 'the desk’s own answer was not carried back to it').toBe(1)
      } finally {
        await throughSocket.close()
      }
    } finally {
      atDesk.close()
    }
  } finally {
    client.close()
    await native.close()
    await desk.close()
    await bodyNative.close()
    await bodyDesk.close()
  }
})

test('the carried service’s record keeps the last bytes of each direction, and no more', async () => {
  const desk = await startDeskPeer({ host: NATIVE_HOST })
  const native = await startSqNativePeer({ host: NATIVE_HOST, port: 0, leavePort: 0, keepalivePort: 0 })
  const limit = 64
  const relay = await startDeskRelay({
    desk: { host: NATIVE_HOST, port: desk.port },
    native: {
      tcpPort: native.port,
      leavePort: native.leavePort,
      keepalivePort: native.keepalivePort,
      recordBytes: limit
    }
  })
  try {
    const client = await attach(relay.native!.tcpPort)
    const session = sessionFrames()
    for (const frame of session) client.send(frame)
    // More than the record holds in each direction: the session is the 8192-byte layout push
    // and its neighbours, and the peer answers each frame the capture answers.
    await expect.poll(() => relay.native!.fromDesk.length).toBe(limit)
    expect(relay.native!.toDesk.length).toBe(limit)

    // A ring, not a prefix: what is kept is the tail of what went each way, and the bytes the
    // head was cut in the middle of are stepped over by the app's own reader — which recovers
    // the frames that the tail does hold, in order, and nothing invented.
    const sent = Buffer.from(session.flat())
    expect(Buffer.from(relay.native!.toDesk)).toEqual(sent.subarray(sent.length - limit))
    const answers = Buffer.from(native.sent.flat())
    expect(answers.length, 'the desk answered less than the record holds').toBeGreaterThanOrEqual(limit)
    expect(Buffer.from(relay.native!.fromDesk)).toEqual(answers.subarray(answers.length - limit))

    const frames = createFrameReader().push(relay.native!.toDesk)
    expect(frames.length, 'the record does not resync to a whole frame').toBeGreaterThan(0)
    expect(frames.map(frame => Buffer.from(frame).toString('hex')))
      .toEqual(session.slice(session.length - frames.length).map(frame => Buffer.from(frame).toString('hex')))
    client.close()
  } finally {
    await relay.close()
    await native.close()
    await desk.close()
  }
})

test('a relay that was not asked for the carriage leaves the desk’s own ports alone', async () => {
  // A host of its own, so the three numbers this case is about are nobody else's: another job on
  // this machine could otherwise be the thing that answers — or holds — a connect at 127.0.0.1,
  // and this case would be reporting another lane's desk as its own relay's.
  const peer = await startDeskPeer({})
  const relay = await startDeskRelay({ desk: { host: '127.0.0.1', port: peer.port }, host: QUIET_HOST })
  try {
    expect(relay.native).toBeNull()
    // The session and the leave channel refuse a connection, and the keepalive port is free to
    // be taken: a port with no listener of its own has no refusal to give, so the bind is what
    // says nothing is there.
    const control = await attach(NATIVE_TCP_PORT, QUIET_HOST)
    await control.closed
    expect(control.refused, 'a port nothing listens on refuses').toBe(true)
    const leave = await attach(NATIVE_LEAVE_PORT, QUIET_HOST)
    await leave.closed
    expect(leave.refused).toBe(true)

    const datagrams = createSocket('udp4')
    try {
      await new Promise<void>((resolve, reject) => {
        datagrams.once('error', reject)
        datagrams.bind(NATIVE_KEEPALIVE_PORT, QUIET_HOST, () => resolve())
      })
    } finally {
      datagrams.close()
    }
  } finally {
    await relay.close()
    await peer.close()
  }
})

test('a desk that never answers on its own service is named with the deadline', async () => {
  // 192.0.2.1 is TEST-NET-1 (RFC 5737): the desk's own service is dialled first, and the SYN to
  // a filter goes nowhere — which is the state this deadline exists for. The MIDI dial is never
  // made, so the ports this failed start could have opened are the only thing to check after it.
  const port = await freePort()
  await expect(
    startDeskRelay({ desk: { host: '192.0.2.1', port: 1 }, port, native: true, connectDeadlineMs: 500 })
  ).rejects.toThrow('Nothing answered at 192.0.2.1:51326 within 500 ms')

  // Nothing it opened stays listening: its own MIDI port is free again, and so are the desk's
  // own, which the failed start had taken before it dialled anything.
  const again = createServer()
  await new Promise<void>((resolve) => again.listen(port, '127.0.0.1', () => resolve()))
  await new Promise<void>((resolve) => again.close(() => resolve()))
  const control = await attach(NATIVE_TCP_PORT)
  await control.closed
  expect(control.refused).toBe(true)
  const datagrams = createSocket('udp4')
  try {
    await new Promise<void>((resolve, reject) => {
      datagrams.once('error', reject)
      datagrams.bind(NATIVE_KEEPALIVE_PORT, '127.0.0.1', () => resolve())
    })
  } finally {
    datagrams.close()
  }
})

test('a carried listen port somebody else holds is named rather than thrown', async () => {
  // The same sentence the MIDI listener gives, for the port the app dials: a carried number is the
  // desk's own, so a caller that overrides one gets the address named rather than an `error` event
  // with nobody on it — and the port the relay had already taken is free again, which is what a
  // failed start that left a listener behind would break.
  const desk = await startDeskPeer({ host: NATIVE_HOST })
  const native = await startSqNativePeer({ host: NATIVE_HOST, port: 0, leavePort: 0, keepalivePort: 0 })
  const held = createServer()
  const port = await freePort()
  try {
    await new Promise<void>((resolve) => held.listen(native.port, '127.0.0.1', () => resolve()))
    await expect(
      startDeskRelay({
        desk: { host: NATIVE_HOST, port: desk.port },
        port,
        native: { tcpPort: native.port, leavePort: native.leavePort, keepalivePort: native.keepalivePort }
      })
    ).rejects.toThrow(`cannot listen on 127.0.0.1:${native.port}`)
    await rebinds(port)
  } finally {
    held.close()
    await native.close()
    await desk.close()
  }
})

test('a held leave port is named too, and takes the session listener with it', async () => {
  // The other order: the MIDI and the control listeners have both bound, and the *leave* port is
  // the one somebody else holds — so what this measures is that a failure part-way through the
  // carried listeners lets go of the ones before it.
  const desk = await startDeskPeer({ host: NATIVE_HOST })
  const native = await startSqNativePeer({ host: NATIVE_HOST, port: 0, leavePort: 0, keepalivePort: 0 })
  const held = createServer()
  const port = await freePort()
  try {
    await new Promise<void>((resolve) => held.listen(native.leavePort, '127.0.0.1', () => resolve()))
    await expect(
      startDeskRelay({
        desk: { host: NATIVE_HOST, port: desk.port },
        port,
        native: { tcpPort: native.port, leavePort: native.leavePort, keepalivePort: native.keepalivePort }
      })
    ).rejects.toThrow(`cannot listen on 127.0.0.1:${native.leavePort}`)
    await rebinds(port)
  } finally {
    held.close()
    await native.close()
    await desk.close()
  }
})

test('the desk going away on its own service takes its clients with it', async () => {
  await carried(async ({ native }, relay) => {
    const client = await attach(relay.native!.tcpPort)
    await expect.poll(() => native.clients).toBe(1)

    // The desk's own service ends — switched off, unplugged, reset — and the relay says so rather
    // than serving bytes into nothing: its client is destroyed with the connection, and a later
    // one is refused. Same rule as the MIDI service's, and the same `lost`.
    await native.close()
    await client.closed
    await expect.poll(() => relay.lost).not.toBeNull()
    // Whichever of the desk's own services reported first names it: one desk, so its death is one
    // loss — and it is the carried route's, not the MIDI link's, which is still up.
    expect(relay.lost, 'the desk’s own service is the one that went')
      .toMatch(/the desk closed (its control service|the leave channel)/)
    const later = await attach(relay.native!.tcpPort)
    await later.closed
    expect(later.refused, 'a later client is refused rather than served nothing').toBe(true)
  })
})

/**
 * The relay's CLI, spawned as a manual run does — `npm run relay:desk` is the same entry with the
 * same arguments — and read until it has printed the address it listens on.
 */
interface CliRun {
  /** Everything the run has said so far, its stderr included. */
  said: () => string
  stop: () => Promise<void>
}

async function runRelayCli(args: string[]): Promise<CliRun> {
  const child = spawn(
    process.execPath,
    ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'integration/deskRelay.ts', ...args],
    { cwd: process.cwd() }
  )
  let said = ''
  child.stdout.on('data', (chunk: Buffer) => { said += chunk.toString() })
  child.stderr.on('data', (chunk: Buffer) => { said += chunk.toString() })
  const printed = Date.now() + 15_000
  while (!said.includes('listening on') && Date.now() < printed) await sleep(100)

  return {
    said: (): string => said,
    async stop(): Promise<void> {
      const gone = Promise.withResolvers<void>()
      child.once('exit', () => gone.resolve())
      child.kill('SIGTERM')
      // A CLI that will not go is killed rather than left holding the ports the cases after it
      // need: this one's own relay takes the desk's three at the address the app dials.
      const impatient = setTimeout(() => child.kill('SIGKILL'), 5000)
      await gone.promise
      clearTimeout(impatient)
    }
  }
}

test('the CLI carries the desk’s own service when asked, and only then', async () => {
  // `--native` is the manual desk run's only switch, and this is where it is exercised: nothing
  // else in the suite spawns the CLI, so a change that dropped the flag would leave the documented
  // run silently without the membership half and every case here still green.
  const desk = await startDeskPeer({ host: NATIVE_HOST })
  const native = await startSqNativePeer({ host: NATIVE_HOST })
  try {
    const asked = await runRelayCli(['--desk', `${NATIVE_HOST}:${desk.port}`, '--listen', '127.0.0.1:0', '--native'])
    try {
      // The line a developer reads, and the carriage's addresses in it — the relay listens on the
      // desk's own numbers and dials the desk on theirs.
      expect(asked.said()).toMatch(new RegExp(`relay listening on 127\\.0\\.0\\.1:\\d+ -> desk ${NATIVE_HOST}:${desk.port}`))
      expect(asked.said()).toContain(
        `carrying the desk’s own control service: 127.0.0.1:${NATIVE_TCP_PORT} -> ${NATIVE_HOST}:${NATIVE_TCP_PORT}, ` +
          `leave 127.0.0.1:${NATIVE_LEAVE_PORT} -> ${NATIVE_HOST}:${NATIVE_LEAVE_PORT}, ` +
          `keepalive udp 127.0.0.1:${NATIVE_KEEPALIVE_PORT} -> ${NATIVE_HOST}:${NATIVE_KEEPALIVE_PORT}`
      )
      // And the carriage is real, not a line: a frame written where an app dials 51326 reaches the
      // desk's own service, which reads it as the session's identify.
      const client = await attach(NATIVE_TCP_PORT)
      client.send(IDENTIFY)
      await expect.poll(() => native.received.some(frame => frame.kind === 'session')).toBe(true)
      client.close()
    } finally {
      await asked.stop()
    }

    // Without the flag the run is the one the lanes ran before this change: no carriage, and no
    // line claiming one.
    const plain = await runRelayCli(['--desk', `${NATIVE_HOST}:${desk.port}`, '--listen', '127.0.0.1:0'])
    try {
      expect(plain.said()).toContain('relay listening on')
      expect(plain.said()).not.toContain('carrying the desk’s own control service')
    } finally {
      await plain.stop()
    }
  } finally {
    await native.close()
    await desk.close()
  }
})
