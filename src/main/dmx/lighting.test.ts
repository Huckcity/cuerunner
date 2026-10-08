// The lighting runtime over real UDP on the loopback: a listener bound to port 0 stands in for
// a node, and what it reads is the packets the engine actually sent — decoded with the same
// readers a receiver would use, never the runtime's own account of itself.
import { afterEach, describe, expect, it } from 'vitest'
import { createSocket, type RemoteInfo, type Socket } from 'node:dgram'
import { DmxLighting } from './lighting'
import { createMachineDmx } from './machine'
import {
  decodeArtDmx,
  decodeSacnData,
  encodeArtPollReply,
  encodeSacnData,
  SACN_OPTION_TERMINATED,
  SACN_SYNC_LENGTH
} from './packets'
import type { DmxConfig, DmxGo } from '../../shared/dmxWire'
import type { UniverseOutput } from '../../shared/dmx'

const CID = '0f0e0d0c-0b0a-0908-0706-050403020100'

interface Listener {
  socket: Socket
  port: number
  packets: Array<{ data: Buffer; from: RemoteInfo }>
}

const open: Array<{ close(): void }> = []

afterEach(() => {
  for (const item of open.splice(0)) {
    try {
      item.close()
    } catch {
      // Already closed.
    }
  }
})

async function listen(): Promise<Listener> {
  const socket = createSocket('udp4')
  const packets: Listener['packets'] = []
  socket.on('message', (data, from) => packets.push({ data, from }))
  await new Promise<void>(resolve => socket.bind(0, '127.0.0.1', () => resolve()))
  open.push(socket)
  return { socket, port: socket.address().port, packets }
}

async function until(condition: () => boolean, ms = 3000): Promise<void> {
  const deadline = Date.now() + ms
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

function output(patch: Partial<UniverseOutput>): UniverseOutput {
  return {
    id: 'out-1',
    universe: 1,
    protocol: 'sacn',
    transport: 'unicast',
    address: '127.0.0.1',
    wireUniverse: 1,
    priority: 100,
    enabled: true,
    ...patch
  }
}

function config(outputs: UniverseOutput[], patch: Partial<DmxConfig> = {}): DmxConfig {
  return { outputs, inputs: [], sync: false, syncUniverse: 63999, panic: 'hold', ...patch }
}

function lighting(now?: () => number, receiver: { sacnPort?: number; artnetPort?: number } = {}): DmxLighting {
  const runtime = new DmxLighting({
    machine: createMachineDmx({ cid: CID }),
    interfaces: () => [],
    now,
    receiver: { sacnPort: receiver.sacnPort ?? 0, artnetPort: receiver.artnetPort ?? 0 }
  })
  open.push({ close: () => runtime.stop() })
  return runtime
}

const REPORT = { state: () => {}, alert: () => {} }

function go(cueId: string, value: number, fadeMs = 0): DmxGo {
  return {
    cueId,
    values: [{ u: 1, s: 0, f: null, i: true, h: 0, v: value }, { u: 1, s: 9, f: 10, i: false, h: 0.5, v: 0.5 }],
    fadeMs,
    curve: 'linear',
    htp: false,
    effects: []
  }
}

describe('the lighting on the wire', () => {
  it('sends a cue’s look as sACN and Art-Net to a listener, and ends the sACN stream when it stops', async () => {
    const sacn = await listen()
    const artnet = await listen()
    const runtime = lighting()
    runtime.configure(config([
      output({ address: `127.0.0.1:${sacn.port}`, wireUniverse: 7 }),
      output({ id: 'out-2', protocol: 'artnet', address: `127.0.0.1:${artnet.port}`, wireUniverse: 0x0102 })
    ]))
    runtime.go(go('cue-1', 1))
    runtime.start(REPORT)

    await until(() => sacn.packets.length > 0 && artnet.packets.length > 0)
    const data = decodeSacnData(sacn.packets[0].data)
    expect(data).not.toBeNull()
    expect(data?.universe).toBe(7)
    expect(data?.cid).toBe(CID.replace(/-/g, ''))
    expect(data?.slots[0]).toBe(255)
    // 0.5 on a 16-bit pan: 0x8000 across the coarse and fine slots.
    expect([data?.slots[9], data?.slots[10]]).toEqual([0x80, 0x00])
    const dmx = decodeArtDmx(artnet.packets[0].data)
    expect(dmx?.portAddress).toBe(0x0102)
    expect(dmx?.slots[0]).toBe(255)

    const before = sacn.packets.length
    runtime.stop()
    await until(() => sacn.packets.length >= before + 3)
    const ended = sacn.packets.slice(before).map(packet => decodeSacnData(packet.data))
    expect(ended.every(packet => packet !== null && (packet.options & SACN_OPTION_TERMINATED) !== 0)).toBe(true)
  })

  it('sends on a change, and again only when the keep-alive is due', async () => {
    const sacn = await listen()
    let now = 0
    const runtime = lighting(() => now)
    runtime.configure(config([output({ address: `127.0.0.1:${sacn.port}` })]))
    runtime.go(go('cue-1', 1))
    runtime.start(REPORT)
    runtime.frame()
    await until(() => sacn.packets.length >= 1)
    // Unchanged and inside the keep-alive: nothing more, however many frames run.
    now = 100
    runtime.frame()
    runtime.frame()
    // A change goes out at once.
    runtime.go(go('cue-2', 0.5))
    runtime.frame()
    await until(() => sacn.packets.length >= 2)
    // And an unchanged universe is sent again once the keep-alive comes round.
    now = 100 + 800
    runtime.frame()
    await until(() => sacn.packets.length >= 3)
    await new Promise(resolve => setTimeout(resolve, 50))
    const levels = sacn.packets.map(packet => decodeSacnData(packet.data)?.slots[0])
    expect(levels).toEqual([255, 128, 128])
    const sequences = sacn.packets.map(packet => decodeSacnData(packet.data)?.sequence)
    expect(sequences).toEqual([0, 1, 2])
  })

  it('releases a frame with a sync packet when the show synchronises', async () => {
    const sacn = await listen()
    const runtime = lighting(() => 0)
    runtime.configure(config([output({ address: `127.0.0.1:${sacn.port}` })], { sync: true, syncUniverse: 4000 }))
    runtime.go(go('cue-1', 1))
    runtime.start(REPORT)
    runtime.frame()
    await until(() => sacn.packets.length >= 2)
    expect(decodeSacnData(sacn.packets[0].data)?.syncAddress).toBe(4000)
    const sync = sacn.packets[1].data
    expect(sync.length).toBe(SACN_SYNC_LENGTH)
    expect(sync.readUInt16BE(45)).toBe(4000)
  })

  it('finds an Art-Net node that answers a poll', async () => {
    const node = await listen()
    node.socket.on('message', (_data, from) => {
      node.socket.send(
        encodeArtPollReply({
          address: '127.0.0.1',
          shortName: 'Rack node',
          longName: 'Rack node, two ports',
          net: 0,
          subnet: 1,
          swOut: [0, 1],
          mac: '02:00:00:00:00:01'
        }),
        from.port,
        from.address
      )
    })
    const runtime = lighting()
    runtime.start(REPORT)
    const nodes = await runtime.discover(`127.0.0.1:${node.port}`, 300)
    expect(nodes).toEqual([
      expect.objectContaining({ address: '127.0.0.1', shortName: 'Rack node', outputs: [0x10, 0x11] })
    ])
  })

  it('hears another console, shows it in the monitor, and merges it highest takes precedence', async () => {
    const runtime = lighting(undefined, { sacnPort: 0 })
    runtime.configure(config([], {
      inputs: [{ id: 'in-1', protocol: 'sacn', wireUniverse: 9, universe: 1, merge: true, enabled: true }]
    }))
    runtime.go(go('cue-1', 0.2))
    runtime.start(REPORT)
    await until(() => runtime.listeningPorts().sacn !== null)
    const slots = new Uint8Array(512)
    slots[0] = 200
    slots[100] = 50
    const sender = createSocket('udp4')
    open.push(sender)
    sender.send(
      encodeSacnData({
        cid: Buffer.alloc(16, 7), sourceName: 'Other desk', priority: 100, syncAddress: 0,
        sequence: 0, options: 0, universe: 9, slots
      }),
      runtime.listeningPorts().sacn!,
      '127.0.0.1'
    )
    await until(() => runtime.monitor([1]).frames[0].input !== null)
    const frame = runtime.monitor([1]).frames[0]
    expect(frame.inputSource).toBe('Other desk')
    expect(frame.input?.[100]).toBe(50)
    expect(frame.output[0]).toBe(200)
    expect(frame.output[100]).toBe(50)
  })
})
