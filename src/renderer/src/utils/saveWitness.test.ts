// The save's in-flight witness: what a round trip leaves unsaved.
//
// One comparison answers it — the shape the save carried out, against the session as it
// stands when the write answers — and these walk every section that comparison has to
// see. A routed section added to the declaration without the witness following is a
// section an edit can move past a save silently, which is the whole bug.
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from '../store'
import { buildWorkspace } from './workspace'
import { witnessSave } from './saveWitness'
import { WORKSPACE_SECTIONS, type WorkspaceKey } from '../../../shared/workspaceSections'
import type { ShowSettings } from '../../../shared/show'
import type { Workspace } from '../../../shared/workspace'

/** A new session, through the store's own load: nothing from the last case survives. */
function freshSession(): void {
  useStore.getState().loadWorkspace([], 'Untitled', null)
}

/** The exact saved shape a save would carry out, before anything lands mid-write. */
function sent(): Workspace {
  const s = useStore.getState()
  return buildWorkspace({
    id: s.workspaceId,
    name: s.workspaceName,
    createdAt: s.workspaceCreatedAt,
    history: s.showHistory,
    audioSettings: s.audioSettings,
    midiSettings: s.midiSettings,
    showSettings: s.showSettings,
    triggerGuard: s.triggerGuard,
    lighting: s.lighting,
    timecode: s.timecode,
    cueLists: s.cueLists,
    cues: s.cues
  })
}

/**
 * The save's own answer, as every caller gives it before the witness runs: the file's
 * path and history adopted, the dirty flag cleared. The history entry is there so a
 * case that passes can only do it by ignoring history — the save's own record of
 * itself is not an edit.
 */
function saveAnswered(): void {
  useStore.getState().saveSucceeded('/shows/witness.cuerunner', useStore.getState().workspaceName, [
    { at: '2026-09-19T20:00:00.000Z', by: 'adam', cues: [], settings: ['name'] }
  ])
}

/**
 * One edit an operator can make to a routed section, through the store's own writer.
 * A key with no edit here throws, so a routed section added to the declaration cannot
 * join this walk unnoticed.
 */
function editRouted(key: WorkspaceKey): void {
  switch (key) {
    case 'name': useStore.getState().setWorkspaceName('Renamed mid-write'); return
    case 'audioSettings': useStore.getState().updateAudioSettings({ outputDeviceId: 'other-device' }); return
    case 'midiSettings': useStore.getState().updateMidiSettings({ outputPortName: 'Other Port' }); return
    case 'showSettings':
      useStore.getState().updateCompanionSettings({ enabled: !useStore.getState().showSettings.companion.enabled })
      return
    case 'triggerGuard': useStore.getState().updateTriggerGuard({ windowMs: 900 }); return
    case 'lighting':
      useStore.getState().setLighting({ ...useStore.getState().lighting, panic: 'blackout' })
      return
    case 'timecode': useStore.getState().setTimecode({ chase: !useStore.getState().timecode.chase }); return
    case 'cueLists': useStore.getState().addCueList('Effects'); return
    default: throw new Error(`no edit for routed section '${key}': the witness walk needs one`)
  }
}

describe('witnessSave', () => {
  beforeEach(freshSession)

  it('reports an edit to every routed section the declaration carries', () => {
    const routed = WORKSPACE_SECTIONS.filter(section => section.route !== null)
    for (const section of routed) {
      freshSession()
      const before = sent()
      editRouted(section.key)
      saveAnswered()
      expect(witnessSave(before), `routed section '${section.key}' was not witnessed`).toBe(true)
    }
  })

  it('reports an edit to every show-settings section the store can change', () => {
    // The show routes as one section, so a witness that compared the section only as a
    // whole would be blind to everything inside it: each subsection is edited through
    // the writer an operator's control calls. The table is keyed by `ShowSettings`
    // itself, so a subsection added to the show fails typecheck until its edit — and
    // through it the witness — is walked here.
    const edits: Record<keyof ShowSettings, () => void> = {
      oscIn: () => {
        const s = useStore.getState()
        s.updateOscInSettings({ enabled: !s.showSettings.oscIn.enabled })
      },
      midiIn: () => {
        const s = useStore.getState()
        s.updateMidiInSettings({ enabled: !s.showSettings.midiIn.enabled })
      },
      rf: () => {
        const s = useStore.getState()
        s.updateRfSettings({
          thresholds: { ...s.showSettings.rf.thresholds, batteryWarning: s.showSettings.rf.thresholds.batteryWarning + 1 }
        })
      },
      presence: () => {
        const s = useStore.getState()
        s.updatePresenceSettings({ enabled: !s.showSettings.presence.enabled })
      },
      script: () => {
        const s = useStore.getState()
        s.updateScriptSettings({ path: s.showSettings.script.path === '' ? '/shows/act-one.txt' : '' })
      },
      companion: () => {
        const s = useStore.getState()
        s.updateCompanionSettings({ enabled: !s.showSettings.companion.enabled })
      },
      desk: () => {
        const s = useStore.getState()
        s.updateDeskSettings({ midiChannel: s.showSettings.desk.midiChannel === 16 ? 1 : 16 })
      },
      scenes: () => {
        const s = useStore.getState()
        s.updateScenesSettings({
          list: [...s.showSettings.scenes.list, {
            id: 'scene-witness', name: 'Witness scene', dcas: [], notes: ''
          }]
        })
      },
      cast: () => {
        const s = useStore.getState()
        s.updateCastSettings({
          performers: [...s.showSettings.cast.performers, {
            id: 'performer-witness', name: 'Witness performer', role: '', notes: '', channelId: null
          }]
        })
      }
    }
    for (const [section, edit] of Object.entries(edits)) {
      freshSession()
      const before = sent()
      edit()
      saveAnswered()
      expect(witnessSave(before), `show settings '${section}' was not witnessed`).toBe(true)
    }
  })

  it('reports a cue added, edited, moved or removed while the write was out', () => {
    const edits: Array<[string, (ids: string[]) => void]> = [
      ['added', () => useStore.getState().addCue('wait')],
      ['edited', ids => useStore.getState().updateCue(ids[0], { name: 'Edited mid-write' })],
      ['moved', () => useStore.getState().moveCue(1, 0)],
      ['removed', ids => useStore.getState().removeCues([ids[1]])]
    ]
    for (const [what, edit] of edits) {
      freshSession()
      useStore.getState().addCue('wait')
      useStore.getState().addCue('wait')
      const ids = useStore.getState().cues.map(cue => cue.id)
      const before = sent()
      edit(ids)
      saveAnswered()
      expect(witnessSave(before), `a cue was not witnessed when it was ${what}`).toBe(true)
    }
  })

  it('reports a rename typed while the write was out', () => {
    const before = sent()
    useStore.getState().setWorkspaceName('Hamlet (revised)')
    saveAnswered()
    // The file was written under the name the save carried out; the session has another,
    // so the next save has work to do.
    expect(witnessSave(before)).toBe(true)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('reports an edit undone while the write was out', () => {
    useStore.getState().addCue('wait')
    const id = useStore.getState().cues[0].id
    useStore.getState().updateCue(id, { name: 'In the file' })
    const before = sent()
    // The undo takes off the screen what the write put in the file.
    useStore.getState().undo()
    saveAnswered()
    expect(witnessSave(before)).toBe(true)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('reports a cue relinked to another folder while the write was out', () => {
    useStore.getState().addCue('audio')
    const id = useStore.getState().cues[0].id
    useStore.getState().updateCue(id, { filePath: '/shows/media/walk-in.wav' })
    const before = sent()
    // The same file name in another folder. The diff folds the route down to the name,
    // so it cannot see this — but pointing the cue at where its file is now is the
    // operator's edit, and the store's relink writer counts it as one.
    useStore.getState().applyRelinkedMedia({ [id]: '/moved/media/walk-in.wav' })
    saveAnswered()
    expect(witnessSave(before)).toBe(true)
    expect(useStore.getState().isDirty).toBe(true)
  })

  it('leaves the session clean when only a measurement was written', () => {
    useStore.getState().addCue('audio')
    const id = useStore.getState().cues[0].id
    useStore.getState().updateCue(id, { filePath: '/shows/walk-in.wav' })
    const before = sent()
    // The app's own writes landing mid-write: a probed length and a silence scan. Neither
    // is an edit, so neither leaves work unsaved.
    useStore.getState().syncCueDuration(id, 12_000)
    useStore.getState().syncCueSilence(id, { startMs: 250, endMs: 11_500, durationMs: 12_000, silent: false })
    saveAnswered()
    expect(witnessSave(before)).toBe(false)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('leaves the session clean when only running, selection or a folded group changed', () => {
    useStore.getState().addCue('group')
    useStore.getState().addCue('wait')
    const [groupId, cueId] = useStore.getState().cues.map(cue => cue.id)
    const before = sent()
    // Session state, not show content: a cue running, the operator's hand moving, a
    // group folding away. None of it is in the saved shape.
    useStore.getState().setRunning(cueId, { cueId, state: 'playing', startedAt: 0, progress: 0 })
    useStore.getState().select(cueId)
    useStore.getState().toggleGroup(groupId)
    saveAnswered()
    expect(witnessSave(before)).toBe(false)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('leaves a clean round trip clean', () => {
    const before = sent()
    saveAnswered()
    // The path and name the save adopted and the history entry it added are the save's
    // own bookkeeping: the file on disk says exactly what the session says.
    expect(useStore.getState().workspacePath).toBe('/shows/witness.cuerunner')
    expect(witnessSave(before)).toBe(false)
    expect(useStore.getState().isDirty).toBe(false)
  })

  it('leaves a show loaded mid-write alone', () => {
    useStore.getState().addCue('wait')
    const before = sent()
    useStore.getState().loadWorkspace(
      [], 'Another Show', '/shows/another.cuerunner', undefined, undefined, undefined,
      { id: 'w-another', createdAt: '2026-09-19T00:00:00.000Z' }
    )
    // The save of the old show answers after the load replaced it.
    saveAnswered()
    // The bytes belong to a show that is no longer on screen; the show that is has all
    // of its own work on disk.
    expect(witnessSave(before)).toBe(false)
    expect(useStore.getState().isDirty).toBe(false)
  })
})
