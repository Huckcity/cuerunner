// The SQ's native service: what the show's settings decide, what the panels are told, and what
// a membership command answers. The session itself belongs to the engine and is held to a real
// desk in SqNativeEngine.test.ts — here the session is a stand-in, because what this class
// decides is when to open, what to publish, what a payload is, and when to let go.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SqNativeService, switchOrderFromEnv, type DeskTraffic, type NativeSession } from './SqNativeService'
import type { DeskLinkTap } from '../midi/MidiTcpEngine'
import type { MidiMessageKind } from '../../shared/cue'
import { ShowBus } from '../bus/ShowBus'
import type { ServiceContext } from '../bus/ServiceHost'
import type { DeviceState, ShowSettings, SqMembershipIntent } from '../../shared/show'
import { defaultShowSettings } from '../../shared/show'
import { drainMainErrors } from '../errors'

/**
 * The four things the service talks to, with nothing behind them. A membership answers the
 * count the case needs, because how many frames went out is the engine's to decide.
 */
function fakeSession(frames = 2): NativeSession {
  return {
    open: vi.fn(),
    closeAll: vi.fn(),
    sendMembership: vi.fn(() => frames),
    // All of them or none, as one write is: `frames` 0 is a session that is not up.
    sendMemberships: vi.fn((intents: readonly SqMembershipIntent[]) => frames === 0 ? 0 : intents.length * 2),
    onStatus: null
  }
}

const DESK = '10.0.0.5'
const DEVICE = `${DESK}:51326`
const ROW = `sq-native:${DEVICE}`

function settings(desk: Partial<ShowSettings['desk']> = {}): ShowSettings {
  return {
    ...defaultShowSettings(),
    desk: { ...defaultShowSettings().desk, kind: 'midi-tcp', profile: 'sq', host: DESK, ...desk }
  }
}

interface Harness {
  service: SqNativeService
  session: NativeSession
  context: ServiceContext
  setState: Mock
  bus: ShowBus
}

function harness(frames = 2): Harness {
  const session = fakeSession(frames)
  const service = new SqNativeService(session)
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, session, context: { bus, setState }, setState, bus }
}

function row(bus: ShowBus): DeviceState | undefined {
  return bus.snapshot().devices.find(device => device.id === ROW)
}

beforeEach(() => {
  // Whatever a previous case reported through the app's own log is not this case's business.
  drainMainErrors()
})

describe('SqNativeService', () => {
  it('opens the session with the desk the show names, on the desk’s own control port', () => {
    const { service, session, context, setState } = harness()

    service.start(context, settings())

    expect(session.open).toHaveBeenCalledWith(DESK)
    expect(setState).toHaveBeenCalledWith('starting', `dialling ${DEVICE}`)
  })

  it('does nothing when the show drives no desk over the network', () => {
    const { service, session, context, setState } = harness()

    service.start(context, settings({ kind: 'none' }))

    expect(session.open).not.toHaveBeenCalled()
    expect(setState).toHaveBeenCalledWith('stopped', 'the show drives no SQ over its own control service')
  })

  it('leaves a desk that is not an SQ alone rather than dialling it', () => {
    // What an SQ takes on its own control port is not what an Avantis takes, so the other
    // profile is the other service's business — and so is the MIDI link's.
    const { service, session, context, setState } = harness()

    service.start(context, settings({ profile: 'avantis' }))

    expect(session.open).not.toHaveBeenCalled()
    expect(setState).toHaveBeenCalledWith('stopped', 'the show drives no SQ over its own control service')
  })

  it('says what is missing rather than dialling an address nobody typed', () => {
    const { service, session, context, setState, bus } = harness()

    service.start(context, settings({ host: '  ' }))

    expect(session.open).not.toHaveBeenCalled()
    expect(setState).toHaveBeenCalledWith('stopped', 'no desk address')
    expect(bus.snapshot().alerts).toEqual([])
  })

  it('reports the desk as a device, with no field nothing renders', () => {
    const { service, session, context, setState, bus } = harness()
    service.start(context, settings())
    if (!session.onStatus) throw new Error('the service did not take the session’s status')

    session.onStatus(true, `session open with ${DEVICE}`)

    expect(setState).toHaveBeenCalledWith('running', `session open with ${DEVICE}`)
    const device = row(bus)
    expect(device).toMatchObject({ service: 'sq-native', name: DEVICE, model: 'Desk (SQ native control)', online: true })
    // `DeviceState.detail` is rendered nowhere, so a row that carried the fault in one would
    // be a fault nobody could read.
    expect(Object.keys(device ?? {})).not.toContain('detail')
  })

  it('says a desk that is not answering, once, naming the address to go and look at', () => {
    const { service, session, context, setState, bus } = harness()
    service.start(context, settings())
    if (!session.onStatus) throw new Error('the service did not take the session’s status')
    session.onStatus(true, `session open with ${DEVICE}`)

    session.onStatus(false, 'connect ECONNREFUSED', 'unreachable')

    expect(setState).toHaveBeenCalledWith('degraded', `${DEVICE}: connect ECONNREFUSED`)
    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({ level: 'warning', source: 'sq-native', message: `Desk ${DEVICE} is not answering` })
    ])
    expect(row(bus)).toMatchObject({ online: false })
    // A dial that reached nothing is not a desk that needs resetting, and the log says
    // nothing that the alarm has not already said.
    expect(drainMainErrors()).toEqual([])
  })

  it('says a session lost without its goodbye in the row, the alarm and the log', () => {
    // The state §6 measured: the desk takes a client again only after it is reset, and the
    // operator has one row and one alarm to read that from — and the log, which is where a
    // fault that arrives while nobody is looking at the panel is still found later.
    const { service, session, context, setState, bus } = harness()
    service.start(context, settings())
    if (!session.onStatus) throw new Error('the service did not take the session’s status')
    session.onStatus(true, `session open with ${DEVICE}`)

    session.onStatus(false, 'the pings went unanswered', 'lost')

    expect(setState).toHaveBeenCalledWith(
      'degraded',
      `${DEVICE}: the session was lost without its goodbye (the pings went unanswered) — the desk needs a reset`
    )
    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'sq-native',
        message: `Desk ${DEVICE} needs a reset — the session was lost without its goodbye (the pings went unanswered)`
      })
    ])
    expect(drainMainErrors()).toEqual([
      `[main] Desk ${DEVICE} needs a reset — the session was lost without its goodbye (the pings went unanswered)`
    ])
    // The desk's row goes offline without a reason of its own: the reason is the sentence
    // above, and the row has nowhere to put one.
    expect(row(bus)).toMatchObject({ online: false })
  })

  it('lets go of the desk, and of the session, when the show stops', () => {
    const { service, session, context, bus } = harness()
    service.start(context, settings())
    if (!session.onStatus) throw new Error('the service did not take the session’s status')
    session.onStatus(true, `session open with ${DEVICE}`)

    service.stop()

    expect(session.closeAll).toHaveBeenCalled()
    // Nothing may be published after the show has been told the services are down.
    expect(session.onStatus).toBeNull()
    expect(row(bus)).toMatchObject({ service: 'sq-native', online: false })
  })
})

/**
 * The one thing the renderer asks this service to write. The payload arrives as `unknown` from
 * the window, so these cases are about what the class does with a shape it did not choose — the
 * frames themselves belong to the engine, and are held to a real desk in SqNativeEngine.test.ts.
 */
describe('a membership command', () => {
  it('writes the intent it was sent, and answers how many frames went out', () => {
    const { service, session, context } = harness()
    service.start(context, settings())

    const answer = service.command('membership', { channel: 3, dca: 5, placed: true, rides: true })

    // What the engine reads is the intent that was checked field by field; what the renderer
    // reads is this answer, which becomes `ShowCommandResult.result`.
    expect(session.sendMembership).toHaveBeenCalledWith({ channel: 3, dca: 5, placed: true, rides: true })
    expect(answer).toEqual({ ok: true, frames: 2 })
  })

  it('refuses a payload that is not a membership, naming what was wrong and writing nothing', () => {
    const { service, session, context } = harness()
    service.start(context, settings())

    const refused: Array<[unknown, string]> = [
      [undefined, 'needs a payload'],
      ['membership', 'needs a payload'],
      [{ dca: 1, placed: true, rides: true }, 'needs a channel'],
      [{ channel: 0, dca: 1, placed: true, rides: true }, 'at or past 1, not 0'],
      [{ channel: '1', dca: 1, placed: true, rides: true }, 'at or past 1, not "1"'],
      [{ channel: 257, dca: 1, placed: true, rides: true }, 'no larger than 256, not 257'],
      [{ channel: 1, dca: 2.5, placed: true, rides: true }, 'at or past 1, not 2.5'],
      [{ channel: 1, dca: 257, placed: true, rides: true }, 'no larger than 256, not 257'],
      [{ channel: 1, dca: 1, placed: true }, 'needs rides'],
      [{ channel: 1, dca: 1, placed: 'yes', rides: true }, 'placed to be true or false, not "yes"']
    ]

    for (const [payload, said] of refused) {
      const answer = service.command('membership', payload)
      expect(answer.ok, `for ${JSON.stringify(payload) ?? String(payload)}`).toBe(false)
      expect(answer.frames).toBeUndefined()
      expect(answer.error).toContain(said)
    }
    // Not one of them reached the engine: a frame is never built from a number nobody checked.
    expect(session.sendMembership).not.toHaveBeenCalled()
  })

  it('answers that the session is not up when the engine wrote nothing', () => {
    const { service, session, context } = harness(0)
    service.start(context, settings())

    const answer = service.command('membership', { channel: 1, dca: 1, placed: false, rides: false })

    expect(session.sendMembership).toHaveBeenCalledTimes(1)
    expect(answer.ok).toBe(false)
    expect(answer.error).toContain('the SQ session is not up')
    // A refusal carries no count: nothing went out, and the recall reports the sentence.
    expect(answer.frames).toBeUndefined()
  })

  it('refuses a membership that went as one frame, saying which half is missing', () => {
    // A write is the pair and then the channel's flag: a count of one is the connection
    // going between them, and a half-written write recorded as landed is a mic the next
    // recall will not place again.
    const { service, session, context } = harness(1)
    service.start(context, settings())

    const answer = service.command('membership', { channel: 1, dca: 1, placed: true, rides: true })

    expect(session.sendMembership).toHaveBeenCalledTimes(1)
    expect(answer.ok).toBe(false)
    expect(answer.error).toContain('only the pair went')
    expect(answer.error).toContain('the channel’s flag did not')
    expect(answer.frames).toBeUndefined()
  })

  it('refuses an action it does not take', () => {
    // The convention the tree's services share: an action a service does not have is a fault
    // rather than a refusal, and the host turns the throw into one for whoever asked.
    const { service, session, context } = harness()
    service.start(context, settings())

    expect(() => service.command('reboot')).toThrow('Unknown action "reboot"')
    expect(session.sendMembership).not.toHaveBeenCalled()
  })
})

describe('highest wins', () => {
  /**
   * The desk's MIDI link as the service sees it: one tap to hear the masters through, and a
   * send that records the gets rather than dialling anything.
   */
  function fakeTraffic(): DeskTraffic & { tapped: DeskLinkTap[]; sent: MidiMessageKind[][] } {
    const tapped: DeskLinkTap[] = []
    const sent: MidiMessageKind[][] = []
    return {
      tapped,
      sent,
      tap: vi.fn((tap: DeskLinkTap) => {
        tapped.push(tap)
        return () => { tapped.splice(tapped.indexOf(tap), 1) }
      }),
      send: vi.fn((_host: string, _port: number, messages: MidiMessageKind[]) => {
        sent.push(messages)
        return Promise.resolve({ ok: true })
      })
    }
  }

  /** The MIDI link's own name for the desk: the show's default MIDI port, 51325. */
  const LINK = `${DESK}:51325`

  /** One DCA master's level as the desk reports it, on the show's channel. */
  function level(tap: DeskLinkTap, dca: number, value: number, device = LINK): void {
    for (const [controller, data] of [[0x63, 0x4f], [0x62, 0x1f + dca], [0x06, value >> 7], [0x26, value & 0x7f]]) {
      tap.message?.(device, { kind: 'cc', channel: 1, controller, value: data })
    }
  }

  /**
   * Every membership the service wrote, in the order it wrote them, each write in brackets:
   * a switch is one write, and a recall's own pair is a write of its own.
   */
  function written(session: NativeSession): string[] {
    const one = session.sendMembership as Mock
    const many = session.sendMemberships as Mock
    const calls = [
      ...one.mock.calls.map((call, at) => ({ order: one.mock.invocationCallOrder[at], writes: [call[0]] })),
      ...many.mock.calls.map((call, at) => ({ order: many.mock.invocationCallOrder[at], writes: call[0] }))
    ].sort((a, b) => a.order - b.order)
    return calls.map(({ writes }) => (writes as SqMembershipIntent[])
      .map(write => `ch${write.channel} ${write.placed ? 'onto' : 'off'} ${write.dca}`).join(' + '))
  }

  function started(frames = 2) {
    const session = fakeSession(frames)
    const traffic = fakeTraffic()
    const service = new SqNativeService(session, traffic)
    const { context } = harness()
    service.start(context, settings())
    return { session, traffic, service, tap: traffic.tapped[0] }
  }

  it('puts a followed channel on its first fader, and asks the desk where the masters stand', async () => {
    const { session, traffic, service } = started()

    expect(service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true }))
      .toEqual({ ok: true, frames: 2 })

    expect(written(session)).toEqual(['ch1 onto 1'])
    expect(session.sendMembership).not.toHaveBeenCalled()
    expect(traffic.send).toHaveBeenCalledTimes(1)
    expect(traffic.send).toHaveBeenCalledWith(DESK, 51325, expect.arrayContaining([
      { kind: 'cc', channel: 1, controller: 0x60, value: 0x7f }
    ]))
    // A second followed channel does not ask again: one link asks once.
    service.command('rides', { channel: 2, dcas: [1, 2], wrote: [], highest: true })
    await Promise.resolve()
    expect(traffic.send).toHaveBeenCalledTimes(1)
  })

  it('moves the channel to whichever fader the desk reports highest, as it reports it', () => {
    const { session, service, tap } = started()
    service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true })
    level(tap, 1, 13000)
    level(tap, 2, 10000)
    expect(written(session)).toEqual(['ch1 onto 1'])

    // The switch goes as one write: the desk never applies the moment between its halves.
    level(tap, 1, 9000)
    expect(written(session)).toEqual(['ch1 onto 1', 'ch1 onto 2 + ch1 off 1'])
  })

  it('hears only the desk the show names', () => {
    const { session, service, tap } = started()
    service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true })
    level(tap, 2, 16000, '10.0.0.9:51325')
    expect(written(session)).toEqual(['ch1 onto 1'])
  })

  it('lets a channel go when a recall writes it as a pair', () => {
    const { session, service, tap } = started()
    service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true })
    service.command('membership', { channel: 1, dca: 3, placed: true, rides: true })
    level(tap, 2, 16000)
    expect(written(session)).toEqual(['ch1 onto 1', 'ch1 onto 3'])
  })

  it('lets a channel go when a recall writes its pairs as one write', () => {
    const { session, service, tap } = started()
    service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true })
    service.command('memberships', { memberships: [
      { channel: 1, dca: 1, placed: false, rides: true },
      { channel: 1, dca: 3, placed: true, rides: true }
    ] })
    level(tap, 2, 16000)
    expect(written(session)).toEqual(['ch1 onto 1', 'ch1 off 1 + ch1 onto 3'])
  })

  it('asks again when the link comes back, because the faders may have moved while it was gone', () => {
    const { traffic, service, tap } = started()
    service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true })
    tap.status?.(LINK, false)
    tap.status?.(LINK, true)
    expect(traffic.send).toHaveBeenCalledTimes(2)
  })

  it('answers a session that is not up, and switches when it is', () => {
    const { session, service, tap } = started(0)
    expect(service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true })).toEqual({
      ok: false,
      error: 'the SQ session is not up — the desk is not answering, so no membership was written'
    })
    ;(session.sendMemberships as Mock).mockImplementation((intents: readonly SqMembershipIntent[]) => intents.length * 2)
    level(tap, 2, 12000)
    expect(written(session).at(-1)).toBe('ch1 onto 2')
  })

  it('refuses a payload that is not one channel’s faders', () => {
    const { session, service } = started()
    expect(service.command('rides', { channel: 1, dcas: [0], wrote: [], highest: true })).toEqual({
      ok: false,
      error: 'a channel’s faders need whole numbers from 1 to 256, not 0'
    })
    expect(service.command('rides', { channel: 1, dcas: [1], wrote: 'all', highest: true })).toEqual({
      ok: false,
      error: 'a channel’s last-told faders need to be a list of fader numbers'
    })
    expect(service.command('rides', { channel: 1, dcas: [1], wrote: [] })).toEqual({
      ok: false,
      error: 'a channel’s faders need highest to be true or false'
    })
    expect(session.sendMemberships).not.toHaveBeenCalled()
  })

  it('refuses when the show drives no SQ, and stops listening when the show stops', () => {
    const session = fakeSession()
    const traffic = fakeTraffic()
    const service = new SqNativeService(session, traffic)
    const { context } = harness()
    service.start(context, settings({ profile: 'avantis' }))
    expect(service.command('rides', { channel: 1, dcas: [1, 2], wrote: [], highest: true }))
      .toEqual({ ok: false, error: 'the show drives no SQ over its own control service' })

    service.start(context, settings())
    expect(traffic.tapped).toHaveLength(1)
    service.stop()
    expect(traffic.tapped).toHaveLength(0)
  })

  it('reads the switch order from the machine, placing first unless told otherwise', () => {
    expect(switchOrderFromEnv(undefined)).toBe('assign-first')
    expect(switchOrderFromEnv('clear-first')).toBe('clear-first')
    expect(switchOrderFromEnv('sideways')).toBe('assign-first')
  })
})

describe('a recall’s memberships', () => {
  it('writes every pair as one write, and answers how many frames went', () => {
    const { service, session, context } = harness()
    service.start(context, settings())

    const pairs = [
      { channel: 1, dca: 1, placed: false, rides: true },
      { channel: 1, dca: 3, placed: true, rides: true }
    ]
    expect(service.command('memberships', { memberships: pairs })).toEqual({ ok: true, frames: 4 })
    expect(session.sendMemberships).toHaveBeenCalledTimes(1)
    expect(session.sendMemberships).toHaveBeenCalledWith(pairs)
    expect(session.sendMembership).not.toHaveBeenCalled()
  })

  it('writes none of them when any pair is not one, naming what was wrong', () => {
    const { service, session, context } = harness()
    service.start(context, settings())

    expect(service.command('memberships', {
      memberships: [{ channel: 1, dca: 1, placed: true, rides: true }, { channel: 0, dca: 1, placed: true, rides: true }]
    })).toEqual({ ok: false, error: 'a membership needs a channel as a whole number at or past 1, not 0' })
    expect(service.command('memberships', { memberships: [] }))
      .toEqual({ ok: false, error: 'a recall’s memberships need a list of them' })
    expect(service.command('memberships', undefined))
      .toEqual({ ok: false, error: 'a recall’s memberships need a list of them' })
    expect(session.sendMemberships).not.toHaveBeenCalled()
  })

  it('answers that the session is not up when nothing went', () => {
    const { service, context } = harness(0)
    service.start(context, settings())

    expect(service.command('memberships', { memberships: [{ channel: 1, dca: 1, placed: true, rides: true }] }))
      .toEqual({
        ok: false,
        error: 'the SQ session is not up — the desk is not answering, so no membership was written'
      })
  })
})
