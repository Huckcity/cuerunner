// A cue stack fires OSC repeatedly, and the engine used to open and close a UDP socket
// for every message. These tests hold it to one socket per destination, and to failing
// the cues that are waiting on a socket that broke.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OscEngine } from './OscEngine'
import { decodePacket } from './codec'

interface SentDatagram {
  address: string
  args: unknown[]
  reply: (error?: Error) => void
}

class FakeClient {
  static created: FakeClient[] = []

  readonly sent: SentDatagram[] = []
  readonly closed = vi.fn()
  private listeners: Array<(error: Error) => void> = []

  constructor(readonly host: string, readonly port: number, readonly localAddress: string | null = null) {
    FakeClient.created.push(this)
  }

  /** The packet as it would leave, read back the way the listener reads one. */
  send(packet: Buffer, reply: (error?: Error | null) => void): void {
    const [message] = decodePacket(packet)
    this.sent.push({ address: message.address, args: message.args, reply: error => reply(error ?? null) })
  }

  close(callback?: () => void): void {
    this.closed()
    callback?.()
  }

  on(_event: 'error', listener: (error: Error) => void): void {
    this.listeners.push(listener)
  }

  fail(error: Error): void {
    for (const listener of this.listeners) listener(error)
  }

  /** Answers the oldest send that has not been answered yet. */
  answer(error?: Error): void {
    this.sent[this.sent.length - 1].reply(error)
  }
}

describe('OscEngine.send', () => {
  let engine: OscEngine

  beforeEach(() => {
    FakeClient.created = []
    engine = new OscEngine((host, port, local) => new FakeClient(host, port, local))
  })

  afterEach(() => {
    engine.close()
  })

  it('sends a cue with no host nowhere, and opens no socket for it', async () => {
    const result = await engine.send('', 9000, '/go', [])

    expect(result).toEqual({ ok: false, error: 'No OSC host is set for this cue' })
    expect(FakeClient.created).toHaveLength(0)
  })

  it('reuses one socket for every send to the same destination', async () => {
    const first = engine.send('10.0.0.5', 9000, '/cue/1', [{ type: 'i', value: 1 }])
    await vi.waitFor(() => expect(FakeClient.created[0]?.sent).toHaveLength(1))
    FakeClient.created[0].answer()

    expect(await first).toEqual({ ok: true })

    const second = engine.send('10.0.0.5', 9000, '/cue/2', [{ type: 's', value: 'x' }])
    await vi.waitFor(() => expect(FakeClient.created[0]?.sent).toHaveLength(2))
    FakeClient.created[0].answer()

    expect(await second).toEqual({ ok: true })
    expect(FakeClient.created).toHaveLength(1)
    expect(FakeClient.created[0].closed).not.toHaveBeenCalled()
  })

  it('keeps a socket per destination, not one shared by all', async () => {
    const a = engine.send('10.0.0.5', 9000, '/a', [])
    const b = engine.send('10.0.0.6', 9000, '/b', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(2))

    FakeClient.created[0].answer()
    FakeClient.created[1].answer()

    expect(await a).toEqual({ ok: true })
    expect(await b).toEqual({ ok: true })
    expect(FakeClient.created.map(c => c.host)).toEqual(['10.0.0.5', '10.0.0.6'])
  })

  it('encodes the cue argument types the way OSC expects', async () => {
    const sent = engine.send('10.0.0.5', 9000, '/lights', [
      { type: 'i', value: 3 },
      { type: 'f', value: 0.5 },
      { type: 's', value: 'warm' },
      { type: 'T', value: true },
      { type: 'F', value: false }
    ])
    await vi.waitFor(() => expect(FakeClient.created[0]?.sent).toHaveLength(1))

    expect(FakeClient.created[0].sent[0].address).toBe('/lights')
    // The tags the cue wrote, not the ones a number would be guessed as.
    expect(FakeClient.created[0].sent[0].args).toEqual([
      { type: 'i', value: 3 },
      { type: 'f', value: 0.5 },
      { type: 's', value: 'warm' },
      { type: 'T', value: true },
      { type: 'F', value: false }
    ])

    FakeClient.created[0].answer()
    await sent
  })

  it('reports a send that the socket refuses', async () => {
    const result = engine.send('10.0.0.5', 9000, '/go', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(1))
    FakeClient.created[0].answer(new Error('send ENETUNREACH'))

    expect(await result).toEqual({ ok: false, error: 'send ENETUNREACH' })
  })

  it('reports a socket error rather than taking the process down with it', async () => {
    const result = engine.send('10.0.0.5', 9000, '/go', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(1))
    FakeClient.created[0].fail(new Error('getaddrinfo ENOTFOUND'))

    expect(await result).toEqual({ ok: false, error: 'getaddrinfo ENOTFOUND' })
    // The socket that errored is dropped, so the next cue starts from a fresh one.
    expect(FakeClient.created[0].closed).toHaveBeenCalled()

    const retry = engine.send('10.0.0.5', 9000, '/go', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(2))
    FakeClient.created[1].answer()
    expect(await retry).toEqual({ ok: true })
  })

  it('fails every cue waiting on a socket when that socket errors', async () => {
    const first = engine.send('10.0.0.5', 9000, '/a', [])
    const second = engine.send('10.0.0.5', 9000, '/b', [])
    await vi.waitFor(() => expect(FakeClient.created[0]?.sent).toHaveLength(2))

    FakeClient.created[0].fail(new Error('socket hung up'))

    expect(await first).toEqual({ ok: false, error: 'socket hung up' })
    expect(await second).toEqual({ ok: false, error: 'socket hung up' })
  })

  it('sends a float the cue wrote as a whole number as a float, not an int', async () => {
    const sent = engine.send('10.0.0.5', 9000, '/fader', [{ type: 'f', value: 1 }])
    await vi.waitFor(() => expect(FakeClient.created[0]?.sent).toHaveLength(1))
    expect(FakeClient.created[0].sent[0].args).toEqual([{ type: 'f', value: 1 }])
    FakeClient.created[0].answer()
    await sent
  })

  it('opens its sockets on the interface this machine pinned OSC to, and again after a change', async () => {
    let pinned: string | null = '10.0.0.2'
    engine.close()
    engine = new OscEngine((host, port, local) => new FakeClient(host, port, local), () => pinned)
    const first = engine.send('10.0.0.5', 9000, '/a', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(1))
    FakeClient.created[0].answer()
    await first
    expect(FakeClient.created[0].localAddress).toBe('10.0.0.2')

    pinned = null
    engine.rebind()
    expect(FakeClient.created[0].closed).toHaveBeenCalled()
    const second = engine.send('10.0.0.5', 9000, '/b', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(2))
    FakeClient.created[1].answer()
    await second
    expect(FakeClient.created[1].localAddress).toBeNull()
  })

  it('closes its sockets on the way out', async () => {
    const sent = engine.send('10.0.0.5', 9000, '/go', [])
    await vi.waitFor(() => expect(FakeClient.created).toHaveLength(1))

    engine.close()

    expect(FakeClient.created[0].closed).toHaveBeenCalled()
    expect(await sent).toEqual({ ok: false, error: 'OSC engine closed' })
  })
})
