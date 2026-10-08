// The picture half of the runner: turns a video, image or text cue's firing into commands for
// the output it is shown on, and hears what the outputs say back.
//
// The CueEngine still owns the run — its pre-wait, its end, its handover, its STOP — and the
// sound of a video is still an audio voice it schedules like any other. What lives here is the
// picture: when it is due (on the engine clock, the same instant the sound is), the fades it
// lands, where it sits, and the record of where each picture has got to, which is what a pause
// or a seek is worked out from. The output draws; this decides.

import type { Cue, FadeCurve } from '../../../shared/cue'
import type { VisualCue, VideoCue } from '../../../shared/visual'
import { mediaUrl } from '../../../shared/visual'
import { blendOf } from '../../../shared/visualBlend'
import { movesGeometry, normalizeKeyframes, type GeometryKeyframe, type GeometryTarget } from '../../../shared/visualKeyframes'
import type { LayerCommand, LayerPatch, LayerSpec, OutputCommandResult, OutputEvent, TextStyle } from '../../../shared/ipc/output'
import {
  elapsedAt,
  mediaPosition,
  playLengthMs,
  reanchor,
  type MediaTimeline,
  type PlayAnchor
} from '../../../shared/visualClock'
import { audioEngine } from './audioEngineClient'

/** What the runner needs from the CueEngine it serves. */
export interface VisualHost {
  /** A picture went without the runner asking: a dissolve took it, its output was removed. */
  pictureGone(cueId: string): void
  /** A picture reached its own end; `held` is a video standing on its last frame. */
  pictureEnded(cueId: string, held: boolean, atShowMs: number): void
  /** The file turned out to be this long. */
  measured(cueId: string, durationMs: number): void
  /** The picture could not be shown. */
  pictureFailed(cueId: string, message: string): void
  /**
   * A crossfade into `incoming` began taking these pictures down, on the incoming picture's
   * first frame: their sound goes with them, over the incoming cue's fade-in.
   */
  dissolving(incoming: string, outgoing: string[], fromShowMs: number): void
  /** The picture's first frame is on screen. */
  firstFrame(cueId: string, atShowMs: number): void
}

interface Showing {
  cueId: string
  kind: VisualCue['type']
  timeline: MediaTimeline | null
  anchor: PlayAnchor
  releasedAt: number | null
  /** The runner took the picture down itself: its `gone` is the answer, not news. */
  stopping: boolean
}

/** The timeline a video plays: the same region and loops its sound is started with. */
export function videoTimeline(cue: VideoCue): MediaTimeline {
  return {
    startMs: Math.max(0, cue.startTime),
    endMs: cue.endTime,
    durationMs: cue.duration > 0 ? cue.duration : null,
    loopCount: cue.loopCount
  }
}

/** How a text cue is drawn. */
export function textStyleOf(cue: Extract<VisualCue, { type: 'text' }>): TextStyle {
  return {
    text: cue.text,
    fontFamily: cue.fontFamily,
    fontSize: cue.fontSize,
    color: cue.color,
    bold: cue.bold,
    italic: cue.italic,
    position: cue.position
  }
}

/**
 * A picture as an output is told to show it, due at engine ms `at`, `seekMs` into the cue (a
 * timeline started part-way through it, a show taken over from another machine).
 */
export function layerSpecOf(cue: VisualCue, at: number, seq: number, seekMs = 0): LayerSpec {
  const base = {
    cueId: cue.id,
    outputId: cue.outputId,
    seq,
    layer: cue.layer,
    opacity: Math.min(Math.max(cue.opacity, 0), 1),
    geometry: cue.geometry,
    // A seek is not a fresh start: fading in again would duck the picture every time.
    fadeInMs: seekMs > 0 ? 0 : Math.max(0, cue.fadeInDuration),
    fadeOutMs: Math.max(0, cue.fadeOutDuration),
    crossfade: cue.crossfade && seekMs === 0,
    at,
    elapsedMs: Math.max(0, seekMs),
    holdLastFrame: false,
    displayMs: null as number | null,
    text: null as TextStyle | null,
    src: null as string | null,
    timeline: null as MediaTimeline | null,
    blend: blendOf(cue.blendMode),
    keyframes: keyframesOf(cue)
  }
  switch (cue.type) {
    case 'video':
      return { ...base, kind: 'video', src: mediaUrl(cue.filePath), timeline: videoTimeline(cue), holdLastFrame: cue.holdLastFrame }
    case 'image':
      return { ...base, kind: 'image', src: mediaUrl(cue.filePath), displayMs: cue.duration > 0 ? Math.max(1, cue.duration - seekMs) : null }
    case 'text':
      return { ...base, kind: 'text', text: textStyleOf(cue), displayMs: cue.duration > 0 ? Math.max(1, cue.duration - seekMs) : null }
    case 'camera':
      // A live picture has no length: it is up until it is stopped. This machine's own id for
      // the device is main's to add (userData), never the show's.
      return { ...base, kind: 'camera', camera: { source: cue.source, deviceId: '', deviceName: cue.deviceName, url: cue.url } }
  }
}

/** A cue's keyframes as an output draws them: held to their ranges, in order. */
export function keyframesOf(cue: VisualCue): GeometryKeyframe[] {
  return normalizeKeyframes(cue.keyframes, cue.geometry)
}

/** What may be applied to a picture that is up, from the cue as it now stands. */
export function livePatchOf(cue: VisualCue): LayerPatch {
  return {
    layer: cue.layer,
    opacity: Math.min(Math.max(cue.opacity, 0), 1),
    geometry: cue.geometry,
    fadeOutMs: Math.max(0, cue.fadeOutDuration),
    blend: blendOf(cue.blendMode),
    keyframes: keyframesOf(cue),
    ...(cue.type === 'text' ? { text: textStyleOf(cue) } : {})
  }
}

export class VisualRunner {
  private host: VisualHost | null = null
  private showing = new Map<string, Showing>()
  private seq = 0
  private listeners = new Set<() => void>()

  init(host: VisualHost): void {
    this.host = host
  }

  /** Whether the runner has a picture up (or on its way up) for this cue. */
  isShowing(cueId: string): boolean {
    return this.showing.has(cueId)
  }

  /** Whether that picture is paused. */
  isPaused(cueId: string): boolean {
    return this.showing.get(cueId)?.anchor.paused ?? false
  }

  /** Subscribes to a picture being paused, resumed, put up or taken down: the inspector's controls. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private changed(): void {
    for (const listener of [...this.listeners]) {
      try { listener() } catch { /* a listener cannot stop a cue */ }
    }
  }

  /**
   * Puts a cue's picture up at show time `atShowMs`. Answers with the output's own refusal
   * when there is nowhere to put it — no output in the show, or one this cue names that is gone.
   */
  play(cue: VisualCue, atShowMs: number, seekMs = 0): Promise<OutputCommandResult> {
    const at = audioEngine.engineTime(atShowMs)
    const spec = layerSpecOf(cue, at, ++this.seq, seekMs)
    this.showing.set(cue.id, {
      cueId: cue.id,
      kind: cue.type,
      timeline: spec.timeline,
      anchor: { engineMs: at, elapsedMs: spec.elapsedMs, paused: false },
      releasedAt: null,
      stopping: false
    })
    this.changed()
    return this.send({ op: 'play', layer: spec })
  }

  /**
   * Opens a video's file on its output ahead of its GO, so its first frame is ready when it is —
   * or a camera, so its picture is live the moment it is asked for.
   */
  prepare(cue: VisualCue): void {
    if (this.showing.has(cue.id)) return
    if (cue.type === 'video' && cue.filePath === '') return
    if (cue.type !== 'video' && cue.type !== 'camera') return
    void this.send({ op: 'prepare', layer: layerSpecOf(cue, 0, 0) })
  }

  /** Takes a picture down over `fadeMs`. */
  stop(cueId: string, fadeMs: number, atShowMs?: number): void {
    const showing = this.showing.get(cueId)
    if (showing === undefined) return
    showing.stopping = true
    this.showing.delete(cueId)
    this.changed()
    void this.send({ op: 'stop', cueId, fadeMs: Math.max(0, fadeMs), at: atShowMs === undefined ? 0 : audioEngine.engineTime(atShowMs) })
  }

  /** Every picture down: STOP, a panic, a stop cue aimed at everything. */
  stopAll(fadeMs: number): void {
    const had = this.showing.size > 0
    this.showing.clear()
    if (had) this.changed()
    void this.send({ op: 'clear', fadeMs: Math.max(0, fadeMs), at: 0 })
  }

  /** A main-process panic already cleared the outputs: only the record is forgotten. */
  forgetAll(): void {
    this.showing.clear()
    this.changed()
  }

  /** A fade cue moving a picture's level. */
  fade(cueId: string, to: number, durationMs: number, curve: FadeCurve, atShowMs: number): void {
    if (!this.showing.has(cueId)) return
    void this.send({
      op: 'fade',
      cueId,
      to: Math.min(Math.max(to, 0), 1),
      durationMs: Math.max(0, durationMs),
      curve,
      at: audioEngine.engineTime(atShowMs)
    })
  }

  /**
   * A fade cue moving a picture's place — its position, scale, rotation, crop — over the same
   * time and curve as its level.
   */
  move(cueId: string, to: GeometryTarget, durationMs: number, curve: FadeCurve, atShowMs: number): void {
    if (!this.showing.has(cueId) || !movesGeometry(to)) return
    void this.send({
      op: 'move',
      cueId,
      to,
      durationMs: Math.max(0, durationMs),
      curve,
      at: audioEngine.engineTime(atShowMs)
    })
  }

  /** An edit in the inspector, applied to the picture while it is up. */
  update(cue: Cue): void {
    if (!this.showing.has(cue.id)) return
    if (cue.type !== 'video' && cue.type !== 'image' && cue.type !== 'text' && cue.type !== 'camera') return
    void this.send({ op: 'update', cueId: cue.id, patch: livePatchOf(cue) })
  }

  /** The cues whose pictures are up (or on their way up). */
  showingIds(): string[] {
    return [...this.showing.keys()]
  }

  /** How far a video has played at show time `atShowMs`, pauses taken out. */
  elapsed(cueId: string, atShowMs: number): number | null {
    const showing = this.showing.get(cueId)
    if (showing === undefined) return null
    return elapsedAt(showing.anchor, audioEngine.engineTime(atShowMs))
  }

  /** Where in its file a video is at show time `atShowMs`, and which pass of its loop. */
  position(cueId: string, atShowMs: number): { positionMs: number; loop: number } | null {
    const showing = this.showing.get(cueId)
    if (showing === undefined || showing.timeline === null) return null
    const at = audioEngine.engineTime(atShowMs)
    const where = mediaPosition(showing.timeline, elapsedAt(showing.anchor, at), showing.releasedAt)
    return { positionMs: where.positionMs, loop: where.loop }
  }

  pause(cueId: string, atShowMs: number): void {
    const showing = this.showing.get(cueId)
    if (showing === undefined || showing.anchor.paused) return
    const at = audioEngine.engineTime(atShowMs)
    showing.anchor = reanchor(showing.anchor, at, true)
    this.changed()
    void this.send({ op: 'pause', cueId, at })
  }

  resume(cueId: string, atShowMs: number): void {
    const showing = this.showing.get(cueId)
    if (showing === undefined || !showing.anchor.paused) return
    const at = audioEngine.engineTime(atShowMs)
    showing.anchor = reanchor(showing.anchor, at, false)
    this.changed()
    void this.send({ op: 'resume', cueId, at })
  }

  /** Puts a video `elapsedMs` of play in, from show time `atShowMs`. */
  seek(cueId: string, elapsedMs: number, atShowMs: number): void {
    const showing = this.showing.get(cueId)
    if (showing === undefined) return
    const at = audioEngine.engineTime(atShowMs)
    showing.anchor = { engineMs: at, elapsedMs: Math.max(0, elapsedMs), paused: showing.anchor.paused }
    this.changed()
    void this.send({ op: 'seek', cueId, elapsedMs: Math.max(0, elapsedMs), at })
  }

  /** A devamp: the loop is let go and the file plays out. */
  release(cueId: string, atShowMs: number): boolean {
    const showing = this.showing.get(cueId)
    if (showing === undefined || showing.timeline === null || showing.timeline.loopCount === 0) return false
    const at = audioEngine.engineTime(atShowMs)
    showing.releasedAt = elapsedAt(showing.anchor, at)
    void this.send({ op: 'release', cueId, at })
    return true
  }

  /** The sound began at show time `startedShowMs`, not when it was asked to: the picture follows it. */
  anchor(cueId: string, startedShowMs: number): void {
    const showing = this.showing.get(cueId)
    if (showing === undefined || showing.anchor.paused) return
    const at = audioEngine.engineTime(startedShowMs)
    showing.anchor = { engineMs: at, elapsedMs: showing.anchor.elapsedMs, paused: false }
    void this.send({ op: 'anchor', cueId, at })
  }

  /** The length of a video's whole play, every loop, once its file's length is known. */
  playLength(cueId: string): number | null {
    const timeline = this.showing.get(cueId)?.timeline
    return timeline === null || timeline === undefined ? null : playLengthMs(timeline)
  }

  /** What the outputs said. */
  handle(events: OutputEvent[]): void {
    const host = this.host
    if (host === null) return
    for (const event of events) {
      switch (event.kind) {
        case 'first-frame':
          host.firstFrame(event.cueId, audioEngine.showTime(event.at))
          if (event.outgoing.length > 0) host.dissolving(event.cueId, event.outgoing, audioEngine.showTime(event.at))
          break
        case 'media': {
          const showing = this.showing.get(event.cueId)
          if (showing !== undefined && showing.timeline !== null && event.durationMs !== null && event.durationMs > 0) {
            showing.timeline = { ...showing.timeline, durationMs: event.durationMs }
          }
          if (event.durationMs !== null && event.durationMs > 0) host.measured(event.cueId, event.durationMs)
          break
        }
        case 'ended':
          if (!event.held) {
            const showing = this.showing.get(event.cueId)
            if (showing !== undefined) showing.stopping = true
          }
          host.pictureEnded(event.cueId, event.held, audioEngine.showTime(event.at))
          break
        case 'gone': {
          const showing = this.showing.get(event.cueId)
          if (showing === undefined || showing.stopping) {
            this.showing.delete(event.cueId)
            break
          }
          this.showing.delete(event.cueId)
          this.changed()
          host.pictureGone(event.cueId)
          break
        }
        case 'dissolved':
          for (const cueId of event.removed) {
            if (this.showing.has(cueId)) {
              this.showing.delete(cueId)
              host.pictureGone(cueId)
            }
          }
          this.changed()
          break
        case 'error':
          host.pictureFailed(event.cueId, event.message)
          break
        case 'status':
          break
      }
    }
  }

  private send(command: LayerCommand): Promise<OutputCommandResult> {
    return window.cuerunner.output.layer(command).catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error)
    }))
  }
}

export const visualCues = new VisualRunner()
