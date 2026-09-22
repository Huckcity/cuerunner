// The missing-media bar is the only place an operator finds out that a cue is pointing
// at a file that is not there. What matters is that it says which cues, that one pick
// puts every file it accounts for back into the session in one edit, and that a file the
// pick did not account for keeps its location and stays visible.
import { describe, it, expect, beforeEach, afterEach, type MockInstance } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MissingMediaBar } from './MissingMediaBar'
import { useStore } from '../../store'
import type { AudioCue, Cue } from '../../../../shared/cue'
import type { Workspace } from '../../../../shared/workspace'

function audioCue(id: string, number: string, name: string, filePath: string): AudioCue {
  return {
    id,
    number,
    name,
    type: 'audio',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1
  }
}

function workspaceWith(cues: Cue[]): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Tour Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  }
}

describe('MissingMediaBar', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({
      cues: [audioCue('a1', '1', 'Walk-in Music', '/old/media/walk-in.wav'), audioCue('a2', '2', 'Sting', '/old/media/sting.wav')],
      workspacePath: null,
      isDirty: false,
      missingMedia: [
        { cueId: 'a1', path: 'media/walk-in.wav', originalPath: '/old/media/walk-in.wav' },
        { cueId: 'a2', path: 'media/sting.wav', originalPath: '/old/media/sting.wav' }
      ]
    })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  // The mock is typed to what the channel declares, so these stubs are checked against the
  // answer the bar reads: a member that stopped resolving a show would fail here.
  const relink = (): MockInstance<typeof window.cuerunner.workspace.relink> =>
    vi.mocked(window.cuerunner.workspace.relink)

  async function render(): Promise<void> {
    await act(async () => { root.render(<MissingMediaBar />) })
  }

  async function openAndLocateAll(): Promise<void> {
    await act(async () => {
      ;(container.querySelector('.missing-media-bar-review') as HTMLButtonElement).click()
    })
    await act(async () => {
      ;(container.querySelector('.missing-media-locate-all') as HTMLButtonElement).click()
    })
  }

  it('lists the missing cues and applies the paths one pick resolves', async () => {
    relink().mockResolvedValue({
      workspace: workspaceWith([
        audioCue('a1', '1', 'Walk-in Music', '/new/media/walk-in.wav'),
        audioCue('a2', '2', 'Sting', '/new/media/sting.wav')
      ]),
      missingMedia: []
    })

    await render()
    expect(container.querySelector('.missing-media-bar')?.textContent).toContain('2 audio files')

    await act(async () => {
      ;(container.querySelector('.missing-media-bar-review') as HTMLButtonElement).click()
    })
    const rows = [...container.querySelectorAll('.missing-media-row')]
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Walk-in Music')
    expect(rows[0].textContent).toContain('media/walk-in.wav')

    await act(async () => {
      ;(container.querySelector('.missing-media-locate-all') as HTMLButtonElement).click()
    })

    // The first row's cue is what the picker was opened for.
    expect(relink().mock.calls[0][1]).toBeNull()
    expect(relink().mock.calls[0][2]).toBe('a1')

    const state = useStore.getState()
    expect((state.cues[0] as AudioCue).filePath).toBe('/new/media/walk-in.wav')
    expect((state.cues[1] as AudioCue).filePath).toBe('/new/media/sting.wav')
    expect(state.missingMedia).toEqual([])
    // Relinking changed the show, so it is unsaved.
    expect(state.isDirty).toBe(true)
    expect(container.querySelector('.missing-media-bar')).toBeNull()
  })

  it('keeps a file the pick did not account for visible, at its last known path', async () => {
    relink().mockResolvedValue({
      workspace: workspaceWith([
        audioCue('a1', '1', 'Walk-in Music', '/new/media/walk-in.wav'),
        audioCue('a2', '2', 'Sting', '/old/media/sting.wav')
      ]),
      missingMedia: [
        { cueId: 'a2', path: 'media/sting.wav', originalPath: '/old/media/sting.wav' }
      ]
    })

    await render()
    await openAndLocateAll()

    const state = useStore.getState()
    expect((state.cues[0] as AudioCue).filePath).toBe('/new/media/walk-in.wav')
    expect((state.cues[1] as AudioCue).filePath).toBe('/old/media/sting.wav')
    expect(state.missingMedia).toEqual([
      { cueId: 'a2', path: 'media/sting.wav', originalPath: '/old/media/sting.wav' }
    ])
    expect(container.querySelector('.missing-media-bar')?.textContent).toContain('One audio file')
    expect(container.querySelector('.missing-media-row')?.textContent).toContain('Sting')
  })
})
