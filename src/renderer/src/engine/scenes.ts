import { useStore } from '../store'
import { describeDeskMessage } from '../utils/desk'
import { sendDeskMessage } from './deskSend'
import { sceneChanges, type DeskChange } from '../utils/scenes'
import { ALL_CLOSED_SCENE_ID } from '../types/show'

export interface RecallResult {
  /** The scene that was recalled, or null when everything was closed. */
  sceneName: string | null
  changes: DeskChange[]
  /** The changes the desk did not accept, described for the log. */
  failures: string[]
}

/**
 * Recalls a scene: works out what the desk has to be told, tells it, and remembers where
 * that left it.
 *
 * Recalling is a deliberate act — a button press, a cue, a message from the desk — and
 * nothing here happens on its own. Editing a scene does not move the desk; the panel says
 * what is still to apply, and the operator applies it.
 *
 * A recall of the all-closed scene — by its id, or by the null a cue carries when it is
 * pointed at nothing — closes every DCA the show drives.
 */
export async function recallScene(sceneId: string | null, label = 'Desk'): Promise<RecallResult> {
  const state = useStore.getState()
  const scenes = state.showSettings.scenes
  const scene = sceneId === null || sceneId === ALL_CLOSED_SCENE_ID
    ? null
    : scenes.list.find(candidate => candidate.id === sceneId)

  // A named scene that is no longer in the list is not "close everything". Deleting a
  // scene leaves the cues that pointed at it pointing at nothing, and remembering that
  // as mics-off would mute the whole stage on the next GO — the loudest possible
  // reading of a missing button. Only the all-closed scene means mics off.
  if (scene === undefined) {
    const message = `no scene by that id — it may have been deleted (${sceneId})`
    useStore.getState().appendLog([{ level: 'error', label, message }])
    return { sceneName: null, changes: [], failures: [message] }
  }

  const changes = sceneChanges(state.showSettings, scene, state.deskState)

  const failures: string[] = []
  const refused: string[] = []
  const deskState = { ...state.deskState }
  for (const change of changes) {
    if (change.message === null) {
      refused.push(`${change.label}: ${change.error}`)
      continue
    }
    const sent = await sendDeskMessage(change.message)
    if (sent.ok) {
      deskState[change.channelId] = change.live
    } else {
      failures.push(`${change.label}: ${describeDeskMessage(change.message)}`)
    }
  }

  // The all-closed scene is a real place the desk can be left, so it is remembered as
  // one: a view that said "nothing recalled" after every mic was closed would be wrong
  // about the one thing it is there to say.
  useStore.getState().setDeskState(deskState, scene === null ? ALL_CLOSED_SCENE_ID : scene.id)

  const opened = changes.filter(change => change.live).length
  const closed = changes.length - opened
  const summary = scene === null
    ? `Mics closed — ${closed} group${closed === 1 ? '' : 's'}`
    : `Scene "${scene.name}" — ${describeChanges(opened, closed)}`

  const log = useStore.getState().appendLog
  log([{ level: 'info', label, message: summary }])
  if (refused.length > 0) {
    // Not a connection that failed but a desk that does not have this fader: the operator
    // has to change the show, not the cable.
    log([{
      level: 'error',
      label,
      message: `Cannot be told to this desk — ${refused.join('; ')}`
    }])
  }
  if (failures.length > 0) {
    // The state that was remembered above is only the state that got there, so the next
    // recall will try again for the rest.
    log([{
      level: 'error',
      label,
      message: `Could not reach the desk: ${failures.join(', ')}`
    }])
  }

  return { sceneName: scene?.name ?? null, changes, failures }
}

function describeChanges(opened: number, closed: number): string {
  if (opened === 0 && closed === 0) return 'desk already set'
  const parts: string[] = []
  if (opened > 0) parts.push(`${opened} opened`)
  if (closed > 0) parts.push(`${closed} closed`)
  return parts.join(', ')
}
