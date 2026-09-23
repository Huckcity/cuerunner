// The SQ's native service: what the show's settings decide, and what the panels are told.
// The session itself belongs to the engine and is held to a real desk in
// SqNativeEngine.test.ts — here the session is a stand-in, because what this class decides
// is when to open, what to publish, and when to let go.
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { SqNativeService, type NativeSession } from './SqNativeService'
import { ShowBus } from '../bus/ShowBus'
import type { ServiceContext } from '../bus/ServiceHost'
import type { DeviceState, ShowSettings } from '../../shared/show'
import { defaultShowSettings } from '../../shared/show'
import { drainMainErrors } from '../errors'

/** The three things the service talks to, with nothing behind them. */
function fakeSession(): NativeSession {
  return { open: vi.fn(), closeAll: vi.fn(), onStatus: null }
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

function harness(): Harness {
  const session = fakeSession()
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
    // Nothing may be published after the show has been told the services are down: the next
    // licence check could be suspending everything.
    expect(session.onStatus).toBeNull()
    expect(row(bus)).toMatchObject({ service: 'sq-native', online: false })
  })
})
