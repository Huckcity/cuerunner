// The receiver's own words, replayed. `integration/fixtures/vendor/ew-dx-em4-2026-10-02.json` is a
// subscription read off a real EM 4 Dante with two bodypacks linked, and the record's `witnessed`
// row for EW-DX rests on it. Nothing in the repository runs a receiver, so what holds that claim
// is this: every reading in that capture goes through the code that reads a receiver, on every
// run, and what comes out has to be what the capture says the receiver said.
import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { channelsFrom, ewDxChannelId, subscriptionPaths } from './mapping'
import { EwDxClient } from './EwDxClient'
import { startFakeReceiver } from './fakeReceiver'
import type { FakeReceiver } from './fakeReceiver'
import { parseDnsRecords, presenceDevices } from '../services/mdns'

interface Capture {
  provenance: Record<string, unknown>
  identity: { product: string; serial: string; vendor: string }
  protocol: { protocol: string; schema: string }
  firmware: { deviceVersion: string }
  mdns: { service: string; reply: string; replyFrom: string }
  snapshot: Array<[string, unknown]>
  events: Array<{ atMs: number; path: string; value: unknown }>
}

const capture: Capture = JSON.parse(
  readFileSync(join(process.cwd(), 'integration/fixtures/vendor/ew-dx-em4-2026-10-02.json'), 'utf-8')
)
const SERIAL = capture.identity.serial
const resources = (): Map<string, unknown> => new Map(capture.snapshot)

describe('the EM 4 capture', () => {
  it('says where it came from: the device, the version the device gave, the day and who recorded it', () => {
    const { provenance } = capture
    expect(provenance.version).toBe(capture.firmware.deviceVersion)
    expect(provenance.versionSource).toBe('device')
    expect(String(provenance.recordedAt)).toMatch(/^2026-10-02T/)
    expect(String(provenance.recordedBy)).not.toBe('')
    expect(capture.protocol.protocol).toBe('2.4')
  })

  it('holds every path the source subscribes to for a four-channel receiver, and no other', () => {
    expect(capture.snapshot.map(([path]) => path).sort()).toEqual([...subscriptionPaths(4)].sort())
  })

  it('reads as the two linked bodypacks it was recorded with, and leaves the unlinked channels out', () => {
    const channels = channelsFrom(SERIAL, resources())

    expect(channels.map(channel => channel.id)).toEqual([ewDxChannelId(SERIAL, 0), ewDxChannelId(SERIAL, 1)])
    for (const channel of channels) {
      // What a receiver reports for a linked pack on AA cells, and what it does not.
      expect(channel.batteryPercent).toBeGreaterThanOrEqual(0)
      expect(channel).not.toHaveProperty('batteryMinutes')
      expect(channel.rfDbm).toBeLessThan(0)
      expect(channel.rfWeak).toBe(false)
      expect(channel.frequencyMhz).toBeGreaterThan(600)
    }
    const gauge = (path: string): number => (capture.snapshot.find(([p]) => p === path)![1] as { gauge: number }).gauge
    expect(channels.map(channel => channel.batteryPercent)).toEqual([
      gauge('/api/transmitters/0/battery'),
      gauge('/api/transmitters/1/battery')
    ])
  })

  it('reads every push that followed the snapshot without ever reporting more than the two packs', () => {
    const live = resources()
    for (const event of capture.events) {
      live.set(event.path, event.value)
      const channels = channelsFrom(SERIAL, live)
      expect(channels).toHaveLength(2)
      for (const channel of channels) {
        expect(channel.audioLevel).toBeGreaterThanOrEqual(0)
        expect(channel.audioLevel).toBeLessThanOrEqual(100)
      }
    }
    expect(capture.events.length).toBeGreaterThan(0)
  })

  it('reads the receiver\'s own mDNS reply as the control interface it announced', () => {
    const [device] = presenceDevices(parseDnsRecords(Buffer.from(capture.mdns.reply, 'hex')))

    expect(device.id.endsWith(`.${capture.mdns.service}`)).toBe(true)
    expect(device.port).toBe(443)
    expect(device.address).toBe(capture.mdns.replyFrom)
  })

  describe('through the client', () => {
    let receiver: FakeReceiver | null = null
    afterEach(async () => {
      await receiver?.close()
      receiver = null
    })

    it('gives the same two packs when a client subscribes to a receiver that says what this one said', async () => {
      receiver = await startFakeReceiver({ password: 'p', state: capture.snapshot })
      const client = new EwDxClient({ origin: receiver.origin, password: 'p', requestTimeoutMs: 500 })
      client.start()
      try {
        const channels = await client.snapshot(3000)
        // The fake receiver's serial is its own; what is held is the readings.
        expect(channels.map(({ id: _id, ...rest }) => rest)).toEqual(
          channelsFrom(SERIAL, resources()).map(({ id: _id, ...rest }) => rest)
        )
      } finally {
        client.stop()
      }
    })
  })
})
