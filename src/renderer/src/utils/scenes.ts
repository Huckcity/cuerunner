import { performerDcaId } from './cast'
import { deskMessages } from './desk'
import type {
  DeskMessage,
  Ensemble,
  MicScene,
  ScenesSettings,
  ShowSettings
} from '../types/show'

/**
 * Scenes, as pure operations.
 *
 * The point of the whole feature is the function at the bottom of this file: given who is
 * open in a scene, what does the desk actually have to be told? A scene recall should be
 * three messages, not a slam of every fader on the desk — both because a desk takes a
 * moment to accept them and because the operator can see what changed.
 *
 * Who is open is two things rather than one: the performers named here, and the ensembles
 * applied here. An ensemble is membership, so a performer added to the chorus joins every
 * scene the chorus is applied to; a scene that wants its own version of that closes the
 * ones it does not want, and that is what `excluded` records.
 */

export function addScene(settings: ScenesSettings, name = ''): ScenesSettings {
  const scene: MicScene = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Scene ${settings.list.length + 1}` : name.trim(),
    live: [],
    ensembles: [],
    excluded: [],
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

/** Removes a performer from every scene: the ones they were named in, and the exclusions. */
export function removePerformerFromScenes(settings: ScenesSettings, performerId: string): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => ({
      ...scene,
      live: scene.live.includes(performerId)
        ? scene.live.filter(id => id !== performerId)
        : scene.live,
      excluded: scene.excluded.includes(performerId)
        ? scene.excluded.filter(id => id !== performerId)
        : scene.excluded
    }))
  }
}

/** Unapplies an ensemble from every scene that had it, once it has left the cast. */
export function removeEnsembleFromScenes(settings: ScenesSettings, ensembleId: string): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => scene.ensembles.includes(ensembleId)
      ? { ...scene, ensembles: scene.ensembles.filter(id => id !== ensembleId) }
      : scene)
  }
}

function ensembleMembersOf(ensembles: Ensemble[], ensembleId: string): string[] {
  return ensembles.find(ensemble => ensemble.id === ensembleId)?.members ?? []
}

/**
 * Everyone open in a scene: named performers, plus the members of applied ensembles,
 * less the ones the scene excludes. The order is the order they were found in, which is
 * the scene's own list first — nothing downstream reads it as a running order.
 */
export function sceneLiveIds(scene: MicScene | null, ensembles: Ensemble[]): string[] {
  if (scene === null) return []
  const excluded = new Set(scene.excluded)
  const live = new Set(scene.live.filter(id => !excluded.has(id)))
  for (const ensembleId of scene.ensembles) {
    for (const memberId of ensembleMembersOf(ensembles, ensembleId)) {
      if (!excluded.has(memberId)) live.add(memberId)
    }
  }
  return [...live]
}

/** Whether one performer's mic is open in a scene, by any route. */
export function isPerformerLive(
  scene: MicScene | null,
  ensembles: Ensemble[],
  performerId: string
): boolean {
  return sceneLiveIds(scene, ensembles).includes(performerId)
}

/**
 * What a scene does with one ensemble: applied, not applied, or applied with some of its
 * members closed in this scene. The third state is why a cell cannot be a tick.
 */
export function ensembleState(
  scene: MicScene,
  ensemble: Ensemble
): 'off' | 'on' | 'partial' {
  if (!scene.ensembles.includes(ensemble.id)) return 'off'
  const closed = ensemble.members.some(memberId => scene.excluded.includes(memberId))
  return closed ? 'partial' : 'on'
}

/**
 * Opens or closes one performer in one scene.
 *
 * Closing a performer who rides in on an applied ensemble is an exclusion rather than a
 * removal — they are still in the ensemble, and the next scene that applies it opens them
 * again. Opening someone who was excluded takes the exclusion back.
 */
export function setPerformerLive(
  settings: ScenesSettings,
  sceneId: string,
  performerId: string,
  live: boolean,
  ensembles: Ensemble[]
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => {
      if (scene.id !== sceneId) return scene
      if (live) {
        return {
          ...scene,
          live: scene.live.includes(performerId) ? scene.live : [...scene.live, performerId],
          excluded: scene.excluded.filter(id => id !== performerId)
        }
      }
      const carried = scene.ensembles.some(ensembleId =>
        ensembleMembersOf(ensembles, ensembleId).includes(performerId))
      return {
        ...scene,
        live: scene.live.filter(id => id !== performerId),
        // Only an applied ensemble can be the reason they were open, so only then is
        // there anything to exclude them from.
        excluded: carried && !scene.excluded.includes(performerId)
          ? [...scene.excluded, performerId]
          : scene.excluded
      }
    })
  }
}

/**
 * Applies or unapplies an ensemble to a scene.
 *
 * Applying it takes its members off the scene's own list, exclusions and all: they are
 * open because the ensemble says so now, which is what lets the ensemble grow later.
 * Unapplying closes whoever it was holding open and leaves the performers the operator
 * named by hand exactly as they were.
 */
export function setEnsembleApplied(
  settings: ScenesSettings,
  sceneId: string,
  ensemble: Ensemble,
  applied: boolean
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => {
      if (scene.id !== sceneId) return scene
      const inEnsemble = (id: string): boolean => ensemble.members.includes(id)
      if (!applied) {
        return {
          ...scene,
          ensembles: scene.ensembles.filter(id => id !== ensemble.id),
          excluded: scene.excluded.filter(id => !inEnsemble(id))
        }
      }
      return {
        ...scene,
        ensembles: scene.ensembles.includes(ensemble.id)
          ? scene.ensembles
          : [...scene.ensembles, ensemble.id],
        live: scene.live.filter(id => !inEnsemble(id)),
        excluded: scene.excluded.filter(id => !inEnsemble(id))
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
  /** What to send, or null when this desk cannot be told about the DCA at all. */
  message: DeskMessage | null
  /** Why there is nothing to send, when that is the case. */
  error?: string
}

/**
 * What a recall actually sends.
 *
 * A DCA is open when a performer open in the scene is patched — through their channel —
 * to it. DCAs nothing is routed to are left alone entirely, because the desk may well be
 * doing something else with them, and a DCA already in the state the scene asks for is
 * not mentioned: that is what makes a recall a few messages instead of a sweep.
 *
 * What each DCA is told comes from the show's connection and the DCA's number, so the
 * patch is one thing to set up rather than one per fader.
 *
 * A null scene is the all-closed scene: every DCA the show drives is closed.
 */
export function sceneChanges(
  show: ShowSettings,
  scene: MicScene | null,
  deskState: Record<string, boolean>
): DeskChange[] {
  const changes: DeskChange[] = []
  const live = new Set(sceneLiveIds(scene, show.cast.ensembles))

  show.cast.dcas.forEach((dca, index) => {
    const routed = show.cast.performers.filter(
      performer => performerDcaId(performer, show.cast.channels) === dca.id
    )
    if (routed.length === 0) return

    const shouldBeLive = routed.some(performer => live.has(performer.id))
    if (deskState[dca.id] === shouldBeLive) return

    const send = deskMessages(dca, index, show.desk)
    if (send === null) return
    if (!send.ok) {
      // The desk is there and cannot be told about this DCA — past the end of its list,
      // or on a channel it does not answer on. The reason travels with the change so the
      // operator reads it instead of a fader that quietly never moves.
      changes.push({
        channelId: dca.id,
        label: dca.label,
        live: shouldBeLive,
        message: null,
        error: send.error
      })
      return
    }

    changes.push({
      channelId: dca.id,
      label: dca.label,
      live: shouldBeLive,
      message: shouldBeLive ? send.unmute : send.mute
    })
  })

  return changes
}
