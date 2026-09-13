// The monitor reports what the services report and nothing else: a wired pack must
// not grow a fake RF line, a healthy listener must not offer a restart, and the alarm
// strip must not exist when there is nothing to alarm about. These tests pin the DOM
// contract the E2E spec targets as well as those readout rules.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MonitorPanel, describeEvent } from './MonitorPanel'
import { useStore } from '../../store'
import type { MidiMessageKind } from '../../types/cue'
import type { DeviceState, ServiceStatus, ShowAlert, ShowEvent } from '../../types/show'

const AT = 1_700_000_000_000

function service(overrides: Partial<ServiceStatus> = {}): ServiceStatus {
  return {
    id: 'osc-in',
    label: 'OSC in',
    state: 'running',
    detail: 'listening on 0.0.0.0:53000',
    since: AT,
    ...overrides
  }
}

function device(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    id: 'shure:1',
    service: 'shure',
    name: 'SM58 #1',
    online: true,
    lastSeen: AT,
    ...overrides
  }
}

function alert(overrides: Partial<ShowAlert> = {}): ShowAlert {
  return {
    id: 1,
    at: AT,
    level: 'critical',
    source: 'shure',
    message: 'Shure API unreachable',
    ...overrides
  }
}

describe('MonitorPanel', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    ;(window.winslab.show.restart as unknown as Mock).mockResolvedValue({ ok: true })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    useStore.setState({ showServices: [], showDevices: [], showAlerts: [], showEvents: [] })
  })

  interface ShowState {
    services?: ServiceStatus[]
    devices?: DeviceState[]
    alerts?: ShowAlert[]
    events?: ShowEvent[]
  }

  async function show(state: ShowState = {}): Promise<void> {
    useStore.setState({
      showServices: state.services ?? [],
      showDevices: state.devices ?? [],
      showAlerts: state.alerts ?? [],
      showEvents: state.events ?? []
    })
    await act(async () => { root.render(<MonitorPanel onClose={onClose} />) })
  }

  function texts(selector: string): string[] {
    return [...container.querySelectorAll(selector)].map(el => el.textContent ?? '')
  }

  it('reports each column as empty and shows no alarm strip', async () => {
    await show()

    // What came in and when is the log's; the monitor is what the show is made of now.
    expect(texts('.monitor-empty')).toEqual(['No services.', 'No devices.'])
    expect(container.querySelectorAll('.monitor-column')).toHaveLength(2)
    expect(container.querySelector('.monitor-alerts')).toBeNull()
    expect(texts('.monitor-count')).toEqual(['0 services · 0 devices'])
  })

  it('counts what it is showing', async () => {
    await show({ services: [service()], devices: [device(), device({ id: 'shure:2' })] })
    expect(texts('.monitor-count')).toEqual(['1 service · 2 devices'])
  })

  it('closes from the header', async () => {
    await show()

    expect(container.querySelector('.monitor-title')?.textContent).toBe('Show monitor')
    const close = [...container.querySelectorAll<HTMLButtonElement>('.monitor-btn')]
      .find(b => b.textContent === '✕')!

    await act(async () => { close.click() })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers a restart only for a service that is not running', async () => {
    await show({
      services: [
        service(),
        service({ id: 'shure', label: 'Shure API', state: 'failed', detail: 'connection refused' }),
        service({ id: 'midi-in', label: 'MIDI in', state: 'degraded', detail: 'no input ports' })
      ]
    })

    const rows = [...container.querySelectorAll('.monitor-service')]
    expect(rows.map(row => row.getAttribute('data-state'))).toEqual(['running', 'failed', 'degraded'])
    expect(texts('.monitor-service-name')).toEqual(['OSC in', 'Shure API', 'MIDI in'])
    expect(texts('.monitor-service-detail')).toEqual([
      'listening on 0.0.0.0:53000',
      'connection refused',
      'no input ports'
    ])

    expect(rows[0].querySelector('.monitor-service-restart')).toBeNull()
    expect(rows[1].querySelector('.monitor-service-restart')).not.toBeNull()
    expect(rows[2].querySelector('.monitor-service-restart')).not.toBeNull()

    // A refused restart reports through the service's next state event, so the
    // rejection from the call itself is swallowed rather than left dangling.
    ;(window.winslab.show.restart as unknown as Mock).mockRejectedValue(new Error('no such service'))
    const restart = rows[1].querySelector<HTMLButtonElement>('.monitor-service-restart')!
    await act(async () => { restart.click() })

    expect(window.winslab.show.restart).toHaveBeenCalledTimes(1)
    expect(window.winslab.show.restart).toHaveBeenCalledWith('shure')
  })

  it('renders only the measurements a device reports', async () => {
    await show({
      devices: [
        device({
          id: 'a',
          name: 'SM58 #1',
          battery: { percent: 42, minutes: 18 },
          rf: { level: -62, unit: 'dBm' },
          audio: { level: 80 },
          frequency: 606.5
        }),
        device({ id: 'b', name: 'IEM pack', battery: { percent: 90 } }),
        device({ id: 'c', name: 'ULXD', rf: { level: 80, unit: 'percent' }, audio: { level: 0, muted: true } }),
        device({ id: 'd', name: 'Wired pack', online: false })
      ]
    })

    const rows = [...container.querySelectorAll('.monitor-device')]
    expect(rows.map(row => row.getAttribute('data-online'))).toEqual(['true', 'true', 'true', 'false'])
    expect(texts('.monitor-device-name')).toEqual(['SM58 #1', 'IEM pack', 'ULXD', 'Wired pack'])
    expect(texts('.monitor-device-readout')).toEqual([
      '42% ≈18m -62 dBm 80% 606.500 MHz',
      '90%',
      '80% 0% muted',
      ''
    ])
  })

  it('shows each alarm at its level and dismisses it', async () => {
    await show({
      alerts: [
        alert({ id: 7, level: 'warning', message: 'Shure API unreachable' }),
        alert({ id: 8, level: 'info', message: 'OSC listener started' })
      ]
    })

    const rows = [...container.querySelectorAll('.monitor-alert')]
    expect(rows.map(row => row.getAttribute('data-level'))).toEqual(['warning', 'info'])
    expect(texts('.monitor-alert-message')).toEqual(['Shure API unreachable', 'OSC listener started'])

    await act(async () => { container.querySelector<HTMLButtonElement>('.monitor-alert-dismiss')!.click() })

    expect(useStore.getState().showAlerts.map(a => a.id)).toEqual([8])
    expect(texts('.monitor-alert-message')).toEqual(['OSC listener started'])

    await act(async () => { container.querySelector<HTMLButtonElement>('.monitor-alert-dismiss')!.click() })

    expect(container.querySelector('.monitor-alerts')).toBeNull()
  })
})

describe('describeEvent', () => {
  function midi(message: MidiMessageKind): string {
    return describeEvent({ kind: 'midi', at: AT, device: 'Launchpad', message })
  }

  it('names the sender and the arguments of an OSC message', () => {
    expect(describeEvent({
      kind: 'osc',
      at: AT,
      from: '192.168.1.4:8000',
      address: '/cue/1/go',
      args: [{ type: 'i', value: 1 }, { type: 'f', value: 2 }]
    })).toBe('/cue/1/go from 192.168.1.4:8000 1, 2')

    expect(describeEvent({
      kind: 'osc',
      at: AT,
      from: '192.168.1.4:8000',
      address: '/cue/1/go',
      args: []
    })).toBe('/cue/1/go from 192.168.1.4:8000')
  })

  it('spells out every MIDI message', () => {
    expect(midi({ kind: 'noteOn', channel: 1, note: 60, velocity: 100 })).toBe('noteOn ch1 60/100')
    expect(midi({ kind: 'noteOff', channel: 2, note: 61, velocity: 0 })).toBe('noteOff ch2 61/0')
    expect(midi({ kind: 'cc', channel: 3, controller: 7, value: 64 })).toBe('cc ch3 7/64')
    expect(midi({ kind: 'programChange', channel: 4, program: 12 })).toBe('programChange ch4 12')
    expect(midi({ kind: 'sysex', data: [240, 65, 247] })).toBe('sysex F0 41 F7')
  })

  it('reports a device as online or offline', () => {
    expect(describeEvent({ kind: 'device', at: AT, device: device() })).toBe('SM58 #1 online')
    expect(describeEvent({ kind: 'device', at: AT, device: device({ online: false }) }))
      .toBe('SM58 #1 offline')
  })

  it('leads an alert with its level', () => {
    expect(describeEvent({ kind: 'alert', at: AT, alert: alert({ level: 'warning' }) }))
      .toBe('warning: Shure API unreachable')
  })

  it('reports a service as label, state and detail', () => {
    expect(describeEvent({ kind: 'service', at: AT, service: service() }))
      .toBe('OSC in running: listening on 0.0.0.0:53000')
    expect(describeEvent({ kind: 'service', at: AT, service: service({ state: 'stopped', detail: '' }) }))
      .toBe('OSC in stopped')
  })
})
