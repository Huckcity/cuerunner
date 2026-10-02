// The wireless panel joins the plot to the telemetry and sorts the result so the pack
// in trouble is the one you read first. These tests pin the DOM contract the E2E spec
// targets, the band precedence behind it, and the rule that a pack with no telemetry is
// not a pack in trouble.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RfPanel, packState, rfPercent } from './RfPanel'
import { useStore } from '../../store'
import {
  DEMO_PACK_COUNT,
  DEMO_SOURCE_ID,
  defaultRfThresholds,
  defaultShowSettings
} from '../../../../shared/show'
import type { DeviceState, RfPack, Performer, RfPlot, RfThresholds, ShowAlert } from '../../../../shared/show'

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

const EMPTY_PLOT: RfPlot = { packs: [] }

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
      showSettingsTab: null,
      showDevices: [],
      showAlerts: []
    })
  })

  interface PanelState {
    plot?: RfPlot
    performers?: Performer[]
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
        },
        cast: { ...defaults.cast, performers: state.performers ?? [] }
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
    expect(useStore.getState().showSettings.cast.performers).toHaveLength(DEMO_PACK_COUNT)
    expect(container.querySelectorAll('.rf-row')).toHaveLength(DEMO_PACK_COUNT)
    expect(container.querySelector('.rf-empty')).toBeNull()
    expect(texts('.rf-count')).toEqual([`${DEMO_PACK_COUNT} packs`])

    // Once there is a plot the demo is no longer offered: the header is the show's.
    expect(container.querySelector('.rf-demo-btn')).toBeNull()
    expect(headerButton('Demo rack')).toBeUndefined()
  })

  it('closes from the header', async () => {
    await show()

    expect(container.querySelector('.rf-title')?.textContent).toBe('Wireless')
    await act(async () => { headerButton('✕').click() })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('opens the mic plot tab of Show Settings from Edit plot', async () => {
    // The plot editor is a tab of Show Settings rather than a dialog of this panel's
    // own, so the button asks the app for that tab and has nothing to render itself.
    await show()

    await act(async () => { headerButton('Edit plot…').click() })

    expect(useStore.getState().showSettingsTab).toBe('mic-plot')
  })

  it('sorts the plot critical, offline, silent, low, ok, unpatched', async () => {
    const plot: RfPlot = {
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
      packs: [
        pack({ id: 'p-cast', label: 'Pack 1', channelId: 'ch-1', performerId: 'perf-1' }),
        pack({ id: 'p-spare', label: 'Pack spare', channelId: 'ch-2', performerId: null })
      ]
    }
    const performers: Performer[] = [{
      id: 'perf-1', name: 'Aldonza', role: 'lead', notes: '', channelId: null
    }]
    await show({ plot, performers })

    expect(texts('.rf-performer')).toEqual(['Aldonza', 'unassigned'])
    expect(texts('.rf-role')).toEqual(['lead', ''])
  })

  it('shows only the wireless alarms and dismisses one', async () => {
    await show({
      plot: { packs: [pack()] },
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

  it('shows a channel that is reporting with no plot at all, under the name its receiver gives it', async () => {
    // A receiver found on the network and nothing typed in: the panel is not empty.
    await show({
      // -83 dBm is below the show's line, and the receiver says the link is fine: its word stands.
      devices: [device({ id: 'rf:ew-dx:5364000906:0', name: '37', battery: { percent: 76 }, rf: { level: -83, unit: 'dBm', weak: false } })]
    })

    expect(container.querySelector('.rf-empty')).toBeNull()
    expect(texts('.rf-count')).toEqual(['1 packs'])
    expect(texts('.rf-name')).toEqual(['37'])
    // Nobody is "unassigned" on a show that has no plot: that would be noise on every row.
    expect(texts('.rf-performer')).toEqual([''])
    expect(rowsByState()).toEqual(['ok'])
    expect(rowFor('37').getAttribute('data-plot')).toBe('false')
  })

  it('shows a reporting channel beside a plot that does not mention it, and sorts it by its band', async () => {
    await show({
      plot: { packs: [pack({ id: 'p-1', label: 'Aldonza', channelId: 'ch-1' })] },
      devices: [
        device({ id: 'rf:ch-1', name: 'Aldonza', battery: { percent: 80 } }),
        device({ id: 'rf:spare', name: 'Spare', battery: { percent: 4 } })
      ]
    })

    // The spare pack is in trouble, so it leads, plot or no plot.
    expect(texts('.rf-name')).toEqual(['Spare', 'Aldonza'])
    expect(rowFor('Spare').getAttribute('data-state')).toBe('critical')
    expect(rowFor('Spare').getAttribute('data-plot')).toBe('false')
    expect(rowFor('Aldonza').getAttribute('data-plot')).toBe('true')
    expect(texts('.rf-count')).toEqual(['2 packs'])
  })

  it('does not show a channel twice when the plot already claims it', async () => {
    await show({
      plot: { packs: [pack({ id: 'p-1', label: 'Aldonza', channelId: 'ch-1' })] },
      devices: [device({ id: 'rf:ch-1', name: 'Aldonza', battery: { percent: 80 } })]
    })

    expect(texts('.rf-name')).toEqual(['Aldonza'])
  })

  it('leaves another service\'s devices out of the wireless panel', async () => {
    await show({ devices: [device({ id: 'presence:amp', service: 'presence', name: 'Amp 1' })] })

    expect(container.querySelector('.rf-empty')).not.toBeNull()
  })

  it('puts what the device complains of under the pack, the critical ones marked', async () => {
    await show({
      plot: { packs: [pack({ id: 'p-1', label: 'Aldonza', channelId: 'ch-1' })] },
      devices: [device({
        id: 'rf:ch-1',
        name: 'Aldonza',
        battery: { percent: 90 },
        warnings: [{ text: 'encryption error — no audio', critical: true }, { text: 'audio clipping' }]
      })]
    })

    const warnings = [...rowFor('Aldonza').querySelectorAll('.rf-warning')]
    expect(warnings.map(node => node.textContent)).toEqual(['encryption error — no audio', 'audio clipping'])
    expect(warnings.map(node => node.getAttribute('data-critical'))).toEqual(['true', 'false'])
    expect(rowFor('Aldonza').getAttribute('data-state')).toBe('critical')
  })

  it('has no line of complaints for a pack with none', async () => {
    await show({
      plot: { packs: [pack({ id: 'p-1', label: 'Aldonza', channelId: 'ch-1' })] },
      devices: [device({ id: 'rf:ch-1', name: 'Aldonza', battery: { percent: 90 } })]
    })

    expect(rowFor('Aldonza').querySelector('.rf-warnings')).toBeNull()
  })

  describe('the check', () => {
    const rack = (devices: DeviceState[]): PanelState => ({
      plot: {
        packs: [
          pack({ id: 'p-1', label: 'Aldonza', channelId: 'ch-1' }),
          pack({ id: 'p-2', label: 'Lead', channelId: 'ch-2' })
        ]
      },
      devices
    })
    const verdict = (): string => container.querySelector('.rf-check-verdict')?.textContent ?? ''
    const checkRows = (): string[] => [...container.querySelectorAll('.rf-check-row')].map(row => row.textContent ?? '')

    it('is a button that swaps the list for the check and back, and says Live while it is open', async () => {
      await show(rack([device({ id: 'rf:ch-1' }), device({ id: 'rf:ch-2' })]))
      expect(headerButton('Check')).toBeDefined()

      await act(async () => { headerButton('Check').click() })
      expect(container.querySelector('.rf-check')).not.toBeNull()
      expect(container.querySelector('.rf-row')).toBeNull()

      await act(async () => { headerButton('Live').click() })
      expect(container.querySelector('.rf-check')).toBeNull()
      expect(container.querySelectorAll('.rf-row')).toHaveLength(2)
    })

    it('says every pack is ready, and nothing under it, when they are', async () => {
      await show(rack([device({ id: 'rf:ch-1' }), device({ id: 'rf:ch-2' })]))
      await act(async () => { headerButton('Check').click() })

      expect(verdict()).toBe('All 2 packs ready.')
      expect(checkRows()).toEqual([])
      expect(container.querySelector('.rf-check')!.getAttribute('data-verdict')).toBe('ready')
    })

    it('lists what is not ready, worst first, with the performer and why', async () => {
      await show({
        ...rack([
          device({ id: 'rf:ch-1', battery: { percent: 20 } }),
          device({ id: 'rf:ch-2', warnings: [{ text: 'encryption error — no audio', critical: true }] })
        ]),
        performers: [{ id: 'who', name: 'Aldonza Test', role: '', notes: '', channelId: null }]
      })
      await act(async () => { headerButton('Check').click() })

      expect(verdict()).toBe('0 of 2 packs ready — 1 not ready.')
      expect(checkRows()).toEqual(['Leadencryption error — no audio', 'Aldonzabattery 20%'])
      expect(container.querySelector('.rf-check')!.getAttribute('data-verdict')).toBe('not-ready')
      expect(container.querySelectorAll('.rf-check-row')[0].getAttribute('data-readiness')).toBe('not-ready')
    })

    it('says worth a look, not not ready, when nothing is worse than that', async () => {
      await show(rack([device({ id: 'rf:ch-1', battery: { percent: 20 } }), device({ id: 'rf:ch-2' })]))
      await act(async () => { headerButton('Check').click() })

      expect(verdict()).toBe('1 of 2 packs ready — worth a look at the rest.')
      expect(container.querySelector('.rf-check')!.getAttribute('data-verdict')).toBe('attention')
    })

    it('changes as the readings do, which is how it goes green', async () => {
      await show(rack([device({ id: 'rf:ch-1', battery: { percent: 5 } }), device({ id: 'rf:ch-2' })]))
      await act(async () => { headerButton('Check').click() })
      expect(verdict()).toContain('not ready')

      await act(async () => {
        useStore.setState({ showDevices: [device({ id: 'rf:ch-1', battery: { percent: 100 } }), device({ id: 'rf:ch-2' })] })
      })
      expect(verdict()).toBe('All 2 packs ready.')
    })

    it('asks about a channel that is reporting even when no plot names it', async () => {
      await show({ devices: [device({ id: 'rf:spare', name: 'Spare', battery: { percent: 4 } })] })
      await act(async () => { headerButton('Check').click() })

      expect(verdict()).toBe('0 of 1 pack ready — 1 not ready.')
      expect(checkRows()).toEqual(['Sparebattery 4%'])
    })

    it('says there is nothing to check for an empty rack, rather than that it is ready', async () => {
      await show()
      await act(async () => { headerButton('Check').click() })

      expect(verdict()).toBe('No packs to check. Add a source or enter the plot.')
    })

    it('copies the check as text when it is the check that is open', async () => {
      const writeText = vi.fn(() => Promise.resolve())
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      await show(rack([device({ id: 'rf:ch-1', battery: { percent: 5 } }), device({ id: 'rf:ch-2' })]))
      await act(async () => { headerButton('Check').click() })

      await act(async () => { headerButton('Copy').click() })

      expect(writeText).toHaveBeenCalledWith(['1 of 2 packs ready.', 'NOT READY Aldonza: battery 5%'].join('\n'))
    })
  })

  it('notes the pack beside its row', async () => {
    await show({ plot: { packs: [pack({ notes: 'Spare — swap with 4' })] } })

    expect(texts('.rf-notes')).toEqual(['Spare — swap with 4'])
  })
})

describe('packState, what the device complains of', () => {
  const linked = pack()

  it('is critical for a complaint that makes the pack unusable, whatever its battery says', () => {
    const keys = device({ battery: { percent: 90 }, warnings: [{ text: 'encryption error — no audio', critical: true }] })
    expect(packState(linked, keys, THRESHOLDS)).toBe('critical')
  })

  it('is low for a complaint worth knowing about, and ok again without it', () => {
    expect(packState(linked, device({ warnings: [{ text: 'audio clipping' }] }), THRESHOLDS)).toBe('low')
    expect(packState(linked, device({ warnings: [] }), THRESHOLDS)).toBe('ok')
  })
})

describe('packState, a source\'s own verdict', () => {
  const linked = pack()

  it('trusts a receiver that says its link is fine over the show\'s dBm line', () => {
    const fine = device({ rf: { level: -90, unit: 'dBm', weak: false } })
    expect(packState(linked, fine, THRESHOLDS)).toBe('ok')
  })

  it('trusts a receiver that says its link is weak over a strong-looking number', () => {
    const weak = device({ rf: { level: -40, unit: 'dBm', weak: true } })
    expect(packState(linked, weak, THRESHOLDS)).toBe('low')
  })

  it('falls back to the show\'s line when the source gave no verdict', () => {
    expect(packState(linked, device({ rf: { level: -90, unit: 'dBm' } }), THRESHOLDS)).toBe('low')
    expect(packState(linked, device({ rf: { level: -60, unit: 'dBm' } }), THRESHOLDS)).toBe('ok')
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
