// Audition: hearing a cue, a selection of cues or a file on the audition output, without
// firing the show.
//
// An audition is not a run. It plays as engine voices of its own (`audition:<n>`) through the
// show's audition patch — headphones at the desk, a monitor in the booth — and nothing about
// it reaches the runner: the cue list does not move, no row lights, no handover happens, no
// log line is written, and the runner ignores the voices' events because no run of its owns
// them. A selection plays one cue after another, in the list's order, each as the show would
// play it (its region, loops, slices, level and fades). Stop ends it; PANIC ends it with
// everything else, because the engine's panic silences every voice.
//
// It refuses rather than guesses when the show has no audition output: auditioning into the
// house PA in the middle of a show is the thing this exists to prevent.

import type { AudioCue, Cue } from '../../../shared/cue'
import type { AudioStartOptions } from '../../../shared/audio'
import { defaultAudioStartOptions } from '../../../shared/audio'
import { audioRoutingOf } from '../../../shared/audioRouting'
import type { AudioSettings } from '../../../shared/workspace'
import type { VideoCue } from '../../../shared/visual'
import { audioEngine } from './audioEngineClient'
import { patchSlotOf } from './audioRouting'
import { startOptions, videoSound } from './CueEngine'

/** What an audition plays: a file, with the options a start carries. */
interface AuditionItem {
  label: string
  filePath: string
  options: AudioStartOptions
}

export interface AuditionState {
  /** What is playing, or null when nothing is. */
  playing: string | null
  /** How many more are queued behind it. */
  queued: number
  /** Why the last audition did not play, or null. */
  refusal: string | null
}

/** What the window says when the show has nowhere to audition to. */
export const NO_AUDITION_OUTPUT = 'Choose an audition output in Settings → Audio first'

/** A cue as an audition plays it, or null for a cue with no sound to play. */
export function auditionItemOf(cue: Cue): AuditionItem | null {
  if (cue.type === 'audio') {
    const audio = cue as AudioCue
    if (!audio.filePath) return null
    return { label: cue.name || audio.filePath, filePath: audio.filePath, options: startOptions(audio, 0, audio.trimSilence === true) }
  }
  if (cue.type === 'video') {
    const video = cue as VideoCue
    if (!video.filePath) return null
    return { label: cue.name || video.filePath, filePath: video.filePath, options: startOptions(videoSound(video)) }
  }
  return null
}

class AuditionPlayer {
  private state: AuditionState = { playing: null, queued: 0, refusal: null }
  private listeners = new Set<(state: AuditionState) => void>()
  private queue: AuditionItem[] = []
  private voice: string | null = null
  private seq = 0
  private unsubscribe: (() => void) | null = null

  current(): AuditionState {
    return this.state
  }

  subscribe(listener: (state: AuditionState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(state: Partial<AuditionState>): void {
    this.state = { ...this.state, ...state }
    for (const listener of this.listeners) listener(this.state)
  }

  /** Plays cues one after another on the audition output; the ones with no sound are passed over. */
  playCues(cues: readonly Cue[], settings: AudioSettings): boolean {
    const items = cues.map(auditionItemOf).filter((item): item is AuditionItem => item !== null)
    return this.play(items, settings)
  }

  /** Plays a whole file, from its start, on the audition output. */
  playFile(filePath: string, settings: AudioSettings): boolean {
    const name = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
    return this.play([{ label: name, filePath, options: defaultAudioStartOptions() }], settings)
  }

  private play(items: AuditionItem[], settings: AudioSettings): boolean {
    const routing = audioRoutingOf(settings)
    const slot = patchSlotOf(routing.auditionPatchId)
    if (slot < 0) {
      this.set({ refusal: NO_AUDITION_OUTPUT })
      return false
    }
    if (items.length === 0) {
      this.set({ refusal: 'Nothing in that has a sound to audition' })
      return false
    }
    this.stop()
    this.queue = items.map(item => ({ ...item, options: { ...item.options, patch: slot } }))
    this.unsubscribe ??= audioEngine.onEvent(event => {
      if (event.type === 'ended' && event.cueId === this.voice) this.next()
      if (event.type === 'error' && event.cueId !== null && event.cueId === this.voice) this.next()
    })
    this.set({ refusal: null })
    this.next()
    return true
  }

  private next(): void {
    const item = this.queue.shift()
    if (item === undefined) {
      this.voice = null
      this.set({ playing: null, queued: 0 })
      return
    }
    const voice = `audition:${++this.seq}`
    this.voice = voice
    this.set({ playing: item.label, queued: this.queue.length })
    void audioEngine.prepare(voice, item.filePath)
      .then(() => {
        if (this.voice !== voice) return undefined
        return audioEngine.start(voice, audioEngine.nowMs(), item.options)
      })
      .catch((error: unknown) => {
        if (this.voice !== voice) return
        this.set({ refusal: error instanceof Error ? error.message : String(error) })
        this.next()
      })
  }

  /** Ends the audition: what is playing stops over a short fade, and the queue is dropped. */
  stop(): void {
    this.queue = []
    const voice = this.voice
    this.voice = null
    if (voice !== null) void audioEngine.stop(voice, 30).catch(() => {})
    if (this.state.playing !== null || this.state.queued !== 0) this.set({ playing: null, queued: 0 })
  }
}

export const audition = new AuditionPlayer()
