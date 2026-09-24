import { channelLabel } from './cast'
import type {
  CastSettings,
  Ensemble,
  MicScene,
  SceneDcaPlacement,
  ScenesSettings,
  ShowSettings
} from '../../../shared/show'

/**
 * Scenes, as pure operations.
 *
 * A scene owns the assignment: per fader it names the channels it places, the ensembles
 * applied to that row and the member channels it leaves off. Nothing but a scene says which
 * fader a channel rides (AD-26), so everything here is about placements rather than about
 * who is open — a controlled channel is open exactly when some row of the scene carries it.
 *
 * The function at the bottom is the point of the file: given a scene and what the desk was
 * last told, what does a recall actually write? Two facts per controlled channel — the
 * faders it rides and whether it is muted — and nothing outside the controlled set, ever.
 */

// ── The scenes themselves ──────────────────────────────────────────────────

export function addScene(settings: ScenesSettings, name = ''): ScenesSettings {
  // A new scene places nothing. Which fader a channel rides is the decision the scene
  // exists to make, so guessing one here would be the app making it for the operator.
  const scene: MicScene = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Scene ${settings.list.length + 1}` : name.trim(),
    dcas: [],
    notes: ''
  }
  return { ...settings, list: [...settings.list, scene] }
}

export function updateScene(
  settings: ScenesSettings,
  sceneId: string,
  patch: Partial<Omit<MicScene, 'id'>>
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => scene.id === sceneId ? { ...scene, ...patch } : scene)
  }
}

export function removeScene(settings: ScenesSettings, sceneId: string): ScenesSettings {
  return { ...settings, list: settings.list.filter(scene => scene.id !== sceneId) }
}

/**
 * Where a desk button moves the show's scenes to, or null when there is nowhere to go.
 *
 * The walk is the list as the Scenes view shows it. The all-closed scene is a place *before*
 * the list rather than a scene in it — a desk wants it pressed between numbers, and it is not
 * something to move into or out of — so a GO from there is the first scene and a BACK from
 * there is nothing, exactly as if no scene had been recalled yet. A scene the show no longer
 * has is the same: deleted scenes leave `deskSceneId` pointing at something that is gone, and
 * the next GO should start the list again rather than refuse.
 */
export function sceneStep(list: MicScene[], current: string | null, step: 1 | -1): MicScene | null {
  const index = current === null ? -1 : list.findIndex(scene => scene.id === current)
  return list[(index < 0 ? -1 : index) + step] ?? null
}

// ── A row, and what rides it ───────────────────────────────────────────────

/** The row a scene keeps for one fader, or null when the scene says nothing about it. */
export function placementFor(scene: MicScene | null, dcaId: string): SceneDcaPlacement | null {
  if (scene === null) return null
  return scene.dcas.find(placement => placement.dcaId === dcaId) ?? null
}

/** The channels an ensemble carries, through the performers whose mics are on them. */
function ensembleChannels(cast: CastSettings, ensembleId: string): string[] {
  const ensemble = cast.ensembles.find(candidate => candidate.id === ensembleId)
  if (ensemble === undefined) return []
  const channels: string[] = []
  for (const memberId of ensemble.members) {
    const performer = cast.performers.find(candidate => candidate.id === memberId)
    const channelId = performer?.channelId ?? null
    if (channelId !== null && !channels.includes(channelId)) channels.push(channelId)
  }
  return channels
}

/**
 * The controlled channels one row carries in one scene: the ones placed on it by hand, plus
 * the channels of the ensembles applied to it, less the member channels the scene leaves off.
 *
 * The order is the show's own channel order, which is the order the desk numbers its inputs
 * in — nothing downstream reads this as an edit order.
 */
export function rowChannels(cast: CastSettings, placement: SceneDcaPlacement | null): string[] {
  if (placement === null) return []
  const carried = new Set(placement.channels)
  for (const ensembleId of placement.ensembles) {
    for (const channelId of ensembleChannels(cast, ensembleId)) carried.add(channelId)
  }
  const channels: string[] = []
  for (const channel of cast.channels) {
    if (carried.has(channel.id) && !placement.excluded.includes(channel.id)) channels.push(channel.id)
  }
  return channels
}

/** The faders a channel rides in a scene, in the show's DCA order. */
export function channelDcas(scene: MicScene | null, channelId: string, cast: CastSettings): string[] {
  if (scene === null) return []
  const dcas: string[] = []
  for (const dca of cast.dcas) {
    if (rowChannels(cast, placementFor(scene, dca.id)).includes(channelId)) dcas.push(dca.id)
  }
  return dcas
}

/** Every channel a scene carries anywhere, in the show's channel order: what its rows have between them. */
export function sceneChannelIds(scene: MicScene | null, cast: CastSettings): string[] {
  if (scene === null) return []
  const channels = new Set<string>()
  for (const dca of cast.dcas) {
    for (const channelId of rowChannels(cast, placementFor(scene, dca.id))) channels.add(channelId)
  }
  return cast.channels.filter(channel => channels.has(channel.id)).map(channel => channel.id)
}

/**
 * What a scene does with one ensemble on one fader: applied, not applied, or applied with
 * some of its members left off this row. The third state is why a cell cannot be a tick.
 */
export function ensembleState(
  scene: MicScene | null,
  dcaId: string,
  ensemble: Ensemble,
  cast: CastSettings
): 'off' | 'on' | 'partial' {
  const row = placementFor(scene, dcaId)
  if (row === null || !row.ensembles.includes(ensemble.id)) return 'off'
  const left = ensembleChannels(cast, ensemble.id).some(channelId => row.excluded.includes(channelId))
  return left ? 'partial' : 'on'
}

/**
 * Who a new ensemble made from a row would hold: the performers whose channels the row is
 * carrying, in cast order — the row's carried channels, which a caller that has already
 * worked them out hands over rather than paying for the same walk again. An empty answer is
 * a row there is nothing to group: the strips it carries have nobody patched to them, and
 * an ensemble names performers.
 */
export function rowPerformers(cast: CastSettings, carried: string[]): string[] {
  return cast.performers
    .filter(performer => performer.channelId !== null && carried.includes(performer.channelId))
    .map(performer => performer.id)
}

/**
 * Whether Create ensemble has a job on this row: somebody carried, and somebody the one
 * ensemble applied to the row does not already hold.
 *
 * A row held by a single ensemble that holds every performer it carries is already what the
 * press would build — the new group would name the same people — so the control is absent
 * rather than a press that rewrites the row into an equivalent one. A performer the row
 * carries that the group does not hold is the job, whether they are placed by hand or were
 * carried into the row by a Cast change; and with no ensemble applied, or more than one,
 * anything carried is.
 */
export function canCreateEnsemble(
  cast: CastSettings,
  scene: MicScene | null,
  dcaId: string,
  carried: string[]
): boolean {
  const row = placementFor(scene, dcaId)
  if (row === null) return false
  const applied = row.ensembles.length === 1
    ? cast.ensembles.find(candidate => candidate.id === row.ensembles[0])
    : undefined

  for (const performer of cast.performers) {
    if (performer.channelId === null || !carried.includes(performer.channelId)) continue
    if (applied === undefined || !applied.members.includes(performer.id)) return true
  }
  return false
}

// ── Editing a placement ────────────────────────────────────────────────────

/** Whether a row still says anything. An empty one is dropped rather than kept as a shell. */
function isEmptyRow(row: SceneDcaPlacement): boolean {
  return row.channels.length === 0 && row.ensembles.length === 0 && row.excluded.length === 0
}

/**
 * Edits one row of one scene, creating it when it is not there yet and dropping it when the
 * edit leaves it saying nothing.
 *
 * One function, because every placement edit is the same three lines and the difference
 * between them is what the row ends up holding: a new row is not a thing any of them should
 * have to remember to make, and an empty one left behind is a scene that speaks for a fader
 * it has nothing to say about.
 */
function writeRow(
  settings: ScenesSettings,
  sceneId: string,
  dcaId: string,
  edit: (row: SceneDcaPlacement) => SceneDcaPlacement
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => {
      if (scene.id !== sceneId) return scene
      const existing = scene.dcas.find(row => row.dcaId === dcaId)
      const next = edit(existing ?? { dcaId, channels: [], ensembles: [], excluded: [] })
      const dcas = isEmptyRow(next)
        ? scene.dcas.filter(row => row.dcaId !== dcaId)
        : existing === undefined
          ? [...scene.dcas, next]
          : scene.dcas.map(row => row.dcaId === dcaId ? next : row)
      return { ...scene, dcas }
    })
  }
}

/** Takes a channel off every row of one scene: the show keeps one fader per channel. */
function clearChannelFromScene(
  settings: ScenesSettings,
  sceneId: string,
  channelId: string
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => scene.id === sceneId
      ? {
          ...scene,
          dcas: scene.dcas
            .map(row => row.channels.includes(channelId)
              ? { ...row, channels: row.channels.filter(id => id !== channelId) }
              : row)
            .filter(row => !isEmptyRow(row))
        }
      : scene)
  }
}

/**
 * Places a controlled channel on one fader in one scene, or takes it off.
 *
 * Taking a hand placement off a channel an applied ensemble carries is an *exclusion*
 * rather than a removal: the ensemble still holds them, and the next scene that applies it
 * rides them again. Placing one by hand says where it goes, so it takes the exclusion back.
 *
 * A show that keeps one fader per channel takes the channel off every other row of that
 * scene first — the editor's half of the rule; the recall collapses whatever a file still
 * carries.
 */
export function setChannelPlaced(
  settings: ScenesSettings,
  sceneId: string,
  dcaId: string,
  channelId: string,
  placed: boolean,
  cast: CastSettings
): ScenesSettings {
  const cleared = placed && !settings.allowDuplicateAssignment
    ? clearChannelFromScene(settings, sceneId, channelId)
    : settings
  return writeRow(cleared, sceneId, dcaId, row => {
    if (placed) {
      return {
        ...row,
        channels: row.channels.includes(channelId) ? row.channels : [...row.channels, channelId],
        excluded: row.excluded.filter(id => id !== channelId)
      }
    }
    const carried = row.ensembles.some(ensembleId =>
      ensembleChannels(cast, ensembleId).includes(channelId))
    return {
      ...row,
      channels: row.channels.filter(id => id !== channelId),
      excluded: carried && !row.excluded.includes(channelId)
        ? [...row.excluded, channelId]
        : row.excluded
    }
  })
}

/**
 * Applies an ensemble to one fader in one scene, or takes it off.
 *
 * Applying it takes its members' channels off the row's own list, exclusions and all: they
 * ride because the ensemble says so now, which is what lets the ensemble grow later without
 * the scene being edited again. Unapplying leaves whatever the operator placed by hand
 * exactly as it was, and an exclusion only means something while the ensemble is applied.
 */
export function setRowEnsemble(
  settings: ScenesSettings,
  sceneId: string,
  dcaId: string,
  ensemble: Ensemble,
  applied: boolean,
  cast: CastSettings
): ScenesSettings {
  const members = ensembleChannels(cast, ensemble.id)
  return writeRow(settings, sceneId, dcaId, row => {
    if (!applied) {
      return {
        ...row,
        ensembles: row.ensembles.filter(id => id !== ensemble.id),
        excluded: row.excluded.filter(id => !members.includes(id))
      }
    }
    return {
      ...row,
      ensembles: row.ensembles.includes(ensemble.id)
        ? row.ensembles
        : [...row.ensembles, ensemble.id],
      channels: row.channels.filter(id => !members.includes(id)),
      excluded: row.excluded.filter(id => !members.includes(id))
    }
  })
}

/**
 * Consolidates a row onto one ensemble: the performers it is carrying become the new
 * group's members, the group is applied here, and the hand placements and applied groups
 * that named those performers are gone from this row.
 *
 * A carried channel nobody is patched to cannot be in an ensemble at all, so it stays
 * placed by hand and the row keeps naming it. That is why the effective carried set is the
 * one the row already had, however many hands and groups put it together — and why the
 * exclusions go: one only ever meant "not this member's channel", and the new group holds
 * exactly the members that were riding.
 *
 * Only this row changes. The ensembles it used to apply stay in the cast for every other
 * row and scene that still holds them.
 */
export function consolidateRow(
  settings: ScenesSettings,
  sceneId: string,
  dcaId: string,
  ensembleId: string,
  cast: CastSettings
): ScenesSettings {
  return writeRow(settings, sceneId, dcaId, row => {
    const carried = rowChannels(cast, row)
    return {
      dcaId,
      // The channels somebody is patched to ride the new ensemble; one nobody is patched to
      // cannot be in an ensemble at all, so the row goes on naming it by hand.
      channels: row.channels.filter(channelId =>
        carried.includes(channelId) &&
        !cast.performers.some(performer => performer.channelId === channelId)),
      ensembles: [ensembleId],
      excluded: []
    }
  })
}

/**
 * Leaves one member's channel off one fader in one scene, or puts it back. An exclusion and
 * a hand placement contradict each other, so excluding takes the placement off the row.
 */
export function setMemberExcluded(
  settings: ScenesSettings,
  sceneId: string,
  dcaId: string,
  channelId: string,
  excluded: boolean
): ScenesSettings {
  return writeRow(settings, sceneId, dcaId, row => {
    if (!excluded) return { ...row, excluded: row.excluded.filter(id => id !== channelId) }
    return {
      ...row,
      channels: row.channels.filter(id => id !== channelId),
      excluded: row.excluded.includes(channelId) ? row.excluded : [...row.excluded, channelId]
    }
  })
}

/**
 * Takes channels out of every scene: each has left the console, so nothing can carry it.
 *
 * A set at a time rather than a channel, because a count's shrink drops several strips in
 * one edit: each of them leaves every row's placements and exclusions, and a row left
 * saying nothing goes with them rather than staying as a shell.
 */
export function removeChannelsFromScenes(
  settings: ScenesSettings,
  channelIds: string[]
): ScenesSettings {
  if (channelIds.length === 0) return settings
  const gone = new Set(channelIds)
  return {
    ...settings,
    list: settings.list.map(scene => ({
      ...scene,
      dcas: scene.dcas
        .map(row => ({
          ...row,
          channels: row.channels.filter(id => !gone.has(id)),
          excluded: row.excluded.filter(id => !gone.has(id))
        }))
        .filter(row => !isEmptyRow(row))
    }))
  }
}

/**
 * Takes the rows of the faders that went out of every scene. A row is the scene's word
 * about one place on the desk, so a place the show no longer has leaves no row behind —
 * nothing to read, nothing to revive, and a fader grown back is a new place.
 */
export function removeDcasFromScenes(settings: ScenesSettings, dcaIds: string[]): ScenesSettings {
  if (dcaIds.length === 0) return settings
  const gone = new Set(dcaIds)
  return {
    ...settings,
    list: settings.list.map(scene => ({
      ...scene,
      dcas: scene.dcas.filter(row => !gone.has(row.dcaId))
    }))
  }
}

/** Unapplies an ensemble from every row that had it, once it has left the cast. */
export function removeEnsembleFromScenes(settings: ScenesSettings, ensembleId: string): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => ({
      ...scene,
      dcas: scene.dcas
        .map(row => row.ensembles.includes(ensembleId)
          ? { ...row, ensembles: row.ensembles.filter(id => id !== ensembleId) }
          : row)
        .filter(row => !isEmptyRow(row))
    }))
  }
}

// ── What a recall writes ───────────────────────────────────────────────────

/** What Cuerunner was last told it wrote to the desk, per controlled channel. */
export interface DeskState {
  /** Whether the desk was last told to mute the channel. An absent key is not known. */
  mutes: Record<string, boolean>
  /** The faders the channel was last written onto. An absent key is not known. */
  assignments: Record<string, string[]>
}

/**
 * What a desk nothing has been sent to reads as: every fact unknown, so the next recall
 * writes it. The resync is the same thing said on purpose — the desk was moved by hand, and
 * the record of what was sent is worth nothing.
 */
export const UNKNOWN_DESK_STATE: DeskState = { mutes: {}, assignments: {} }

/** One controlled channel a recall would write, and what the scene asks of it. */
export interface DeskChange {
  channelId: string
  /** How the operator reads it: "Ch 3 · Ruth", or "Ch 7" while the strip is unnamed. */
  label: string
  /** Whether the scene places it at all: a channel placed nowhere is closed. */
  open: boolean
  /** The faders the scene places it on, in the show's DCA order. */
  dcas: string[]
}

/** Whether two sets of faders are the same set, whatever order each is written in. */
function sameFaders(a: string[], b: string[]): boolean {
  return a.length === b.length && b.every(id => a.includes(id))
}

/**
 * What a recall actually writes: the controlled channels the scene moves, and what the scene
 * asks of each.
 *
 * The controlled set is the boundary and nothing outside it is ever computed — the walk is
 * the show's own channel list, so a channel the scene never mentions is not merely left
 * alone, it is not reachable from here. A channel the scene places nowhere yields no faders
 * and is closed; a channel whose faders and mute already match the record yields nothing at
 * all, which is what makes a recall a few messages instead of a sweep.
 *
 * The record's own shape is a fact per channel, and a fact nothing is known about is a fact
 * to write: a channel the record has never mentioned — a fresh show, or the resync's emptied
 * base — is told to the desk rather than assumed to be where the show wants it.
 *
 * A null scene is the all-closed column: every controlled channel the record has something
 * to say about is closed, which is the same rule with nothing placed.
 */
export function sceneChanges(
  show: ShowSettings,
  scene: MicScene | null,
  deskState: DeskState
): DeskChange[] {
  const changes: DeskChange[] = []
  for (const channel of show.cast.channels) {
    const dcas = channelDcas(scene, channel.id, show.cast)
    // A residual duplicate — a file written with more than one fader per channel while the
    // show now keeps one — collapses to the lowest-numbered fader, which is the lowest place
    // in the show's own order.
    const target = show.scenes.allowDuplicateAssignment ? dcas : dcas.slice(0, 1)
    const open = target.length > 0

    const muted = deskState.mutes[channel.id]
    // A fact the record has never carried reads as no faders, which is what the recall would
    // write from it anyway: a channel placed nowhere and already muted is not a change, and a
    // change that produces no write is a press that never clears.
    const wrote = deskState.assignments[channel.id] ?? []
    const mutedMatches = muted !== undefined && muted === !open
    if (mutedMatches && sameFaders(wrote, target)) continue

    changes.push({
      channelId: channel.id,
      label: channelLabel(show.cast.channels, channel.id),
      open,
      dcas: target
    })
  }
  return changes
}
