// Recovery hands back a session that ended without saving. What it hands back has to be
// all of it: a show restored without its scenes and its mic plot would look whole and be
// empty, and the next save would write that emptiness over the operator's file.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RecoveryNotice } from './RecoveryNotice'
import { useStore } from '../../store'
import type { MissingMedia } from '../../../../shared/media'
import { defaultShowSettings } from '../../types/show'
import { midiNoteMessages } from '../../utils/cast'
import type { Workspace } from '../../types/workspace'
import type { Cue } from '../../types/cue'

const cue: Cue = {
  id: 'c1', number: '1', name: 'Walk-in Music', type: 'wait', colorLabel: 'none',
  parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000,
  advance: 'none', isArmed: true, notes: ''
}

const secondCue: Cue = { ...cue, id: 'c2', number: '2', name: 'Sting' }

function snapshot(): {
  workspace: Workspace
  savedAt: number
  sourcePath: string | null
  selectedCueId?: string | null
  missingMedia: MissingMedia[]
} {
  const showSettings = defaultShowSettings()
  showSettings.cast = {
    ...showSettings.cast,
    dcas: [{
      id: 'dca-1',
      label: 'DCA 1 — Principals',
      ...midiNoteMessages('Yamaha', 1, 36)
    }]
  }
  showSettings.scenes = {
    list: [{
      id: 's-1', name: 'Wedding', live: ['p-1'], ensembles: [], excluded: [], notes: ''
    }]
  }
  showSettings.script = { path: '/shows/act-one.txt', fontSize: 13 }
  return {
    workspace: {
      version: 1,
      id: 'w1',
      name: 'Demo Show',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: 'Yamaha' },
      showSettings,
      cues: [cue, secondCue]
    },
    savedAt: Date.parse('2026-01-01T20:00:00Z'),
    sourcePath: '/shows/demo.wlab',
    // The session was standing on the second cue when it ended, which is the cue GO
    // would have fired next.
    selectedCueId: 'c2',
    // The file moved while the session was down; recovery says so rather than starting
    // the show with a cue that cannot play.
    missingMedia: [
      { cueId: 'c1', path: 'media/walk-in.wav', originalPath: '/shows/media/walk-in.wav' }
    ]
  }
}

describe('RecoveryNotice', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ cues: [], showSettings: defaultShowSettings(), log: [], notice: null, missingMedia: [] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function offer(found: ReturnType<typeof snapshot> | null): Promise<void> {
    ;(window.winslab.workspace.recovery as unknown as Mock).mockResolvedValue(found)
    await act(async () => { root.render(<RecoveryNotice />) })
  }

  async function recover(): Promise<void> {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Recover')
    await act(async () => { button?.click() })
  }

  it('hands back the cues and the show settings the snapshot was carrying', async () => {
    await offer(snapshot())

    await recover()

    const state = useStore.getState()
    expect(state.cues.map(c => c.name)).toEqual(['Walk-in Music', 'Sting'])
    expect(state.workspacePath).toBe('/shows/demo.wlab')
    // The desk, the plot and the script are part of that show, not decoration.
    expect(state.showSettings.scenes.list.map(scene => scene.name)).toEqual(['Wedding'])
    expect(state.showSettings.cast.dcas.map(dca => dca.label))
      .toEqual(['DCA 1 — Principals'])
    expect(state.showSettings.script.path).toBe('/shows/act-one.txt')
    // A file that cannot be found is part of what the recovered session has to say.
    expect(state.missingMedia).toEqual([
      { cueId: 'c1', path: 'media/walk-in.wav', originalPath: '/shows/media/walk-in.wav' }
    ])
  })

  it('hands back the place the session was standing on', async () => {
    await offer(snapshot())

    expect(container.textContent).toContain('It was standing on')
    expect(container.textContent).toContain('2 · Sting')

    await recover()

    // The recovered show is standing where the session stood, so the next GO fires the
    // cue it would have fired.
    expect(useStore.getState().selectedId).toBe('c2')
  })

  it('claims no place when the cue it names is not in the snapshot', async () => {
    await offer({ ...snapshot(), selectedCueId: 'gone' })

    expect(container.textContent).not.toContain('standing on')

    await recover()

    // Falls back to the same place any load picks: the first cue.
    expect(useStore.getState().selectedId).toBe('c1')
  })

  it('offers nothing when there is no snapshot', async () => {
    await offer(null)

    expect(container.querySelector('.app-notice')).toBeNull()
  })

  it('discards the snapshot on request, and clears it off the disk', async () => {
    await offer(snapshot())
    expect(container.querySelector('.app-notice')?.getAttribute('data-kind')).toBe('recovery')

    const discard = [...container.querySelectorAll('button')].find(b => b.textContent === 'Discard')
    await act(async () => { discard?.click() })

    expect(window.winslab.workspace.clearRecovery).toHaveBeenCalled()
    expect(container.querySelector('.app-notice')).toBeNull()
  })
})
