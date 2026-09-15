// Redundant playback, held to real sockets with a clock the test owns.
//
// Two services are stood up as a pair and left to talk: one publishes its show, the
// other mirrors it, the first is taken away, and what the survivor says and does about
// it is what these cases assert. The sockets are real — the wire is half of what this
// service is — while the timers are the test's, so a heartbeat is advanced rather than
// waited for and no case depends on how fast the machine running it is.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, createConnection, type AddressInfo, type Server, type Socket } from 'node:net'
import { RedundancyService } from './RedundancyService'
import { ShowBus } from '../bus/ShowBus'
import { defaultShowSettings, type RedundancyEvent, type ServiceState } from '../../renderer/src/types/show'
import {
  REDUNDANCY_PROTOCOL,
  cueListHash,
  defaultRedundancySettings,
  encodeMessage,
  type RedundancyDigest,
  type RedundancySettings
} from '../../shared/redundancy'

/** The service's own timings, shortened: what is held here is the order, not a second. */
const HEARTBEAT_MS = 20
const CHECK_MS = 10
const TIMEOUT_MS = 200
/** How much of that clock a case may spend waiting for a condition before it fails. */
const BUDGET_MS = 2000

interface Health {
  state: ServiceState
  detail: string
}

interface Harness {
  service: RedundancyService
  bus: ShowBus
  /** The port this machine was told to listen on. */
  port: number
  health: Health[]
  events: RedundancyEvent[]
  /** The newest status this machine published. */
  latest: () => RedundancyEvent | null
  /** Every takeover this machine has announced. */
  takeovers: () => RedundancyEvent[]
  close: () => void
}

const running: Harness[] = []

beforeEach(() => {
  // Everything the service measures silence with is the test's clock; the event loop,
  // and therefore the sockets, stay real.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  for (const harness of running.splice(0)) harness.close()
  vi.useRealTimers()
})

/** One turn of the event loop, so a write on one socket can be read on the other. */
function io(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setImmediate(resolve)
  return promise
}

/**
 * Moves the service's clock and lets the sockets catch up. Time is advanced in small
 * steps rather than in one jump, because a beat that arrives because of a timer is half
 * the protocol: the peer has to be given the chance to read it between two of them.
 */
async function settle(ms: number): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 5) {
    vi.advanceTimersByTime(5)
    await io()
  }
  await io()
}

/** Settles until the condition holds, or fails with what it was waiting for. */
/** Waits for a machine's listener to be bound, which binding does asynchronously. */
async function awaiting(machine: Harness): Promise<Harness> {
  await until(() => machine.latest()?.status.listening === true, `${machine.port} to be listening`)
  return machine
}

async function until(check: () => boolean, what: string, budgetMs = BUDGET_MS): Promise<void> {
  for (let elapsed = 0; elapsed <= budgetMs; elapsed += 5) {
    if (check()) return
    await settle(5)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A port nothing is listening on, for a machine to be told to listen on. */
async function freePort(): Promise<number> {
  const server = createServer()
  const { promise, resolve } = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', resolve)
  await promise
  const port = (server.address() as AddressInfo).port
  const closed = Promise.withResolvers<void>()
  server.close(() => closed.resolve())
  await closed.promise
  return port
}

async function start(
  name: string,
  id: string,
  settings: Partial<RedundancySettings> = {}
): Promise<Harness> {
  const config: RedundancySettings = {
    ...defaultRedundancySettings(name, id),
    enabled: true,
    port: await freePort(),
    timeoutMs: TIMEOUT_MS,
    ...settings
  }
  const bus = new ShowBus()
  const health: Health[] = []
  const events: RedundancyEvent[] = []
  bus.subscribe(batch => {
    for (const event of batch) {
      if (event.kind === 'redundancy') events.push(event)
    }
  })
  const service = new RedundancyService({
    settings: () => config,
    heartbeatMs: HEARTBEAT_MS,
    checkMs: CHECK_MS,
    retryMs: 50
  })
  service.start({ bus, setState: (state, detail) => health.push({ state, detail }) }, defaultShowSettings())

  const harness: Harness = {
    service,
    bus,
    port: config.port,
    health,
    events,
    latest: () => events.at(-1) ?? null,
    takeovers: () => events.filter(event => event.takeover !== undefined),
    close: () => {
      service.stop()
      bus.close()
    }
  }
  running.push(harness)
  return harness
}

/** Two machines, the second standing by for the first, on ports the test chose. */
async function pair(
  standby: Partial<RedundancySettings> = {}
): Promise<{ live: Harness; backup: Harness; port: number }> {
  const port = await freePort()
  const live = await start('desk-a', 'id-a', { role: 'live', port })
  const backup = await start('desk-b', 'id-b', {
    role: 'standby',
    peerHost: '127.0.0.1',
    peerPort: port,
    ...standby
  })
  return { live, backup, port }
}

function digest(overrides: Partial<RedundancyDigest> = {}): RedundancyDigest {
  const cues = [
    { id: 'a', number: '1', name: 'Overture' },
    { id: 'b', number: '2', name: 'Entrance' }
  ]
  return {
    at: Date.now(),
    show: { id: 'show-1', name: 'Hamlet', cues: cues.length, hash: cueListHash(cues) },
    selectedId: 'b',
    running: [
      {
        cueId: 'a',
        number: '1',
        name: 'Overture',
        type: 'audio',
        state: 'playing',
        positionMs: 12_000,
        durationMs: 180_000
      }
    ],
    prepared: 0,
    ...overrides
  }
}

function hello(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    t: 'hello',
    protocol: REDUNDANCY_PROTOCOL,
    id,
    name: id,
    role: 'live',
    driving: true,
    term: 0,
    token: '',
    ...overrides
  }
}

/** A machine that is not a WinsLab: a socket the test writes the wire with. */
interface RawPeer {
  socket: Socket
  lines: string[]
  say: (message: unknown) => void
  heard: () => Array<Record<string, unknown>>
  close: () => void
}

async function rawPeer(port: number, greeting: Record<string, unknown>): Promise<RawPeer> {
  const socket = createConnection(port, '127.0.0.1')
  const ready = Promise.withResolvers<void>()
  socket.once('connect', () => ready.resolve())
  socket.once('error', error => ready.reject(error))
  await ready.promise
  const peer: RawPeer = {
    socket,
    lines: [],
    say: message => socket.write(encodeMessage(message as never)),
    heard: () => peer.lines.map(line => JSON.parse(line) as Record<string, unknown>),
    close: () => socket.destroy()
  }
  socket.on('data', chunk => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (line !== '') peer.lines.push(line)
    }
  })
  peer.say(greeting)
  return peer
}

/** A stand-in for the other end of a dial: it accepts and says hello. */
async function rawServer(greeting: Record<string, unknown>): Promise<{ port: number; lines: string[]; close: () => Promise<void> }> {
  const lines: string[] = []
  const server: Server = createServer(socket => {
    socket.on('data', chunk => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line !== '') lines.push(line)
      }
    })
    socket.write(encodeMessage(greeting as never))
  })
  const listening = Promise.withResolvers<void>()
  server.listen(0, '127.0.0.1', listening.resolve)
  await listening.promise
  return {
    port: (server.address() as AddressInfo).port,
    lines,
    close: async () => {
      const closed = Promise.withResolvers<void>()
      server.close(() => closed.resolve())
      await closed.promise
    }
  }
}

describe('a machine on its own', () => {
  it('says it is off when the operator has not asked for a pair', async () => {
    const harness = await start('desk-a', 'id-a', { enabled: false })
    expect(harness.health[0]).toEqual({ state: 'stopped', detail: 'disabled' })
    await settle(CHECK_MS * 4)
    expect(harness.events).toEqual([])
  })

  it('listens, and says that nobody is dialling it', async () => {
    const alone = await start('desk-a', 'id-a')
    await until(() => alone.latest()?.status.listening === true, 'a status')
    expect(alone.latest()?.status).toMatchObject({
      enabled: true,
      listening: true,
      driving: true,
      role: 'live',
      peer: null
    })
    expect(alone.latest()?.status.detail).toContain('no partner address')
    expect(alone.health.at(-1)).toEqual({ state: 'running', detail: alone.latest()?.status.detail })
  })

  it('degrades with the port it could not have, rather than failing the show', async () => {
    const taken = createServer()
    const listening = Promise.withResolvers<void>()
    taken.listen(0, '127.0.0.1', listening.resolve)
    await listening.promise
    const port = (taken.address() as AddressInfo).port

    const machine = await start('desk-a', 'id-a', { port })
    await until(() => machine.health.some(entry => entry.state === 'degraded'), 'the degrade')
    expect(machine.health.at(-1)?.detail).toContain(String(port))

    const closed = Promise.withResolvers<void>()
    taken.close(() => closed.resolve())
    await closed.promise
  })

  it('does not take a show it has never heard anyone run', async () => {
    // A backup alone in the room has nothing to pick up, and starting the show by
    // itself would be a worse failure than saying it is alone.
    const alone = await start('desk-b', 'id-b', { role: 'standby', takeover: 'auto' })
    await settle(TIMEOUT_MS * 3)
    expect(alone.takeovers()).toEqual([])
    expect(alone.latest()?.status.driving).toBe(false)
  })

  it('sets the monitor’s line on a change rather than on every look', async () => {
    const machine = await awaiting(await start('desk-a', 'id-a'))
    const settled = machine.health.length
    await settle(CHECK_MS * 8)
    expect(machine.health).toHaveLength(settled)
  })
})

describe('two machines in a pair', () => {
  it('hear each other and each says which half it is', async () => {
    const { live, backup } = await pair()
    await until(() => backup.latest()?.status.peer?.name === 'desk-a', 'the standby to hear the live machine')
    expect(live.latest()?.status.peer?.name).toBe('desk-b')
    expect(backup.latest()?.status.peer?.name).toBe('desk-a')
    expect(live.latest()?.status.peer?.alive).toBe(true)
    expect(live.latest()?.status.driving).toBe(true)
    expect(backup.latest()?.status.driving).toBe(false)
    expect(backup.health.some(entry => entry.state === 'running')).toBe(true)
  })

  it('carries the live machine’s show across, running cue and all', async () => {
    const { live, backup } = await pair()
    await until(() => backup.latest()?.status.peer?.name === 'desk-a', 'the pair to meet')
    // Both machines have the show open — that is the arrangement — and the live one is
    // running a cue out of it.
    await backup.service.command('publish', digest({ running: [], prepared: 2 }))
    await live.service.command('publish', digest())

    await until(() => backup.latest()?.status.peer?.running === 1, 'the running cue to be mirrored')
    expect(backup.latest()?.status.peer).toMatchObject({ inSync: true, running: 1 })
    expect(backup.latest()?.status.peer?.note).toContain('the same show')
  })

  it('says so when the two machines have different shows open', async () => {
    const { live, backup } = await pair()
    await until(() => backup.latest()?.status.peer?.name === 'desk-a', 'the pair to meet')
    await backup.service.command('publish', digest({ running: [] }))
    await live.service.command('publish', digest({ running: [], show: { id: 'other', name: 'Macbeth', cues: 3, hash: 'ffff' } }))

    await until(() => backup.latest()?.status.peer?.note.startsWith('a different show'), 'the mismatch to be noticed')
    expect(backup.latest()?.status.peer?.note).toContain('Macbeth')
  })

  it('takes the show over when the live machine stops answering', async () => {
    const { live, backup } = await pair({ takeover: 'auto' })
    await backup.service.command('publish', digest({ running: [] }))
    await live.service.command('publish', digest())
    await until(() => backup.latest()?.status.peer?.inSync === true, 'the show to be mirrored')

    live.close()

    await until(() => backup.takeovers().length === 1, 'the takeover')
    const notice = backup.takeovers()[0].takeover!
    expect(notice.reason).toBe('the live machine stopped answering')
    expect(notice.term).toBe(1)
    expect(notice.digest?.show.name).toBe('Hamlet')
    expect(notice.silentMs).toBeGreaterThanOrEqual(TIMEOUT_MS)
    expect(backup.latest()?.status.driving).toBe(true)
    expect(backup.latest()?.status.lastEvent).toContain('took the show over')
    expect(backup.health.some(entry => entry.state === 'degraded')).toBe(true)
  })

  it('waits for the operator when the mode is manual, then takes it when asked', async () => {
    const { live, backup } = await pair()
    await until(() => backup.latest()?.status.peer?.name === 'desk-a', 'the pair to meet')
    live.close()

    await until(
      () => backup.latest()?.status.lastEvent?.includes('went quiet') === true,
      'the silence to be noticed'
    )
    expect(backup.takeovers()).toEqual([])
    expect(backup.latest()?.status.driving).toBe(false)
    expect(backup.latest()?.status.detail).toContain('has gone quiet')

    const result = await backup.service.command('takeover') as { adopted: boolean; term: number }
    expect(result.adopted).toBe(true)
    await until(() => backup.takeovers().length === 1, 'the takeover to be announced')
    expect(backup.takeovers()[0].takeover?.reason).toBe('the operator took the show')
    expect(backup.latest()?.status.driving).toBe(true)
  })

  it('hands the show back when it is asked', async () => {
    const { live, backup } = await pair({ takeover: 'auto' })
    await until(() => backup.latest()?.status.peer?.name === 'desk-a', 'the pair to meet')
    live.close()
    await until(() => backup.takeovers().length === 1, 'the takeover')

    await backup.service.command('release')
    await until(() => backup.latest()?.status.driving === false, 'the show to be handed back')
    expect(backup.latest()?.status.lastEvent).toContain('handed back')
  })

  it('does not take a show it is already driving', async () => {
    const live = await start('desk-a', 'id-a', { role: 'live' })
    const result = await live.service.command('takeover') as { adopted: boolean; term: number }
    expect(result).toEqual({ adopted: false, term: 0, driving: true })
    expect(live.takeovers()).toEqual([])
  })

  it('stands down when it hears a partner driving under a higher term', async () => {
    const live = await start('desk-a', 'id-a', { role: 'live' })
    const other = await rawPeer((await awaiting(live)).port, hello('id-b', { term: 2, driving: true }))

    await until(() => live.latest()?.status.driving === false, 'the machine to stand down')
    expect(live.latest()?.status.lastEvent).toContain('is running the show')
    other.close()
  })

  it('ignores a partner that names a higher term without driving', async () => {
    const live = await start('desk-a', 'id-a', { role: 'live' })
    const other = await rawPeer((await awaiting(live)).port, hello('id-b', { term: 5, driving: false }))
    await settle(CHECK_MS * 8)
    expect(live.latest()?.status.driving).toBe(true)
    other.close()
  })
})

describe('who is allowed in', () => {
  it('refuses a machine with the wrong token, and says why', async () => {
    const machine = await start('desk-a', 'id-a', { token: 'sekrit' })
    const stranger = await rawPeer((await awaiting(machine)).port, hello('id-x', { token: 'guess' }))

    await until(() => stranger.heard().some(line => line.t === 'refuse'), 'a refusal')
    expect(stranger.heard().find(line => line.t === 'refuse')?.reason).toBe('the token does not match')
    await until(
      () => machine.latest()?.status.lastEvent?.includes('refused a machine') === true,
      'the refusal to be reported'
    )
    stranger.close()
  })

  it('refuses a machine that speaks another version', async () => {
    const machine = await start('desk-a', 'id-a')
    const stranger = await rawPeer((await awaiting(machine)).port, hello('id-x', { protocol: 99 }))

    await until(() => stranger.heard().some(line => line.t === 'refuse'), 'a refusal')
    expect(String(stranger.heard().find(line => line.t === 'refuse')?.reason)).toContain('version')
    stranger.close()
  })

  it('turns away a third machine while the partner is answering', async () => {
    const live = await start('desk-a', 'id-a', { role: 'live' })
    const partner = await rawPeer((await awaiting(live)).port, hello('id-b'))
    await until(() => live.latest()?.status.peer?.name === 'id-b', 'the partner to be heard')

    const intruder = await rawPeer(live.port, hello('id-c'))
    await until(() => intruder.heard().some(line => line.t === 'refuse'), 'the intruder to be turned away')
    expect(intruder.heard().find(line => line.t === 'refuse')?.reason).toBe("id-b is this machine's partner")
    expect(live.latest()?.status.peer?.name).toBe('id-b')

    partner.close()
    intruder.close()
  })

  it('keeps one of the two sockets a pair opens, the lower id’s one, at both ends', async () => {
    // Both machines dial each other. The machine with the lower id keeps the socket it
    // opened and the other keeps the socket it accepted — which is the same connection,
    // so the pair is left talking once rather than twice.
    const far = await rawServer(hello('id-b'))
    const machine = await start('desk-a', 'id-a', { peerHost: '127.0.0.1', peerPort: far.port })

    const accepted = await rawPeer((await awaiting(machine)).port, hello('id-b'))
    await until(() => accepted.heard().some(line => line.t === 'bye'), 'the second socket to be closed')
    expect(accepted.heard().find(line => line.t === 'bye')?.reason).toBe('the other socket is the one in use')
    // The socket this machine opened is the one in use: the beats go out on it.
    await until(() => far.lines.some(line => line.includes('"t":"beat"')), 'beats on the kept socket')

    accepted.close()
    machine.close()
    await far.close()
  })
})

describe('what the window can ask of it', () => {
  it('keeps the show the window published, and refuses anything that is not one', async () => {
    const machine = await start('desk-a', 'id-a')
    await expect(machine.service.command('publish', { nonsense: true })).rejects.toThrow('not a show mirror')
    await expect(machine.service.command('polish')).rejects.toThrow('Unknown action')

    await machine.service.command('publish', digest({ prepared: 3 }))
    const peer = await rawPeer((await awaiting(machine)).port, hello('id-b', { role: 'standby', driving: false }))
    await until(() => peer.heard().some(line => line.t === 'beat'), 'a beat')
    const beat = peer.heard().findLast(line => line.t === 'beat') as unknown as { digest: RedundancyDigest }
    expect(beat.digest.prepared).toBe(3)
    expect(beat.digest.running[0].positionMs).toBe(12_000)
    peer.close()
  })
})

