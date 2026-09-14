/** A cue's colour label, or none. */
export type CueColor = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'
export type CueType =
  | 'audio'
  | 'midi'
  | 'osc'
  | 'wait'
  | 'fade'
  | 'stop'
  | 'group'
  | 'network'
  | 'script'
  | 'scene'

/**
 * What a second firing does to a cue that is already running.
 *
 * `ignore` leaves it alone: the second press was a hand that shook, a desk that sent
 * twice, or a note that bounced, and the cue that is running is the cue that was meant.
 * `restart` is what the app used to do unconditionally — it is right for a cue that is
 * itself the repeat (a stinger, a hold chord), which is why it stays one setting away.
 */
export type RefirePolicy = 'ignore' | 'restart'

/**
 * A message a cue answers to, when nobody's hand is on the GO button.
 *
 * A MIDI trigger is identity, not value: a note fires whatever its velocity and a knob
 * fires whatever it is turned to. The desk decides when something happens; the cue only
 * decides whether it is the thing being talked to.
 */
export type TriggerMidiMessage =
  | { kind: 'noteOn'; channel: number; note: number }
  | { kind: 'noteOff'; channel: number; note: number }
  | { kind: 'cc'; channel: number; controller: number }
  | { kind: 'programChange'; channel: number; program: number }

export type CueTrigger =
  | { id: string; kind: 'osc'; address: string }
  /** `device` is the MIDI input port name, as the service reports it. */
  | { id: string; kind: 'midi'; device: string; message: TriggerMidiMessage }

export interface CueBase {
  id: string
  number: string
  name: string
  colorLabel: CueColor
  parentId: string | null
  preWait: number
  postWait: number
  timelineOffset: number
  duration: number
  advance: 'none' | 'on-start' | 'on-end'
  isArmed: boolean
  notes: string
  /**
   * What fires this cue besides GO. Optional on disk: a workspace saved before triggers
   * existed has none, and the migration fills the list in.
   */
  triggers?: CueTrigger[]
  /**
   * What a second firing does while this cue is running. Optional on disk for the same
   * reason as `triggers`, and absent means `ignore` — a show written before the policy
   * existed keeps every behaviour it had except the one that was the bug.
   */
  refire?: RefirePolicy
  /**
   * The line of the script this cue fires on, 1-based, for the script panel and the
   * tablet reading it. Null or absent means it is not pinned to anything.
   */
  scriptLine?: number | null
}

/**
 * One routing crosspoint: the file's channel `inputChannel` feeds the device's channel
 * `outputChannel` at `gain`. Both channels are zero-based, so a stereo file routed to
 * the first two device channels is `{inputChannel: 0, outputChannel: 0}` and
 * `{inputChannel: 1, outputChannel: 1}`.
 */
export interface AudioCrosspoint {
  inputChannel: number
  outputChannel: number
  gain: number
}

export interface AudioCue extends CueBase {
  type: 'audio'
  filePath: string
  startTime: number
  endTime: number | null
  fadeInDuration: number
  /** Master level, 0–1, applied to every output. */
  volume: number
  /** Master pan, −1 (left) to 1 (right); automatic routing spreads it across the pair. */
  pan: number
  /**
   * Crosspoints, or null for automatic channel routing. An empty list is not "no
   * routing": it is a cue that is deliberately silent, and it must not be read as
   * "automatic".
   */
  outputs: AudioCrosspoint[] | null
  loopCount: number
  playbackRate: number
  trim: number
}

export type MidiMessageKind =
  | { kind: 'noteOn'; channel: number; note: number; velocity: number }
  | { kind: 'noteOff'; channel: number; note: number; velocity: number }
  | { kind: 'cc'; channel: number; controller: number; value: number }
  | { kind: 'programChange'; channel: number; program: number }
  | { kind: 'sysex'; data: number[] }

export interface MidiCue extends CueBase {
  type: 'midi'
  portName: string
  messages: MidiMessageKind[]
}

export type OscArgType = 'i' | 'f' | 's' | 'T' | 'F'
export interface OscArg {
  type: OscArgType
  value: number | string | boolean
}

export interface OscCue extends CueBase {
  type: 'osc'
  host: string
  port: number
  address: string
  args: OscArg[]
}

export interface WaitCue extends CueBase {
  type: 'wait'
}

export type FadeCurve = 'linear' | 'sCurve' | 'logarithmic'

export interface FadeCue extends CueBase {
  type: 'fade'
  targetCueId: string
  fadeProperty: 'volume' | 'pan'
  targetValue: number
  curve: FadeCurve
  stopTargetWhenDone: boolean
}

export interface StopCue extends CueBase {
  type: 'stop'
  targetCueId: string | 'all'
  fadeOut: boolean
  fadeOutDuration: number
  waitForFade: boolean
}

export type GroupMode = 'playlist' | 'random' | 'sequence' | 'timeline'

export interface GroupCue extends CueBase {
  type: 'group'
  mode: GroupMode
}

export interface NetworkCue extends CueBase {
  type: 'network'
  method: 'GET' | 'POST' | 'PUT'
  url: string
  body: string
  headers: Record<string, string>
  timeout: number  // ms, defaults to 5000
}

export interface ScriptCue extends CueBase {
  type: 'script'
  language: 'javascript'
  script: string
  timeout: number  // ms, defaults to 60000; 0 runs without a timeout
}

/**
 * A cue that puts the desk where the scene says it should be: GO moves the show on and
 * the mics with it. The work — which groups change, and the messages that change them —
 * belongs to the scene, so this cue only names one.
 */
export interface SceneCue extends CueBase {
  type: 'scene'
  /** The scene to recall, or empty for a cue that has not been pointed at one yet. */
  sceneId: string
}

export type Cue =
  | AudioCue
  | MidiCue
  | OscCue
  | WaitCue
  | FadeCue
  | StopCue
  | GroupCue
  | NetworkCue
  | ScriptCue
  | SceneCue
