// The wireless panel joins the plot to the telemetry and sorts the result so the pack
// in trouble is the one you read first. These tests pin the DOM contract the E2E spec
// targets, the band precedence behind it, and the rule that a pack with no telemetry is
// not a pack in trouble.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RfPanel, packState, rfPercent } from './RfPanel'
import { useStore } from '../../store'
import { demoSource } from '../../utils/rfDemo'
import {
  DEMO_PACK_COUNT,
  DEMO_SOURCE_ID,
  defaultRfThresholds,
  defaultShowSettings
} from '../../types/show'
import type { DeviceState, RfPack, RfPlot, RfThresholds, ShowAlert } from '../../types/show'

const AT = 1_700_000_000_000
const THRESHOLDS = defaultRfThresholds()

function pack(overrides: Partial<RfPack> = {}): RfPack {
  return {
    id: 'p-1',
    label: 'Pack 1',
    channelId: 'ch-1',
    performerId: null,
    notes: '',
    ...overrides
  }
}

function device(overrides: Partial<DeviceState> = {}): DeviceState {
  return {
    id: 'rf:ch-1',
    service: 'rf',
    name: 'Pack 1',
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
    source: 'rf',
    message: 'Pack 1 is down to 5%',
    ...overrides
  }
}

const EMPTY_PLOT: RfPlot = { performers: [], packs: [] }

describe('RfPanel', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.restoreAllMocks()
    useStore.setState({
      showSettings: defaultShowSettings(),
      showDevices: [],
      showAlerts: []
    })
  })

  interface PanelState {
    plot?: RfPlot
    devices?: DeviceState[]
    alerts?: ShowAlert[]
    thresholds?: RfThresholds
  }

  async function show(state: PanelState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        rf: {
          ...defaults.rf,
          plot: state.plot ?? EMPTY_PLOT,
          thresholds: state.thresholds ?? THRESHOLDS
        }
      },
      showDevices: state.devices ?? [],
      showAlerts: state.alerts ?? []
    })
    await act(async () => { root.render(<RfPanel onClose={onClose} />) })
  }

  function texts(selector: string): string[] {
    return [...container.querySelectorAll(selector)].map(el => el.textContent ?? '')
  }

  function rowsByState(): (string | null)[] {
    return [...container.querySelectorAll('.rf-row')].map(row => row.getAttribute('data-state'))
  }

  // Rows move as bands change, so find one by the pack it names, not by position.
  function rowFor(label: string): Element {
    return [...container.querySelectorAll('.rf-row')]
      .find(row => row.querySelector('.rf-name')?.textContent === label)!
  }

  function headerButton(label: string): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>('.rf-btn')]
      .find(button => button.textContent === label)!
  }

  it('reports an empty plot and adds the demo rack from the empty state', async () => {
    await show()

    expect(container.querySelector('.rf-empty')).not.toBeNull()
    expect(texts('.rf-count')).toEqual(['empty'])
    const demo = container.querySelector<HTMLButtonElement>('.rf-demo-btn')!
    expect(demo.textContent).toBe('Add demo rack')

    await act(async () => { demo.click() })

    const settings = useStore.getState().showSettings.rf
    expect(settings.sources.map(source => source.id)).toEqual([DEMO_SOURCE_ID])
    expect(settings.plot.packs).toHaveLength(DEMO_PACK_COUNT)
    expect(container.querySelectorAll('.rf-row')).toHaveLength(DEMO_PACK_COUNT)
    expect(container.querySelector('.rf-empty')).toBeNull()
    expect(texts('.rf-count')).toEqual([`${DEMO_PACK_COUNT} packs`])

    // A second click replaces the source list rather than stacking a duplicate rack.
    await act(async () => { headerButton('Demo rack').click() })
    expect(useStore.getState().showSettings.rf.sources).toHaveLength(1)
    expect(useStore.getState().showSettings.rf.plot.packs).toHaveLength(DEMO_PACK_COUNT)
  })

  it('loads the demo rack from the header, and does not throw a real plot away', async () => {
    await show({ plot: { performers: [], packs: [pack({ id: 'p-mine', label: 'My pack' })] } })

    await act(async () => { headerButton('Demo rack').click() })
    await act(async () => { headerButton('Demo rack').click() })

    const settings = useStore.getState().showSettings.rf
    // The source list is replaced rather than stacked, but a cast somebody typed in is
    // not the demo's to overwrite: only an empty plot gets the demo one.
    expect(settings.sources).toEqual([demoSource()])
    expect(settings.plot.packs.map(entry => entry.label)).toEqual(['My pack'])
  })

  it('loads the demo plot from the header when there is nothing to overwrite', async () => {
    await show()

    await act(async () => { headerButton('Demo rack').click() })

    expect(useStore.getState().showSettings.rf.plot.packs).toHaveLength(DEMO_PACK_COUNT)
  })

  it('closes from the header', async () => {
    await show()

    expect(container.querySelector('.rf-title')?.textContent).toBe('Wireless')
    await act(async () => { headerButton('✕').click() })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('sorts the plot critical, offline, silent, low, ok, unpatched', async () => {
    const plot: RfPlot = {
      performers: [],
      packs: [
        pack({ id: 'p-ok', label: 'Pack ok', channelId: 'ch-ok' }),
        pack({ id: 'p-low-1', label: 'Pack low one', channelId: 'ch-low-1' }),
        pack({ id: 'p-unpatched', label: 'Pack unpatched', channelId: null }),
        pack({ id: 'p-critical', label: 'Pack critical', channelId: 'ch-critical' }),
        pack({ id: 'p-offline', label: 'Pack offline', channelId: 'ch-offline' }),
        pack({ id: 'p-silent', label: 'Pack silent', channelId: 'ch-silent' }),
        pack({ id: 'p-low-2', label: 'Pack low two', channelId: 'ch-low-2' })
      ]
    }
    await show({
      plot,
      devices: [
        device({ id: 'rf:ch-ok', battery: { percent: 80 }, rf: { level: -50, unit: 'dBm' } }),
        device({ id: 'rf:ch-low-1', battery: { percent: 20 } }),
        device({ id: 'rf:ch-low-2', rf: { level: -78, unit: 'dBm' } }),
        device({ id: 'rf:ch-critical', battery: { percent: 5 } }),
        device({ id: 'rf:ch-offline', online: false, battery: { percent: 90 } })
      ]
    })

    expect(rowsByState()).toEqual(['critical', 'offline', 'silent', 'low', 'low', 'ok', 'unpatched'])
    // A band keeps plot order: the two low packs did not swap.
    expect(texts('.rf-name').slice(0, 3)).toEqual(['Pack critical', 'Pack offline', 'Pack silent'])
    expect(texts('.rf-name').slice(3, 5)).toEqual(['Pack low one', 'Pack low two'])
  })

  it('draws each bar from the reading and leaves an unreported cell empty', async () => {
    const plot: RfPlot = {
      performers: [],
      packs: [
        pack({ id: 'p-full', label: 'Pack full', channelId: 'ch-full' }),
        pack({ id: 'p-bare', label: 'Pack bare', channelId: 'ch-bare' }),
        pack({ id: 'p-clamp', label: 'Pack clamp', channelId: 'ch-clamp' })
      ]
    }
    await show({
      plot,
      devices: [
        device({
          id: 'rf:ch-full',
          battery: { percent: 19 },
          rf: { level: -62, unit: 'dBm' },
          frequency: 606.5,
          audio: { level: 40, muted: true }
        }),
        device({ id: 'rf:ch-bare' }),
        device({ id: 'rf:ch-clamp', rf: { level: -100, unit: 'dBm' } })
      ]
    })

    const full = rowFor('Pack full')
    expect(full.querySelector('.rf-battery .rf-bar')?.getAttribute('data-level')).toBe('19')
    expect(full.querySelector<HTMLElement>('.rf-battery .rf-bar')?.style.width).toBe('19%')
    expect(full.querySelector('.rf-battery .rf-bar-value')?.textContent).toBe('19%')
    // -62 dBm sits at 56% of the -90..-40 window.
    expect(full.querySelector('.rf-rf .rf-bar')?.getAttribute('data-level')).toBe('56')
    expect(full.querySelector<HTMLElement>('.rf-rf .rf-bar')?.style.width).toBe('56%')
    expect(full.querySelector('.rf-rf .rf-bar-value')?.textContent).toBe('-62 dBm')
    expect(full.querySelector('.rf-readout')?.textContent).toBe('606.500 MHz muted')

    // No reading means no bar and no number, not a bar sitting at zero.
    const bare = rowFor('Pack bare')
    expect(bare.querySelector('.rf-battery')?.textContent).toBe('')
    expect(bare.querySelector('.rf-battery .rf-bar')).toBeNull()
    expect(bare.querySelector('.rf-rf')?.textContent).toBe('')
    expect(bare.querySelector('.rf-rf .rf-bar')).toBeNull()
    expect(bare.querySelector('.rf-readout')?.textContent).toBe('')

    // Off the bottom of the window pins the bar at empty rather than going negative.
    const clamp = rowFor('Pack clamp')
    expect(clamp.querySelector<HTMLElement>('.rf-rf .rf-bar')?.style.width).toBe('0%')
  })

  it('names the performer, or says unassigned, and shows the role', async () => {
    const plot: RfPlot = {
      performers: [{ id: 'perf-1', name: 'Aldonza', role: 'lead', notes: '' }],
      packs: [
        pack({ id: 'p-cast', label: 'Pack 1', channelId: 'ch-1', performerId: 'perf-1' }),
        pack({ id: 'p-spare', label: 'Pack spare', channelId: 'ch-2', performerId: null })
      ]
    }
    await show({ plot })

    expect(texts('.rf-performer')).toEqual(['Aldonza', 'unassigned'])
    expect(texts('.rf-role')).toEqual(['lead', ''])
  })

  it('shows only the wireless alarms and dismisses one', async () => {
    await show({
      plot: { performers: [], packs: [pack()] },
      alerts: [
        alert({ id: 7, level: 'warning', deviceId: 'rf:ch-1', message: 'Pack 1 is down to 20%' }),
        alert({ id: 8, message: 'Shure API unreachable' }),
        alert({ id: 9, deviceId: 'shure:1', message: 'Receiver offline' })
      ]
    })

    expect(texts('.rf-alert-message')).toEqual(['Pack 1 is down to 20%'])
    expect([...container.querySelectorAll('.rf-alert')].map(el => el.getAttribute('data-level')))
      .toEqual(['warning'])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.rf-alert-dismiss')!.click()
    })

    expect(useStore.getState().showAlerts.map(a => a.id)).toEqual([8, 9])
    expect(container.querySelector('.rf-alerts')).toBeNull()
  })

  it('notes the pack beside its row', async () => {
    await show({ plot: { performers: [], packs: [pack({ notes: 'Spare — swap with 4' })] } })

    expect(texts('.rf-notes')).toEqual(['Spare — swap with 4'])
  })
})

describe('packState', () => {
  it('is unpatched without a channel to listen to', () => {
    expect(packState(pack({ channelId: null }), undefined, THRESHOLDS)).toBe('unpatched')
    expect(packState(pack({ channelId: null }), device(), THRESHOLDS)).toBe('unpatched')
  })

  it('is silent while the channel it is assigned to has not reported', () => {
    // The rack may still be booting and the transmitter may be switched off; either way
    // the pack is assigned and nobody is hearing it, which is not the same as unpatched.
    expect(packState(pack(), undefined, THRESHOLDS)).toBe('silent')
  })

  it('is offline when the device says so, whatever its battery', () => {
    expect(packState(pack(), device({ online: false }), THRESHOLDS)).toBe('offline')
    expect(packState(pack(), device({ online: false, battery: { percent: 3 } }), THRESHOLDS))
      .toBe('offline')
  })

  it('is critical at or below the battery floor', () => {
    expect(packState(pack(), device({ battery: { percent: 10 } }), THRESHOLDS)).toBe('critical')
    expect(packState(pack(), device({ battery: { percent: 9 } }), THRESHOLDS)).toBe('critical')
  })

  it('is low on a weak battery or a weak signal', () => {
    expect(packState(pack(), device({ battery: { percent: 25 } }), THRESHOLDS)).toBe('low')
    expect(packState(pack(), device({ rf: { level: -75, unit: 'dBm' } }), THRESHOLDS)).toBe('low')
  })

  it('is ok when every reading is healthy', () => {
    expect(
      packState(pack(), device({ battery: { percent: 80 }, rf: { level: -50, unit: 'dBm' } }), THRESHOLDS)
    ).toBe('ok')
    // No reading to pull it down: an unmeasured pack is not a warning.
    expect(packState(pack(), device(), THRESHOLDS)).toBe('ok')
  })

  it('reads the dBm window pinned at both ends', () => {
    expect(rfPercent(-90)).toBe(0)
    expect(rfPercent(-62)).toBe(56)
    expect(rfPercent(-40)).toBe(100)
    expect(rfPercent(-115)).toBe(0)
    expect(rfPercent(-10)).toBe(100)
  })
})
