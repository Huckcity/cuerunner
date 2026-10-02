// The cue that closes a radio mic. What it decides is which channel and which way; what happens at
// the receiver is tested where the receiver is. These hold what it offers — the packs the show
// knows, named the way the show names them — and that it never offers a toggle.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MicInspector } from './MicInspector'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../../../shared/show'
import type { DeviceState, Performer, RfPack } from '../../../../shared/show'
import type { MicCue } from '../../../../shared/cue'

const SERIAL = '5364000906'
const CH0 = `ew-dx:${SERIAL}:0`
const CH1 = `ew-dx:${SERIAL}:1`

function micCue(overrides: Partial<MicCue> = {}): MicCue {
  return {
    id: 'mi1', number: '14', name: 'Mic Cue', type: 'mic',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
    advance: 'none', isArmed: true, notes: '',
    channelId: '', label: '', action: 'mute',
    ...overrides
  }
}

const device = (id: string, name: string, overrides: Partial<DeviceState> = {}): DeviceState => ({
  id, service: 'rf', name, online: true, lastSeen: 1, ...overrides
})
const pack = (label: string, channelId: string | null, performerId: string | null = null): RfPack => ({
  id: `p-${label}`, label, channelId, performerId, notes: ''
})

describe('MicInspector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  function show(cue: MicCue, state: { devices?: DeviceState[]; packs?: RfPack[]; performers?: Performer[] } = {}): void {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        rf: { ...defaults.rf, plot: { packs: state.packs ?? [] } },
        cast: { ...defaults.cast, performers: state.performers ?? [] }
      },
      showDevices: state.devices ?? [],
      cues: [cue]
    })
    act(() => { root.render(<MicInspector cue={cue} />) })
  }

  const options = (): string[] => [...container.querySelectorAll<HTMLOptionElement>('#mic-cue-channel option')].map(o => o.textContent ?? '')
  const select = (id: string): HTMLSelectElement => container.querySelector<HTMLSelectElement>(id)!
  function choose(el: HTMLSelectElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    act(() => {
      setter.call(el, value)
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('offers the EW-DX channels that are reporting, by what the receiver calls them', () => {
    show(micCue(), { devices: [device(`rf:${CH0}`, '37'), device(`rf:${CH1}`, '38')] })

    expect(options()).toEqual(['— none —', '37', '38'])
  })

  it('names a patched pack by the pack and who wears it, and still offers it when its pack is switched off', () => {
    show(micCue(), {
      packs: [pack('Pack 7', CH0, 'who')],
      performers: [{ id: 'who', name: 'Aldonza', role: '', notes: '', channelId: null }]
    })

    expect(options()).toEqual(['— none —', 'Pack 7 (Aldonza)'])
  })

  it('shows both when a patched pack is also reporting, so the operator can tell which channel it is', () => {
    show(micCue(), { packs: [pack('Pack 7', CH0)], devices: [device(`rf:${CH0}`, '37')] })

    expect(options()).toEqual(['— none —', 'Pack 7 · 37'])
  })

  it('offers only what can be muted from here: no other service\'s device, and no other kind of source', () => {
    show(micCue(), {
      devices: [
        device('presence:amp', 'Amp', { service: 'presence' }),
        device('rf:demo-pack-1', 'Demo pack 1'),
        device(`rf:${CH0}`, '37')
      ],
      packs: [pack('Spare', null), pack('Demo', 'demo-pack-1')]
    })

    expect(options()).toEqual(['— none —', '37'])
  })

  it('writes the channel and the name it was chosen under into the cue', () => {
    show(micCue(), { devices: [device(`rf:${CH0}`, '37')] })

    choose(select('#mic-cue-channel'), CH0)

    expect(useStore.getState().cues[0]).toMatchObject({ channelId: CH0, label: '37' })
  })

  it('offers Mute and Unmute and nothing like a toggle, and writes the choice', () => {
    show(micCue())
    expect([...select('#mic-cue-action').options].map(o => o.textContent)).toEqual(['Mute', 'Unmute'])

    choose(select('#mic-cue-action'), 'unmute')
    expect((useStore.getState().cues[0] as MicCue).action).toBe('unmute')
  })

  it('keeps a mic the show no longer has in the list, said as not found, rather than moving the cue off it', () => {
    show(micCue({ channelId: CH1, label: 'Lead (38)' }), { devices: [device(`rf:${CH0}`, '37')] })

    expect(options()).toEqual(['— none —', 'Lead (38) — not found', '37'])
    expect(select('#mic-cue-channel').value).toBe(CH1)
  })

  it('says where to add a receiver when there is none to choose', () => {
    show(micCue())
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('No EW-DX receivers yet')
  })

  it('says what it does once there is something to choose', () => {
    show(micCue(), { devices: [device(`rf:${CH0}`, '37')] })
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('then asks it')
  })
})
