// One output's pictures: what is up, what each is doing, and the frame they make.
//
// Every frame the stage asks the engine clock what time it is and works out, from nothing but
// that and each picture's anchors, where each one is and how visible: a video's place in its
// file (and a nudge or a seek for the element if it has strayed — visualSync.ts), the level
// its fades have reached, whether its end has come. Nothing here counts frames or keeps a
// timer of its own, which is what lets a reloaded window, handed the same commands, draw the
// same picture.
//
// A picture is not drawn until its first frame is ready. Until then whatever was on the output
// stays exactly as it was — the picture underneath, the one being dissolved from — so there is
// never a black frame between two cues, and a fade-in or a dissolve starts its clock on the
// frame the audience first sees, not on the GO.

import type { LayerCommand, LayerSpec, OutputEvent, TextStyle, TimerFeed } from '../../../shared/ipc/output'
import { mediaUrl, type OutputMask, type OutputWarp, type TimerMode, type VideoOutput, type VisualGeometry } from '../../../shared/visual'
import { blendOf } from '../../../shared/visualBlend'
import {
  keyframedGeometry,
  moveGeometry,
  movesAfterEdit,
  shiftMoves,
  withMoves,
  type GeometryRamps
} from '../../../shared/visualKeyframes'
import type { CameraFeedState } from '../../../shared/camera'
import type { CameraFeed, CameraFeeds } from './cameraFeeds'
import {
  dissolveProgress,
  elapsedAt,
  fadeInFactor,
  fadeOutFactor,
  mediaPosition,
  playEndsAt,
  rampAt,
  reanchor,
  retarget,
  steady,
  stopFactor,
  stopLanded,
  type PlayAnchor,
  type Ramp,
  type StopFade
} from '../../../shared/visualClock'
import { dissolveTargets, planComposition, type PlanLayer } from '../../../shared/visualComposition'
import { gridCentre, placeLayer, textGeometry } from '../../../shared/visualGeometry'
import { rateWorthSetting, syncCorrection } from '../../../shared/visualSync'
import { createImage, createVideo, drawTestPattern, drawText, type Drawable } from './sources'
import type { DrawItem, Frame, MaskItem } from './render'

/** How long before its moment a video is put at its first frame, if nothing prepared it. */
const PREROLL_MS = 400
/** How far in from the edge text and the timer sit, as a fraction of the output's height. */
const MARGIN = 0.05

interface Layer {
  spec: LayerSpec
  drawable: Drawable
  video: HTMLVideoElement | null
  textCanvas: HTMLCanvasElement | null
  level: Ramp
  anchor: PlayAnchor
  releasedAt: number | null
  shownAt: number | null
  started: boolean
  stop: StopFade | null
  holding: boolean
  durationMs: number | null
  /** The element said it had played to its end. */
  elementEnded: boolean
  framePending: boolean
  /** Its fade-in was a dissolve from what was on the output. */
  dissolvedIn: boolean
  /**
   * The engine time a pause held it at, or null while it runs. Held, a picture's own clocks —
   * its fades, an image's display time — stand still with it; a video's place in its file is
   * its anchor's to hold.
   */
  heldAt: number | null
  /** The properties fade cues have moved, each on its own ramp (visualKeyframes.ts). */
  moves: GeometryRamps
  /** A live picture's feed. */
  feed: CameraFeed | null
  /** How the feed was last heard to be getting on, and the line it shows when it is not live. */
  feedState: { state: CameraFeedState; message: string } | null
}

interface Dissolve {
  incoming: string
  outgoing: string[]
  firstFrameMs: number
  durationMs: number
}

/** What the stage needs from the window it is in. */
export interface StageHost {
  now(): number
  /** A moment on the window's clock as engine ms: a video frame's presentation time. */
  toEngine(localMs: number): number
  emit(event: OutputEvent): void
  /** A texture the renderer can let go of. */
  release(key: string): void
  /** Where live pictures come from; an output with none shows a camera cue as a banner. */
  cameras?: CameraFeeds
  /** The mask could not be read (its path), or now has been (null). */
  maskStatus?(missing: string | null): void
}

interface MaskState {
  mask: OutputMask
  image: HTMLImageElement
  drawable: Drawable
}

export class Stage {
  private layers = new Map<string, Layer>()
  private prepared = new Map<string, { src: string; video: HTMLVideoElement }>()
  private mask: MaskState | null = null
  private dissolve: Dissolve | null = null
  private testPattern: { drawable: Drawable; canvas: HTMLCanvasElement } | null = null
  private timer: { drawable: Drawable; canvas: HTMLCanvasElement; text: string } | null = null
  private timerFeed: TimerFeed = { elapsedFrom: null, remaining: null }
  private timerMode: TimerMode = 'off'
  private output: VideoOutput | null = null
  width = 1920
  height = 1080

  constructor(private readonly host: StageHost) {}

  // ── What the output is ──────────────────────────────────────────────────────

  configure(output: VideoOutput | null, width: number, height: number): void {
    this.output = output
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    if (this.testPattern !== null) this.setTestPattern(true)
    if (output !== null) this.timerMode = output.timer.mode
    this.timer = null
    this.configureMask(output?.mask ?? null)
  }

  /** Loads the output's mask, when it names another than the one it has. */
  private configureMask(mask: OutputMask | null): void {
    if (mask === null) {
      if (this.mask !== null) this.host.release('__mask')
      this.mask = null
      this.host.maskStatus?.(null)
      return
    }
    if (this.mask !== null && this.mask.mask.filePath === mask.filePath) {
      // The same image, read another way: no need to read it again.
      this.mask = { ...this.mask, mask }
      return
    }
    if (this.mask !== null) this.host.release('__mask')
    const image = createImage(mediaUrl(mask.filePath))
    const state: MaskState = { mask, image, drawable: { element: image, width: 0, height: 0, version: 0, ready: false } }
    this.mask = state
    image.decode().then(() => {
      if (this.mask !== state) return
      state.drawable.width = image.naturalWidth
      state.drawable.height = image.naturalHeight
      state.drawable.version++
      state.drawable.ready = true
      this.host.maskStatus?.(null)
    }).catch(() => {
      // A mask that cannot be read masks nothing: the output says so rather than going black.
      if (this.mask === state) this.host.maskStatus?.(mask.filePath)
    })
  }

  warp(): OutputWarp | null {
    return this.output?.warp ?? null
  }

  setTestPattern(on: boolean): void {
    if (!on) {
      this.testPattern = null
      return
    }
    const canvas = document.createElement('canvas')
    drawTestPattern(canvas, this.width, this.height, this.output?.name ?? 'Output')
    this.testPattern = { canvas, drawable: { element: canvas, width: this.width, height: this.height, version: Date.now(), ready: true } }
  }

  setTimer(feed: TimerFeed, mode: TimerMode): void {
    this.timerFeed = feed
    this.timerMode = mode
  }

  /** Every engine time held, moved: the engine was replaced and counts from zero again. */
  rebase(deltaMs: number): void {
    for (const layer of this.layers.values()) {
      layer.spec = { ...layer.spec, at: layer.spec.at + deltaMs }
      layer.anchor = { ...layer.anchor, engineMs: layer.anchor.engineMs + deltaMs }
      layer.level = { ...layer.level, startMs: layer.level.startMs + deltaMs }
      if (layer.shownAt !== null) layer.shownAt += deltaMs
      if (layer.stop !== null) layer.stop = { ...layer.stop, atMs: layer.stop.atMs + deltaMs }
      if (layer.heldAt !== null) layer.heldAt += deltaMs
      layer.moves = shiftMoves(layer.moves, deltaMs)
    }
    if (this.dissolve !== null) this.dissolve.firstFrameMs += deltaMs
    if (this.timerFeed.elapsedFrom !== null || this.timerFeed.remaining !== null) {
      this.timerFeed = {
        elapsedFrom: this.timerFeed.elapsedFrom === null ? null : this.timerFeed.elapsedFrom + deltaMs,
        remaining: this.timerFeed.remaining === null ? null : { ...this.timerFeed.remaining, endsAt: this.timerFeed.remaining.endsAt + deltaMs }
      }
    }
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  apply(command: LayerCommand): void {
    const now = this.host.now()
    switch (command.op) {
      case 'play':
        this.play(command.layer)
        return
      case 'prepare':
        this.prepare(command.layer)
        return
      case 'clear':
        for (const layer of this.layers.values()) {
          if (layer.stop === null) layer.stop = { atMs: now, fadeMs: Math.max(0, command.fadeMs) }
        }
        return
    }
    const layer = this.layers.get(command.cueId)
    if (layer === undefined) return
    const at = 'at' in command && command.at > 0 ? command.at : now
    switch (command.op) {
      case 'update': {
        const patch = command.patch
        if (patch.opacity !== undefined && patch.opacity !== layer.spec.opacity) {
          layer.level = retarget(layer.level, patch.opacity, now, 0, 'linear')
        }
        // A property the operator changed by hand is theirs again; a fade's other moves stand.
        if (patch.geometry !== undefined) layer.moves = movesAfterEdit(layer.moves, layer.spec.geometry, patch.geometry)
        layer.spec = {
          ...layer.spec,
          ...(patch.layer !== undefined ? { layer: patch.layer } : {}),
          ...(patch.opacity !== undefined ? { opacity: patch.opacity } : {}),
          ...(patch.geometry !== undefined ? { geometry: patch.geometry } : {}),
          ...(patch.fadeOutMs !== undefined ? { fadeOutMs: patch.fadeOutMs } : {}),
          ...(patch.displayMs !== undefined ? { displayMs: patch.displayMs } : {}),
          ...(patch.text !== undefined ? { text: patch.text } : {}),
          ...(patch.blend !== undefined ? { blend: patch.blend } : {}),
          ...(patch.keyframes !== undefined ? { keyframes: patch.keyframes } : {})
        }
        if (patch.text !== undefined && layer.textCanvas !== null) this.renderText(layer, patch.text)
        return
      }
      case 'fade':
        layer.level = retarget(layer.level, command.to, at, command.durationMs, command.curve, command.shape ?? null)
        return
      case 'move':
        // From wherever the picture is when the move begins: its keyframes' place then, or a
        // move still running.
        layer.moves = moveGeometry(layer.moves, this.geometryAt(layer, at), command.to, at, command.durationMs, command.curve, command.shape ?? null)
        return
      case 'stop':
        if (layer.stop === null || at + command.fadeMs < layer.stop.atMs + layer.stop.fadeMs) {
          layer.stop = { atMs: at, fadeMs: Math.max(0, command.fadeMs) }
        }
        return
      case 'pause':
        layer.anchor = reanchor(layer.anchor, at, true)
        layer.video?.pause()
        // A live picture held stands on the frame it was showing.
        if (layer.feed?.element instanceof HTMLVideoElement) layer.feed.element.pause()
        if (layer.heldAt === null) layer.heldAt = at
        return
      case 'resume':
        layer.anchor = reanchor(layer.anchor, at, false)
        if (layer.heldAt !== null) {
          // Everything the picture keeps on the clock moves on by the time it was held.
          const held = Math.max(0, at - layer.heldAt)
          layer.heldAt = null
          layer.spec = { ...layer.spec, at: layer.spec.at + held }
          if (layer.shownAt !== null) layer.shownAt += held
          layer.level = { ...layer.level, startMs: layer.level.startMs + held }
          if (layer.stop !== null) layer.stop = { ...layer.stop, atMs: layer.stop.atMs + held }
          layer.moves = shiftMoves(layer.moves, held)
          // A dissolve into it was held with it.
          if (this.dissolve !== null && this.dissolve.incoming === layer.spec.cueId) this.dissolve.firstFrameMs += held
        }
        if (layer.started && layer.video !== null && !layer.holding) void layer.video.play().catch(() => {})
        if (layer.feed?.element instanceof HTMLVideoElement) void layer.feed.element.play().catch(() => {})
        return
      case 'seek':
        layer.anchor = { engineMs: at, elapsedMs: Math.max(0, command.elapsedMs), paused: layer.anchor.paused }
        layer.holding = false
        layer.elementEnded = false
        return
      case 'release':
        layer.releasedAt = elapsedAt(layer.anchor, at)
        return
      case 'anchor':
        if (!layer.anchor.paused) layer.anchor = { engineMs: at, elapsedMs: layer.spec.elapsedMs, paused: false }
        return
    }
  }

  private prepare(spec: LayerSpec): void {
    if (spec.kind === 'camera') {
      this.prepareFeed(spec)
      return
    }
    if (spec.kind !== 'video' || spec.src === null || this.layers.has(spec.cueId)) return
    const existing = this.prepared.get(spec.cueId)
    if (existing !== undefined && existing.src === spec.src) return
    if (existing !== undefined) disposeVideo(existing.video)
    const video = createVideo(spec.src)
    const startAt = ((spec.timeline?.startMs ?? 0) + spec.elapsedMs) / 1000
    video.addEventListener('loadedmetadata', () => { video.currentTime = startAt }, { once: true })
    this.prepared.set(spec.cueId, { src: spec.src, video })
    // A window that prepares many cues keeps the newest few decoders open.
    while (this.prepared.size > 4) {
      const [oldest, entry] = this.prepared.entries().next().value as [string, { video: HTMLVideoElement }]
      disposeVideo(entry.video)
      this.prepared.delete(oldest)
    }
  }

  private play(spec: LayerSpec): void {
    const replaced = this.layers.get(spec.cueId)
    if (replaced !== undefined) this.removeLayer(replaced, false)
    const layer: Layer = {
      spec,
      drawable: { element: document.createElement('canvas'), width: 0, height: 0, version: 0, ready: false },
      video: null,
      textCanvas: null,
      level: steady(spec.opacity),
      anchor: { engineMs: spec.at, elapsedMs: spec.elapsedMs, paused: false },
      releasedAt: null,
      shownAt: null,
      started: false,
      stop: null,
      holding: false,
      durationMs: spec.timeline?.durationMs ?? null,
      elementEnded: false,
      framePending: false,
      dissolvedIn: false,
      heldAt: null,
      moves: {},
      feed: null,
      feedState: null
    }
    if (spec.kind === 'camera') {
      this.layers.set(spec.cueId, layer)
      this.attachFeed(layer)
      return
    }
    if (spec.kind === 'video' && spec.src !== null) {
      const prepared = this.prepared.get(spec.cueId)
      let video: HTMLVideoElement
      if (prepared !== undefined && prepared.src === spec.src) {
        video = prepared.video
        this.prepared.delete(spec.cueId)
      } else {
        if (prepared !== undefined) {
          disposeVideo(prepared.video)
          this.prepared.delete(spec.cueId)
        }
        video = createVideo(spec.src)
      }
      layer.video = video
      layer.drawable = { element: video, width: video.videoWidth, height: video.videoHeight, version: 0, ready: false }
      const reportMedia = (): void => {
        layer.drawable.width = video.videoWidth
        layer.drawable.height = video.videoHeight
        const durationMs = Number.isFinite(video.duration) ? video.duration * 1000 : null
        layer.durationMs = durationMs
        this.host.emit({ kind: 'media', cueId: spec.cueId, outputId: spec.outputId, durationMs, width: video.videoWidth, height: video.videoHeight })
      }
      if (video.readyState >= 1) reportMedia()
      else video.addEventListener('loadedmetadata', reportMedia, { once: true })
      video.addEventListener('seeked', () => { layer.drawable.version++ })
      video.addEventListener('ended', () => { layer.elementEnded = true })
      video.addEventListener('error', () => {
        this.host.emit({ kind: 'error', cueId: spec.cueId, outputId: spec.outputId, message: mediaError(video) })
      }, { once: true })
    } else if (spec.kind === 'image' && spec.src !== null) {
      const image = createImage(spec.src)
      layer.drawable = { element: image, width: 0, height: 0, version: 0, ready: false }
      image.decode().then(() => {
        layer.drawable.width = image.naturalWidth
        layer.drawable.height = image.naturalHeight
        layer.drawable.version++
        layer.drawable.ready = true
        this.host.emit({ kind: 'media', cueId: spec.cueId, outputId: spec.outputId, durationMs: null, width: image.naturalWidth, height: image.naturalHeight })
      }).catch(() => {
        this.host.emit({ kind: 'error', cueId: spec.cueId, outputId: spec.outputId, message: 'the image could not be read' })
      })
    } else if (spec.kind === 'text' && spec.text !== null) {
      const canvas = document.createElement('canvas')
      layer.textCanvas = canvas
      layer.drawable = { element: canvas, width: 0, height: 0, version: 0, ready: false }
      this.renderText(layer, spec.text)
    }
    this.layers.set(spec.cueId, layer)
  }

  // ── Live pictures ───────────────────────────────────────────────────────────

  private preparedFeeds = new Map<string, { key: string; feed: CameraFeed; state: { state: CameraFeedState; message: string } }>()

  /** Opens a camera ahead of its GO, so its picture is live the moment it is asked for. */
  private prepareFeed(spec: LayerSpec): void {
    const cameras = this.host.cameras
    if (cameras === undefined || spec.camera === undefined || spec.camera === null || this.layers.has(spec.cueId)) return
    const key = JSON.stringify(spec.camera)
    if (this.preparedFeeds.get(spec.cueId)?.key === key) return
    this.preparedFeeds.get(spec.cueId)?.feed.close()
    const entry = { key, feed: null as unknown as CameraFeed, state: { state: 'connecting' as CameraFeedState, message: '' } }
    entry.feed = cameras.open(spec.camera, (state, message) => {
      entry.state = { state, message }
      // Once it is a picture's, the picture hears it.
      const layer = this.layers.get(spec.cueId)
      if (layer !== undefined && layer.feed === entry.feed) this.feedReport(layer, state, message)
    })
    this.preparedFeeds.set(spec.cueId, entry)
    // A camera held open is a device another program cannot have: the newest two are kept.
    while (this.preparedFeeds.size > 2) {
      const [oldest, held] = this.preparedFeeds.entries().next().value as [string, { feed: CameraFeed }]
      held.feed.close()
      this.preparedFeeds.delete(oldest)
    }
  }

  private attachFeed(layer: Layer): void {
    const spec = layer.spec
    const cameras = this.host.cameras
    if (spec.camera === undefined || spec.camera === null || cameras === undefined) {
      this.feedReport(layer, 'failed', 'this output cannot open a camera')
      return
    }
    const key = JSON.stringify(spec.camera)
    const prepared = this.preparedFeeds.get(spec.cueId)
    this.preparedFeeds.delete(spec.cueId)
    if (prepared !== undefined && prepared.key === key) {
      layer.feed = prepared.feed
      this.feedReport(layer, prepared.state.state, prepared.state.message)
      return
    }
    prepared?.feed.close()
    // A feed reports as it opens — before `open` has returned it — so its reports are the
    // layer's from the start rather than checked against a feed that is not there yet.
    let feed: CameraFeed | null = null
    feed = cameras.open(spec.camera, (state, message) => {
      if (this.layers.get(spec.cueId) === layer && (feed === null || layer.feed === feed)) this.feedReport(layer, state, message)
    })
    layer.feed = feed
  }

  private feedReport(layer: Layer, state: CameraFeedState, message: string): void {
    const previous = layer.feedState
    if (previous !== null && previous.state === state && previous.message === message) return
    layer.feedState = { state, message }
    this.host.emit({ kind: 'camera', cueId: layer.spec.cueId, outputId: layer.spec.outputId, state, message })
  }

  /** A live picture's frame, every frame it is giving them: it is up once the first one comes. */
  private advanceFeed(layer: Layer, now: number): void {
    const feed = layer.feed
    if (feed === null || feed.element === null) return
    const size = feed.size()
    const live = feed.state === 'live' && size.width > 0 && size.height > 0
    if (layer.drawable.element !== feed.element) {
      layer.drawable = { element: feed.element, width: size.width, height: size.height, version: layer.drawable.version + 1, ready: live }
    }
    layer.drawable.width = size.width
    layer.drawable.height = size.height
    layer.drawable.ready = live
    // A live picture changes every frame; held, it stands on the one it had.
    if (live && layer.heldAt === null) layer.drawable.version++
    if (live && layer.shownAt === null && now >= layer.spec.at) this.shown(layer, now)
  }

  /** The lines a live picture that cannot be shown draws across the output. */
  cameraLines(): string[] {
    const lines: string[] = []
    for (const layer of this.layers.values()) {
      const state = layer.feedState
      if (state !== null && state.state !== 'live' && state.state !== 'connecting' && state.message !== '') lines.push(state.message)
    }
    return lines
  }

  /** Each live picture, and how it is getting on: for the tests. */
  cameras(): Array<{ cueId: string; state: CameraFeedState; device: string }> {
    return [...this.layers.values()]
      .filter(layer => layer.spec.kind === 'camera')
      .map(layer => ({ cueId: layer.spec.cueId, state: layer.feedState?.state ?? 'connecting', device: layer.feed?.name ?? '' }))
  }

  private renderText(layer: Layer, style: TextStyle): void {
    if (layer.textCanvas === null) return
    drawText(layer.textCanvas, style)
    layer.drawable.width = layer.textCanvas.width
    layer.drawable.height = layer.textCanvas.height
    layer.drawable.version++
    layer.drawable.ready = true
  }

  /** Fonts arrived after the text was drawn: every text layer is drawn again in them. */
  redrawText(): void {
    for (const layer of this.layers.values()) {
      if (layer.spec.text !== null && layer.textCanvas !== null) this.renderText(layer, layer.spec.text)
    }
    this.timer = null
  }

  // ── The frame ───────────────────────────────────────────────────────────────

  frame(): Frame {
    const now = this.host.now()
    for (const layer of [...this.layers.values()]) this.advance(layer, now)
    this.advanceDissolve(now)

    const planLayers: PlanLayer[] = []
    const items = new Map<string, DrawItem>()
    for (const layer of this.layers.values()) {
      if (layer.shownAt === null || !layer.drawable.ready) continue
      const opacity = this.opacityOf(layer, now)
      planLayers.push({ cueId: layer.spec.cueId, layer: layer.spec.layer, seq: layer.spec.seq, opacity })
      items.set(layer.spec.cueId, {
        key: layer.spec.cueId,
        source: layer.drawable,
        placement: this.placementOf(layer, now),
        opacity,
        blend: blendOf(layer.spec.blend)
      })
    }
    const plan = planComposition(planLayers, this.dissolve === null ? null : {
      incoming: this.dissolve.incoming,
      outgoing: this.dissolve.outgoing,
      progress: dissolveProgress(this.dissolve.firstFrameMs, this.dissolve.durationMs, this.layers.get(this.dissolve.incoming)?.heldAt ?? now)
    })
    const toItems = (list: PlanLayer[]): DrawItem[] => list.map(entry => items.get(entry.cueId)).filter((item): item is DrawItem => item !== undefined)

    const overlays: DrawItem[] = []
    const timer = this.timerItem(now)
    if (timer !== null) overlays.push(timer)
    if (this.testPattern !== null) {
      overlays.push({
        key: '__test-pattern',
        source: this.testPattern.drawable,
        placement: placeLayer({ fit: 'stretch', x: 0, y: 0, scale: 1, rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 } }, this.testPattern.drawable, this),
        opacity: 1,
        blend: 'normal'
      })
    }
    return {
      plan: plan.kind === 'single'
        ? { kind: 'single', draws: toItems(plan.draws) }
        : { kind: 'dissolve', before: toItems(plan.before), after: toItems(plan.after), progress: plan.progress },
      overlays,
      mask: this.maskItem(),
      warp: this.output?.warp ?? { corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], blend: { left: 0, right: 0, top: 0, bottom: 0 }, gamma: 1 }
    }
  }

  /** The output's mask, once its image is read. */
  private maskItem(): MaskItem | null {
    const mask = this.mask
    if (mask === null || !mask.drawable.ready) return null
    return { key: '__mask', source: mask.drawable, mode: mask.mask.mode, invert: mask.mask.invert, filePath: mask.mask.filePath }
  }

  /**
   * Where a picture is at `now`: its own geometry, carried along its keyframes by how long it has
   * been up (pauses taken out), with every move a fade cue has made laid over that.
   */
  private geometryAt(layer: Layer, now: number): VisualGeometry {
    const t = layer.heldAt ?? now
    const elapsed = layer.shownAt === null ? 0 : Math.max(0, t - layer.shownAt)
    return withMoves(keyframedGeometry(layer.spec.geometry, layer.spec.keyframes, elapsed), layer.moves, t)
  }

  /** A picture's geometry as this frame draws it: for the tests. */
  geometry(cueId: string): VisualGeometry | null {
    const layer = this.layers.get(cueId)
    return layer === undefined ? null : this.geometryAt(layer, this.host.now())
  }

  /** Each video's element, as it stands: where it is in its file, and whether it is playing. */
  videos(): Array<{ cueId: string; positionMs: number; paused: boolean; rate: number; heldAt: number | null; anchorPaused: boolean }> {
    return [...this.layers.values()]
      .filter(layer => layer.video !== null)
      .map(layer => ({
        cueId: layer.spec.cueId,
        positionMs: Math.round(layer.video!.currentTime * 1000),
        paused: layer.video!.paused,
        rate: layer.video!.playbackRate,
        heldAt: layer.heldAt,
        anchorPaused: layer.anchor.paused
      }))
  }

  /** The cues showing, back to front, with the opacity each is drawn at — for the tests and the status. */
  showing(): Array<{ cueId: string; opacity: number }> {
    const now = this.host.now()
    return [...this.layers.values()]
      .filter(layer => layer.shownAt !== null)
      .sort((a, b) => a.spec.layer - b.spec.layer || a.spec.seq - b.spec.seq)
      .map(layer => ({ cueId: layer.spec.cueId, opacity: this.opacityOf(layer, now) }))
  }

  private placementOf(layer: Layer, now: number): ReturnType<typeof placeLayer> {
    const geometry = this.geometryAt(layer, now)
    if (layer.spec.kind === 'text' && layer.spec.text !== null) {
      const margin = this.height * MARGIN
      const anchor = gridCentre(layer.spec.text.position, layer.drawable, this, margin)
      return placeLayer(textGeometry(geometry), layer.drawable, this, anchor)
    }
    return placeLayer(geometry, layer.drawable, this)
  }

  private endsAt(layer: Layer): number | null {
    if (layer.spec.kind === 'video') {
      if (layer.spec.holdLastFrame || layer.spec.timeline === null || layer.releasedAt !== null) return null
      return playEndsAt({ ...layer.spec.timeline, durationMs: layer.durationMs ?? layer.spec.timeline.durationMs }, layer.anchor)
    }
    return layer.spec.displayMs !== null && layer.spec.displayMs > 0 ? layer.spec.at + layer.spec.displayMs : null
  }

  private opacityOf(layer: Layer, wallNow: number): number {
    const now = layer.heldAt ?? wallNow
    // A picture that dissolved in has the mix for its fade-in; one that had nothing to
    // dissolve from fades up over black like any other.
    const fadeIn = layer.dissolvedIn ? 1 : fadeInFactor(layer.shownAt, layer.spec.fadeInMs, now)
    const level = Math.min(Math.max(rampAt(layer.level, now), 0), 1)
    return level * fadeIn * fadeOutFactor(this.endsAt(layer), layer.spec.fadeOutMs, now) * stopFactor(layer.stop, now)
  }

  private advance(layer: Layer, now: number): void {
    const spec = layer.spec
    if (stopLanded(layer.stop, now)) {
      this.removeLayer(layer, true)
      return
    }
    if (spec.kind === 'video' && layer.video !== null) {
      this.advanceVideo(layer, layer.video, now)
    } else if (spec.kind === 'camera') {
      this.advanceFeed(layer, now)
    } else if (layer.shownAt === null && layer.drawable.ready && now >= spec.at) {
      this.shown(layer, now)
    }
    if (spec.kind !== 'video' && layer.heldAt === null) {
      const ends = this.endsAt(layer)
      if (ends !== null && now >= ends && layer.shownAt !== null) {
        this.host.emit({ kind: 'ended', cueId: spec.cueId, outputId: spec.outputId, at: ends, held: false })
        this.endedDuringDissolve(layer)
        this.removeLayer(layer, true)
      }
    }
  }

  private advanceVideo(layer: Layer, video: HTMLVideoElement, now: number): void {
    const spec = layer.spec
    const timeline = spec.timeline ?? { startMs: 0, endMs: null, durationMs: null, loopCount: 0 }
    const known = { ...timeline, durationMs: layer.durationMs ?? timeline.durationMs }
    const position = mediaPosition(known, elapsedAt(layer.anchor, now), layer.releasedAt)

    if (!layer.started) {
      if (now < spec.at - PREROLL_MS || video.readyState < 1) return
      const target = position.positionMs / 1000
      if (Math.abs(video.currentTime - target) > 0.02 && !video.seeking) video.currentTime = target
      if (now < spec.at) return
      layer.started = true
      if (!layer.anchor.paused) void video.play().catch(() => {})
      this.awaitFrame(layer, video)
      return
    }

    if (layer.shownAt === null && video.readyState >= 2) {
      // A frame is there but no presentation callback has said so: a video that was asked to
      // start paused, or one whose element Chromium is decoding without presenting — a
      // detached element it has not composited, an element woken from a suspended preload.
      // Once it is playing and has moved, its frame is on the texture the next draw uploads.
      const moving = !video.paused && video.currentTime * 1000 > (spec.timeline?.startMs ?? 0) + spec.elapsedMs + 40
      if (layer.anchor.paused || moving) {
        layer.framePending = false
        layer.drawable.width = video.videoWidth
        layer.drawable.height = video.videoHeight
        layer.drawable.version++
        this.shown(layer, now)
      }
    }

    if (layer.holding) return

    const ended = position.ended || (layer.elementEnded && !video.loop && position.positionMs >= (layer.durationMs ?? Infinity) - 50)
    if (ended) {
      if (spec.holdLastFrame) {
        layer.holding = true
        video.pause()
        layer.drawable.version++
        this.host.emit({ kind: 'ended', cueId: spec.cueId, outputId: spec.outputId, at: now, held: true })
      } else {
        this.host.emit({ kind: 'ended', cueId: spec.cueId, outputId: spec.outputId, at: now, held: false })
        this.endedDuringDissolve(layer)
        this.removeLayer(layer, true)
      }
      return
    }

    if (layer.anchor.paused) {
      if (!video.paused) video.pause()
      return
    }
    if (video.paused && !video.seeking && video.readyState >= 2) void video.play().catch(() => {})
    if (video.seeking || layer.shownAt === null) return
    const action = syncCorrection(position.positionMs, video.currentTime * 1000)
    if (action.kind === 'seek') {
      video.currentTime = action.toMs / 1000
    } else if (rateWorthSetting(video.playbackRate, action.rate)) {
      video.playbackRate = action.rate
    }
  }

  /** Waits for the first frame the audience sees; its moment is the picture's start. */
  private awaitFrame(layer: Layer, video: HTMLVideoElement): void {
    layer.framePending = true
    const onFrame = (localNow: number, metadata?: { expectedDisplayTime?: number }): void => {
      if (!this.layers.has(layer.spec.cueId) || this.layers.get(layer.spec.cueId) !== layer) return
      layer.drawable.width = video.videoWidth
      layer.drawable.height = video.videoHeight
      layer.drawable.version++
      layer.drawable.ready = true
      if (layer.shownAt === null) {
        layer.framePending = false
        this.shown(layer, this.host.toEngine(metadata?.expectedDisplayTime ?? localNow))
      }
      // Every presented frame is a new texture; nothing else is uploaded.
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(onFrame)
    }
    if ('requestVideoFrameCallback' in video) {
      video.requestVideoFrameCallback(onFrame)
    } else {
      const element = video as HTMLVideoElement
      element.addEventListener('playing', () => onFrame(performance.now()), { once: true })
    }
  }

  private shown(layer: Layer, at: number): void {
    if (layer.shownAt !== null) return
    layer.shownAt = at
    layer.drawable.ready = layer.drawable.width > 0 && layer.drawable.height > 0
    let outgoing: string[] = []
    if (layer.spec.crossfade) {
      // A dissolve already running lands now: one dissolve at a time on an output.
      if (this.dissolve !== null) this.finishDissolve()
      const candidates = [...this.layers.values()]
        .filter(other => other !== layer && other.shownAt !== null && other.stop === null)
        .map(other => ({ cueId: other.spec.cueId, layer: other.spec.layer }))
      outgoing = dissolveTargets(candidates, { cueId: layer.spec.cueId, layer: layer.spec.layer })
      if (outgoing.length > 0) {
        layer.dissolvedIn = true
        if (layer.spec.fadeInMs > 0) {
          this.dissolve = { incoming: layer.spec.cueId, outgoing, firstFrameMs: at, durationMs: layer.spec.fadeInMs }
        } else {
          this.dissolve = { incoming: layer.spec.cueId, outgoing, firstFrameMs: at, durationMs: 0 }
          this.finishDissolve()
        }
      }
    }
    this.host.emit({ kind: 'first-frame', cueId: layer.spec.cueId, outputId: layer.spec.outputId, at, outgoing })
  }

  private advanceDissolve(now: number): void {
    const dissolve = this.dissolve
    if (dissolve === null) return
    if (!this.layers.has(dissolve.incoming)) {
      // The picture being dissolved to was taken away: what it was replacing stays.
      this.dissolve = null
      return
    }
    const held = this.layers.get(dissolve.incoming)?.heldAt ?? null
    if (dissolveProgress(dissolve.firstFrameMs, dissolve.durationMs, held ?? now) >= 1) this.finishDissolve()
  }

  /**
   * A picture being dissolved to reached its own end before the dissolve did: what it was
   * replacing goes now, as it would have at the dissolve's end. A picture that was *stopped*
   * mid-dissolve is the other case — the operator took it back — and leaves what it was
   * replacing where it is (`advanceDissolve`).
   */
  private endedDuringDissolve(layer: Layer): void {
    if (this.dissolve !== null && this.dissolve.incoming === layer.spec.cueId) this.finishDissolve()
  }

  private finishDissolve(): void {
    const dissolve = this.dissolve
    if (dissolve === null) return
    this.dissolve = null
    const removed: string[] = []
    for (const cueId of dissolve.outgoing) {
      const layer = this.layers.get(cueId)
      if (layer === undefined) continue
      this.removeLayer(layer, true)
      removed.push(cueId)
    }
    const incoming = this.layers.get(dissolve.incoming)
    this.host.emit({ kind: 'dissolved', cueId: dissolve.incoming, outputId: incoming?.spec.outputId ?? '', removed })
  }

  private removeLayer(layer: Layer, announce: boolean): void {
    if (this.layers.get(layer.spec.cueId) !== layer) return
    this.layers.delete(layer.spec.cueId)
    if (layer.video !== null) disposeVideo(layer.video)
    // A camera let go of is a device another picture, or another program, can have.
    layer.feed?.close()
    this.host.release(layer.spec.cueId)
    if (announce) this.host.emit({ kind: 'gone', cueId: layer.spec.cueId, outputId: layer.spec.outputId })
  }

  private timerItem(now: number): DrawItem | null {
    if (this.timerMode === 'off' || this.output === null) return null
    const text = timerText(this.timerMode, this.timerFeed, now)
    if (text === '') return null
    const output = this.output
    if (this.timer === null || this.timer.text !== text) {
      const canvas = this.timer?.canvas ?? document.createElement('canvas')
      drawText(canvas, {
        text,
        fontFamily: 'IBM Plex Mono',
        fontSize: Math.max(8, output.timer.size * this.height),
        color: output.timer.color,
        bold: true,
        italic: false,
        position: output.timer.position
      })
      this.timer = { canvas, text, drawable: { element: canvas, width: canvas.width, height: canvas.height, version: Date.now(), ready: true } }
    }
    const drawable = this.timer.drawable
    const anchor = gridCentre(output.timer.position, drawable, this, this.height * MARGIN)
    return {
      key: '__timer',
      source: drawable,
      placement: placeLayer({ fit: 'native', x: 0, y: 0, scale: 1, rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 } }, drawable, this, anchor),
      opacity: 1,
      blend: 'normal'
    }
  }
}

function disposeVideo(video: HTMLVideoElement): void {
  try {
    video.pause()
    video.removeAttribute('src')
    video.load()
  } catch {
    // An element that is already gone has nothing to let go of.
  }
}

function mediaError(video: HTMLVideoElement): string {
  const code = video.error?.code
  if (code === 4) return 'this video is in a format the picture decoder cannot read'
  if (code === 3) return 'the video could not be decoded'
  if (code === 2) return 'the video file could not be read'
  return 'the video could not be played'
}

function pad(value: number): string {
  return String(Math.floor(value)).padStart(2, '0')
}

/** A duration as the timer shows it: `1:02:03`, `02:03`. */
export function formatTimer(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

/** What a timer reads at `now` (engine ms), or nothing when it has nothing to count. */
export function timerText(mode: TimerMode, feed: TimerFeed, now: number, wallClock: Date = new Date()): string {
  switch (mode) {
    case 'off':
      return ''
    case 'clock':
      return `${pad(wallClock.getHours())}:${pad(wallClock.getMinutes())}:${pad(wallClock.getSeconds())}`
    case 'elapsed':
      return feed.elapsedFrom === null ? formatTimer(0) : formatTimer(now - feed.elapsedFrom)
    case 'remaining':
      if (feed.remaining === null || feed.remaining.endsAt <= now) return ''
      // Rounded up, so a cue with half a second left reads 00:01, not 00:00.
      return `−${formatTimer(Math.ceil((feed.remaining.endsAt - now) / 1000) * 1000)}`
  }
}
