import { useStore } from '../store'
import { channelMutes, describeDeskMessage, faderLabel, membershipWrite } from '../utils/desk'
import { sendDeskMessage } from './deskSend'
import { sceneChanges, type DeskChange, type DeskState } from '../utils/scenes'
import { ALL_CLOSED_SCENE_ID } from '../../../shared/show'
import type { Dca, DeskMessage, ShowSettings } from '../../../shared/show'

export interface RecallResult {
  /** The scene that was recalled, or null when everything was closed. */
  sceneName: string | null
  changes: DeskChange[]
  /** The writes the desk did not accept, described for the log. */
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
 * Two facts go out and they go in this order: the membership, then the mic's mute. The
 * membership first because it is what the mute is a state *of* — a channel that has just
 * been placed and is opened is opened on the fader the scene put it on — and because a
 * channel whose fader changed must not be muted on its way there: the mic keeps playing
 * through the move, and a recall that muted it would drop it mid-line.
 *
 * A recall of the all-closed column — by its id — closes every controlled channel the
 * record has something to say about. A recall with no scene at all is refused: it is a cue
 * pointed at nothing, and reading that as "close every mic" would be the loudest possible
 * reading of a missing button.
 */
export async function recallScene(sceneId: string | null, label = 'Desk'): Promise<RecallResult> {
  const state = useStore.getState()
  const scenes = state.showSettings.scenes
  const scene = sceneId === null || sceneId === ALL_CLOSED_SCENE_ID
    ? null
    : scenes.list.find(candidate => candidate.id === sceneId)

  // A cue pointed at nothing carries an empty id; the all-closed column's own id is never
  // empty. Both are "no scene chosen" rather than "close everything", which is the reading
  // that would mute a whole stage on a cue somebody half-filled in.
  if (sceneId === null || sceneId === '') {
    const message = 'no scene chosen — nothing was sent to the desk'
    useStore.getState().appendLog([{ level: 'error', label, message }])
    return { sceneName: null, changes: [], failures: [message] }
  }

  // A named scene that is no longer in the list is not "close everything". Deleting a
  // scene leaves the cues that pointed at it pointing at nothing, and remembering that
  // as mics-off would mute the whole stage on the next GO — the loudest possible
  // reading of a missing button. Only the all-closed column means mics off.
  if (scene === undefined) {
    const message = `no scene by that id — it may have been deleted (${sceneId})`
    useStore.getState().appendLog([{ level: 'error', label, message }])
    return { sceneName: null, changes: [], failures: [message] }
  }

  const changes = sceneChanges(state.showSettings, scene, state.deskState)
  const outcome = await writeChanges(state.showSettings, changes, state.deskState)

  // The all-closed column is a real place the desk can be left, so it is remembered as
  // one: a view that said "nothing recalled" after every mic was closed would be wrong
  // about the one thing it is there to say.
  useStore.getState().mergeDeskState({}, scene === null ? ALL_CLOSED_SCENE_ID : scene.id)

  const summary = scene === null
    ? `Mics closed — ${channelCount(outcome.closed + outcome.moved)}`
    : `Scene "${scene.name}" — ${describeChanges(outcome.opened, outcome.closed, outcome.moved)}`
  useStore.getState().appendLog([{ level: 'info', label, message: summary }])
  logRefusals(outcome.refusals, label)
  logFailures(outcome.failed, outcome.causes, label)

  return { sceneName: scene?.name ?? null, changes, failures: outcome.failures }
}

/** One write a recall makes, in the order it makes them. */
type DeskWrite =
  | { kind: 'membership'; change: DeskChange; dca: Dca; index: number; placed: boolean }
  | { kind: 'mute'; change: DeskChange; close: boolean }

/**
 * The writes a recall makes, in the order it makes them.
 *
 * The membership goes first, in the faders' own order — the same walk the grid shows, and
 * the order the desk's DCAs are numbered in. It is a difference rather than a sweep: a pair
 * the scene and the record already agree about is not mentioned, and a fader the record has
 * never heard of is only ever placed, never cleared blind.
 *
 * The mutes follow, one write per channel whose mute the scene moves. A mute carries no
 * fader, so a channel rides in the order of the first fader it is on — the scene's first,
 * and the record's where the scene places it nowhere — and the channels that ride nothing at
 * all keep the show's own channel order behind the ones that do.
 */
function deskWrites(show: ShowSettings, changes: DeskChange[], deskState: DeskState): DeskWrite[] {
  const writes: DeskWrite[] = []

  show.cast.dcas.forEach((dca, index) => {
    for (const change of changes) {
      const rides = change.dcas.includes(dca.id)
      const rode = (deskState.assignments[change.channelId] ?? []).includes(dca.id)
      if (rides === rode) continue
      writes.push({ kind: 'membership', change, dca, index, placed: rides })
    }
  })

  const firstFader = (ids: string[]): number => {
    const index = show.cast.dcas.findIndex(dca => ids.includes(dca.id))
    return index === -1 ? Number.POSITIVE_INFINITY : index
  }
  const riding = (change: DeskChange): number => {
    const scene = firstFader(change.dcas)
    if (scene !== Number.POSITIVE_INFINITY) return scene
    const record = firstFader(deskState.assignments[change.channelId] ?? [])
    if (record !== Number.POSITIVE_INFINITY) return record
    return show.cast.dcas.length + show.cast.channels.findIndex(channel => channel.id === change.channelId)
  }

  // The mutes this recall writes: the channels a change is about whose mute the record does
  // not already agree about. A change whose faders moved while its mute did not is a mic
  // that keeps playing, and it is not in this list at all.
  const moving = changes.filter(change => {
    const muted = deskState.mutes[change.channelId]
    return muted === undefined || muted !== !change.open
  })
  for (const change of [...moving].sort((a, b) => riding(a) - riding(b))) {
    writes.push({ kind: 'mute', change, close: !change.open })
  }
  return writes
}

/** What one write is on this show's desk, or why it cannot be made. */
function addressed(
  show: ShowSettings,
  write: DeskWrite,
  channelIndex: number
): { message: DeskMessage } | { error: string } | null {
  if (write.kind === 'mute') {
    const mutes = channelMutes(channelIndex, show.desk)
    return mutes === null ? null : { message: write.close ? mutes.close : mutes.open }
  }
  const send = membershipWrite(
    channelIndex,
    write.dca,
    write.index,
    write.placed,
    write.change.dcas.length > 0,
    show.desk
  )
  if (send === null) return null
  return send.ok ? { message: send.message } : { error: send.error }
}

interface WriteOutcome {
  opened: number
  closed: number
  moved: number
  /** The writes the desk is there for and cannot be told, one line each. */
  refusals: string[]
  /** The writes that did not get there, each with the reason the engine gave. */
  failed: Array<{ described: string; cause: string | null }>
  causes: string[]
  /** The same failures as the caller reads them back. */
  failures: string[]
}

/**
 * Sends the writes, one awaited at a time, and remembers each one the moment it lands.
 *
 * One at a time because the desk takes them in an order and this is that order; each one the
 * moment it lands because the record is the diff's base, so a send that arrives mid-recall
 * is the state the next decision sees — never the pre-recall snapshot, which two recalls
 * overlapping would write over each other.
 *
 * A write the desk cannot be told at all is refused rather than sent: there is no desk to
 * send it to, or the profile has no such route, and the operator is owed the reason. A write
 * that is refused does not stop the rest: half a recall is bad, and a recall that stops at
 * the first gap is worse, because the rest of the stage never moves.
 */
async function writeChanges(
  show: ShowSettings,
  changes: DeskChange[],
  deskState: DeskState
): Promise<WriteOutcome> {
  const outcome: WriteOutcome = {
    opened: 0,
    closed: 0,
    moved: 0,
    refusals: [],
    failed: [],
    causes: [],
    failures: []
  }
  /** The channels a mute was addressed for, which are the ones that opened or closed. */
  const muted = new Set<string>()
  /** The channels a placement was addressed for, which are the ones that moved. */
  const placed = new Set<string>()

  // Every write is addressed before anything is sent: what the desk is there for is a fact
  // about the show and the profile, and resolving it up front is what makes the log's counts
  // and the sends the same list rather than two walks that could disagree.
  const attempts: Array<{ write: DeskWrite; message: DeskMessage }> = []
  for (const write of deskWrites(show, changes, deskState)) {
    const channelIndex = show.cast.channels.findIndex(
      channel => channel.id === write.change.channelId)
    // What the operator reads: the channel, and the fader when the write is a placement.
    const where = write.kind === 'mute'
      ? write.change.label
      : `${write.change.label} → ${faderLabel(show.cast.dcas, write.dca.id)}`
    const send = addressed(show, write, channelIndex)
    // Nothing to send it to at all — a show that drives no desk, a port nobody chose. Not a
    // failure: there is nothing to fail, and the record is left alone.
    if (send === null) continue
    if ('error' in send) {
      outcome.refusals.push(`${where}: ${send.error}`)
      continue
    }
    attempts.push({ write, message: send.message })
    if (write.kind === 'mute') {
      muted.add(write.change.channelId)
      if (write.close) outcome.closed += 1
      else outcome.opened += 1
    } else {
      placed.add(write.change.channelId)
    }
  }
  // A channel whose fader moved without its mute moving kept playing: that is the one the
  // move must not have silenced, so it is counted on its own.
  for (const channelId of placed) {
    if (!muted.has(channelId)) outcome.moved += 1
  }

  for (const { write, message } of attempts) {
    const sent = await sendDeskMessage(message)
    if (!sent.ok) {
      // The write and where it was addressed are one half of a failed recall; why it did
      // not get there is the other, and the engine is the one that wrote it. A recall
      // against a desk whose socket somebody else holds fails exactly like one against an
      // address nobody is at, so dropping that sentence leaves the operator reading an
      // address that was never the problem. Each write answers for its own failure: two of
      // them can fail for two different reasons.
      const where = write.kind === 'mute'
        ? write.change.label
        : `${write.change.label} → ${faderLabel(show.cast.dcas, write.dca.id)}`
      outcome.failed.push({
        described: `${where}: ${describeDeskMessage(message)}`,
        cause: sent.error ?? null
      })
      if (sent.error !== undefined && !outcome.causes.includes(sent.error)) {
        outcome.causes.push(sent.error)
      }
      continue
    }

    if (write.kind === 'mute') {
      useStore.getState().mergeDeskState({ mutes: { [write.change.channelId]: write.close } })
      continue
    }
    const wrote = useStore.getState().deskState.assignments[write.change.channelId] ?? []
    const next = write.placed
      ? (wrote.includes(write.dca.id) ? wrote : [...wrote, write.dca.id])
      : wrote.filter(id => id !== write.dca.id)
    useStore.getState().mergeDeskState({ assignments: { [write.change.channelId]: next } })
  }

  outcome.failures = outcome.failed.map(({ described, cause }) =>
    cause === null ? described : `${described} — ${cause}`)
  return outcome
}

/** Not a connection that failed but a desk that has no such route: the show has to change. */
function logRefusals(refusals: string[], label: string): void {
  if (refusals.length === 0) return
  useStore.getState().appendLog([{
    level: 'error',
    label,
    message: `Cannot be told to this desk — ${refusals.join('; ')}`
  }])
}

/**
 * The state that was remembered is only the state that got there, so the next recall tries
 * again for the rest. A recall that fails usually fails for one reason across all of its
 * writes, so the log names them and then the distinct reasons once — the engine's own
 * sentences carry em dashes of their own, which is why the reasons are led in with a word
 * rather than tacked on beside each write.
 */
function logFailures(
  failed: Array<{ described: string }>,
  causes: string[],
  label: string
): void {
  if (failed.length === 0) return
  const listed = failed.map(({ described }) => described).join(', ')
  useStore.getState().appendLog([{
    level: 'error',
    label,
    message: causes.length === 0
      ? `Could not reach the desk: ${listed}`
      : `Could not reach the desk: ${listed}; why: ${causes.join('; ')}`
  }])
}

/**
 * The all-closed column's own line: how many channels it wrote. "Mics closed — 12 closed"
 * says the same thing twice, and the column already reads "Out" above the press.
 */
function channelCount(count: number): string {
  return `${count} channel${count === 1 ? '' : 's'}`
}

/**
 * What the recall did, as the operator reads it: the mics it opened, the ones it closed, and
 * the ones whose fader moved while they kept playing.
 */
function describeChanges(opened: number, closed: number, moved: number): string {
  if (opened === 0 && closed === 0 && moved === 0) return 'desk already set'
  const parts: string[] = []
  if (opened > 0) parts.push(`${opened} opened`)
  if (closed > 0) parts.push(`${closed} closed`)
  if (moved > 0) parts.push(`${moved} moved`)
  return parts.join(', ')
}
