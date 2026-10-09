// The picture half of a show: the outputs it is shown on, and the three cues that put
// something there — a video, an image, a line of text.
//
// An output is a window main owns and keeps open for as long as the show declares it: one
// canvas, composited every frame, so a cue that replaces another lands on a picture that was
// never taken down — no black frame between them, and no flicker as a window is made. What an
// output *is* belongs to the show (its name, the size it is composed at, the timer it carries,
// the way it is pinned to a projector's throw); *where* it is — which display, fullscreen or a
// window — belongs to the machine, because the same show runs on a laptop in rehearsal and on
// the venue's rig on the night. The second half lives in userData (`OutputPlacement`), beside
// the licence and the pair's settings, never in the showfile (spine AD-14).
//
// A video's sound is not the picture's: the picture element is muted, and the sound plays as
// an ordinary voice on the native engine — routing matrix, fades, meters and all — started on
// the engine's sample clock at the same instant the picture is due. The output follows that
// clock frame by frame (`visualSync.ts`), so the two stay together however long the video is.

import type { AudioCrosspoint, CueBase, FadeCurve } from './cue'
import type { FadeShape } from './fadeShape'
import type { BlendMode } from './visualBlend'
import type { GeometryKeyframe } from './visualKeyframes'
import type { CameraSourceKind } from './camera'

/** One of the nine places text — or the timer — is anchored to on an output. */
export type GridPosition =
  | 'top-left' | 'top' | 'top-right'
  | 'left' | 'center' | 'right'
  | 'bottom-left' | 'bottom' | 'bottom-right'

export const GRID_POSITIONS: readonly GridPosition[] = [
  'top-left', 'top', 'top-right',
  'left', 'center', 'right',
  'bottom-left', 'bottom', 'bottom-right'
]

/**
 * How a picture is sized to its output before the cue's own scale applies.
 *
 * `fit` shows all of it, letterboxed; `fill` covers the output, cropping what spills over;
 * `stretch` distorts it to the output's shape; `native` is one source pixel per output pixel.
 */
export type FitMode = 'fit' | 'fill' | 'stretch' | 'native'

export const FIT_MODES: readonly FitMode[] = ['fit', 'fill', 'stretch', 'native']

/** What is cut off each edge of the source before it is placed, as fractions of its size. */
export interface VisualCrop {
  top: number
  right: number
  bottom: number
  left: number
}

/**
 * Where a picture sits on its output. Every field applies live: an edit while the cue is up
 * moves the picture on the next frame.
 */
export interface VisualGeometry {
  fit: FitMode
  /** The picture's centre, right of the output's centre, as a fraction of the output's width. */
  x: number
  /** The picture's centre, below the output's centre, as a fraction of the output's height. */
  y: number
  /** A multiple of the fitted size: 1 is the fit, 0.5 half of it. */
  scale: number
  /** Degrees, clockwise, about the picture's own centre. */
  rotation: number
  crop: VisualCrop
}

export const DEFAULT_GEOMETRY: VisualGeometry = {
  fit: 'fit',
  x: 0,
  y: 0,
  scale: 1,
  rotation: 0,
  crop: { top: 0, right: 0, bottom: 0, left: 0 }
}

/** The ranges the inspector's controls offer, and what a load holds a file to. */
export const GEOMETRY_LIMITS = {
  offset: [-2, 2] as const,
  scale: [0.01, 10] as const,
  rotation: [-360, 360] as const,
  crop: [0, 0.95] as const
}

/** What every picture cue carries besides its content. */
export interface VisualCueBase extends CueBase {
  /**
   * The output the picture goes to. Empty means the show's first output — which is what a
   * new cue in a show with one output wants, and what keeps it working when that output is
   * replaced by another.
   */
  outputId: string
  /**
   * Stacking order on the output: higher is in front. Cues on the same layer stack in the
   * order they were fired, the newest in front.
   */
  layer: number
  /** The level the picture rests at once it is up, 0–1. A fade cue moves this. */
  opacity: number
  /** ms from the picture's first frame to `opacity`. */
  fadeInDuration: number
  /**
   * ms over which the picture fades to nothing so that it lands on its own end: the end of a
   * video's last play, or the end of an image's or text's display time. Nothing to land on — a
   * video that loops for ever, a picture held until it is stopped — and this does nothing.
   */
  fadeOutDuration: number
  geometry: VisualGeometry
  /**
   * Whether this picture dissolves in from whatever is on its output instead of fading up
   * over it: what is on the output at or below this cue's layer is taken down over the same
   * `fadeInDuration`, and the two pictures are mixed exactly — the old frame times one minus
   * the new — so nothing dips through black or shows through a letterbox on the way.
   */
  crossfade: boolean
  /**
   * How the picture is laid over what is behind it (src/shared/visualBlend.ts). Optional on
   * disk: absent is `normal`, which is every picture a show saved before blend modes had.
   */
  blendMode?: BlendMode
  /**
   * Where the picture moves to over its own play (src/shared/visualKeyframes.ts): from its own
   * geometry at its first frame, through each keyframe in turn. Optional on disk, and absent or
   * empty is a picture that stays where its geometry puts it.
   */
  keyframes?: GeometryKeyframe[]
  /**
   * Whether the next GO takes this picture down (over its own fade out), whatever that GO fires.
   * Absent or null follows the show's default (`PictureSettings.stopOnNextGo`); true or false is
   * this cue's own answer.
   */
  stopOnNextGo?: boolean | null
}

export interface VideoCue extends VisualCueBase {
  type: 'video'
  filePath: string
  /** ms into the file the picture and the sound start from. */
  startTime: number
  /** ms into the file they stop at, or null for the end of the file. */
  endTime: number | null
  /** 0 plays once, n plays n more times, −1 loops until it is stopped or devamped. */
  loopCount: number
  /**
   * Whether the last frame stays up when the video ends. The cue then runs until it is
   * stopped, as a held picture does; without it the picture goes when the video does.
   */
  holdLastFrame: boolean
  /** The sound's level, 0–1, and its pan. The sound is an engine voice like any audio cue's. */
  volume: number
  pan: number
  /** The sound's crosspoints, or null for automatic routing — exactly an audio cue's `outputs`. */
  outputs: AudioCrosspoint[] | null
  /** The output patch the sound plays through, as an audio cue's; absent is the device's channels. */
  outputPatchId?: string | null
  /** The sound's fade-in and fade-out shapes, as an audio cue's; absent is the line and the S-curve. */
  fadeInShape?: FadeShape | null
  fadeOutShape?: FadeShape | null
}

/** A still picture. Its `duration` is how long it is shown; 0 holds it until it is stopped. */
export interface ImageCue extends VisualCueBase {
  type: 'image'
  filePath: string
}

/** A line or more of text, drawn on the output. `duration` 0 holds it until it is stopped. */
export interface TextCue extends VisualCueBase {
  type: 'text'
  text: string
  /** A CSS font family. The output's own machine has to have it, or its fallback is used. */
  fontFamily: string
  /** Size in output pixels at the output's own resolution. */
  fontSize: number
  /** `#rrggbb`. */
  color: string
  bold: boolean
  italic: boolean
  /** Which of the nine places on the output the block is anchored to. */
  position: GridPosition
}

/**
 * A live picture: a capture device on this machine, or a network stream (src/shared/camera.ts).
 * It runs until it is stopped — a feed has no end of its own — so its `duration` is nought.
 */
export interface CameraCue extends VisualCueBase {
  type: 'camera'
  source: CameraSourceKind
  /**
   * The device by the name its driver gives it: what travels with the show. This machine's own
   * id for it is kept in userData, by cue id, and is never written here.
   */
  deviceName: string
  /** The stream's address, for a network source: HTTP(S) video, HLS or MJPEG. */
  url: string
}

export type VisualCue = VideoCue | ImageCue | TextCue | CameraCue
export type VisualCueType = VisualCue['type']

export const VISUAL_CUE_TYPES: readonly VisualCueType[] = ['video', 'image', 'text', 'camera']

/** Whether a cue puts a picture on an output. */
export function isVisualCue(cue: { type: string }): cue is VisualCue {
  return cue.type === 'video' || cue.type === 'image' || cue.type === 'text' || cue.type === 'camera'
}

/**
 * Whether a cue names a media file the show carries with it — the cues whose path is made
 * portable on save, resolved on load, bundled, relinked and counted in the footprint. A MIDI
 * file is one too: a show that plays a click track has to arrive with it.
 */
export function carriesMediaFile(cue: { type: string }): cue is { type: 'audio' | 'video' | 'image' | 'midiFile'; filePath: string } & CueBase {
  return cue.type === 'audio' || cue.type === 'video' || cue.type === 'image' || cue.type === 'midiFile'
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

/** A timer drawn over an output: what it counts, and where. */
export interface OutputTimer {
  /**
   * `off`; `clock` is the time of day; `elapsed` counts from the show's first GO; `remaining`
   * counts down the most recently started cue that has a known end.
   */
  mode: 'off' | 'clock' | 'elapsed' | 'remaining'
  position: GridPosition
  /** Height of the digits as a fraction of the output's height. */
  size: number
  color: string
}

export type TimerMode = OutputTimer['mode']
export const TIMER_MODES: readonly TimerMode[] = ['off', 'clock', 'elapsed', 'remaining']

/** One corner's offset from where it would be, as fractions of the output's width and height. */
export interface CornerOffset {
  x: number
  y: number
}

/**
 * How the finished picture is laid onto a projector's throw: four corners pinned
 * (perspective, for a projector that is not square to its screen) and soft edges, for two
 * projectors whose pictures overlap. Applied after everything else, so the timer and text
 * are pinned with the picture — which is what a calibration wants.
 */
export interface OutputWarp {
  /** Top-left, top-right, bottom-right, bottom-left. */
  corners: [CornerOffset, CornerOffset, CornerOffset, CornerOffset]
  /** The width of each soft edge, as a fraction of the output's width or height; 0 is none. */
  blend: { left: number; right: number; top: number; bottom: number }
  /** The soft edge's curve: 1 is a straight ramp, higher bends it for a projector's gamma. */
  gamma: number
}

/**
 * An image laid over an output's pictures as a mask: where it is white (or opaque) the pictures
 * show, where it is black (or clear) they do not. Stretched to the output's frame, and applied to
 * the pictures alone — the timer and the test pattern are drawn over it — before the corner pin,
 * so it is pinned with them.
 */
export interface OutputMask {
  filePath: string
  /** Which of the image's channels says how much shows: its brightness, or its transparency. */
  mode: 'luma' | 'alpha'
  /** Shows the pictures where the image is black instead. */
  invert: boolean
}

/** An output as the show declares it. */
export interface VideoOutput {
  id: string
  name: string
  /**
   * The size the output is composed at when its display cannot say — a window, or a display
   * that is not connected. Fullscreen on a display, the display's own size is used.
   */
  width: number
  height: number
  timer: OutputTimer
  warp: OutputWarp
  /**
   * Another output whose pictures this one shows — a confidence monitor at the desk, a second
   * projector stacked on the first. It shows that output's cues as that output composes them,
   * at that output's size, with its own timer and corner pin. Optional on disk: absent is an
   * output with pictures of its own.
   */
  mirrorOf?: string
  /** An image the pictures are masked by. Optional on disk: absent is no mask. */
  mask?: OutputMask
}

export const DEFAULT_OUTPUT_SIZE = { width: 1920, height: 1080 }

export const DEFAULT_TIMER: OutputTimer = {
  mode: 'off',
  position: 'bottom-right',
  size: 0.08,
  color: '#ffffff'
}

export function identityWarp(): OutputWarp {
  return {
    corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }],
    blend: { left: 0, right: 0, top: 0, bottom: 0 },
    gamma: 1
  }
}

/** Whether a warp leaves the picture exactly where it was: the pass that applies it is skipped. */
export function isIdentityWarp(warp: OutputWarp): boolean {
  return warp.corners.every(c => c.x === 0 && c.y === 0) &&
    warp.blend.left === 0 && warp.blend.right === 0 && warp.blend.top === 0 && warp.blend.bottom === 0
}

/** A new output. The id is the caller's: a random one from the window, a positional one in tests. */
export function createOutput(id: string, name: string): VideoOutput {
  return {
    id,
    name,
    ...DEFAULT_OUTPUT_SIZE,
    timer: { ...DEFAULT_TIMER },
    warp: identityWarp()
  }
}

/**
 * The output a cue's picture goes to: the one it names, else the show's first that has
 * pictures of its own (a mirror shows another's).
 */
export function outputFor(outputs: readonly VideoOutput[], outputId: string): VideoOutput | null {
  if (outputs.length === 0) return null
  return outputs.find(output => output.id === outputId) ??
    (outputId === '' ? outputs.find(output => output.mirrorOf === undefined) ?? outputs[0] : null)
}

// ─── Placement (a machine fact) ───────────────────────────────────────────────

/**
 * Where this machine puts one output. Kept in userData, keyed by the output's id, so a show
 * opened on another machine keeps its outputs and finds them a place of that machine's own.
 */
export interface OutputPlacement {
  /** The display, by the id the OS gives it; null is a window on whichever display is primary. */
  displayId: number | null
  /** The display's label when it was chosen, so a display that is gone can be named. */
  displayLabel: string
  /** Fullscreen on the display, or a window the operator can move. */
  fullscreen: boolean
  /** Where the window was left, when it is one. */
  bounds: { x: number; y: number; width: number; height: number } | null
}

export const DEFAULT_PLACEMENT: OutputPlacement = {
  displayId: null,
  displayLabel: '',
  fullscreen: false,
  bounds: null
}

/** A display as main reports it to the window. */
export interface DisplayInfo {
  id: number
  label: string
  bounds: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  primary: boolean
}

/** What one output is doing, as main reports it. */
export interface OutputStatus {
  outputId: string
  /** The window exists and has loaded. */
  open: boolean
  /** The size it is composed at, in output pixels. */
  width: number
  height: number
  /** How it draws: on the GPU, or the 2D fallback a machine without WebGL gets. */
  renderer: 'webgl' | 'canvas' | null
  /** The display it was placed on is not connected: it is showing in a window instead. */
  displayMissing: boolean
  placement: OutputPlacement
  /** The cues it is showing, bottom first. */
  layers: string[]
  testPattern: boolean
  /** Its window was closed by hand: the show still has the output, and it can be opened again. */
  windowClosed: boolean
  /** The output whose pictures it shows, when it mirrors one. */
  mirrorOf?: string
  /** A mask the output could not read, by its file's path. */
  maskMissing?: string
  /** The cameras its pictures name that are not giving a picture, each with the line it shows. */
  cameraProblems?: string[]
}

// ─── The cue defaults ─────────────────────────────────────────────────────────

export const VISUAL_BASE_DEFAULTS = {
  outputId: '',
  layer: 1,
  opacity: 1,
  fadeInDuration: 0,
  fadeOutDuration: 0,
  crossfade: false
}

export const VIDEO_DEFAULTS = {
  startTime: 0,
  endTime: null as number | null,
  loopCount: 0,
  holdLastFrame: false,
  volume: 1,
  pan: 0,
  outputs: null as AudioCrosspoint[] | null
}

export const TEXT_DEFAULTS = {
  text: 'Text',
  fontFamily: 'IBM Plex Sans',
  fontSize: 96,
  color: '#ffffff',
  bold: false,
  italic: false,
  position: 'center' as GridPosition
}

/** A fresh copy of the default geometry: a cue owns its own. */
export function defaultGeometry(): VisualGeometry {
  return { ...DEFAULT_GEOMETRY, crop: { ...DEFAULT_GEOMETRY.crop } }
}

/** The curve names a picture fade takes: the same three an audio fade does. */
export type OpacityCurve = FadeCurve

/** What a video, image or text file the window offers: the extensions Chromium decodes. */
export const VIDEO_FILE_EXTENSIONS = ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv'] as const
export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'] as const

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot + 1).toLowerCase()
}

export function isVideoFile(fileName: string): boolean {
  return (VIDEO_FILE_EXTENSIONS as readonly string[]).includes(extensionOf(fileName))
}

export function isImageFile(fileName: string): boolean {
  return (IMAGE_FILE_EXTENSIONS as readonly string[]).includes(extensionOf(fileName))
}

/**
 * The scheme the outputs and the window read media through. It serves only files whose
 * names say they are video or images, by path, with byte ranges — what a video element
 * needs to seek — and it is registered by main before the app is ready
 * (src/main/output/mediaProtocol.ts).
 */
export const MEDIA_SCHEME = 'cuerunner-media'

/** The URL a picture's file is read through. */
export function mediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(filePath)}`
}

/** The path a media URL names, or null for a URL that is not one. */
export function mediaPathOf(url: string): string | null {
  const prefix = `${MEDIA_SCHEME}://file/`
  if (!url.startsWith(prefix)) return null
  try {
    const path = decodeURIComponent(url.slice(prefix.length).split(/[?#]/)[0])
    return path === '' ? null : path
  } catch {
    return null
  }
}

// ─── Reading an output list off disk ──────────────────────────────────────────

function finiteIn(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(Math.max(value, min), max) : fallback
}

/** The most outputs a show declares: past it a list is not one this build wrote. */
export const MAX_OUTPUTS = 16

/**
 * A show's outputs as the window holds them: each one this build can draw, its numbers held
 * to their ranges and anything missing filled in, and nothing past `MAX_OUTPUTS`. A file the
 * funnel has already admitted is the input, so this repairs ranges, never shapes: an entry
 * that is not an object with an id is not an output and is left out.
 */
export function normalizeVideoOutputs(value: unknown): VideoOutput[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const outputs: VideoOutput[] = []
  for (const raw of value.slice(0, MAX_OUTPUTS)) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Partial<VideoOutput>
    if (typeof entry.id !== 'string' || entry.id === '' || seen.has(entry.id)) continue
    seen.add(entry.id)
    const timer: Partial<OutputTimer> = typeof entry.timer === 'object' && entry.timer !== null ? entry.timer : {}
    const warp: Partial<OutputWarp> = typeof entry.warp === 'object' && entry.warp !== null ? entry.warp : {}
    const corners = Array.isArray(warp.corners) ? warp.corners : []
    const blend: Partial<OutputWarp['blend']> = typeof warp.blend === 'object' && warp.blend !== null ? warp.blend : {}
    outputs.push({
      id: entry.id,
      name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : `Output ${outputs.length + 1}`,
      width: Math.round(finiteIn(entry.width, 16, 8192, DEFAULT_OUTPUT_SIZE.width)),
      height: Math.round(finiteIn(entry.height, 16, 8192, DEFAULT_OUTPUT_SIZE.height)),
      timer: {
        mode: TIMER_MODES.includes(timer.mode as TimerMode) ? timer.mode as TimerMode : DEFAULT_TIMER.mode,
        position: GRID_POSITIONS.includes(timer.position as GridPosition) ? timer.position as GridPosition : DEFAULT_TIMER.position,
        size: finiteIn(timer.size, 0.02, 0.5, DEFAULT_TIMER.size),
        color: typeof timer.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(timer.color) ? timer.color : DEFAULT_TIMER.color
      },
      warp: {
        corners: [0, 1, 2, 3].map(i => {
          const corner = corners[i] as Partial<CornerOffset> | undefined
          return { x: finiteIn(corner?.x, -1, 1, 0), y: finiteIn(corner?.y, -1, 1, 0) }
        }) as OutputWarp['corners'],
        blend: {
          left: finiteIn(blend.left, 0, 0.5, 0),
          right: finiteIn(blend.right, 0, 0.5, 0),
          top: finiteIn(blend.top, 0, 0.5, 0),
          bottom: finiteIn(blend.bottom, 0, 0.5, 0)
        },
        gamma: finiteIn(warp.gamma, 0.1, 5, 1)
      },
      ...(typeof entry.mirrorOf === 'string' && entry.mirrorOf !== '' && entry.mirrorOf !== entry.id ? { mirrorOf: entry.mirrorOf } : {}),
      ...maskOf(entry.mask)
    })
  }
  // A mirror shows an output that has pictures of its own: one that names an output the show
  // does not have, or another mirror, shows its own instead — a chain of mirrors is a loop
  // waiting to be made.
  const own = new Set(outputs.filter(output => output.mirrorOf === undefined).map(output => output.id))
  return outputs.map(output => {
    if (output.mirrorOf === undefined || own.has(output.mirrorOf)) return output
    const { mirrorOf: _dropped, ...rest } = output
    return rest
  })
}

function maskOf(value: unknown): { mask?: OutputMask } {
  if (typeof value !== 'object' || value === null) return {}
  const mask = value as Partial<OutputMask>
  if (typeof mask.filePath !== 'string' || mask.filePath === '') return {}
  return {
    mask: {
      filePath: mask.filePath,
      mode: mask.mode === 'alpha' ? 'alpha' : 'luma',
      invert: mask.invert === true
    }
  }
}

/** The output whose pictures an output shows: the one it mirrors, else itself. */
export function pictureSourceOf(outputs: readonly VideoOutput[], outputId: string): VideoOutput | null {
  const output = outputs.find(candidate => candidate.id === outputId)
  if (output === undefined) return null
  if (output.mirrorOf === undefined) return output
  const source = outputs.find(candidate => candidate.id === output.mirrorOf)
  return source !== undefined && source.mirrorOf === undefined ? source : output
}

// ─── The show's picture settings ──────────────────────────────────────────────

/**
 * What the show says about its pictures as a whole. A section of the show of its own
 * (`Workspace.pictures`), written only when it says something other than the defaults, so a
 * show that never touched it keeps the bytes it had.
 */
export interface PictureSettings {
  /** Whether a picture is taken down by the next GO unless its cue says otherwise. */
  stopOnNextGo: boolean
}

export function defaultPictureSettings(): PictureSettings {
  return { stopOnNextGo: false }
}

export function isDefaultPictureSettings(settings: PictureSettings): boolean {
  return settings.stopOnNextGo === false
}

/** The picture settings as a file carries them: anything missing or of the wrong kind is the default. */
export function normalizePictureSettings(value: unknown): PictureSettings {
  const entry = typeof value === 'object' && value !== null ? value as Partial<PictureSettings> : {}
  return { stopOnNextGo: entry.stopOnNextGo === true }
}

/** Whether the next GO takes a picture down: its cue's own answer, else the show's. */
export function stopsOnNextGo(cue: Pick<VisualCueBase, 'stopOnNextGo'>, settings: PictureSettings): boolean {
  return typeof cue.stopOnNextGo === 'boolean' ? cue.stopOnNextGo : settings.stopOnNextGo
}
