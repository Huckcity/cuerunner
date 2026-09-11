// The matrix is the view the operator lives in at curtain up: a row per pack, a column
// per scene, and the column the desk was last taken to lit where the show is. These tests
// pin that glance, the two presses that move the desk — a column's Recall and the header's
// Apply — and the lock that stops every edit while leaving both of them working.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MatrixView } from './MatrixView'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import type {
  DeskChannel,
  MicScene,
  RfPack,
  RfPerformer,
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

const PERFORMERS: RfPerformer[] = [
  { id: 'f1', name: 'Ada', role: 'Lead', notes: '' },
  { id: 'f2', name: 'Bea', role: 'MD', notes: '' }
]

function pack(
  id: string,
  label: string,
  deskChannelId: string | null,
  performerId: string | null = null
): RfPack {
  return { id, label, channelId: null, performerId, notes: '', deskChannelId }
}

// Pack 1 on the ensemble, Pack 3 on the band: recalling a scene opens one group and
// closes the other, which is the handful of messages the whole feature exists to send.
const PLOT: RfPlot = {
  performers: PERFORMERS,
  packs: [
    pack('p1', 'Pack 1', 'dca-ensemble', 'f1'),
    pack('p2', 'Pack 2', 'dca-ensemble'),
    pack('p3', 'Pack 3', 'dca-band', 'f2')
  ]
}

function scene(id: string, name: string, live: string[]): MicScene {
  return { id, name, live, notes: '' }
}

const OPENING = scene('s1', 'Opening', ['p1'])
const INTERVAL = scene('s2', 'Interval', ['p3'])

function settings(
  list: MicScene[],
  locked = false,
  channels: DeskChannel[] = [ENSEMBLE, BAND]
): ScenesSettings {
  return { channels, list, locked }
}

describe('MatrixView', () => {
  let container: HTMLDivElement
  let root: Root
  let midiSend: Mock
  let oscSend: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

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

  interface ViewState {
    scenes?: ScenesSettings
    plot?: RfPlot
    deskState?: Record<string, boolean>
    deskSceneId?: string | null
  }

  async function show(state: ViewState = {}): Promise<void> {
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
      root.render(<MatrixView />)
    })
  }

  function columnFor(name: string): Element {
    const column = [...container.querySelectorAll('.matrix-scene')].find(
      candidate => candidate.querySelector('.matrix-scene-name')?.textContent === name
    )
    if (!column) throw new Error(`no scene column named ${name}`)
    return column
  }

  function rowFor(label: string): Element {
    const row = [...container.querySelectorAll('.matrix-row')].find(
      candidate => candidate.querySelector('.matrix-pack')?.textContent === label
    )
    if (!row) throw new Error(`no mic row for ${label}`)
    return row
  }

  function cellFor(label: string, sceneName: string): HTMLButtonElement {
    const cell = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')].find(
      candidate => candidate.getAttribute('aria-label') === `${label} in ${sceneName}`
    )
    if (!cell) throw new Error(`no cell for ${label} in ${sceneName}`)
    return cell
  }

  it('gives every pack a row and every scene a column, with the counts', async () => {
    await show({
      scenes: settings([OPENING, scene('s3', 'Finale', ['p2', 'p3']), INTERVAL]),
      plot: PLOT
    })

    expect(container.querySelector('.matrix-subtitle')?.textContent).toBe('3 mics · 3 scenes')

    const columns = [...container.querySelectorAll('.matrix-scene')]
    expect(columns.map(column => column.querySelector('.matrix-scene-name')?.textContent))
      .toEqual(['Opening', 'Finale', 'Interval'])
    expect(columns.map(column => column.querySelector('.matrix-scene-count')?.textContent))
      .toEqual(['1 mic', '2 mics', '1 mic'])

    const rows = [...container.querySelectorAll('.matrix-row')]
    expect(rows.map(row => row.querySelector('.matrix-pack')?.textContent))
      .toEqual(['Pack 1', 'Pack 2', 'Pack 3'])
    expect(rows.map(row => row.querySelectorAll('.matrix-cell').length)).toEqual([3, 3, 3])
  })

  it('counts a lone mic and scene in the singular', async () => {
    await show({
      scenes: settings([OPENING]),
      plot: { performers: [], packs: [pack('p1', 'Pack 1', 'dca-ensemble')] }
    })

    expect(container.querySelector('.matrix-subtitle')?.textContent).toBe('1 mic · 1 scene')
    expect(container.querySelector('.matrix-scene-count')?.textContent).toBe('1 mic')
  })

  it('reads each mic cell as pack, performer and desk group', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    expect(rowFor('Pack 1').querySelector('.matrix-performer')?.textContent).toBe('Ada')
    expect(rowFor('Pack 1').querySelector('.matrix-group')?.textContent).toBe('DCA 1 — Ensemble')
    expect(rowFor('Pack 2').querySelector('.matrix-performer')?.textContent).toBe('unassigned')
    expect(rowFor('Pack 2').querySelector('.matrix-group')?.textContent).toBe('DCA 1 — Ensemble')
    expect(rowFor('Pack 3').querySelector('.matrix-performer')?.textContent).toBe('Bea')
    expect(rowFor('Pack 3').querySelector('.matrix-group')?.textContent).toBe('DCA 2 — Band')
  })

  it('reads a mic with no group on the desk as a dash', async () => {
    await show({
      scenes: settings([OPENING]),
      plot: { performers: [], packs: [pack('p9', 'Pack 9', null)] }
    })

    expect(container.querySelector('.matrix-performer')?.textContent).toBe('unassigned')
    expect(container.querySelector('.matrix-group')?.textContent).toBe('—')
  })

  it('toggles a mic in a scene through to the store', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    const cell = cellFor('Pack 2', 'Opening')
    expect(cell.getAttribute('aria-label')).toBe('Pack 2 in Opening')
    expect(cell.getAttribute('data-live')).toBe('false')

    await act(async () => { cell.click() })

    expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p1', 'p2'])
    expect(cell.getAttribute('data-live')).toBe('true')

    await act(async () => { cell.click() })

    expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p1'])
    expect(cell.getAttribute('data-live')).toBe('false')
  })

  it('locks every cell but leaves the column recall live', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL], true),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    const cells = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(cell => cell.disabled)).toBe(true)

    await act(async () => { cellFor('Pack 2', 'Opening').click() })
    expect(useStore.getState().showSettings.scenes.list[0].live).toEqual(['p1'])

    const recall = columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')
    expect(recall?.disabled).toBe(false)
    await act(async () => { recall?.click() })

    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOff', channel: 0, note: 60, velocity: 0 }]
    })
    expect(oscSend).toHaveBeenCalledWith({
      host: '10.0.0.5',
      port: 9000,
      address: '/dca/2',
      args: [{ type: 'i', value: 1 }]
    })
    expect(useStore.getState().deskSceneId).toBe('s2')
  })

  it('writes the lock from the header and says why', async () => {
    await show({ scenes: settings([OPENING]), plot: PLOT })

    const lock = container.querySelector<HTMLButtonElement>('.matrix-lock')
    expect(lock?.textContent).toBe('Lock')
    expect(lock?.getAttribute('data-locked')).toBe('false')
    expect(container.querySelector('.matrix-view')?.getAttribute('data-locked')).toBe('false')
    expect(container.querySelector('.matrix-locked-hint')).toBeNull()

    await act(async () => { lock?.click() })

    expect(useStore.getState().showSettings.scenes.locked).toBe(true)
    expect(lock?.getAttribute('data-locked')).toBe('true')
    expect(lock?.textContent).toBe('Locked')
    expect(container.querySelector('.matrix-view')?.getAttribute('data-locked')).toBe('true')
    expect(container.querySelector('.matrix-locked-hint')?.textContent)
      .toBe('Locked for the show — recall is live, editing is not.')
  })

  it('marks the column the desk is in, and the rows follow it', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('true')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('false')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['true', 'false', 'false'])

    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': false, 'dca-band': true },
      deskSceneId: 's2'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('false')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('true')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['false', 'false', 'true'])
  })

  it('marks the scene pending after an edit and applies exactly that change', async () => {
    await show({
      scenes: settings([OPENING, INTERVAL]),
      plot: PLOT,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(container.querySelector('.matrix-apply')).toBeNull()

    // Closing Pack 1 leaves the ensemble open on the desk: the column says so in amber
    // and the header offers the one message that would close it.
    await act(async () => { cellFor('Pack 1', 'Opening').click() })

    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    // Both mics on the ensemble are pending together: the desk holds one state per group.
    expect(cellFor('Pack 1', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Pack 2', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Pack 3', 'Interval').getAttribute('data-pending')).toBe('false')

    const apply = container.querySelector<HTMLButtonElement>('.matrix-apply')
    expect(apply?.textContent).toBe('Apply to desk (1)')

    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => { apply?.click() })

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend).toHaveBeenCalledWith({
      portName: PORT,
      messages: [{ kind: 'noteOff', channel: 0, note: 60, velocity: 0 }]
    })
    expect(oscSend).not.toHaveBeenCalled()
    expect(useStore.getState().deskState).toEqual({ 'dca-ensemble': false, 'dca-band': false })
    expect(container.querySelector('.matrix-apply')).toBeNull()
  })

  it('sends exactly the changes a column recall needs', async () => {
    await show({ scenes: settings([OPENING, INTERVAL]), plot: PLOT })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-recall')?.click()
    })

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
    expect(useStore.getState().deskSceneId).toBe('s1')
  })

  it('says how to make scenes when there are none', async () => {
    await show({ scenes: settings([]), plot: PLOT })

    expect(container.querySelector('.matrix-empty')?.textContent)
      .toBe('No scenes yet — make them in the SCENES panel.')
    expect(container.querySelectorAll('.matrix-scene').length).toBe(0)
  })

  it('says the plot is empty when there are no packs', async () => {
    await show({ scenes: settings([OPENING]), plot: { performers: [], packs: [] } })

    expect(container.querySelector('.matrix-empty')?.textContent)
      .toBe('The mic plot is empty — add packs in the RF panel.')
    expect(container.querySelectorAll('.matrix-row').length).toBe(0)
  })
})
