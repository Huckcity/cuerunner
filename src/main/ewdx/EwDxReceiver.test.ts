// A receiver is followed by its serial, not by its address: when the address stops answering the
// machine looks for the serial, and carries on from wherever it is. The clients here are scripted
// and the credentials are a real file, so what is held is the decision — when to look, what to
// believe about what was found, and what the machine is left remembering.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EwDxReceiver, addressOf } from './EwDxReceiver'
import type { ClientParts, ReceiverClient } from './EwDxReceiver'
import { EwDxError } from './EwDxClient'
import { createEwDxCredentials } from './credentials'
import type { EwDxCredentials } from './credentials'
import type { DiscoverResult } from './discovery'
import type { EwDxFound } from '../../shared/ipc/show'
import type { TelemetryChannel } from '../../shared/show'

const SERIAL = '5364000906'
const TARGET = '192.168.0.194'
const ORIGIN = 'https://192.168.0.194'
const PACK: TelemetryChannel = { id: 'ew-dx:5364000906:0', name: '37', batteryPercent: 60 }

const found = (address: string, serial = SERIAL, port = 443): EwDxFound => ({
  address, port, name: 'EWDXEM4D-001B663BDD13', product: 'EWDX4CHDS', model: 'EW-DX EM 4 Dante', serial
})

/** A client whose answers are written by the test, remembering how it was made. */
class ScriptedClient implements ReceiverClient {
  started = false
  stopped = false
  constructor(readonly parts: ClientParts, private readonly answer: () => Promise<TelemetryChannel[]>) {}
  start(): void { this.started = true }
  stop(): void { this.stopped = true }
  snapshot(): Promise<TelemetryChannel[]> { return this.answer() }
  setMute?: (channel: number, mute: boolean) => Promise<void>
}

let dir = ''
let credentials: EwDxCredentials
let clients: ScriptedClient[]
/** What each origin's client says: the origins a receiver can be reached at are the test's to name. */
let reachable: Record<string, () => Promise<TelemetryChannel[]>>
let discover: ReturnType<typeof vi.fn>
let clock: number

const gone = (kind: 'unreachable' | 'wrong-receiver' | 'refused' = 'unreachable') => () =>
  Promise.reject(new EwDxError(kind === 'refused' ? 'password rejected' : 'connection refused', kind))
const answers = () => Promise.resolve([PACK])

function receiver(overrides: { target?: string; origin?: string; seekEveryMs?: number } = {}): EwDxReceiver {
  return new EwDxReceiver({
    sourceId: 'rack-a',
    target: overrides.target ?? TARGET,
    origin: overrides.origin ?? ORIGIN,
    credentials,
    makeClient: parts => {
      const client = new ScriptedClient(parts, reachable[parts.origin] ?? gone())
      clients.push(client)
      return client
    },
    discover: discover as () => Promise<DiscoverResult>,
    now: () => clock,
    seekEveryMs: overrides.seekEveryMs ?? 30_000
  })
}

/**
 * Lets a look that was started in the background finish: it is not awaited by the poll that
 * caused it. For a case that expects the look to find nothing — there is no artifact to wait on.
 */
const settled = (): Promise<void> => vi.waitFor(() => expect(discover).toHaveBeenCalled()).then(() => new Promise(r => setTimeout(r, 20)))

/**
 * Waits for the move a look in the background makes: the second client. A fixed pause after
 * the look is a race the Linux runners lose — the client is made after the credential is
 * written — so a case that expects a move waits on the move.
 */
const followed = (): Promise<void> => vi.waitFor(() => expect(clients).toHaveLength(2))

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ewdx-receiver-'))
  credentials = createEwDxCredentials({
    filePath: join(dir, 'ew-dx.json'),
    cipher: { available: () => false, encrypt: t => t, decrypt: t => t }
  })
  await credentials.setPassword('rack-a', 'pw')
  clients = []
  reachable = { [ORIGIN]: answers }
  discover = vi.fn(async (): Promise<DiscoverResult> => ({ receivers: [], error: null }))
  clock = 1_000_000
})

// A write the test started may still be open when it ends, and Windows will not delete a folder
// with a file open in it: the cleanup retries, as a real quit would simply wait.
afterEach(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }))

describe('EwDxReceiver', () => {
  it('starts a client at the address the show names, and remembers which receiver answered', async () => {
    const live = receiver()
    live.start()

    expect(clients[0].parts.origin).toBe(ORIGIN)
    expect(clients[0].parts.expectedSerial).toBeUndefined()
    clients[0].parts.onSerial(SERIAL)
    // The artifact, not the in-memory value: what is remembered is what is on disk, and a test that
    // stops at the memory leaves the write running under its own cleanup.
    await vi.waitFor(async () => {
      expect(JSON.parse(await readFile(join(dir, 'ew-dx.json'), 'utf8')).sources['rack-a'].serial).toBe(SERIAL)
    })

    // The next time it is made for that receiver, and will refuse another.
    const again = receiver()
    again.start()
    expect(clients[1].parts.expectedSerial).toBe(SERIAL)
  })

  it('does not let a write that failed while remembering a serial become an unhandled rejection', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const failing = { ...credentials, remember: () => Promise.reject(new Error('EPERM: the file is held')) } as unknown as EwDxCredentials
      const live = new EwDxReceiver({
        sourceId: 'rack-a', target: TARGET, origin: ORIGIN, credentials: failing,
        makeClient: parts => {
          const client = new ScriptedClient(parts, answers)
          clients.push(client)
          return client
        },
        discover: discover as () => Promise<DiscoverResult>
      })
      live.start()

      clients[0].parts.onSerial(SERIAL)
      await new Promise(resolve => setTimeout(resolve, 30))

      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })

  it('follows the serial to a new address when the old one stops answering, and says where it went', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    discover.mockResolvedValue({ receivers: [found('192.168.0.210')], error: null })
    reachable['https://192.168.0.210'] = answers
    reachable[ORIGIN] = gone()
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow('connection refused')
    await followed()

    // A second client, at the address the serial was found at, and the old one let go.
    expect(clients).toHaveLength(2)
    expect(clients[0].stopped).toBe(true)
    expect(clients[1].parts.origin).toBe('https://192.168.0.210')
    expect(clients[1].parts.expectedSerial).toBe(SERIAL)
    expect(credentials.get('rack-a')?.moved).toEqual({ from: TARGET, to: '192.168.0.210' })
    await expect(live.snapshot(0)).resolves.toEqual([PACK])
  })

  it('writes an address on an unusual port the way a source is written', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    discover.mockResolvedValue({ receivers: [found('10.0.0.7', SERIAL, 8443)], error: null })
    reachable[ORIGIN] = gone()
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow()
    await followed()

    expect(credentials.get('rack-a')?.moved).toEqual({ from: TARGET, to: '10.0.0.7:8443' })
    expect(addressOf({ address: '10.0.0.7', port: 8443 })).toBe('10.0.0.7:8443')
  })

  it('looks for the original when a different receiver has taken its address', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    discover.mockResolvedValue({ receivers: [found('192.168.0.177'), found(TARGET, 'someone-else')], error: null })
    reachable[ORIGIN] = gone('wrong-receiver')
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow()
    await followed()

    expect(clients[1].parts.origin).toBe('https://192.168.0.177')
  })

  it('does not look for a receiver it has never reached, because there is no serial to look for', async () => {
    reachable[ORIGIN] = gone()
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(discover).not.toHaveBeenCalled()
  })

  it('does not look when the receiver refused: moving does not change what it chose to say', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    reachable[ORIGIN] = gone('refused')
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow('password rejected')
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(discover).not.toHaveBeenCalled()
  })

  it('looks no more than once in a window however many polls fail, and again after it', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    reachable[ORIGIN] = gone()
    const live = receiver({ seekEveryMs: 30_000 })
    live.start()

    for (let poll = 0; poll < 5; poll += 1) {
      await expect(live.snapshot(0)).rejects.toThrow()
      clock += 2000
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    expect(discover).toHaveBeenCalledTimes(1)

    clock += 30_000
    await expect(live.snapshot(0)).rejects.toThrow()
    await vi.waitFor(() => expect(discover).toHaveBeenCalledTimes(2))
  })

  it('stays where it is when the serial is nowhere to be found, or is where it already looked', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    discover.mockResolvedValue({ receivers: [found('192.168.0.150', 'someone-else')], error: null })
    reachable[ORIGIN] = gone()
    const live = receiver({ seekEveryMs: 0 })
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow()
    await settled()
    expect(clients).toHaveLength(1)

    // Found at the very address that is failing: moving there would change nothing.
    discover.mockResolvedValue({ receivers: [found(TARGET)], error: null })
    await expect(live.snapshot(0)).rejects.toThrow()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(clients).toHaveLength(1)
    expect(credentials.get('rack-a')?.moved).toBeUndefined()
  })

  it('carries on failing as it was when the network cannot be asked', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    discover.mockRejectedValue(new Error('ENETUNREACH'))
    reachable[ORIGIN] = gone()
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow('connection refused')
    await settled()

    expect(clients).toHaveLength(1)
  })

  it('starts the next run where the receiver was found, while the show still names the same address', async () => {
    await credentials.remember('rack-a', { serial: SERIAL, moved: { from: TARGET, to: '192.168.0.210' } })
    const live = receiver()
    live.start()

    expect(clients[0].parts.origin).toBe('https://192.168.0.210')
  })

  it('lets an address the operator typed since overrule a stale memory of a move', async () => {
    await credentials.remember('rack-a', { serial: SERIAL, moved: { from: TARGET, to: '192.168.0.210' } })
    const live = receiver({ target: '10.9.9.9', origin: 'https://10.9.9.9' })
    live.start()

    expect(clients[0].parts.origin).toBe('https://10.9.9.9')
  })

  it('forgets a move when the receiver is found back at the address the show names', async () => {
    await credentials.remember('rack-a', { serial: SERIAL, moved: { from: TARGET, to: '192.168.0.210' } })
    discover.mockResolvedValue({ receivers: [found(TARGET)], error: null })
    reachable['https://192.168.0.210'] = gone()
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow()
    await followed()

    expect(credentials.get('rack-a')?.moved).toBeUndefined()
    expect(clients[1].parts.origin).toBe(ORIGIN)
  })

  it('mutes through the client it has now, and says so when it has none', async () => {
    const live = receiver()
    await expect(live.setMute(0, true)).rejects.toThrow('receiver is not started')

    live.start()
    const setMute = vi.fn().mockResolvedValue(undefined)
    clients[0].setMute = setMute
    await live.setMute(2, true)
    expect(setMute).toHaveBeenCalledWith(2, true)
  })

  it('opens nothing once it has been stopped, even if a look finishes after', async () => {
    await credentials.remember('rack-a', { serial: SERIAL })
    let finish: (result: DiscoverResult) => void = () => undefined
    discover.mockReturnValue(new Promise(resolve => { finish = resolve }))
    reachable[ORIGIN] = gone()
    const live = receiver()
    live.start()

    await expect(live.snapshot(0)).rejects.toThrow()
    live.stop()
    finish({ receivers: [found('192.168.0.210')], error: null })
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(clients).toHaveLength(1)
    expect(credentials.get('rack-a')?.moved).toBeUndefined()
  })
})
