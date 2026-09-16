// The desk service: what the show's settings decide, and what the panels are told. The
// socket itself belongs to the engine and is held to a real desk in MidiTcpEngine.test.ts
// — here the link is a stand-in, because what this class decides is when to open, what to
// publish, and when to let go.
import { describe, it, expect, vi } from 'vitest'
import { MidiTcpService, type DeskLink } from './MidiTcpService'
import { ShowBus } from '../bus/ShowBus'
import type { ServiceContext } from '../bus/ServiceHost'
import type { ShowEvent, ShowSettings } from '../../renderer/src/types/show'
import { defaultShowSettings } from '../../renderer/src/types/show'

type MidiEvent = Extract<ShowEvent, { kind: 'midi' }>

/** The four things the service talks to, with nothing behind them. */
function fakeLink(): DeskLink {
  return { open: vi.fn(), closeAll: vi.fn(), onMessage: null, onStatus: null }
}

const DESK = '10.0.0.5'

function settings(desk: Partial<ShowSettings['desk']> = {}): ShowSettings {
  return {
    ...defaultShowSettings(),
    desk: { ...defaultShowSettings().desk, kind: 'midi-tcp', host: DESK, ...desk }
  }
}

interface Harness {
  service: MidiTcpService
  link: DeskLink
  context: ServiceContext
  setState: ReturnType<typeof vi.fn>
  bus: ShowBus
}

function harness(): Harness {
  const link = fakeLink()
  const service = new MidiTcpService(link)
  const bus = new ShowBus({ now: () => 1000 })
  const setState = vi.fn()
  return { service, link, context: { bus, setState }, setState, bus }
}

function midiEvents(bus: ShowBus): MidiEvent[] {
  return bus.snapshot().events.filter((event): event is MidiEvent => event.kind === 'midi')
}

describe('MidiTcpService', () => {
  it('dials the desk the show names, on the desk’s own MIDI port', () => {
    const { service, link, context, setState } = harness()

    service.start(context, settings())

    expect(link.open).toHaveBeenCalledWith('10.0.0.5', 51325)
    expect(setState).toHaveBeenCalledWith('starting', 'dialling 10.0.0.5:51325')
  })

  it('does nothing when the show drives no desk over the network', () => {
    const { service, link, context, setState } = harness()

    service.start(context, settings({ kind: 'none' }))

    expect(link.open).not.toHaveBeenCalled()
    expect(setState).toHaveBeenCalledWith('stopped', 'the show drives no desk over the network')
  })

  it('says what is missing rather than dialling an address nobody typed', () => {
    const { service, link, context, setState } = harness()

    service.start(context, settings({ host: '  ' }))

    expect(link.open).not.toHaveBeenCalled()
    expect(setState).toHaveBeenCalledWith('degraded', 'no desk address')
  })

  it('reports the desk as a device, and its state with it', () => {
    const { service, link, context, setState, bus } = harness()
    service.start(context, settings())
    if (!link.onStatus) throw new Error('the service did not take the link’s status')

    link.onStatus('10.0.0.5:51325', true)

    expect(setState).toHaveBeenCalledWith('running', 'connected to 10.0.0.5:51325')
    expect(bus.snapshot().devices.find(device => device.id === 'midi-tcp:10.0.0.5:51325'))
      .toMatchObject({ service: 'midi-tcp', name: '10.0.0.5:51325', online: true })

    link.onStatus('10.0.0.5:51325', false, 'connect ECONNREFUSED')

    // One alarm, naming the desk the operator typed, so the panel says which one to go
    // and look at.
    expect(bus.snapshot().alerts).toEqual([
      expect.objectContaining({
        level: 'warning',
        source: 'midi-tcp',
        message: 'Desk 10.0.0.5:51325 is not answering'
      })
    ])
    expect(setState).toHaveBeenCalledWith('degraded', '10.0.0.5:51325: connect ECONNREFUSED')
  })

  it('puts what the desk sends into the show, under the desk’s own name', () => {
    const { service, link, context, bus } = harness()
    service.start(context, settings())
    if (!link.onMessage) throw new Error('the service did not take the link’s messages')

    link.onMessage('10.0.0.5:51325', { kind: 'programChange', channel: 1, program: 6 })

    expect(midiEvents(bus)).toEqual([
      expect.objectContaining({
        kind: 'midi',
        device: '10.0.0.5:51325',
        message: { kind: 'programChange', channel: 1, program: 6 }
      })
    ])
  })

  it('lets go of the desk, and of the link, when the show stops', () => {
    const { service, link, context } = harness()
    service.start(context, settings())

    service.stop()

    expect(link.closeAll).toHaveBeenCalled()
    // Nothing may be published after the show has been told the services are down: the
    // next licence check could be suspending everything, and a stale desk would keep
    // talking into a bus nobody is reading.
    expect(link.onMessage).toBeNull()
    expect(link.onStatus).toBeNull()
  })

  it('takes the desk’s row offline when the service stops', () => {
    // The engine's close path cannot report: the handlers are dropped before the link is
    // let go. A row left reading "online" for a desk nobody is talking to is the panel
    // lying about the one thing it shows, in the state where it matters most.
    const { service, link, context, bus } = harness()
    service.start(context, settings())
    if (!link.onStatus) throw new Error('the service did not take the link’s status')
    link.onStatus('10.0.0.5:51325', true)

    service.stop()

    expect(bus.snapshot().devices.find(device => device.id === 'midi-tcp:10.0.0.5:51325'))
      .toMatchObject({ service: 'midi-tcp', online: false })
  })
})
