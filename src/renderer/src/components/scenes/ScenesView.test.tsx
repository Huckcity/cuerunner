// Scenes is the view the operator lives in at curtain up: a row per performer, a column
// per scene, the column the desk was last taken to lit where the show is. Which desk
// group a performer's mic actually opens is the cast's (`ShowDialog.test.tsx`) — these
// tests pin the glance, the two presses that move the desk — a column's Recall and the
// header's Apply — and the run mode it opens in, which stops every edit while leaving
// recall, Apply and Mics off working.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScenesView } from './ScenesView'
import { useStore } from '../../store'
import { defaultShowSettings } from '../../types/show'
import type { CastSettings, DeskChannel, MicScene, RfPerformer } from '../../types/show'

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

function performer(id: string, name: string, deskChannelId: string | null): RfPerformer {
  return { id, name, role: '', notes: '', ensembleId: null, deskChannelId }
}

// Ada on the ensemble, Bea on the band: recalling a scene opens one group and closes
// the other, which is the handful of messages the whole feature exists to send.
const PERFORMERS: RfPerformer[] = [
  performer('p1', 'Ada', 'dca-ensemble'),
  performer('p2', 'Extra', null),
  performer('p3', 'Bea', 'dca-band')
]

function scene(id: string, name: string, live: string[]): MicScene {
  return { id, name, live, notes: '' }
}

const OPENING = scene('s1', 'Opening', ['p1'])
const INTERVAL = scene('s2', 'Interval', ['p3'])

function cast(
  performers: RfPerformer[] = PERFORMERS,
  groups: DeskChannel[] = [ENSEMBLE, BAND]
): CastSettings {
  return { groups, performers, ensembles: [] }
}

describe('ScenesView', () => {
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
      deskSceneId: null,
      scenesEditing: false
    })
  })

  interface ViewState {
    scenes?: MicScene[]
    cast?: CastSettings
    deskState?: Record<string, boolean>
    deskSceneId?: string | null
    /** Most of these tests are about editing, so they start in edit mode. */
    editing?: boolean
  }

  async function show(state: ViewState = {}): Promise<void> {
    const defaults = defaultShowSettings()
    await act(async () => {
      useStore.setState({
        showSettings: {
          ...defaults,
          cast: state.cast ?? cast(),
          scenes: { list: state.scenes ?? [] }
        },
        deskState: state.deskState ?? {},
        deskSceneId: state.deskSceneId ?? null,
        scenesEditing: state.editing ?? true
      })
      root.render(<ScenesView />)
    })
  }

  function scenes(): MicScene[] {
    return useStore.getState().showSettings.scenes.list
  }

  function columnFor(name: string): Element {
    const column = [...container.querySelectorAll('.matrix-scene')].find(
      candidate =>
        candidate.querySelector<HTMLInputElement>('.scene-name-field')?.value === name
    )
    if (!column) throw new Error(`no scene column named ${name}`)
    return column
  }

  function cellFor(name: string, sceneName: string): HTMLButtonElement {
    const cell = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')].find(
      candidate => candidate.getAttribute('aria-label') === `${name} in ${sceneName}`
    )
    if (!cell) throw new Error(`no cell for ${name} in ${sceneName}`)
    return cell
  }

  function field<T extends HTMLElement = HTMLInputElement>(selector: string, index = 0): T {
    return container.querySelectorAll<T>(selector)[index]
  }

  // The header readout as the operator reads it: the two labels and what they point at.
  function where(): { now: string; next: string | null } {
    const slot = (position: string): string | null => {
      const element = container.querySelector(position)
      if (element === null) return null
      return [...element.children]
        .filter(child => !child.classList.contains('scenes-where-label'))
        .map(child => child.textContent)
        .join(' ')
    }
    return { now: slot('.scenes-now') ?? '', next: slot('.scenes-next') }
  }

  // Controlled inputs: setting the value through the prototype setter is what gets past
  // React's own tracker, so the dispatched event looks like a real keystroke.
  async function type(input: HTMLInputElement, value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function leave(input: HTMLElement): Promise<void> {
    await act(async () => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
  }

  it('gives every performer a row, and every scene a named column', async () => {
    await show({
      scenes: [OPENING, scene('s3', 'Finale', ['p2', 'p3']), INTERVAL]
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('3 performers · 3 scenes')

    const columns = [...container.querySelectorAll('.matrix-scene')]
    expect(columns.map(column =>
      column.querySelector<HTMLInputElement>('.scene-name-field')?.value))
      .toEqual(['Opening', 'Finale', 'Interval'])

    const rows = [...container.querySelectorAll('.matrix-row')]
    expect(rows.map(row => row.querySelector('.matrix-performer')?.textContent))
      .toEqual(['Ada', 'Extra', 'Bea'])
    expect(rows.map(row => row.querySelectorAll('.matrix-cell').length)).toEqual([3, 3, 3])
  })

  it('counts a lone performer and scene in the singular', async () => {
    await show({
      scenes: [OPENING],
      cast: cast([performer('p1', 'Ada', 'dca-ensemble')])
    })

    expect(container.querySelector('.scenes-subtitle')?.textContent).toBe('1 performer · 1 scene')
  })

  it('toggles a performer in a scene through to the store', async () => {
    await show({ scenes: [OPENING] })

    const cell = cellFor('Extra', 'Opening')
    expect(cell.getAttribute('data-live')).toBe('false')

    await act(async () => { cell.click() })

    expect(scenes()[0].live).toEqual(['p1', 'p2'])
    expect(cell.getAttribute('data-live')).toBe('true')

    await act(async () => { cell.click() })

    expect(scenes()[0].live).toEqual(['p1'])
    expect(cell.getAttribute('data-live')).toBe('false')
  })

  it('adds a scene from the header and renames it in place, refusing an empty name', async () => {
    await show({ scenes: [] })

    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(0)
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No scenes yet.')
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('Add one from the header.')

    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-add')!.click() })

    expect(scenes().map(entry => entry.name)).toEqual(['Scene 1'])
    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(1)

    const name = field('.scene-name-field')
    await type(name, 'Entrance')
    // Half a name is not a rename: the scene list is untouched until the field is left.
    expect(scenes()[0].name).toBe('Scene 1')

    await leave(name)
    expect(scenes()[0].name).toBe('Entrance')
    expect(field<HTMLInputElement>('.scene-name-field').value).toBe('Entrance')

    // A scene without a name is a row nobody can find again, so the old one stays.
    await type(field('.scene-name-field'), '')
    await leave(field('.scene-name-field'))
    expect(scenes()[0].name).toBe('Entrance')
    expect(field<HTMLInputElement>('.scene-name-field').value).toBe('Entrance')
  })

  it('removes a scene from its column', async () => {
    await show({ scenes: [OPENING, INTERVAL] })

    await act(async () => {
      columnFor('Opening').querySelector<HTMLButtonElement>('.matrix-scene-remove')!.click()
    })

    expect(scenes().map(entry => entry.name)).toEqual(['Interval'])
    expect(container.querySelectorAll('.matrix-scene')).toHaveLength(1)
  })

  it('runs the show without editing it: every cell is still, the column recall is live', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      editing: false,
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    const cells = [...container.querySelectorAll<HTMLButtonElement>('.matrix-cell')]
    expect(cells.length).toBeGreaterThan(0)
    expect(cells.every(cell => cell.disabled)).toBe(true)

    await act(async () => { cellFor('Extra', 'Opening').click() })
    expect(scenes()[0].live).toEqual(['p1'])

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

  it('opens to run the show, and Edit and Done switch it, saying what the clicks now do', async () => {
    await show({ scenes: [OPENING], editing: false })

    const edit = container.querySelector<HTMLButtonElement>('.scenes-edit')
    expect(edit?.textContent).toBe('Edit')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('false')
    expect(container.querySelector('.scenes-editing-hint')).toBeNull()
    expect(container.querySelector('.scenes-add')).toBeNull()
    expect(container.querySelector('.scenes-plot')).toBeNull()
    expect(container.querySelector('.scenes-show')).toBeNull()

    await act(async () => { edit?.click() })

    // A mode of the window, not a change to the show.
    expect(useStore.getState().scenesEditing).toBe(true)
    expect(edit?.textContent).toBe('Done')
    expect(container.querySelector('.scenes-view')?.getAttribute('data-editing')).toBe('true')
    expect(container.querySelector('.scenes-editing-hint')?.textContent).toContain('Editing')
    expect(container.querySelector('.scenes-add')).not.toBeNull()
    expect(container.querySelector('.scenes-plot')).not.toBeNull()
    expect(container.querySelector('.scenes-show')).not.toBeNull()

    await act(async () => { edit?.click() })
    expect(useStore.getState().scenesEditing).toBe(false)
  })

  it('opens the mic plot, the Show panel and the telemetry sources from edit mode', async () => {
    await show({ scenes: [OPENING] })

    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-plot')!.click() })
    expect(container.querySelector('.plot-dialog')).not.toBeNull()

    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-show')!.click() })
    expect(container.querySelector('.show-dialog')).not.toBeNull()

    useStore.setState({ settingsTab: null })
    await act(async () => { container.querySelector<HTMLButtonElement>('.scenes-sources')!.click() })
    expect(useStore.getState().settingsTab).toBe('wireless')
  })

  it('marks the column the desk is in, and the rows follow it', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('true')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('false')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['true', 'false', 'false'])

    await show({
      scenes: [OPENING, INTERVAL],
      deskState: { 'dca-ensemble': false, 'dca-band': true },
      deskSceneId: 's2'
    })

    expect(columnFor('Opening').getAttribute('data-current')).toBe('false')
    expect(columnFor('Interval').getAttribute('data-current')).toBe('true')
    expect([...container.querySelectorAll('.matrix-row')].map(row => row.getAttribute('data-on')))
      .toEqual(['false', 'false', 'true'])
  })

  it('names the scene the desk is on and the one coming, where the grid cannot', async () => {
    const three = [OPENING, INTERVAL, scene('s3', 'Finale', ['p3'])]

    // Nothing recalled: the show has not started, so the first scene is what is coming.
    await show({ scenes: three })
    expect(where()).toEqual({ now: 'nothing recalled', next: '1 Opening' })

    await show({ scenes: three, deskSceneId: 's2', deskState: { 'dca-band': true } })
    expect(where()).toEqual({ now: '2 Interval', next: '3 Finale' })

    // The last scene has nothing after it, so the slot goes rather than naming a scene
    // that is not there.
    await show({ scenes: three, deskSceneId: 's3', deskState: { 'dca-band': true } })
    expect(where()).toEqual({ now: '3 Finale', next: null })
  })

  it('leaves the header to the empty state when there are no scenes to name', async () => {
    await show({})

    expect(container.querySelector('.scenes-where')).toBeNull()
    expect(container.querySelector('.matrix-empty')?.textContent).toContain('No scenes yet')
  })

  it('marks the scene pending after an edit and applies exactly that change', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      deskState: { 'dca-ensemble': true, 'dca-band': false },
      deskSceneId: 's1'
    })

    expect(container.querySelector('.matrix-apply')).toBeNull()

    // Closing Ada leaves the ensemble open on the desk: the column says so in amber
    // and the header offers the one message that would close it.
    await act(async () => { cellFor('Ada', 'Opening').click() })

    expect(columnFor('Opening').getAttribute('data-pending')).toBe('true')
    // Ada and Extra ride the same group, so both cells are pending together: the desk
    // holds one state per group.
    expect(cellFor('Ada', 'Opening').getAttribute('data-pending')).toBe('true')
    expect(cellFor('Bea', 'Interval').getAttribute('data-pending')).toBe('false')

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
    await show({ scenes: [OPENING, INTERVAL] })

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

  it('says the cast is empty, and goes straight to entering it', async () => {
    await show({ scenes: [OPENING], cast: cast([]), editing: false })

    expect(container.querySelector('.matrix-empty')?.textContent).toContain('The cast is empty')
    expect(container.querySelectorAll('.matrix-row').length).toBe(0)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().scenesEditing).toBe(true)
    expect(container.querySelector('.show-dialog')).not.toBeNull()
  })

  it('offers Edit from an empty show that is being run', async () => {
    await show({ scenes: [], editing: false })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-empty-action')!.click()
    })

    expect(useStore.getState().scenesEditing).toBe(true)
    expect(container.querySelector('.scenes-add')).not.toBeNull()
  })

  it('while the show is run, nothing edits it; recall, Apply and Mics off stay live', async () => {
    await show({
      scenes: [OPENING, INTERVAL],
      editing: false,
      deskState: { 'dca-ensemble': true, 'dca-band': true },
      deskSceneId: 's1'
    })

    const disabled = (selector: string): boolean[] =>
      [...container.querySelectorAll<HTMLInputElement | HTMLButtonElement>(selector)]
        .map(control => control.disabled)

    expect(disabled('.scene-name-field').every(Boolean)).toBe(true)
    // What removes a scene is not there at all, rather than there and asleep beside recall.
    expect(container.querySelector('.matrix-scene-remove')).toBeNull()
    expect(disabled('.matrix-cell').every(Boolean)).toBe(true)
    expect(container.querySelector('.scenes-add')).toBeNull()

    // Edit is how the show is edited, and recall is what the view is for.
    expect(container.querySelector<HTMLButtonElement>('.scenes-edit')?.disabled).toBe(false)
    expect([...container.querySelectorAll<HTMLButtonElement>('.matrix-recall')]
      .every(recall => !recall.disabled)).toBe(true)
    expect(container.querySelector('.matrix-apply')?.textContent).toBe('Apply to desk (1)')

    // Apply still moves the band, which is the one group the scene disagrees with.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.matrix-apply')!.click()
    })
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(midiSend).not.toHaveBeenCalled()

    // Mics off still closes the ensemble, which apply left open.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.scenes-mics-off')!.click()
    })
    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(useStore.getState().deskSceneId).toBeNull()

    // ...and a column recall still opens the band.
    midiSend.mockClear()
    oscSend.mockClear()
    await act(async () => {
      columnFor('Interval').querySelector<HTMLButtonElement>('.matrix-recall')!.click()
    })
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(useStore.getState().deskSceneId).toBe('s2')
  })
})
