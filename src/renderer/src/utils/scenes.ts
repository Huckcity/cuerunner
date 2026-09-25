import { channelLabel } from './cast'
import type {
  CastSettings,
  Ensemble,
  MicScene,
  RowMember,
  SceneDcaPlacement,
  ScenesSettings,
  ShowSettings
} from '../../../shared/show'

/**
 * Scenes, as pure operations.
 *
 * A scene owns the assignment: per fader it names the one thing that rides it — a channel,
 * or an ensemble over some of them. Nothing but a scene says which
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

/**
 * The strips an ensemble stands on, in the show's own channel order — which is the order the
 * desk numbers its inputs in, and the order a group is read in wherever it is shown. A strip
 * a group still names but the console no longer has contributes nothing: nothing can open it.
 */
export function ensembleChannels(cast: CastSettings, ensembleId: string): string[] {
  const ensemble = cast.ensembles.find(candidate => candidate.id === ensembleId)
  if (ensemble === undefined) return []
  return cast.channels
    .filter(channel => ensemble.channelIds.includes(channel.id))
    .map(channel => channel.id)
}

/**
 * The controlled channels one row carries in one scene: the channel it holds, or the
 * channels of the ensemble it holds.
 *
 * The order is the show's own channel order, which is the order the desk numbers its inputs
 * in — nothing downstream reads this as an edit order.
 */
export function rowChannels(cast: CastSettings, placement: SceneDcaPlacement | null): string[] {
  if (placement === null) return []
  const carried = new Set(placement.kind === 'channel'
    ? [placement.memberId]
    : ensembleChannels(cast, placement.memberId))
  return cast.channels.filter(channel => carried.has(channel.id)).map(channel => channel.id)
}

/** The ensemble a row holds, or null when it holds a channel or nothing. */
export function rowEnsemble(
  cast: CastSettings,
  placement: SceneDcaPlacement | null
): Ensemble | null {
  if (placement === null || placement.kind !== 'ensemble') return null
  return cast.ensembles.find(ensemble => ensemble.id === placement.memberId) ?? null
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

// ── Editing a placement ────────────────────────────────────────────────────

/**
 * Edits one row of one scene: what it holds, or nothing to drop it.
 *
 * One function, because every placement edit comes to the same thing — a row says one thing
 * — and a null member is a row that says nothing: it is taken out rather than left behind,
 * since a scene that speaks for a fader it has nothing to say about is one nobody can read,
 * and a fader grown back is a new place rather than a revivable shell.
 *
 * A new row lands at the end of the scene's list. The order of that list is not a running
 * order — the faders are — so an edit keeps it as it finds it and appends.
 */
export function setRowMember(
  settings: ScenesSettings,
  sceneId: string,
  dcaId: string,
  member: RowMember | null
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => {
      if (scene.id !== sceneId) return scene
      // A show that keeps one fader per channel takes a channel off this scene's other rows
      // first — the editor's half of the rule; the recall collapses what a file still carries.
      const cleared = member !== null && member.kind === 'channel' &&
        !settings.allowDuplicateAssignment
        ? scene.dcas
            .filter(row => !(row.kind === 'channel' && row.memberId === member.memberId))
        : scene.dcas
      const others = cleared.filter(row => row.dcaId !== dcaId)
      if (member === null) return { ...scene, dcas: others }
      return { ...scene, dcas: [...others, { dcaId, ...member }] }
    })
  }
}

/**
 * Takes channels out of every scene: each has left the console, so nothing can carry it.
 *
 * A set at a time rather than a channel, because a count's shrink drops several strips in
 * one edit: a row that was holding one of them holds nothing and goes with it, while a row
 * holding an ensemble keeps it — the ensemble is still a group, and it is the cast's editor
 * that says who is in it, not a scene.
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
      dcas: scene.dcas.filter(row => !(row.kind === 'channel' && gone.has(row.memberId)))
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

/** Empties every row that was holding an ensemble, once it has left the cast. */
export function removeEnsembleFromScenes(settings: ScenesSettings, ensembleId: string): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => ({
      ...scene,
      dcas: scene.dcas.filter(row => !(row.kind === 'ensemble' && row.memberId === ensembleId))
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
