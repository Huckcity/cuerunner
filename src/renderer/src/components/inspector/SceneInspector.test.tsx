// The cue that carries a scene into the stack. What it decides is only which scene; what
// the desk is told belongs to the scene, and is tested there.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { SceneInspector } from './SceneInspector'
import { useStore } from '../../store'
import {
  defaultShowSettings,
  type CastSettings,
  type MicScene,
  type ScenesSettings
} from '../../../../shared/show'
import type { SceneCue } from '../../../../shared/cue'

function scene(id: string, name: string, dcas: MicScene['dcas'] = []): MicScene {
  return { id, name, dcas, notes: '' }
}

describe('SceneInspector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(window.cuerunner.midi.send).mockResolvedValue({ ok: true })
    vi.mocked(window.cuerunner.osc.send).mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  function show(
    cue: SceneCue,
    scenes: Partial<ScenesSettings> = {},
    cast: Partial<CastSettings> = {}
  ): void {
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        // The show reaches its desk over MIDI on the port the other fixtures use; what the
        // scene places decides what goes, addressed by each channel's own number.
        desk: { ...defaults.desk, kind: 'midi', midiPort: 'Yamaha' },
        cast: {
          // Ada is patched to the first strip, so a scene placing her first channel has a
          // message to send and a name to count.
          channels: [{ id: 'ch-1', name: 'Ada' }],
          performers: [{
            id: 'p-1', name: 'Ada', role: 'Lead', notes: '', channelId: 'ch-1'
          }],
          ensembles: [],
          dcas: [{ id: 'dca-1', label: 'DCA 1', deskNumber: null }],
          ...cast
        },
        scenes: {
          list: scenes.list ?? [scene('s-1', 'Wedding', [
            { dcaId: 'dca-1', channels: ['ch-1'], ensembles: [], excluded: [] }
          ])],
          allowDuplicateAssignment: scenes.allowDuplicateAssignment ?? true
        }
      },
      deskState: { mutes: {}, assignments: {} },
      deskSceneId: null,
      log: [],
      cues: [cue]
    })
    act(() => { root.render(<SceneInspector cue={cue} />) })
  }

  function cue(sceneId: string): SceneCue {
    return {
      id: 'sc1', number: '12', name: 'Wedding Scene', type: 'scene',
      colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
      advance: 'none', isArmed: true, notes: '',
      sceneId
    }
  }

  function select(): HTMLSelectElement {
    return container.querySelector<HTMLSelectElement>('#scene-cue-select')!
  }

  async function choose(value: string): Promise<void> {
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
      setter.call(select(), value)
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })
  }

  it('offers every scene, and stores the one that is picked', async () => {
    show(cue(''), { list: [scene('s-1', 'Wedding'), scene('s-2', 'Finale')] })

    expect(Array.from(select().options).map(option => option.textContent))
      .toEqual(['— none —', 'Wedding', 'Finale'])

    await choose('s-2')
    const stored = useStore.getState().cues[0]
    expect(stored.type === 'scene' && stored.sceneId).toBe('s-2')
  })

  it('says what firing it will do, and refuses to when nothing is chosen', async () => {
    show(cue('s-1'))
    // What a recall would touch, named the way the grid names it: the channel and the
    // fader it speaks for.
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('1 channel open')
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('Ch 1 · Ada')
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('1 fader')

    show(cue(''))
    // Still says what it will not do: a scene cue with nothing chosen does nothing,
    // rather than closing every mic on the desk.
    expect(container.querySelector('.inspector-hint')?.textContent)
      .toContain('closing every mic')
    expect(container.querySelector<HTMLButtonElement>('.inspector-btn')?.disabled).toBe(true)
  })

  it('counts what an ensemble applied to a row carries, and names the set', () => {
    // Applying an ensemble to a row is how a scene carries a whole section, so the count
    // the operator reads before pressing GO has to be everyone it places.
    show(
      cue('s-1'),
      { list: [scene('s-1', 'Wedding', [
        { dcaId: 'dca-1', channels: [], ensembles: ['ens-1'], excluded: [] }
      ])] },
      {
        channels: [{ id: 'ch-1', name: 'Ada' }, { id: 'ch-2', name: 'Bea' }],
        performers: [
          { id: 'p-1', name: 'Ada', role: 'Lead', notes: '', channelId: 'ch-1' },
          { id: 'p-2', name: 'Bea', role: 'Chorus', notes: '', channelId: 'ch-2' }
        ],
        ensembles: [{ id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }]
      }
    )

    expect(container.querySelector('.inspector-hint')?.textContent).toContain('2 channels open')
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('Ch 1 · Ada')
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('Ch 2 · Bea')
  })

  it('recalls the scene by hand, under the cue that will fire it', async () => {
    show(cue('s-1'))
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.inspector-btn')!.click()
    })
    await vi.waitFor(() => expect(
      useStore.getState().log.some(entry => entry.label === '12 · Wedding Scene')
    ).toBe(true))

    expect(window.cuerunner.midi.send).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 1, note: 1, velocity: 127 }]
    })
    expect(useStore.getState().log.find(entry => entry.label === '12 · Wedding Scene'))
      .toMatchObject({
        label: '12 · Wedding Scene',
        message: 'Scene "Wedding" — 1 opened'
      })
  })
})
