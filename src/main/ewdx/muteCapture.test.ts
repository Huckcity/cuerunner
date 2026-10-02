// What a real EM 4 said to a mute, replayed. `integration/fixtures/vendor/ew-dx-em4-mute-2026-10-02.json`
// is ten requests against a channel with a pack linked, ending with the original state written back.
// Two things hold it to the code. The fake receiver every other test relies on must answer each
// captured request the way the real one did — otherwise those tests are about a receiver that does
// not exist — and the client must send exactly the writes that were captured, and nothing wider.
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EwDxClient } from './EwDxClient'
import { startFakeReceiver } from './fakeReceiver'
import type { FakeReceiver } from './fakeReceiver'

interface Exchange {
  method: string
  path: string
  request: unknown
  status: number
  response: { mute?: boolean } | null
}

const capture: { provenance: Record<string, unknown>; exchanges: Exchange[] } = JSON.parse(
  readFileSync(join(process.cwd(), 'integration/fixtures/vendor/ew-dx-em4-mute-2026-10-02.json'), 'utf-8')
)

const PASSWORD = 'pw'
let receiver: FakeReceiver | null = null
afterEach(async () => {
  await receiver?.close()
  receiver = null
})

const authorization = `Basic ${Buffer.from(`api:${PASSWORD}`).toString('base64')}`

describe('the EM 4 mute capture', () => {
  it('says where it came from: the device, the version the device gave, the day and who recorded it', () => {
    const { provenance } = capture
    expect(provenance.version).toBe('4.0.0')
    expect(provenance.versionSource).toBe('device')
    expect(String(provenance.recordedAt)).toMatch(/^2026-10-02T/)
    expect(String(provenance.recordedBy)).not.toBe('')
  })

  it('ends in the state it began in: a hand run on somebody\'s receiver puts it back', () => {
    const reads = capture.exchanges.filter(exchange => exchange.method === 'GET')
    expect(reads[0].response?.mute).toBe(reads[reads.length - 1].response?.mute)
  })

  it('is answered by the fake receiver exactly as the real one answered it', async () => {
    receiver = await startFakeReceiver({ password: PASSWORD })

    for (const exchange of capture.exchanges) {
      const response = await fetch(`${receiver.origin}${exchange.path}`, {
        method: exchange.method,
        headers: { authorization, ...(exchange.request === null ? {} : { 'content-type': 'application/json' }) },
        body: exchange.request === null ? undefined : JSON.stringify(exchange.request)
      })
      const text = await response.text()
      const label = `${exchange.method} ${exchange.path} ${JSON.stringify(exchange.request)}`
      expect(response.status, label).toBe(exchange.status)
      if (exchange.method === 'GET') expect((JSON.parse(text) as { mute: boolean }).mute, label).toBe(exchange.response?.mute)
      else expect(text, label).toBe('')
    }
  })

  it('has the client send exactly the writes that were captured, to the channel it names, and read it back', async () => {
    receiver = await startFakeReceiver({ password: PASSWORD })
    const client = new EwDxClient({ origin: receiver.origin, password: PASSWORD, requestTimeoutMs: 500 })
    client.start()
    try {
      await client.snapshot(3000)
      // What the cue does: mute, mute again, unmute — the first three writes the capture holds to channel 0.
      await client.setMute(0, true)
      await client.setMute(0, true)
      await client.setMute(0, false)
    } finally {
      client.stop()
    }

    const captured = capture.exchanges
      .filter(exchange => exchange.method === 'PUT' && exchange.path === '/api/channel/0' && exchange.status === 200)
      .slice(0, 3)
      .map(exchange => `PUT ${exchange.path} ${JSON.stringify(exchange.request)}`)
    expect(receiver.writes).toEqual(captured)
    // Each write was followed by a read of the same channel: it asks, and does not take yes for done.
    expect(receiver.requests.filter(line => line === 'GET /api/channel/0').length).toBeGreaterThanOrEqual(3)
  })
})
