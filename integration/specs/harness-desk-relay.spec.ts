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
 */
import { expect, test } from '@playwright/test'
import { createConnection, createServer } from 'node:net'
import type { AddressInfo, Socket } from 'node:net'
import { startDeskPeer } from '../peers/desk.ts'
import type { DeskPeer, DeskPeerOptions } from '../peers/desk.ts'
import { startDeskRelay } from '../deskRelay.ts'
import type { DeskRelay } from '../deskRelay.ts'

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
 * Connects to `port` and hands back the client whatever the connection did: a refused or reset
 * connection is a result a test asserts on, not an exception for it to catch.
 */
async function attach(port: number): Promise<RelayClient> {
  const socket = createConnection({ host: '127.0.0.1', port })
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
