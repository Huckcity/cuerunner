// The scene panel is the operator's side of the desk: it says who is open and whether
// the desk has caught up, and it moves the desk only when a row or the head is pressed.
// These tests pin the DOM contract the E2E spec targets, the pending rule, and the two
// ways the panel sends anything at all — through the real engine and the mocked bridge.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenesPanel } from './ScenesPanel'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import type {
  DeskChannel,
  MicScene,
  RfPack,
  RfPlot,
  ScenesSettings
} from '../../types/show'

const PORT = 'Desk'

const ENSEMBLE: DeskChannel = {
  id: 'dca-ensemble',
  label: 'DCA 1 — Ensemble',
  unmute: { kind: 'midi', portName: PORT, message: { kind: 'noteOn', channel: 0, note: 60, velocity: 127 } },
  mute: { kind: 'midi', portName: PORT, message: { kind: 'noteOff', channel: 0, note: 60, velocity: 0 } }
}

const BAND: DeskChannel = {
  id: 'dca-band',
  label: 'DCA 2 — Band',
  unmute: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2', args: [1] },
  mute: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2', args: [0] }
}

// A group the plot does not drive: no mic feeds it, so a recall must leave it alone.
const SPARE: DeskChannel = { id: 'dca-spare', label: 'DCA 3 — Spare', mute: null, unmute: null }

function pack(id: string, label: string, deskChannelId: string): RfPack {
  return { id, label, channelId: null, performerId: null, notes: '', deskChannelId }
}

const PACKS: RfPack[] = [
  pack('p1', 'Pack 1', 'dca-ensemble'),
  pack('p2', 'Pack 2', 'dca-ensemble'),
  pack('p3', 'Pack 3', 'dca-band')
]

// p1 is on the ensemble, p3 on the band: recalling Open opens the ensemble and closes
// the band, which is exactly the handful of messages the feature exists to send.
const PLOT: RfPlot = { performers: [], packs: PACKS }

function scene(id: string, name: string, live: string[]): MicScene {
  return { id, name, live, notes: '' }
}

const OPENING = scene('s1', 'Opening', ['p1'])
const INTERVAL = scene('s2', 'Interval', ['p3'])

function settings(list: MicScene[], channels: DeskChannel[] = [ENSEMBLE, BAND, SPARE]): ScenesSettings {
  return { channels, list }
}

describe('ScenesPanel', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: Mock
  let midiSend: Mock
  let oscSend: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn()

    midiSend = window.winslab.midi.send as unknown as Mock
    oscSend = window.winslab.osc.send as unknown as Mock
    midiSend.mockReset().mockResolvedValue({ ok: true })
    oscSend.mockReset().mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    midiSend.mockReset()
    oscSend.mockReset()
    useStore.setState({
      showSettings: defaultShowSettings(),
      deskState: {},
      deskSceneId: null
    })
  })

  interface PanelState {
    scenes?: ScenesSettings
    plot?: RfPlot
    deskState?: Record<string, boolean>
    deskSceneId?: string | null
  }

  async function show(state: PanelState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        rf: { ...defaults.rf, plot: state.plot ?? defaults.rf.plot },
        scenes: state.scenes ?? defaults.scenes
      },
      deskState: state.deskState ?? {},
      deskSceneId: state.deskSceneId ?? null
    })
    await act(async () => {
      root.render(<ScenesPanel onClose={onClose} />)
    })
  }

  function rowFor(name: string): Element {
    const row = [...container.querySelectorAll('.scene-row')].find(
      candidate => candidate.querySelector('.scene-name')?.textContent === name
    )
    if (!row) throw new Error(`no scene row named ${name}`)
    return row
  }

  function deskRowFor(label: string): Element {
    const row = [...container.querySelectorAll('.desk-row')].find(
      candidate => candidate.querySelector('.desk-label')?.textContent === label
    )
    if (!row) throw new Error(`no desk row labelled ${label}`)
    return row
  }

  function headerButton(label: string): HTMLButtonElement {
    const button = [...container.querySelectorAll<HTMLButtonElement>('.scenes-btn')].find(
      candidate => candidate.textContent?.trim() === label
    )
    if (!button) throw new Error(`no header button ${label}`)
    return button
  }

  it('reports no scenes and offers the editor from the empty state', async () => {
    await show({ scenes: settings([]) })

    expect(container.querySelector('.scenes-count')?.textContent).toBe('no scenes')
    expect(container.querySelector('.scenes-empty')?.textContent)
      .toContain('No scenes yet. A scene is who is open on stage.')

    const edit = container.querySelector<HTMLButtonElement>('.scenes-edit-btn')
    expect(edit).not.toBeNull()
    await act(async () => { edit?.click() })
    expect(container.querySelector('.scene-dialog')).not.toBeNull()
  })

  it('names each scene and counts its mics', async () => {
    await show({
      scenes: settings([scene('s1', 'Opening', ['p1', 'p2', 'p3']), scene('s2', 'Interval', [])])
    })

    const rows = [...container.querySelectorAll('.scene-row')]
    expect(rows.map(row => row.querySelector('.scene-name')?.textContent))
      .toEqual(['Opening', 'Interval'])
    expect(rows.map(row => row.querySelector('.scene-live')?.textContent))
      .toEqual(['3 mics', 'no mics'])
  })

  it('marks the scene the desk is in from the desk scene id', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': false, 'dca-band': true },
      deskSceneId: 's2'
    })

    expect(rowFor('Opening').getAttribute('data-current')).toBe('false')
    expect(rowFor('Interval').getAttribute('data-current')).toBe('true')
  })

  it('marks a scene not applied, and leaves the current scene alone', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    const opening = rowFor('Opening')
    expect(opening.getAttribute('data-pending')).toBe('false')
    expect(opening.querySelector('.scene-pending')).toBeNull()

    const interval = rowFor('Interval')
    expect(interval.getAttribute('data-pending')).toBe('true')
    expect(interval.querySelector('.scene-pending')?.textContent).toBe('not applied')
  })

  it('sends exactly the changes a recall needs and remembers where the desk was left', async () => {
    await show({ scenes: settings([OPENING, INTERVAL]), plot: PLOT })

    expect(rowFor('Opening').getAttribute('data-pending')).toBe('true')

    const recall = rowFor('Opening').querySelector<HTMLButtonElement>('.scene-recall')
    await act(async () => { recall?.click() })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOn', channel: 0, note: 60, velocity: 127 }]
    })
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(oscSend).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 9000,
      address: '/dca/2',
      args: [{ type: 'i', value: 0 }]
    })

    expect(useStore.getState().deskState)
      .toEqual({ 'dca-ensemble': true, 'dca-band': false })
    expect(useStore.getState().deskSceneId).toBe('s1')
    expect(rowFor('Opening').getAttribute('data-pending')).toBe('false')
  })

  it('closes everything the plot drives from Mics off', async () => {
    await show({
      scenes: settings([OPENING]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    await act(async () => { headerButton('Mics off').click() })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOff', channel: 0, note: 60, velocity: 0 }]
    })
    // The band was already shut, so it is not mentioned again.
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskState)
      .toEqual({ 'dca-ensemble': false, 'dca-band': false })
    expect(useStore.getState().deskSceneId).toBeNull()
  })

  it('reads each desk group as live, muted, or off the plot', async () => {
    await show({
      scenes: settings([OPENING]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    const rows = [...container.querySelectorAll('.desk-row')]
    expect(rows.map(row => row.getAttribute('data-live'))).toEqual(['true', 'false', 'false'])

    const ensemble = deskRowFor('DCA 1 — Ensemble')
    expect(ensemble.querySelector('.desk-packs')?.textContent).toBe('Pack 1, Pack 2')
    expect(ensemble.querySelector('.desk-state')?.textContent).toBe('live')
    expect(ensemble.querySelector('.desk-message')?.textContent).toBe('noteOn ch0 → "Desk"')

    const band = deskRowFor('DCA 2 — Band')
    expect(band.querySelector('.desk-packs')?.textContent).toBe('Pack 3')
    expect(band.querySelector('.desk-state')?.textContent).toBe('muted')
    expect(band.querySelector('.desk-message')?.textContent).toBe('OSC /dca/2 1 → 10.0.0.5:9000')

    const spare = deskRowFor('DCA 3 — Spare')
    expect(spare.querySelector('.desk-packs')?.textContent).toBe('nothing assigned')
    expect(spare.querySelector('.desk-state')?.textContent).toBe('—')
    expect(spare.querySelector('.desk-message')?.textContent).toBe('not driven')
  })

  it('closes from the header', async () => {
    await show({ scenes: settings([OPENING]) })

    await act(async () => { headerButton('✕').click() })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
