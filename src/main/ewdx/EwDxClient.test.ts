// The client is held to a receiver that speaks the captured protocol over a real socket:
// what it reports once connected, what it says when the receiver refuses or goes away, and
// that it does not hold more of the receiver's sessions than it needs.
import { afterEach, describe, it, expect } from 'vitest'
import { EwDxClient, EwDxError, describeNetworkError } from './EwDxClient'
import type { EwDxOptions } from './EwDxClient'
import { startFakeReceiver } from './fakeReceiver'
import type { FakeReceiver } from './fakeReceiver'
import { FIXTURE_SERIAL } from './fixtures'
import { ewDxChannelId } from './mapping'
import { makeTestCertificate } from './testCertificate'

const PASSWORD = 'correct horse'
let receiver: FakeReceiver | null = null
let client: EwDxClient | null = null

async function connect(options: Partial<EwDxOptions> = {}, receiverOptions = {}): Promise<EwDxClient> {
  receiver = await startFakeReceiver({ password: PASSWORD, ...receiverOptions })
  client = new EwDxClient({
    origin: receiver.origin,
    password: PASSWORD,
    retryMs: [20, 40],
    heartbeatMs: 50,
    requestTimeoutMs: 300,
    ...options
  })
  client.start()
  return client
}

async function until(check: () => boolean | Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 3000
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`timed out waiting for ${what}`)
}

afterEach(async () => {
  client?.stop()
  await receiver?.close()
  client = null
  receiver = null
})

describe('EwDxClient', () => {
  it('connects, waits for the whole first picture, and reports the linked channel', async () => {
    const live = await connect()
    const channels = await live.snapshot(2000)
    expect(channels).toEqual([
      expect.objectContaining({
        id: ewDxChannelId(FIXTURE_SERIAL, 0),
        name: '37',
        rfDbm: -83,
        batteryPercent: 76,
        frequencyMhz: 606.2
      })
    ])
  })

  it('uses one subscription session however long it runs', async () => {
    const live = await connect()
    await live.snapshot(2000)
    receiver?.push('/api/channel/0/level', { value: -50 })
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(receiver?.sessions()).toBe(1)
    expect(receiver?.requests.filter(r => r === 'GET /api/ssc/state/subscriptions')).toHaveLength(1)
  })

  it('shows a change the receiver pushes', async () => {
    const live = await connect()
    await live.snapshot(2000)
    receiver?.push('/api/transmitters/0/battery', { type: 'PrimaryCell', gauge: 12 })
    await until(async () => (await live.snapshot(0))[0].batteryPercent === 12, 'the battery push')
  })

  it('drops a channel when its transmitter unlinks and brings it back when it relinks', async () => {
    const live = await connect()
    await live.snapshot(2000)
    receiver?.push('/api/channel/0/warnings', ['NoLink'])
    await until(async () => (await live.snapshot(0)).length === 0, 'the channel to go quiet')
    receiver?.push('/api/channel/0/warnings', [])
    await until(async () => (await live.snapshot(0)).length === 1, 'the channel to return')
  })

  it('refuses a wrong password by name and does not report anything', async () => {
    const live = await connect({ password: 'wrong' })
    await expect(live.snapshot(2000)).rejects.toThrow('password rejected')
  })

  it('refuses a receiver that is not speaking SSC protocol 2', async () => {
    const live = await connect({}, { protocol: '1.0' })
    await expect(live.snapshot(2000)).rejects.toThrow('unsupported SSC protocol 1.0')
  })

  it('says why when the receiver drops the stream, and recovers on its own', async () => {
    const live = await connect()
    await live.snapshot(2000)
    receiver?.dropStreams()
    // The client learns of the drop when the socket close reaches it, not in the same tick.
    let said = ''
    await until(async () => {
      said = await live.snapshot(0).then(() => '', (error: Error) => error.message)
      return said !== ''
    }, 'the drop to be noticed')
    expect(said).toBe('connection lost')
    await until(async () => (await live.snapshot(0).catch(() => [])).length === 1, 'the session to reopen')
  })

  it('does not show a reading from before the drop once the session is gone', async () => {
    const live = await connect()
    await live.snapshot(2000)
    // Stalled, so the session cannot reopen: what the client held must be gone, not kept.
    receiver?.stall(true)
    receiver?.dropStreams()
    await until(async () => await live.snapshot(0).then(() => false, () => true), 'the drop to be noticed')
    await expect(live.snapshot(0)).rejects.toThrow()
  })

  it('notices a receiver that has gone quiet without closing the socket', async () => {
    const live = await connect()
    await live.snapshot(2000)
    receiver?.stall(true)
    await until(async () => (await live.snapshot(0).then(() => false, () => true)), 'the heartbeat to fail')
  })

  it('times out the first snapshot when nothing answers', async () => {
    const live = await connect({ requestTimeoutMs: 5000 }, {})
    receiver?.stall(true)
    live.stop()
    const slow = new EwDxClient({ origin: receiver!.origin, password: PASSWORD, requestTimeoutMs: 5000 })
    slow.start()
    await expect(slow.snapshot(150)).rejects.toThrow('did not answer in time')
    slow.stop()
  })

  it('releases its session when it is stopped', async () => {
    const live = await connect()
    await live.snapshot(2000)
    live.stop()
    await until(() => receiver?.sessions() === 0, 'the session to be released')
  })
})

describe('describeNetworkError', () => {
  it('says what happened to the receiver, not what Node called it', () => {
    expect(describeNetworkError(Object.assign(new Error('connect ECONNREFUSED 10.0.0.4:443'), { code: 'ECONNREFUSED' }))).toBe('connection refused')
    expect(describeNetworkError(Object.assign(new Error('x'), { code: 'EHOSTUNREACH' }))).toBe('receiver unreachable')
    expect(describeNetworkError(new Error('aborted'))).toBe('connection lost')
    expect(describeNetworkError(new Error('something unforeseen'))).toBe('something unforeseen')
  })
})

// A real receiver's certificate is self-signed, which is the case Node does not hand to
// `checkServerIdentity`: a pin kept there pins nothing. These run over real TLS with a
// certificate nothing trusts, so the pin is held to what a receiver actually presents.
describe('EwDxClient certificate pin', () => {
  // Made fresh for the run: there is no key in the repository to leak, and the two
  // certificates are different the way a replaced receiver's would be.
  const first = makeTestCertificate('cuerunner-test-receiver')
  const other = makeTestCertificate('cuerunner-test-receiver-2')
  const tlsReceiver = { tls: { key: first.key, cert: first.cert } }

  it('makes a certificate whose fingerprint is the one a connection sees', async () => {
    expect(first.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/)
    expect(first.fingerprint).not.toBe(other.fingerprint)
  })

  it('trusts the first certificate a receiver shows and says which it was', async () => {
    const seen: string[] = []
    const live = await connect({ onFingerprint: fp => seen.push(fp) }, tlsReceiver)
    expect(await live.snapshot(2000)).toHaveLength(1)
    expect(seen).toEqual([first.fingerprint])
  })

  it('connects when the certificate is the one that was pinned, without asking to pin it again', async () => {
    const seen: string[] = []
    const live = await connect({ pinnedFingerprint: first.fingerprint.toLowerCase(), onFingerprint: fp => seen.push(fp) }, tlsReceiver)
    expect(await live.snapshot(2000)).toHaveLength(1)
    expect(seen).toEqual([])
  })

  it('refuses a certificate that is not the pinned one, and sends it nothing — not even the password', async () => {
    const live = await connect({ pinnedFingerprint: other.fingerprint }, tlsReceiver)
    await expect(live.snapshot(2000)).rejects.toThrow('certificate changed since it was trusted')
    expect(receiver?.requests).toEqual([])
    expect(receiver?.sawCredentials()).toBe(false)
  })

  it('does not accept a different certificate on a reconnect once it has trusted one', async () => {
    const live = await connect({ retryMs: [20, 40] }, tlsReceiver)
    await live.snapshot(2000)

    // The same address, a different certificate: a replaced receiver, or someone in the way.
    const port = Number(new URL(receiver!.origin).port)
    await receiver!.close()
    receiver = await startFakeReceiver({ password: PASSWORD, port, tls: { key: other.key, cert: other.cert } })

    await until(async () => await live.snapshot(0).then(() => false, error => /certificate changed/.test(error.message)), 'the new certificate to be refused')
    expect(receiver.sawCredentials()).toBe(false)
  })
})

// An address is where a receiver was, and a lease that changed can give it to another one. The
// serial is which receiver it is, and it is read from the public identity before a credential is sent.
describe('EwDxClient serial', () => {
  const failureOf = async (live: EwDxClient): Promise<EwDxError> => {
    const error = await live.snapshot(2000).then(() => null, (thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(EwDxError)
    return error as EwDxError
  }

  it('says which receiver it reached, so the machine can remember it', async () => {
    const seen: string[] = []
    const live = await connect({ onSerial: serial => seen.push(serial) })
    await live.snapshot(2000)
    expect(seen).toContain(FIXTURE_SERIAL)
  })

  it('connects to the receiver it was made for', async () => {
    const live = await connect({ expectedSerial: FIXTURE_SERIAL })
    expect(await live.snapshot(2000)).toHaveLength(1)
  })

  it('refuses a different receiver at the address, and never sends it the password', async () => {
    const live = await connect({ expectedSerial: '9999999999' })

    const error = await failureOf(live)
    expect(error.message).toContain(`serial ${FIXTURE_SERIAL}, not 9999999999`)
    expect(error.message).toContain('Trust again')
    expect(error.kind).toBe('wrong-receiver')
    // It asked who it was talking to and went no further.
    expect(receiver?.requests).toEqual(['GET /api/device/identity'])
    expect(receiver?.sawCredentials()).toBe(false)
  })

  it('holds to the first receiver it reaches for the rest of the run, so a stranger that takes the address is not logged into', async () => {
    const live = await connect({ retryMs: [20, 40] })
    await live.snapshot(2000)
    const port = Number(new URL(receiver!.origin).port)

    // Same address, another unit: a lease that changed under a client that is already running.
    await receiver!.close()
    receiver = await startFakeReceiver({ password: PASSWORD, port, serial: '0000000099' })

    await until(async () => await live.snapshot(0).then(() => false, error => /a different receiver answers here/.test(error.message)), 'the stranger to be refused')
    expect(receiver.sawCredentials()).toBe(false)
  })

  it('tells a receiver that has gone from one that refused, because only the first is worth looking for', async () => {
    const refused = await connect({ password: 'wrong' })
    expect((await failureOf(refused)).kind).toBe('refused')
    refused.stop()
    await receiver?.close()

    // Nothing is listening where the receiver was.
    const gone = new EwDxClient({ origin: receiver!.origin, password: PASSWORD, retryMs: [20, 40], requestTimeoutMs: 300 })
    client = gone
    gone.start()
    const error = await failureOf(gone)
    expect(error.kind).toBe('unreachable')
    expect(error.message).toBe('connection refused')
  })
})

// The one thing the source writes to a receiver. A mute that did not happen is a mic that is open on
// a stage, so these hold what it sends, that the receiver is asked afterwards, and what it says when
// it could not be done.
describe('EwDxClient setMute', () => {
  it('mutes a channel, sends the one boolean and nothing else, and the cache follows', async () => {
    const live = await connect()
    await live.snapshot(2000)

    await live.setMute(0, true)

    expect(receiver?.writes).toEqual(['PUT /api/channel/0 {"mute":true}'])
    await until(async () => (await live.snapshot(0))[0].muted === true, 'the mute to arrive on the stream')
  })

  it('unmutes it, and muting something already muted is the state that was asked for, not an error', async () => {
    const live = await connect()
    await live.snapshot(2000)

    await live.setMute(0, true)
    await live.setMute(0, true)
    await live.setMute(0, false)

    await until(async () => (await live.snapshot(0))[0].muted === false, 'the unmute to arrive')
    expect(receiver?.writes).toHaveLength(3)
  })

  it('does not take a receiver\'s yes for the mute: it asks, and says when it said yes and did not', async () => {
    const live = await connect({}, { ignoreWrites: true })
    await live.snapshot(2000)

    await expect(live.setMute(0, true)).rejects.toThrow('receiver said yes and is not muted')
    await expect(live.setMute(0, false)).resolves.toBeUndefined() // it already is not muted: that is the state asked for
  })

  it('refuses a channel the receiver does not have, before and after asking it', async () => {
    const live = await connect()
    await live.snapshot(2000)

    await expect(live.setMute(7, true)).rejects.toThrow('this receiver has no channel 7')
    await expect(live.setMute(-1, true)).rejects.toThrow('has no channel -1')
    await expect(live.setMute(1.5, true)).rejects.toThrow('has no channel 1.5')
    // Channel 3 is a real EM 4 channel the fixture receiver does not carry. The real receiver answers a
    // write for a channel it lacks with 400, not 404 (see the capture), and says nothing more.
    await expect(live.setMute(3, true)).rejects.toThrow('receiver refused the mute (HTTP 400)')
    expect(receiver?.writes).toEqual([])
  })

  it('says what is wrong when the receiver is not there, rather than muting nothing quietly', async () => {
    const live = await connect()
    await live.snapshot(2000)
    receiver?.stall(true)

    await expect(live.setMute(0, true)).rejects.toThrow('receiver did not answer in time')
  })
})
