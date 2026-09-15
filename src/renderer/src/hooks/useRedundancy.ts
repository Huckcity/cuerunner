import { useEffect } from 'react'
import { usePro, useStore } from '../store'
import { cueRunner } from '../engine/CueRunner'
import { audioEngine } from '../engine/audioEngineClient'
import {
  cueListHash,
  takeoverPlan,
  type MirrorCue,
  type PlanCue,
  type RedundancyDigest
} from '../../../shared/redundancy'
import type { Cue } from '../types/cue'
import type { RunState } from '../store'

/**
 * How often the show is offered to the main process. The engine's position moves every
 * tick, and a takeover starts where the last beat said the show was, so this is how much
 * of the show the backup can be wrong about: at four a second, a quarter of a second of
 * music. Nothing is sent when nothing has changed, so an idle pair is silent.
 */
const PUBLISH_MS = 250

/**
 * How many files the backup will warm before it stops. The engine's own cache holds far
 * more than this; the cap is here so a show with two hundred cues does not spend the
 * evening decoding all of them on a machine that may never play a note.
 */
const MAX_PREPARED = 8

/**
 * The window's half of redundant playback.
 *
 * The cue list lives here, so this is what tells the main process what the show is
 * doing — which cue is running, how far into its file the engine has reached, what the
 * operator has selected — and what puts a show back on this machine's engine when this
 * machine takes one over. The socket, the heartbeat and the decision to take over belong
 * to the main process; by the time anything arrives here the only question left is what
 * to play.
 *
 * A machine standing by does the one thing a backup can usefully do before it is needed:
 * it warms the same media in its own audio engine, so the cue it picks up starts rather
 * than decodes.
 */
export function useRedundancy(): void {
  const pro = usePro()
  const enabled = useStore(s => s.redundancySettings?.enabled ?? false)
  const takeover = useStore(s => s.redundancyTakeover)

  useEffect(() => {
    if (!pro) return
    // The machine's own half of the pair, read once for the session. The settings tab
    // writes it back through the same slice, so a change made there is a change here.
    let live = true
    window.winslab.redundancy.settings().then(
      settings => {
        if (live) useStore.getState().setRedundancySettings(settings)
      },
      () => {
        // Unreadable settings are settings this machine is not paired on.
      }
    )
    return () => {
      live = false
    }
  }, [pro])

  useEffect(() => {
    if (!pro || !enabled) return

    /** Cue ids whose media this machine has already been asked to warm. */
    const asked = new Set<string>()
    /** Cue ids the engine has answered for: these are the ones a takeover can start. */
    const warmed = new Set<string>()
    let lastPayload = ''

    const body = (): Omit<RedundancyDigest, 'at'> => {
      const state = useStore.getState()
      return {
        show: {
          id: state.workspaceId,
          name: state.workspaceName,
          cues: state.cues.length,
          hash: cueListHash(state.cues)
        },
        selectedId: state.selectedId,
        running: [...state.running.values()].map(entry => mirrorCue(entry.cueId, entry.state, state.cues)),
        prepared: warmed.size
      }
    }

    const publish = (): void => {
      const digest = body()
      const payload = JSON.stringify(digest)
      if (payload === lastPayload) return
      lastPayload = payload
      // The stamp is what makes each publish its own event; it is not part of the
      // comparison, or every tick would be a change worth sending.
      void window.winslab.show.command('redundancy', 'publish', { ...digest, at: Date.now() }).catch(() => {
        // A service that is not running has nothing to publish to; the next change
        // publishes again, and the status panel says what the machine is doing.
      })
    }

    /**
     * The one thing a backup does before it is needed: the files the live machine is
     * playing, and the one the operator's next GO would fire, are decoded into this
     * machine's engine so that picking the show up costs no wait.
     */
    const warm = (): void => {
      const state = useStore.getState()
      const wanted = new Set<string>()
      if (state.selectedId) wanted.add(state.selectedId)
      for (const entry of state.running.values()) wanted.add(entry.cueId)

      for (const cueId of [...wanted].slice(0, MAX_PREPARED)) {
        if (asked.has(cueId)) continue
        const cue = state.cues.find(candidate => candidate.id === cueId)
        if (!cue || cue.type !== 'audio' || cue.filePath === '') continue
        asked.add(cueId)
        void audioEngine.prepare(cue.id, cue.filePath).then(
          () => {
            warmed.add(cueId)
            publish()
          },
          () => {
            // A file this machine cannot read is not a reason to stop being a backup:
            // the takeover says what it could and could not pick up.
            asked.delete(cueId)
          }
        )
      }

      // A cue that has left the show is no longer worth holding warm, and the engine's
      // own cache is bounded anyway.
      const live = new Set(state.cues.map(cue => cue.id))
      for (const cueId of [...asked]) {
        if (!live.has(cueId)) {
          asked.delete(cueId)
          warmed.delete(cueId)
        }
      }
    }

    const timer = setInterval(() => {
      warm()
      publish()
    }, PUBLISH_MS)

    // A change in the show goes out at once rather than at the next tick: an operator
    // who has just selected the next cue expects the backup to be standing on it.
    const unsubscribe = useStore.subscribe(publish)

    warm()
    publish()

    return () => {
      clearInterval(timer)
      unsubscribe()
    }
  }, [pro, enabled])

  useEffect(() => {
    if (!pro || !takeover) return
    // The notice is consumed before the show is put back on the engine: it exists once,
    // and a replayed batch must not fire the show a second time.
    useStore.getState().clearRedundancyTakeover()
    const plan = takeoverPlan(useStore.getState().cues.map(toPlanCue), takeover.digest, takeover.silentMs)
    // The runner writes the plan's own line to the session log — what was picked up,
    // what could not be, and how much of the show went by unheard.
    cueRunner.adopt(plan)
  }, [pro, takeover])
}

/** One running cue as the partner has to know it: its phase and where in its file it is. */
function mirrorCue(cueId: string, state: RunState, cues: Cue[]): MirrorCue {
  const cue = cues.find(candidate => candidate.id === cueId)
  const progress = audioEngine.getProgress(cueId)
  return {
    cueId,
    number: cue?.number ?? '',
    name: cue?.name ?? '',
    type: cue?.type ?? 'audio',
    state: state === 'pre-wait' ? 'pre-wait' : state === 'post-wait' ? 'post-wait' : 'playing',
    positionMs: progress?.elapsedMs ?? null,
    durationMs: cue && cue.duration > 0 ? cue.duration : null
  }
}

/** The part of a cue a takeover works from: only an audio cue has a region to start in. */
function toPlanCue(cue: Cue): PlanCue {
  return {
    id: cue.id,
    number: cue.number,
    name: cue.name,
    type: cue.type,
    duration: cue.duration,
    startTime: cue.type === 'audio' ? cue.startTime : 0
  }
}
