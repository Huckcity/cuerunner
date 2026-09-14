import { useStore } from '../store'
import { describeDeskMessage } from '../utils/cast'
import { sceneChanges, type DeskChange } from '../utils/scenes'
import type { OscArg } from '../types/cue'
import type { DeskMessage } from '../types/show'

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
 * A null scene closes every group the plot drives, which is also what a "mics all off"
 * button should do.
 */
export async function recallScene(sceneId: string | null, label = 'Desk'): Promise<RecallResult> {
  const state = useStore.getState()
  const scenes = state.showSettings.scenes
  const scene = sceneId === null
    ? null
    : scenes.list.find(candidate => candidate.id === sceneId)

  // A named scene that is no longer in the list is not "close everything". Deleting a
  // scene leaves the cues that pointed at it pointing at nothing, and remembering that
  // as mics-off would mute the whole stage on the next GO — the loudest possible
  // reading of a missing button. Only a null id means mics off.
  if (scene === undefined) {
    const message = `no scene by that id — it may have been deleted (${sceneId})`
    useStore.getState().appendLog([{ level: 'error', label, message }])
    return { sceneName: null, changes: [], failures: [message] }
  }

  const cast = state.showSettings.cast
  const changes = sceneChanges(
    cast.performers,
    cast.ensembles,
    cast.groups,
    scene,
    state.deskState
  )

  const failures: string[] = []
  const deskState = { ...state.deskState }
  for (const change of changes) {
    if (await sendDeskMessage(change.message)) {
      deskState[change.channelId] = change.live
    } else {
      failures.push(`${change.label}: ${describeDeskMessage(change.message)}`)
    }
  }

  useStore.getState().setDeskState(deskState, scene?.id ?? null)

  const opened = changes.filter(change => change.live).length
  const closed = changes.length - opened
  const summary = scene === null
    ? `Mics closed — ${closed} group${closed === 1 ? '' : 's'}`
    : `Scene "${scene.name}" — ${describeChanges(opened, closed)}`

  const log = useStore.getState().appendLog
  log([{ level: 'info', label, message: summary }])
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

async function sendDeskMessage(message: DeskMessage): Promise<boolean> {
  try {
    if (message.kind === 'midi') {
      const result = await window.winslab.midi.send({
        portName: message.portName,
        messages: [message.message]
      })
      return result.ok
    }
    const result = await window.winslab.osc.send({
      host: message.host,
      port: message.port,
      address: message.address,
      args: message.args.map(toOscArg)
    })
    return result.ok
  } catch {
    // A desk that is not there is a failure to report, not a reason to stop the show.
    return false
  }
}

/** The desk model carries plain numbers; the OSC bridge wants them typed. */
function toOscArg(value: number): OscArg {
  return { type: Number.isInteger(value) ? 'i' : 'f', value }
}
