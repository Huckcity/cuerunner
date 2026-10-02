// Finding a receiver is held to what one actually said: the mDNS reply below is the bytes an EM 4
// Dante sent to a `_ssc-https._tcp` query, captured on a show network. The sockets are fakes, so
// no multicast is needed; the identity step runs against the fake receiver over real TLS.
import { afterEach, describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { discoverEwDx, modelOf, readIdentity } from './discovery'
import type { ScanSocket } from './discovery'
import { startFakeReceiver } from './fakeReceiver'
import type { FakeReceiver } from './fakeReceiver'
import { FIXTURE_SERIAL } from './fixtures'
import { makeTestCertificate } from './testCertificate'

/**
 * The receiver's own reply: PTR to `EWDXEM4D-001B663BDD13._ssc-https._tcp.local`, its TXT, an
 * SRV for port 443 on `EWDX4CHDS-001B663BDD13.local`, two AAAA and the A record 192.168.0.194.
 */
const REAL_REPLY = Buffer.from(
  '0000840000010006000000000a5f7373632d6874747073045f746370056c6f63616c00000c0001c00c000c00010000000a00181545574458454d34442d303031423636334244443133c00cc033001000010000000a000100c033002100010000000a001f0000000001bb164557445834434844532d303031423636334244443133c01cc06a001c00010000000a00102a0aef4007e8b601dacec8fdf5322b07c06a001c00010000000a00102a0aef4007e8b601021b66fffe3bdd13c06a000100010000000a0004c0a800c2',
  'hex'
)

const IDENTITY = { product: 'EWDX4CHDS', serial: '5364000906' }

/** A socket that never touches the network: it answers each query with whatever it was given. */
class FakeSocket extends EventEmitter {
  sent: Array<{ port: number; address: string }> = []
  closed = false
  constructor(
    private readonly reply: Buffer | null,
    private readonly from: string,
    private readonly failSend?: Error
  ) {
    super()
  }

  bind(_port: number, _address: string, callback: () => void): this {
    queueMicrotask(callback)
    return this
  }

  setMulticastInterface(): void {}

  send(_message: Buffer, port: number, address: string): void {
    if (this.failSend) throw this.failSend
    this.sent.push({ port, address })
    if (this.reply) queueMicrotask(() => this.emit('message', this.reply, { address: this.from, port: 5353 }))
  }

  close(): void {
    this.closed = true
  }
}

const asScan = (socket: FakeSocket): ScanSocket => socket as unknown as ScanSocket

describe('discoverEwDx', () => {
  it('finds the receiver a real reply names, and says what model it is', async () => {
    const socket = new FakeSocket(REAL_REPLY, '192.168.0.194')

    const result = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(socket),
      identify: async () => IDENTITY
    })

    expect(result).toEqual({
      error: null,
      receivers: [
        {
          address: '192.168.0.194',
          port: 443,
          name: 'EWDXEM4D-001B663BDD13',
          product: 'EWDX4CHDS',
          serial: '5364000906',
          model: 'EW-DX EM 4 Dante'
        }
      ]
    })
    // It asked the mDNS group, once at least, and let go of the socket afterwards.
    expect(socket.sent[0]).toEqual({ port: 5353, address: '224.0.0.251' })
    expect(socket.closed).toBe(true)
  })

  it('asks from every network the machine is on, and one receiver heard twice is one receiver', async () => {
    const sockets = [new FakeSocket(REAL_REPLY, '192.168.0.194'), new FakeSocket(REAL_REPLY, '10.0.0.7')]
    let next = 0

    const result = await discoverEwDx({
      interfaces: ['192.168.0.97', '10.0.0.5'],
      windowMs: 20,
      open: () => asScan(sockets[next++]),
      identify: async () => IDENTITY
    })

    expect(sockets.every(socket => socket.sent.length > 0)).toBe(true)
    expect(result.receivers).toHaveLength(1)
  })

  it('offers only what identifies itself as an EW-DX receiver', async () => {
    const answer = async (): Promise<null> => null
    const refused = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(new FakeSocket(REAL_REPLY, '192.168.0.194')),
      identify: answer
    })
    expect(refused.receivers).toEqual([])

    // Another Sennheiser product that speaks SSC is not one this source can read.
    const other = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(new FakeSocket(REAL_REPLY, '192.168.0.194')),
      identify: async () => ({ product: 'TCCM', serial: '1' })
    })
    expect(other.receivers).toEqual([])
  })

  it('offers a receiver whose model it does not know under the code it gave', async () => {
    const result = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(new FakeSocket(REAL_REPLY, '192.168.0.194')),
      identify: async () => ({ product: 'EWDX2CHRX', serial: '77' })
    })
    expect(result.receivers[0].model).toBe('EW-DX (EWDX2CHRX)')
    expect(modelOf('EWDX4CHDS')).toBe('EW-DX EM 4 Dante')
  })

  it('says none were found, with no error, when the network was asked and nobody answered', async () => {
    const socket = new FakeSocket(null, '')

    const result = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(socket),
      identify: async () => IDENTITY
    })

    expect(result).toEqual({ receivers: [], error: null })
    expect(socket.sent.length).toBeGreaterThan(0)
  })

  it('says it could not look, rather than that there is nothing, when no network would take the query', async () => {
    const result = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(new FakeSocket(null, '', new Error('ENETUNREACH'))),
      identify: async () => IDENTITY
    })

    expect(result).toEqual({ receivers: [], error: 'ENETUNREACH' })
  })

  it('says so when the machine is on no network at all', async () => {
    const result = await discoverEwDx({ interfaces: [], windowMs: 20 })
    expect(result.error).toBe('this computer is not on a network')
  })

  it('ignores an announcement of some other service', async () => {
    // The same bytes with the service type changed to one of the same length.
    const other = Buffer.from(REAL_REPLY)
    other.write('_ssc-ftpps', 13)

    const result = await discoverEwDx({
      interfaces: ['192.168.0.97'],
      windowMs: 20,
      open: () => asScan(new FakeSocket(other, '192.168.0.194')),
      identify: async () => IDENTITY
    })

    expect(result.receivers).toEqual([])
  })

  it('takes announcements it is handed without opening a socket, and still identifies them', async () => {
    const asked: string[] = []

    const result = await discoverEwDx({
      announced: [{ address: '127.0.0.1', port: 8443, name: 'announced' }],
      open: () => {
        throw new Error('no socket should be opened')
      },
      identify: async (address, port) => {
        asked.push(`${address}:${port}`)
        return IDENTITY
      }
    })

    expect(asked).toEqual(['127.0.0.1:8443'])
    expect(result.receivers).toHaveLength(1)
  })
})

describe('readIdentity', () => {
  let receiver: FakeReceiver | null = null
  afterEach(async () => {
    await receiver?.close()
    receiver = null
  })

  const portOf = (origin: string): number => Number(new URL(origin).port)

  it('reads who a receiver is without a password, over a certificate nothing trusts', async () => {
    const certificate = makeTestCertificate('identity-receiver')
    receiver = await startFakeReceiver({ password: 'never sent', tls: { key: certificate.key, cert: certificate.cert } })

    expect(await readIdentity('127.0.0.1', portOf(receiver.origin))).toEqual({
      product: 'EWDX4CHDS',
      serial: FIXTURE_SERIAL
    })
    // It asked the one public question and carried no credentials.
    expect(receiver.requests).toEqual(['GET /api/device/identity'])
    expect(receiver.sawCredentials()).toBe(false)
  })

  it('reads nothing from something that is not a receiver, or is not there', async () => {
    const certificate = makeTestCertificate('not-a-receiver')
    // The fake answers 404 to everything it does not serve; its identity path is the only one.
    receiver = await startFakeReceiver({ password: 'x', tls: { key: certificate.key, cert: certificate.cert }, state: [] })
    const port = portOf(receiver.origin)
    await receiver.close()
    receiver = null

    expect(await readIdentity('127.0.0.1', port)).toBeNull()
  })
})
