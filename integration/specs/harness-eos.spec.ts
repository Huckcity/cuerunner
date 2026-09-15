// Holds the Eos peer to ETC's documentation, with nothing else running.
//
// Every expectation here is what a client sees on a UDP socket — the address it gets
// back, the arguments in order, and for the packets whose bytes the documentation pins
// down, the bytes themselves. The decoder below is written from OSC 1.0 and shares no
// code with the peer, so a mistake in the peer's codec cannot make a test pass.
//
// The source for each shape is ETC's online help for Eos v3.3.x: the OSC Dictionary
// (OSC Inputs and OSC Outputs) and the OSC Get page under Third-Party Integration.

import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createSocket } from 'node:dgram'
import type { Socket } from 'node:dgram'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startEosPeer } from '../peers/eos.ts'
import type { EosPeer, EosPeerOptions, OscArg } from '../peers/eos.ts'

// ── OSC, from the spec's own side of the wire ───────────────────────────────

interface WireMessage {
  address: string
  /** The type-tag string, comma included: it is where an argument's type is visible. */
  tags: string
  args: OscArg[]
  bytes: Buffer
}

/** UTF-8, NUL-terminated, NUL-padded to four bytes. */
function oscString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  const cell = Buffer.alloc((bytes.length + 4) & ~3)
  bytes.copy(cell)
  return cell
}

function encode(address: string, args: OscArg[] = []): Buffer {
  let tags = ','
  for (const arg of args) {
    if (typeof arg === 'string') tags += 's'
    else if (typeof arg === 'number') tags += Number.isInteger(arg) ? 'i' : 'f'
    else tags += arg ? 'T' : 'F'
  }

  const cells = [oscString(address), oscString(tags)]
  for (const arg of args) {
    if (typeof arg === 'string') cells.push(oscString(arg))
    else if (typeof arg === 'number') {
      const cell = Buffer.alloc(4)
      if (Number.isInteger(arg)) cell.writeInt32BE(arg)
      else cell.writeFloatBE(arg)
      cells.push(cell)
    }
  }
  return Buffer.concat(cells)
}

function readString(buffer: Buffer, offset: number): { value: string; next: number } {
  const end = buffer.indexOf(0, offset)
  return { value: buffer.toString('utf8', offset, end), next: (end + 4) & ~3 }
}

function decode(bytes: Buffer): { address: string; tags: string; args: OscArg[] } {
  const address = readString(bytes, 0)
  const tags = readString(bytes, address.next)
  const args: OscArg[] = []
  let offset = tags.next
  for (const tag of tags.value.slice(1)) {
    if (tag === 'i') {
      args.push(bytes.readInt32BE(offset))
      offset += 4
    } else if (tag === 'f') {
      args.push(bytes.readFloatBE(offset))
      offset += 4
    } else if (tag === 's') {
      const value = readString(bytes, offset)
      args.push(value.value)
      offset = value.next
    } else if (tag === 'T') {
      args.push(true)
    } else if (tag === 'F') {
      args.push(false)
    }
  }
  return { address: address.value, tags: tags.value, args }
}

interface Wire {
  /** The port this socket bound, which is where a peer's output must arrive. */
  port: number
  messages: WireMessage[]
  send(address: string, args: OscArg[], port: number): void
  sendBytes(bytes: Buffer, port: number): void
  /**
   * The next message nobody has looked at yet that matches. Test failures carry the
   * addresses that did arrive, because a peer that answers the wrong address is the
   * usual reason a harness spec goes red.
   */
  waitFor(predicate: (message: WireMessage) => boolean, what: string, timeoutMs?: number): Promise<WireMessage>
  waitForAddress(address: string, timeoutMs?: number): Promise<WireMessage>
  /** Let anything in flight land, so an assertion about silence has something to hold. */
  settle(ms?: number): Promise<void>
  close(): Promise<void>
}

/** A second socket, which is how every assertion here sees the peer's wire. */
async function openWire(): Promise<Wire> {
  const socket: Socket = createSocket('udp4')
  const messages: WireMessage[] = []
  const consumed = new Set<number>()
  const waiting = new Set<(message: WireMessage, index: number) => void>()

  socket.on('message', (bytes: Buffer) => {
    const index = messages.length
    messages.push({ ...decode(bytes), bytes })
    for (const waiter of waiting) waiter(messages[index], index)
  })
  socket.on('error', () => {})
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', () => resolve()))
  const bound = socket.address()
  if (typeof bound === 'string') throw new Error('a udp4 socket does not bind to a path')

  function waitFor(predicate: (message: WireMessage) => boolean, what: string, timeoutMs = 3000): Promise<WireMessage> {
    for (let index = 0; index < messages.length; index++) {
      if (consumed.has(index) || !predicate(messages[index])) continue
      consumed.add(index)
      return Promise.resolve(messages[index])
    }
    return new Promise<WireMessage>((resolve, reject) => {
      const expired = setTimeout(() => {
        waiting.delete(waiter)
        reject(new Error(`timed out waiting for ${what}; the peer sent ${JSON.stringify(messages.map((message) => message.address))}`))
      }, timeoutMs)
      const waiter = (message: WireMessage, index: number): void => {
        if (!predicate(message)) return
        clearTimeout(expired)
        waiting.delete(waiter)
        consumed.add(index)
        resolve(message)
      }
      waiting.add(waiter)
    })
  }

  return {
    port: bound.port,
    messages,
    send(address, args, port) {
      // The sender is this socket, so the peer's answer comes back here.
      socket.send(encode(address, args), port, '127.0.0.1', () => {})
    },
    sendBytes(bytes, port) {
      socket.send(bytes, port, '127.0.0.1', () => {})
    },
    waitFor,
    waitForAddress(address, timeoutMs) {
      return waitFor((message) => message.address === address, address, timeoutMs)
    },
    settle(ms = 200) {
      return new Promise<void>((resolve) => setTimeout(resolve, ms))
    },
    close() {
      return new Promise<void>((resolve) => socket.close(() => resolve()))
    }
  }
}

// ── The peer under test ─────────────────────────────────────────────────────

let wire: Wire
let peer: EosPeer
const extra: EosPeer[] = []
const extraWires: Wire[] = []

test.beforeEach(async () => {
  wire = await openWire()
  peer = await startEosPeer()
})

test.afterEach(async () => {
  for (const other of extra.splice(0)) await other.close()
  for (const other of extraWires.splice(0)) await other.close()
  await peer.close()
  await wire.close()
})

/** A peer started with options, closed with the rest when the test ends. */
async function peerWith(options: EosPeerOptions): Promise<EosPeer> {
  const started = await startEosPeer(options)
  extra.push(started)
  return started
}

/** Another socket: somewhere for a peer's output to arrive that is not its caller. */
async function otherWire(): Promise<Wire> {
  const opened = await openWire()
  extraWires.push(opened)
  return opened
}

interface RecordedSession {
  provenance: { kind: unknown; target: unknown; version: unknown; versionSource: unknown; note: unknown }
  exchanges: Array<{ at: unknown; direction: unknown; address: unknown; args: unknown; bytes: unknown }>
}

/**
 * A recording as this spec reads it. A fixture is a file that could have come off another
 * machine, so it is checked field by field — and a spec that blew up on a malformed fixture
 * would say nothing about the peer that wrote it.
 */
function readRecording(path: string): RecordedSession {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof parsed !== 'object' || parsed === null || !('provenance' in parsed) || !('exchanges' in parsed)) {
    throw new Error(`${path} is not a recording`)
  }
  const provenance = parsed.provenance
  if (
    typeof provenance !== 'object' ||
    provenance === null ||
    !('kind' in provenance) ||
    !('target' in provenance) ||
    !('version' in provenance) ||
    !('versionSource' in provenance) ||
    !('note' in provenance)
  ) {
    throw new Error(`${path} has no provenance`)
  }
  if (!Array.isArray(parsed.exchanges)) throw new Error(`${path} lists no exchanges`)

  const exchanges = parsed.exchanges.map((entry: unknown, index: number) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('at' in entry) ||
      !('direction' in entry) ||
      !('address' in entry) ||
      !('args' in entry) ||
      !('bytes' in entry)
    ) {
      throw new Error(`${path}: exchange ${index} is not a recorded message`)
    }
    const { at, direction, address, args, bytes } = entry
    return { at, direction, address, args, bytes }
  })

  return {
    provenance: {
      kind: provenance.kind,
      target: provenance.target,
      version: provenance.version,
      versionSource: provenance.versionSource,
      note: provenance.note
    },
    exchanges
  }
}

/** A path of its own per test, so two runs of the suite cannot read each other's fixtures. */
function recordingPath(name: string): string {
  return join(tmpdir(), `eos-${name}-${randomUUID()}.json`)
}

/**
 * One cue firing, as a console reports it: the event, the active cue's text, and — when
 * a cue follows it — the text for what is now pending. It reads from the wire it is
 * given, because a peer with an OSC TX destination answers somewhere else.
 */
async function expectFire(
  on: Wire,
  list: number,
  cue: number,
  label: string,
  duration: string,
  pending: { cue: number; label: string; duration: string } | null
): Promise<void> {
  expect((await on.waitForAddress(`/eos/out/event/cue/${list}/${cue}/fire`)).args).toEqual([label])
  expect((await on.waitForAddress('/eos/out/active/cue/text')).args).toEqual([`${list}/${cue} ${label} ${duration}`])
  if (pending) {
    expect((await on.waitForAddress('/eos/out/pending/cue/text')).args).toEqual([
      `${list}/${pending.cue} ${pending.label} ${pending.duration}`
    ])
  }
}

// ── What it answers ─────────────────────────────────────────────────────────

test('answers /eos/ping with the same arguments, byte for byte', async () => {
  wire.send('/eos/ping', ['abcde', 4], peer.port)
  const reply = await wire.waitForAddress('/eos/out/ping')

  expect(reply.args).toEqual(['abcde', 4])
  // The dictionary's example is `/eos/out/ping="abcde", 4`. The bytes are the framing
  // rule in full: "/eos/out/ping" padded to 16, the tags ",si" padded to 4, "abcde"
  // padded to 8, and the int32.
  expect(reply.bytes.toString('hex')).toBe('2f656f732f6f75742f70696e670000002c736900616263646500000000000004')
})

test('answers /eos/get/version with both versions and the swatch flag', async () => {
  wire.send('/eos/get/version', [], peer.port)
  const reply = await wire.waitForAddress('/eos/out/get/version')

  expect(reply.tags).toBe(',ssi')
  expect(String(reply.args[0])).toMatch(/^\d+\.\d+\.\d+\.\d+$/) // Eos version
  expect(String(reply.args[1])).toMatch(/^\d+\.\d+\.\d+\.\d+$/) // fixture library version
  expect(reply.args[2]).toBe(0) // 0 = Gel + S4 Lamp swatches
})

test('answers the cue-list count and the cue counts of each list', async () => {
  wire.send('/eos/get/cuelist/count', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/get/cuelist/count')).args).toEqual([2])

  // The dictionary's own example for this packet writes the address with the word
  // "cuelist", against its own `<cue list>/count` pattern; the pattern is what a client
  // can match on, so that is what the peer answers.
  wire.send('/eos/get/cue/1/count', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/get/cue/1/count')).args).toEqual([3])

  wire.send('/eos/get/cue/2/count', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/get/cue/2/count')).args).toEqual([1])
})

test('answers a cue with the documented cue packet', async () => {
  wire.send('/eos/get/cue/1/12', [], peer.port)
  const cue = await wire.waitForAddress('/eos/out/get/cue/1/12/0/list/0/31')

  expect(cue.args).toHaveLength(31)
  // The dictionary's argument order, which the tags spell out: list index, UID, label,
  // the five time/delay pairs, preheat, curve, rate, mark, block, assert, link, follow
  // time, hang time, all fade, loop, solo, timecode, part count, notes, scene, scene
  // end, part index.
  expect(cue.tags).toBe(',issiiiiiiiiiiFiisssiiiFiFsissFi')

  expect(cue.args[0]).toBe(1) // list index
  expect(String(cue.args[1])).toMatch(/^[0-9A-F]{8}(-[0-9A-F]{4}){3}-[0-9A-F]{12}$/) // UID
  expect(cue.args[2]).toBe('Blackout')
  expect(cue.args[3]).toBe(2000) // up time, in the milliseconds the packets use
  expect(cue.args[13]).toBe(false) // preheat
  expect(cue.args[15]).toBe(100) // rate, per cent
  expect(cue.args[26]).toBe(0) // part count, base cue only
  expect(cue.args[30]).toBe(-1) // part index: -1 when this is not a part

  wire.send('/eos/get/cue/1/2', [], peer.port)
  const parted = await wire.waitForAddress('/eos/out/get/cue/1/2/0/list/0/31')
  expect(parted.args[26]).toBe(2)
  expect(parted.args[27]).toBe('wings') // notes
})

test('answers a cue that does not exist with the empty target packet', async () => {
  wire.send('/eos/get/cue/1/999', [], peer.port)
  const empty = await wire.waitForAddress('/eos/out/get/cue/1/999/0')

  expect(empty.tags).toBe(',')
  expect(empty.args).toEqual([])

  // The same packet is what an instruction gets when the cue it names is not there —
  // fire, and the target is refused rather than ignored.
  wire.send('/eos/cue/1/999/fire', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/get/cue/1/999/0')).args).toEqual([])

  await wire.settle()
  expect(wire.messages.filter((message) => message.address.startsWith('/eos/out/event/'))).toHaveLength(0)
})

// ── Firing cues ─────────────────────────────────────────────────────────────

test('fires a cue into the event, active and pending messages', async () => {
  wire.send('/eos/cue/1/1/fire', [], peer.port)
  await expectFire(wire, 1, 1, 'Preshow', '3.0', { cue: 2, label: 'Act One', duration: '5.0' })
})

test('fires a named part, and refuses one the cue does not have', async () => {
  wire.send('/eos/cue/1/2/2/fire', [], peer.port)
  // The event address carries no part: the dictionary's cue event is
  // `/eos/out/event/cue/<cue list>/<cue number>/fire`.
  await expectFire(wire, 1, 2, 'Act One', '5.0', { cue: 12, label: 'Blackout', duration: '2.0' })

  wire.send('/eos/cue/1/2/9/fire', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/get/cue/1/2/9')).args).toEqual([])

  await wire.settle()
  expect(wire.messages.filter((message) => message.address.startsWith('/eos/out/event/'))).toHaveLength(1)
})

test('has nothing pending after the last cue of a list', async () => {
  wire.send('/eos/cue/1/12/fire', [], peer.port)
  await expectFire(wire, 1, 12, 'Blackout', '2.0', null)

  await wire.settle()
  expect(wire.messages.filter((message) => message.address === '/eos/out/pending/cue/text')).toHaveLength(0)
})

test('[Go] fires what is pending', async () => {
  wire.send('/eos/cue/1/1/fire', [], peer.port)
  await expectFire(wire, 1, 1, 'Preshow', '3.0', { cue: 2, label: 'Act One', duration: '5.0' })

  wire.send('/eos/key/go_0', [], peer.port)
  await expectFire(wire, 1, 2, 'Act One', '5.0', { cue: 12, label: 'Blackout', duration: '2.0' })
})

test('takes a command line and answers it on /eos/out/cmd', async () => {
  const controlled = await peerWith({ controlPort: 0 })
  wire.send('/eos/cmd', ['Chan 1 At 50'], controlled.port)
  const echo = await wire.waitForAddress('/eos/out/cmd')

  expect(echo.tags).toBe(',si')
  expect(String(echo.args[0])).toContain('Chan 1 At 50')
  expect(echo.args[1]).toBe(0) // the dictionary's error flag: 0, no error

  // The control endpoint is the peer's own state, which is where an instruction with no
  // answer on the wire can still be checked. JSON off a socket, so it is narrowed rather
  // than asserted: the two fields this test reads are the two it checks for.
  expect(controlled.controlPort).not.toBeNull()
  const body: unknown = await (await fetch(`http://${controlled.host}:${controlled.controlPort}/state`)).json()
  if (typeof body !== 'object' || body === null || !('lastCommand' in body) || !('cues' in body)) {
    throw new Error(`the control endpoint served ${JSON.stringify(body)}`)
  }
  expect(body.lastCommand).toBe('Chan 1 At 50')
  expect(Array.isArray(body.cues)).toBe(true)
  expect(body.cues).toHaveLength(4)
  expect((await fetch(`http://${controlled.host}:${controlled.controlPort}/elsewhere`)).status).toBe(404)
})

// ── Subscriptions ───────────────────────────────────────────────────────────

test('a subscription turns a cue change into a notification', async () => {
  // `/eos/subscribe=1` is the documentation's spelling; the value on the address is its
  // notation, and a client with an OSC library sends the uint32 as an argument instead.
  // Both are the same message to a console.
  wire.send('/eos/subscribe=1', [], peer.port)
  wire.send('/eos/cue/1/1/fire', [], peer.port)
  await expectFire(wire, 1, 1, 'Preshow', '3.0', { cue: 2, label: 'Act One', duration: '5.0' })

  // List convention: argument index 0, and a count of the whole logical list — the
  // sequence number and the cue that changed.
  const first = await wire.waitForAddress('/eos/out/notify/cue/1/list/0/2')
  expect(first.args).toEqual([1, 1])

  wire.send('/eos/subscribe', [0], peer.port)
  wire.send('/eos/cue/1/2/fire', [], peer.port)
  await expectFire(wire, 1, 2, 'Act One', '5.0', { cue: 12, label: 'Blackout', duration: '2.0' })
  await wire.settle()
  expect(wire.messages.filter((message) => message.address.startsWith('/eos/out/notify/'))).toHaveLength(1)

  wire.send('/eos/subscribe=1', [], peer.port)
  wire.send('/eos/cue/1/12/fire', [], peer.port)
  await expectFire(wire, 1, 12, 'Blackout', '2.0', null)
  // The sequence number counts the notifications this list has sent, and only up.
  expect((await wire.waitForAddress('/eos/out/notify/cue/1/list/0/2')).args).toEqual([2, 12])
})

// ── Cue list banks ──────────────────────────────────────────────────────────

test('configures a cue-list bank and pushes its rows', async () => {
  wire.send('/eos/cuelist/1/config/1/1/1', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/cuelist/1')).args).toEqual(['Cue List 1', 3, 0])

  const row = await wire.waitForAddress('/eos/out/cuelist/1/1')
  expect(row.tags).toBe(',sssssFii')
  expect(row.args).toEqual(['1 Preshow', '1', 'Preshow', '', '', false, 3000, -1])
  expect((await wire.waitForAddress('/eos/out/cuelist/1/2')).args).toEqual(['2 Act One', '2', 'Act One', 'wings', '', false, 5000, -1])
  expect((await wire.waitForAddress('/eos/out/cuelist/1/3')).args).toEqual(['12 Blackout', '12', 'Blackout', '', '', false, 2000, -1])
  await wire.settle()
  expect(wire.messages.filter((message) => message.address.startsWith('/eos/out/cuelist/1/'))).toHaveLength(3)

  // The dictionary's optional trailing offset: a 0-based cue to open the window at, each
  // cue counting as one item, which is how a caller pages a bank without playing anything.
  // With no rows either side of it, the window is the one cue at that offset.
  wire.send('/eos/cuelist/2/config/1/0/0/1', [], peer.port)
  expect((await wire.waitForAddress('/eos/out/cuelist/2')).args).toEqual(['Cue List 1', 3, 0])
  expect((await wire.waitForAddress('/eos/out/cuelist/2/1')).args).toEqual(['2 Act One', '2', 'Act One', 'wings', '', false, 5000, -1])
  await wire.settle()
  expect(wire.messages.filter((message) => message.address.startsWith('/eos/out/cuelist/2/'))).toHaveLength(1)
})

// ── The OSC TX destination ──────────────────────────────────────────────────

test('sends unsolicited output to the configured OSC TX destination', async () => {
  const destination = await otherWire()
  const configured = await peerWith({ tx: { host: '127.0.0.1', port: destination.port } })

  // The instruction comes from a client that is not the destination, which is the shape
  // of the app-side round trip: WinsLab sends from an ephemeral socket and listens for
  // OSC on its own input port, so output that went back to the sender would never arrive.
  wire.send('/eos/cue/1/12/fire', [], configured.port)
  await expectFire(destination, 1, 12, 'Blackout', '2.0', null)

  await wire.settle()
  expect(wire.messages).toHaveLength(0)
})

// ── The vendor lane: a console, a recording of it, a replay of that ─────────

test('proxies a console, records both directions, and replays the recording', async () => {
  // The far end's show is nothing like the proxy's own default, so an answer that could
  // only have come from the console is one that did.
  const consolePeer = await peerWith({ cues: [{ list: 3, number: 5, label: 'Vendor Show' }] })
  const listener = await otherWire()
  const file = recordingPath('session')
  const proxy = await peerWith({
    upstream: { host: '127.0.0.1', port: consolePeer.port },
    tx: { host: '127.0.0.1', port: listener.port },
    record: file,
    recordNote: 'the round trip the vendor lane takes'
  })

  // One cue list where the proxy's own model would answer two: the console is speaking.
  wire.send('/eos/get/cuelist/count', [], proxy.port)
  expect((await listener.waitForAddress('/eos/out/get/cuelist/count')).args).toEqual([1])

  wire.send('/eos/cue/3/5/fire', [], proxy.port)
  expect((await listener.waitForAddress('/eos/out/event/cue/3/5/fire')).args).toEqual(['Vendor Show'])
  expect((await listener.waitForAddress('/eos/out/active/cue/text')).args).toEqual(['3/5 Vendor Show 0.0'])
  await listener.settle()

  const recording = readRecording(file)
  expect(recording.provenance).toMatchObject({
    kind: 'eos',
    target: `127.0.0.1:${consolePeer.port}`,
    note: 'the round trip the vendor lane takes',
    versionSource: 'option'
  })
  // Five exchanges: the count and its answer, then the fire and the two the console makes
  // of it — cue 5 is the only cue in that list, so nothing is pending.
  expect(recording.exchanges.map((exchange) => exchange.direction)).toEqual([
    'to-console',
    'from-console',
    'to-console',
    'from-console',
    'from-console'
  ])
  // The datagrams as they were, so a replay does not depend on this peer's encoder.
  expect(recording.exchanges[2]).toMatchObject({ address: '/eos/cue/3/5/fire', args: [] })
  expect(recording.exchanges[2].bytes).toBe(encode('/eos/cue/3/5/fire').toString('hex'))
  expect(recording.exchanges[3]).toMatchObject({ address: '/eos/out/event/cue/3/5/fire', args: ['Vendor Show'] })
  expect(recording.exchanges[3].bytes).toBe(encode('/eos/out/event/cue/3/5/fire', ['Vendor Show']).toString('hex'))

  const timestamps = recording.exchanges.map((exchange) => Number(exchange.at))
  expect(timestamps.every((at) => Number.isFinite(at) && at >= 0)).toBe(true)
  expect(timestamps).toEqual([...timestamps].sort((a, b) => a - b))

  // The replay lane: the same fire, the same answer, with no console in the picture.
  const replayed = await peerWith({ replay: file, tx: { host: '127.0.0.1', port: listener.port } })
  wire.send('/eos/cue/3/5/fire', [], replayed.port)
  const event = await listener.waitForAddress('/eos/out/event/cue/3/5/fire')
  expect(event.args).toEqual(['Vendor Show'])
  expect(event.bytes.toString('hex')).toBe(encode('/eos/out/event/cue/3/5/fire', ['Vendor Show']).toString('hex'))
  expect((await listener.waitForAddress('/eos/out/active/cue/text')).args).toEqual(['3/5 Vendor Show 0.0'])

  // An address the recording has no answer for gets no answer, exactly like the console
  // that was recorded — and the replayed peer does not fall back on its own model.
  const heard = listener.messages.length
  wire.send('/eos/cue/1/1/fire', [], replayed.port)
  await listener.settle()
  expect(listener.messages).toHaveLength(heard)
})

test('routes the console’s output by what it says, not by where it came from', async () => {
  // A real Eos sends its output from an ephemeral port — a probe against v3.3.9.25 was
  // answered from 127.0.0.1:55166, not from 8000 — so the stand-in here answers from a
  // socket that has nothing to do with the one it listens on, which is the shape the
  // vendor lane ran into: the console's own output was forwarded back at the console and
  // the app heard nothing.
  const consoleInput = await otherWire()
  const consoleOutput = await otherWire()
  const listener = await otherWire()
  const file = recordingPath('ephemeral-console')
  const proxy = await peerWith({
    upstream: { host: '127.0.0.1', port: consoleInput.port },
    tx: { host: '127.0.0.1', port: listener.port },
    record: file
  })

  wire.send('/eos/cue/1/12/fire', [], proxy.port)
  expect((await consoleInput.waitForAddress('/eos/cue/1/12/fire')).args).toEqual([])

  consoleOutput.send('/eos/out/event/cue/1/12/fire', ['Blackout'], proxy.port)
  consoleOutput.send('/eos/out/active/cue/text', ['1/12 5.0'], proxy.port)
  expect((await listener.waitForAddress('/eos/out/event/cue/1/12/fire')).args).toEqual(['Blackout'])
  expect((await listener.waitForAddress('/eos/out/active/cue/text')).args).toEqual(['1/12 5.0'])

  // Not one byte of the console's own output goes back at it.
  await consoleInput.settle()
  expect(consoleInput.messages.map((message) => message.address)).toEqual(['/eos/cue/1/12/fire'])

  // In the recording, the instruction is the app's and the rest is the console's.
  const recording = readRecording(file)
  expect(recording.exchanges.map((exchange) => exchange.direction)).toEqual(['to-console', 'from-console', 'from-console'])
  expect(recording.exchanges.map((exchange) => exchange.address)).toEqual([
    '/eos/cue/1/12/fire',
    '/eos/out/event/cue/1/12/fire',
    '/eos/out/active/cue/text'
  ])
})

test('records the console’s own version when it answers one', async () => {
  const consolePeer = await peerWith({ version: '3.3.9.1', fixtureLibraryVersion: '3.3.9.2' })
  const file = recordingPath('version')
  // Started with a version of its own, so the file saying otherwise is the console talking.
  const proxy = await peerWith({
    upstream: { host: '127.0.0.1', port: consolePeer.port },
    record: file,
    version: '0.0.0.0'
  })

  wire.send('/eos/get/version', [], proxy.port)
  expect((await wire.waitForAddress('/eos/out/get/version')).args).toEqual(['3.3.9.1', '3.3.9.2', 0])

  expect(readRecording(file).provenance).toMatchObject({ version: '3.3.9.1', versionSource: 'console' })
})

test('refuses a recording it cannot read, in a sentence', async () => {
  await expect(startEosPeer({ replay: recordingPath('missing') })).rejects.toThrow(/no recording at/)

  const notARecording = recordingPath('not-a-recording')
  writeFileSync(notARecording, '{"hello": true}\n')
  await expect(startEosPeer({ replay: notARecording })).rejects.toThrow(/is not an Eos recording/)
})

// ── The cue send string ─────────────────────────────────────────────────────

test('the cue send string replaces the event message', async () => {
  const formatted = await peerWith({ cues: [{ list: 1, number: 12, label: 'Twelve' }], cueSendString: '/go/%1' })
  wire.send('/eos/cue/1/12/fire', [], formatted.port)

  const sent = await wire.waitForAddress('/go/12')
  expect(sent.tags).toBe(',')
  expect(sent.args).toEqual([])

  // Only the event is replaced: the text messages a console sends alongside it are not.
  expect((await wire.waitForAddress('/eos/out/active/cue/text')).args).toEqual(['1/12 Twelve 0.0'])
  await wire.settle()
  expect(wire.messages.filter((message) => message.address.startsWith('/eos/out/event/'))).toHaveLength(0)
})

test('the cue send string reads the list, the whole and point number, and the label', async () => {
  const formatted = await peerWith({
    cues: [{ list: 2, number: 1.5, label: 'Encore' }],
    cueSendString: '/cue/%2/%3/%4/%5'
  })
  wire.send('/eos/cue/2/1.5/fire', [], formatted.port)

  expect((await wire.waitForAddress('/cue/2/1/5/Encore')).args).toEqual([])
})

// ── Things that must not break it ───────────────────────────────────────────

test('ignores what it does not implement and stays up', async () => {
  wire.send('/eos/does/not/exist', ['who knows'], peer.port)
  wire.send('/eos/get/nonsense/count', [], peer.port)
  wire.sendBytes(Buffer.from([0x01, 0x02, 0x03]), peer.port) // not OSC at all
  wire.sendBytes(Buffer.from('/eos/ping'), peer.port) // an OSC string with no terminator
  wire.sendBytes(Buffer.alloc(0), peer.port) // an empty datagram
  await wire.settle()
  expect(wire.messages).toHaveLength(0)

  wire.send('/eos/ping', ['still here'], peer.port)
  expect((await wire.waitForAddress('/eos/out/ping')).args).toEqual(['still here'])
})
