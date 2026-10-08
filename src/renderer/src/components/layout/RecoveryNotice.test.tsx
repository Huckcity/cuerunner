// Recovery hands back a session that ended without saving. What it hands back has to be
// all of it: a show restored without its scenes and its mic plot would look whole and be
// empty, and the next save would write that emptiness over the operator's file.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RecoveryNotice } from './RecoveryNotice'
import { useStore } from '../../store'
import { cueEngine } from '../../engine/CueEngine'
import type { MissingMedia } from '../../../../shared/media'
import { defaultShowSettings } from '../../../../shared/show'
import type { LoadNote, Workspace } from '../../../../shared/workspace'
import type { Cue } from '../../../../shared/cue'

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
  loadNotes: LoadNote[]
} {
  const showSettings = defaultShowSettings()
  // The show reaches its desk over MIDI, and this DCA is addressed by a number the show
  // gave it rather than the one its place derives: what recovery hands back is the
  // connection and the number, not a patch per fader. The scene places the first strip on
  // that fader, which is the only place a placement lives.
  showSettings.desk = { ...showSettings.desk, kind: 'midi', midiPort: 'Yamaha' }
  showSettings.cast = {
    ...showSettings.cast,
    dcas: [{ id: 'dca-1', deskNumber: 36 }]
  }
  showSettings.scenes = {
    list: [{
      id: 's-1',
      name: 'Wedding',
      dcas: [{ dcaId: 'dca-1', kind: 'channel', memberId: 'channel-1' }],
      notes: ''
    }],
    allowDuplicateAssignment: true
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
      triggerGuard: { windowMs: 800 },
      history: [{ at: '2026-01-01T19:00:00.000Z', by: 'adam', cues: [], settings: [] }],
      cues: [cue, secondCue],
    },
    savedAt: Date.parse('2026-01-01T20:00:00Z'),
    sourcePath: '/shows/demo.cuerunner',
    // The session was standing on the second cue when it ended, which is the cue GO
    // would have fired next.
    selectedCueId: 'c2',
    // The file moved while the session was down; recovery says so rather than starting
    // the show with a cue that cannot play.
    missingMedia: [
      { cueId: 'c1', path: 'media/walk-in.wav', originalPath: '/shows/media/walk-in.wav' }
    ],
    // The snapshot also needed a grouping repair on its way back, and that travels with
    // it exactly as the missing-media report does.
    loadNotes: [
      {
        cueId: 'c1',
        kind: 'missing-group',
        detail: 'it has no group in this file: still fires with the show, at the top level'
      }
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
    useStore.setState({ cues: [], showSettings: defaultShowSettings(), log: [], notice: null, missingMedia: [], selectedId: null, selectedIds: [], selectionAnchorId: null, isDirty: false })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  async function offer(found: ReturnType<typeof snapshot> | null): Promise<void> {
    // The channel's success arm: the snapshot, or nothing to offer inside `ok`.
    ;(window.cuerunner.workspace.recovery as unknown as Mock)
      .mockResolvedValue({ ok: true, recovery: found })
    await act(async () => { root.render(<RecoveryNotice />) })
  }

  async function recover(): Promise<void> {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === 'Recover')
    await act(async () => { button?.click() })
  }

  it('stops what this session was playing before the recovered one replaces it', async () => {
    const stop = vi.spyOn(cueEngine, 'stopForShowChange').mockImplementation(() => {
      // Said while the session that is leaving is still the one in the store.
      expect(useStore.getState().cues).toEqual([])
    })
    await offer(snapshot())

    await recover()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(useStore.getState().cues.map(c => c.name)).toEqual(['Walk-in Music', 'Sting'])
    stop.mockRestore()
  })

  it('hands back the cues and the show settings the snapshot was carrying', async () => {
    await offer(snapshot())

    await recover()

    const state = useStore.getState()
    expect(state.cues.map(c => c.name)).toEqual(['Walk-in Music', 'Sting'])
    expect(state.workspacePath).toBe('/shows/demo.cuerunner')
    // The desk, the plot and the script are part of that show, not decoration.
    expect(state.showSettings.desk.midiPort).toBe('Yamaha')
    expect(state.showSettings.scenes.list.map(scene => scene.name)).toEqual(['Wedding'])
    expect(state.showSettings.cast.dcas).toEqual([{ id: 'dca-1', deskNumber: 36 }])
    expect(state.showSettings.script.path).toBe('/shows/act-one.txt')
    // A file that cannot be found is part of what the recovered session has to say.
    expect(state.missingMedia).toEqual([
      { cueId: 'c1', path: 'media/walk-in.wav', originalPath: '/shows/media/walk-in.wav' }
    ])
    // So is the grouping the snapshot needed repaired on its way back.
    expect(state.loadNotes).toEqual([
      {
        cueId: 'c1',
        kind: 'missing-group',
        detail: 'it has no group in this file: still fires with the show, at the top level'
      }
    ])
    // The snapshot's own guard and history travel with it: the next save must not write
    // the default guard or an empty history over the operator's file.
    expect(state.showHistory).toEqual([
      { at: '2026-01-01T19:00:00.000Z', by: 'adam', cues: [], settings: [] }
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

  it('says a fault on the lane rather than rendering nothing at all', async () => {
    // A rejection is not a refusal: something broke. It used to produce no bar and no log
    // line — the promise's rejection was unhandled — which left the operator with a
    // session that silently had no answer about their unsaved work.
    ;(window.cuerunner.workspace.recovery as unknown as Mock).mockRejectedValue(
      new Error('the snapshot folder could not be read')
    )

    await act(async () => { root.render(<RecoveryNotice />) })

    const notice = container.querySelector('.app-notice')
    expect(notice?.getAttribute('data-kind')).toBe('recovery')
    expect(notice?.textContent).toContain('Could not look for unsaved work')
    expect(notice?.textContent).toContain('the snapshot folder could not be read')
    expect(useStore.getState().log.map(entry => entry.message)).toEqual([
      'Could not look for unsaved work: the snapshot folder could not be read'
    ])
  })

  it('asks once per mount, StrictMode’s second pass included', async () => {
    // React 18's StrictMode mounts every effect twice in a development session. The ask is
    // idempotent, but the sentence it logs is not, and a log with the same line twice is a
    // record nobody can read.
    ;(window.cuerunner.workspace.recovery as unknown as Mock).mockResolvedValue({
      ok: false,
      error: 'that show has a cue this version of Cuerunner does not know (hologram)'
    })

    await act(async () => {
      root.render(
        <StrictMode>
          <RecoveryNotice />
        </StrictMode>
      )
    })

    expect(useStore.getState().log.map(entry => entry.message)).toEqual([
      'Could not bring the unsaved work back: that show has a cue this version of Cuerunner does not know (hologram)'
    ])
  })

  it('says a snapshot this build cannot bring forward rather than offering nothing', async () => {
    // The refusal arm: an ordinary state, but the operator's only sight of a snapshot this
    // build cannot read. The bar is the recovery lane's own — a snapshot that will not come
    // back is not a failure the session had — and the log carries the same sentence.
    ;(window.cuerunner.workspace.recovery as unknown as Mock).mockResolvedValue({
      ok: false,
      error: 'that show has a cue this version of Cuerunner does not know (hologram)'
    })

    await act(async () => { root.render(<RecoveryNotice />) })

    const notice = container.querySelector('.app-notice')
    expect(notice?.getAttribute('data-kind')).toBe('recovery')
    expect(notice?.textContent).toContain('Could not bring the unsaved work back')
    expect(notice?.textContent).toContain('does not know (hologram)')
    // Nothing to decide about a snapshot that is not offerable: no Recover, no Discard.
    expect(container.querySelector('.app-notice-action')).toBeNull()
    expect(useStore.getState().log.map(entry => entry.message)).toEqual([
      'Could not bring the unsaved work back: that show has a cue this version of Cuerunner does not know (hologram)'
    ])

    // Dismissed like any other bar, and the file stays where it is: this build cannot read
    // it, and nothing here has decided to throw it away.
    const dismiss = container.querySelector('.app-notice-dismiss') as HTMLButtonElement
    await act(async () => { dismiss.click() })
    expect(container.querySelector('.app-notice')).toBeNull()
    expect(window.cuerunner.workspace.clearRecovery).not.toHaveBeenCalled()
  })

  it('carries the file the refusal names onto the bar', async () => {
    // A snapshot whose bytes are not a snapshot: the renderer has no path for the file, so
    // main writes it into the sentence, and the bar has to show the whole of it.
    const named = 'that file is not a show — /home/adam/.config/cuerunner/recovery.cuerunner is not JSON'
    ;(window.cuerunner.workspace.recovery as unknown as Mock).mockResolvedValue({ ok: false, error: named })

    await act(async () => { root.render(<RecoveryNotice />) })

    expect(container.querySelector('.app-notice-text')?.textContent)
      .toBe(`Could not bring the unsaved work back: ${named}`)
  })

  it('discards the snapshot on request, and clears it off the disk', async () => {
    await offer(snapshot())
    expect(container.querySelector('.app-notice')?.getAttribute('data-kind')).toBe('recovery')

    const discard = [...container.querySelectorAll('button')].find(b => b.textContent === 'Discard')
    await act(async () => { discard?.click() })

    expect(window.cuerunner.workspace.clearRecovery).toHaveBeenCalled()
    expect(container.querySelector('.app-notice')).toBeNull()
  })

  it('asks before replacing a session with unsaved work', async () => {
    useStore.setState({ workspaceName: 'Live Show', isDirty: true })
    const confirmClose = window.cuerunner.workspace.confirmClose as unknown as Mock
    confirmClose.mockResolvedValue(2)
    await offer(snapshot())

    await recover()

    // Cancel keeps the live session: no load, no clear, no selection change.
    expect(useStore.getState().workspaceName).toBe('Live Show')
    expect(window.cuerunner.workspace.clearRecovery).not.toHaveBeenCalled()
  })

  it('saves the live session through the one constructor before recovering over it', async () => {
    // The Save arm of the prompt: the session on screen goes to its file first, as the
    // one saved shape `buildWorkspace` builds — a section added to that shape cannot be
    // missing from exactly this save.
    const history = [{ at: '2026-01-01T18:00:00.000Z', by: 'adam', cues: [], settings: ['name'] }]
    useStore.setState({
      cues: [cue, secondCue],
      isDirty: true,
      workspaceName: 'Live Show',
      showHistory: history
    })
    const live = useStore.getState()
    const save = window.cuerunner.workspace.save as unknown as Mock
    save.mockResolvedValue({ path: '/shows/live.cuerunner', history })
    ;(window.cuerunner.workspace.confirmClose as unknown as Mock).mockResolvedValue(0)

    await offer(snapshot())
    await recover()

    expect(save).toHaveBeenCalledTimes(1)
    const [workspace, path] = save.mock.calls[0]
    expect(workspace).toEqual({
      version: 1,
      id: live.workspaceId,
      name: 'Live Show',
      createdAt: live.workspaceCreatedAt,
      history,
      audioSettings: live.audioSettings,
      midiSettings: live.midiSettings,
      showSettings: live.showSettings,
      triggerGuard: live.triggerGuard,
      cues: [cue, secondCue]
    })
    expect(path).toBe(live.workspacePath)
  })
})
