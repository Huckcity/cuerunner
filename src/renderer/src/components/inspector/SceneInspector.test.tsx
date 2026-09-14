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
} from '../../types/show'
import type { SceneCue } from '../../types/cue'

function scene(id: string, name: string, live: string[] = [], ensembles: string[] = []): MicScene {
  return { id, name, live, ensembles, excluded: [], notes: '' }
}

describe('SceneInspector', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    vi.mocked(window.winslab.midi.send).mockResolvedValue({ ok: true })
    vi.mocked(window.winslab.osc.send).mockResolvedValue({ ok: true })
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
        // The show reaches its desk over MIDI on the port the other fixtures use, and
        // this DCA is on a note of its own rather than the one its number derives.
        desk: { ...defaults.desk, kind: 'midi', midiPort: 'Yamaha' },
        cast: {
          // Ada is patched to the strip that drives DCA 1, so a scene naming her has a
          // message to send and a person to count.
          channels: [{ id: 'ch-1', name: 'Ada', dcaId: 'dca-1' }],
          performers: [{
            id: 'p-1', name: 'Ada', role: 'Lead', notes: '', channelId: 'ch-1'
          }],
          ensembles: [],
          dcas: [{ id: 'dca-1', label: 'DCA 1', note: 36, address: null }],
          ...cast
        },
        scenes: { list: scenes.list ?? [scene('s-1', 'Wedding', ['p-1'])] }
      },
      deskState: {},
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
    expect(container.querySelector('.inspector-hint')?.textContent).toContain('1 performer open')

    show(cue(''))
    expect(container.querySelector('.inspector-hint')?.textContent)
      .toContain('close every mic on the desk')
    expect(container.querySelector<HTMLButtonElement>('.inspector-btn')?.disabled).toBe(true)
  })

  it('counts who an applied ensemble holds open, not just the names in the scene', () => {
    // Applying an ensemble is how a scene carries a whole section, so the count the
    // operator reads before pressing GO has to be everyone it opens.
    show(
      cue('s-1'),
      { list: [scene('s-1', 'Wedding', [], ['ens-1'])] },
      {
        performers: [
          { id: 'p-1', name: 'Ada', role: 'Lead', notes: '', channelId: null },
          { id: 'p-2', name: 'Bea', role: 'Chorus', notes: '', channelId: null }
        ],
        ensembles: [{ id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }]
      }
    )

    expect(container.querySelector('.inspector-hint')?.textContent).toContain('2 performers open')
  })

  it('recalls the scene by hand, under the cue that will fire it', async () => {
    show(cue('s-1'))

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.inspector-btn')!.click()
    })
    await vi.waitFor(() => expect(useStore.getState().log).toHaveLength(1))

    expect(window.winslab.midi.send).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 1, note: 36, velocity: 127 }]
    })
    expect(useStore.getState().log[0]).toMatchObject({
      label: '12 · Wedding Scene',
      message: 'Scene "Wedding" — 1 opened'
    })
  })
})
