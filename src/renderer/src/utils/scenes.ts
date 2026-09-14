import { resolvedGroupId } from './cast'
import type {
  DeskChannel,
  DeskMessage,
  MicScene,
  RfEnsemble,
  RfPerformer,
  ScenesSettings
} from '../types/show'

/**
 * Scenes, as pure operations.
 *
 * The point of the whole feature is the function at the bottom of this file: given who is
 * open in a scene, what does the desk actually have to be told? A scene recall should be
 * three messages, not a slam of every fader on the desk — both because a desk takes a
 * moment to accept them and because the operator can see what changed.
 */

export function addScene(settings: ScenesSettings, name = ''): ScenesSettings {
  const scene: MicScene = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Scene ${settings.list.length + 1}` : name.trim(),
    live: [],
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

/** Removes a performer from every scene's live list, once they have left the cast. */
export function removePerformerFromScenes(settings: ScenesSettings, performerId: string): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => scene.live.includes(performerId)
      ? { ...scene, live: scene.live.filter(id => id !== performerId) }
      : scene)
  }
}

/** Opens or closes one performer in one scene. */
export function setPerformerLive(
  settings: ScenesSettings,
  sceneId: string,
  performerId: string,
  live: boolean
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => {
      if (scene.id !== sceneId) return scene
      const already = scene.live.includes(performerId)
      if (already === live) return scene
      return {
        ...scene,
        live: live ? [...scene.live, performerId] : scene.live.filter(id => id !== performerId)
      }
    })
  }
}

/** One group the desk has to be told about, and what to tell it. */
export interface DeskChange {
  channelId: string
  label: string
  /** True when the group is being opened, false when it is being closed. */
  live: boolean
  message: DeskMessage
}

/**
 * What a recall actually sends.
 *
 * A group is open when one of the performers routed to it is open in the scene. Groups
 * nobody is routed to are left alone entirely — the desk may well be doing something
 * else with them — and a group already in the state the scene asks for is not mentioned:
 * that is what makes a recall a few messages instead of a sweep.
 */
export function sceneChanges(
  performers: RfPerformer[],
  ensembles: RfEnsemble[],
  groups: DeskChannel[],
  scene: MicScene | null,
  deskState: Record<string, boolean>
): DeskChange[] {
  const changes: DeskChange[] = []

  for (const group of groups) {
    const routed = performers.filter(performer => resolvedGroupId(performer, ensembles) === group.id)
    if (routed.length === 0) continue

    const shouldBeLive = routed.some(performer => scene?.live.includes(performer.id) ?? false)
    if (deskState[group.id] === shouldBeLive) continue

    const message = shouldBeLive ? group.unmute : group.mute
    if (message === null) continue

    changes.push({ channelId: group.id, label: group.label, live: shouldBeLive, message })
  }

  return changes
}

/** The groups the cast drives, in order, with what each one is carrying. */
export interface DeskChannelSummary {
  channel: DeskChannel
  performers: RfPerformer[]
  /** True when at least one of its performers is open in the current scene. */
  live: boolean
}

export function deskSummary(
  performers: RfPerformer[],
  ensembles: RfEnsemble[],
  groups: DeskChannel[],
  scene: MicScene | null
): DeskChannelSummary[] {
  return groups.map(group => {
    const routed = performers.filter(performer => resolvedGroupId(performer, ensembles) === group.id)
    return {
      channel: group,
      performers: routed,
      live: routed.some(performer => scene?.live.includes(performer.id) ?? false)
    }
  })
}
