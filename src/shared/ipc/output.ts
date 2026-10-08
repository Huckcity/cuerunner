// Video outputs: the windows main keeps for the show's pictures, the commands that put
// pictures on them, and what they report back.
//
// Two bridges are declared here. `OutputBridge` is the control window's
// (`window.cuerunner.output`), part of the composed surface every other domain is in. The
// output windows have a preload of their own (src/preload/output.ts) and a bridge of their
// own, `OutputWindowBridge` — a smaller door for a page that only draws: it reads its first
// state, reads the engine's clock, and reports what it showed. Its channels are not in
// `CHANNEL_TABLES`, because the control window's bridge does not call them; they are declared
// in ./outputWindow.ts (a module of their own, so the two preloads share no code) and held
// to their own registrar by src/main/output/parity.test.ts.
//
// Every time a command carries is on the engine's sample clock, in engine milliseconds —
// never the window's show clock and never a wall clock — so an output can place a picture
// against the same clock the sound of it is scheduled on (spine AD-6).

import type { FadeCurve } from '../cue'
import type { MediaTimeline } from '../visualClock'
import type { AudioClockReading } from '../audio'
import type { DisplayInfo, GridPosition, OutputPlacement, OutputStatus, TimerMode, VideoOutput, VisualGeometry } from '../visual'
import type { BlendMode } from '../visualBlend'
import type { GeometryKeyframe, GeometryTarget } from '../visualKeyframes'
import type { CameraDevice, CameraFeedState, LayerCamera } from '../camera'
import type { Refusal } from './refusal'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const OUTPUT_CHANNELS = {
  /** The show's outputs, as the window holds them: main opens, updates and closes to match. */
  configure: 'output:configure',
  /** Every output's state, the displays this machine has, and the floating timer's. */
  snapshot: 'output:snapshot',
  /** Where this machine puts one output: a machine fact, kept in userData. */
  place: 'output:place',
  /** One picture command: play, fade, stop and the rest (`LayerCommand`). */
  layer: 'output:layer',
  /** Each output's name, drawn across it for a few seconds. */
  identify: 'output:identify',
  /** A test pattern over one output, or off again. */
  testPattern: 'output:testPattern',
  /** A small picture of what one output is showing, as a data URL. */
  preview: 'output:preview',
  /** What the timers count from: the show's first GO and the cue with an end nearest. */
  timer: 'output:timer',
  /** The always-on-top floating timer window, opened or closed (a machine fact). */
  timerWindow: 'output:timerWindow',
  /** A dialog for a video or image file. */
  pickFile: 'output:pickFile',
  /** What the outputs did, pushed: first frames, ends, dissolves, statuses. */
  events: 'output:events',
  /** The capture devices this machine's outputs can see, and the one each camera cue uses here. */
  cameras: 'output:cameras',
  /** This machine's device for one camera cue: a machine fact, kept in userData. */
  chooseCamera: 'output:chooseCamera',
  /** A dialog for a mask image. */
  pickMask: 'output:pickMask'
} as const

/** How a block of text is drawn. */
export interface TextStyle {
  text: string
  fontFamily: string
  fontSize: number
  color: string
  bold: boolean
  italic: boolean
  position: GridPosition
}

/** One picture, as an output is told to show it. */
export interface LayerSpec {
  cueId: string
  outputId: string
  kind: 'video' | 'image' | 'text' | 'camera'
  /** Firing order, for pictures on one layer: later is in front. */
  seq: number
  layer: number
  /** The level it rests at once it is up. */
  opacity: number
  geometry: VisualGeometry
  fadeInMs: number
  /** Lands on the picture's own end, when it has one. */
  fadeOutMs: number
  /** Dissolve in from what is on the output, over `fadeInMs`. */
  crossfade: boolean
  /** Engine ms the picture is due. */
  at: number
  /** The media's URL (`mediaUrl`), for a video or an image. */
  src: string | null
  /** A video's region and loops — the same its sound plays. */
  timeline: MediaTimeline | null
  /** How much of a video had already played at `at`: a cue started part-way in. */
  elapsedMs: number
  holdLastFrame: boolean
  /** How long an image or text is shown from `at`; null holds it until it is stopped. */
  displayMs: number | null
  text: TextStyle | null
  /** How it is laid over what is behind it. Absent is normal: a record main kept from before. */
  blend?: BlendMode
  /** Where it moves over its own play, from its first frame. Absent or empty is nowhere. */
  keyframes?: GeometryKeyframe[]
  /** A live picture's source. */
  camera?: LayerCamera | null
}

/** What may change about a picture while it is up. */
export interface LayerPatch {
  layer?: number
  opacity?: number
  geometry?: VisualGeometry
  blend?: BlendMode
  keyframes?: GeometryKeyframe[]
  fadeOutMs?: number
  text?: TextStyle
  displayMs?: number | null
}

export type LayerCommand =
  | { op: 'play'; layer: LayerSpec }
  /** Opens the media and puts it at its first frame, unseen, so a GO later starts at once. */
  | { op: 'prepare'; layer: LayerSpec }
  | { op: 'update'; cueId: string; patch: LayerPatch }
  /** Moves the resting level to `to` from `at`, over `durationMs`. */
  | { op: 'fade'; cueId: string; to: number; durationMs: number; curve: FadeCurve; at: number }
  /** Moves the picture's place to `to` from `at`, over `durationMs`: a fade cue's geometry. */
  | { op: 'move'; cueId: string; to: GeometryTarget; durationMs: number; curve: FadeCurve; at: number }
  /** Takes the picture down over `fadeMs`, from `at`. */
  | { op: 'stop'; cueId: string; fadeMs: number; at: number }
  | { op: 'pause'; cueId: string; at: number }
  | { op: 'resume'; cueId: string; at: number }
  /** Puts a video `elapsedMs` of play in, from `at`. */
  | { op: 'seek'; cueId: string; elapsedMs: number; at: number }
  /** A devamp: the loop is let go at `at` and the file plays out. */
  | { op: 'release'; cueId: string; at: number }
  /** The sound began at `at` rather than when it was asked for: the picture follows it. */
  | { op: 'anchor'; cueId: string; at: number }
  /** Everything off every output, over `fadeMs`. */
  | { op: 'clear'; fadeMs: number; at: number }

/** What an output did, as the control window hears it. */
export type OutputEvent =
  /** The picture's first frame is on screen, at engine ms `at`. A crossfade names what it is taking down. */
  | { kind: 'first-frame'; cueId: string; outputId: string; at: number; outgoing: string[] }
  /** A picture reached its own end and was taken down, or — held — stands on its last frame. */
  | { kind: 'ended'; cueId: string; outputId: string; at: number; held: boolean }
  /** A picture is off its output: a stop landed, a dissolve finished, or the output went. */
  | { kind: 'gone'; cueId: string; outputId: string }
  /** A dissolve into `cueId` finished; `removed` are the pictures it took down. */
  | { kind: 'dissolved'; cueId: string; outputId: string; removed: string[] }
  /** What the media turned out to be. */
  | { kind: 'media'; cueId: string; outputId: string; durationMs: number | null; width: number; height: number }
  | { kind: 'error'; cueId: string; outputId: string; message: string }
  /** How a live picture is getting on: a camera that is missing says so here, and when it is back. */
  | { kind: 'camera'; cueId: string; outputId: string; state: CameraFeedState; message: string }
  | { kind: 'status'; status: OutputStatus }
  /** The capture devices changed: one plugged in, one taken away. */
  | { kind: 'cameras'; cameras: CameraSnapshot }

/** What the timers count. Engine ms; null where there is nothing to count. */
export interface TimerFeed {
  /** When the show's first GO was, or null before it. */
  elapsedFrom: number | null
  /** The most recently started cue with a known end, and when that end is. */
  remaining: { label: string; endsAt: number } | null
}

/** The floating timer, as this machine keeps it. */
export interface TimerWindowState {
  open: boolean
  mode: Exclude<TimerMode, 'off'>
}

export interface OutputSnapshot {
  outputs: OutputStatus[]
  displays: DisplayInfo[]
  timerWindow: TimerWindowState
}

/**
 * The capture devices this machine has, as its outputs see them — an output window is the one
 * place camera access is granted, so a machine with no output open cannot list them — and the
 * device each camera cue uses here, by cue id.
 */
export interface CameraSnapshot {
  devices: CameraDevice[]
  /** Whether any output has been able to look: false is "open an output to list them". */
  listed: boolean
  choices: Record<string, CameraDevice>
}

export interface ChooseCameraPayload {
  cueId: string
  /** The device, or null to forget this machine's choice for the cue. */
  device: CameraDevice | null
}

export type OutputPlaceResult = Refusal | { ok: true; status: OutputStatus }
export type OutputCommandResult = Refusal | { ok: true }

/** The outputs, as the control window reads them (`window.cuerunner.output`). */
export interface OutputBridge {
  configure(outputs: VideoOutput[]): Promise<void>
  snapshot(): Promise<OutputSnapshot>
  place(outputId: string, placement: OutputPlacement): Promise<OutputPlaceResult>
  layer(command: LayerCommand): Promise<OutputCommandResult>
  identify(): Promise<void>
  testPattern(outputId: string, on: boolean): Promise<OutputCommandResult>
  preview(outputId: string): Promise<string | null>
  timer(feed: TimerFeed): Promise<void>
  timerWindow(state: TimerWindowState): Promise<TimerWindowState>
  pickFile(kind: 'video' | 'image'): Promise<string | null>
  onEvents(callback: (events: OutputEvent[]) => void): () => void
  cameras(): Promise<CameraSnapshot>
  chooseCamera(cueId: string, device: CameraDevice | null): Promise<CameraSnapshot>
  pickMask(): Promise<string | null>
}

export interface OutputPlacePayload {
  outputId: string
  placement: OutputPlacement
}

export interface OutputTestPatternPayload {
  outputId: string
  on: boolean
}

// ─── The output windows' own door ─────────────────────────────────────────────

/** What a window is, as main answers its `ready`. */
export interface OutputWindowInit {
  /** An output, or the floating timer. */
  role: 'output' | 'timer'
  output: VideoOutput | null
  /** The size it composes at. */
  width: number
  height: number
  /** What it should be showing: after a reload, the pictures it had. */
  layers: LayerSpec[]
  /** The commands since each picture was first played, so a reloaded window lands where it was. */
  commands: LayerCommand[]
  testPattern: boolean
  displayMissing: { label: string } | null
  timer: TimerFeed
  timerMode: TimerMode
}

/** Commands main sends an output window. */
export type OutputWindowCommand =
  | { kind: 'layer'; command: LayerCommand }
  | { kind: 'output'; output: VideoOutput; width: number; height: number; displayMissing: { label: string } | null }
  | { kind: 'testPattern'; on: boolean }
  | { kind: 'identify'; label: string; untilMs: number }
  | { kind: 'timer'; feed: TimerFeed; mode: TimerMode }

/** What an output window reports. */
export interface OutputWindowReport {
  events: OutputEvent[]
  /** How it draws, once it has found out. */
  renderer?: 'webgl' | 'canvas'
  /** The capture devices it can see, when it has looked (and again whenever they change). */
  cameras?: CameraDevice[]
  /** The mask it was given and could not read, or null once it has one (or none). */
  maskMissing?: string | null
}

export interface OutputWindowBridge {
  ready(): Promise<OutputWindowInit>
  clock(): Promise<AudioClockReading | null>
  report(report: OutputWindowReport): Promise<void>
  onCommands(callback: (commands: OutputWindowCommand[]) => void): () => void
}

/**
 * What an output window shows the acceptance suite (`window.__cuerunnerOutput`): how it draws,
 * the size it composes at, one pixel of the composed frame, and the pictures it has up. Read
 * only — nothing here changes what the output shows.
 */
export interface OutputProbe {
  renderer(): 'webgl' | 'canvas'
  size(): { width: number; height: number }
  pixel(x: number, y: number): number[]
  showing(): Array<{ cueId: string; opacity: number }>
  /** Each video's element: its place in its file, and whether it is playing. */
  videos(): Array<{ cueId: string; positionMs: number; paused: boolean; rate: number; heldAt: number | null; anchorPaused: boolean }>
  /** Each live picture, and how it is getting on. */
  cameras(): Array<{ cueId: string; state: CameraFeedState; device: string }>
  /** Each picture's geometry as this frame drew it: keyframes and moves applied. */
  geometry(cueId: string): VisualGeometry | null
  /** The line across the output, or '' when there is none. */
  banner(): string
}
