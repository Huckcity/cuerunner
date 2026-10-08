/** A cue's colour label, or none. */
export type CueColor = 'none' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | 'pink'

/**
 * Every cue type, as a list rather than only as a union: anything that has to cover all
 * of them — the icon set, a menu, a test — reads them from here, so a type added to the
 * union cannot be quietly missed by one of them.
 */
export const CUE_TYPES = [
  'audio', 'midi', 'osc', 'wait', 'fade', 'stop',
  'group', 'network', 'script', 'scene', 'devamp', 'msc', 'mic',
  'memo'
] as const

export type CueType = (typeof CUE_TYPES)[number]

/**
 * The cue types that need Cuerunner Pro: the class, declared beside the types themselves
 * so the refusal and the published record read one fact rather than spelling the same
 * literal twice.
 *
 * `scene` and `mic`. A cue that puts the desk somewhere the show can lose is a production
 * workflow, and so is one that opens and closes a radio mic from the cue list: both write to
 * live equipment on the show's behalf, where a send the operator's own hand caused is not,
 * whichever socket it uses. The runner refuses these through `isProCueType` when the machine
 * is unlicensed.
 */
export const PRO_CUE_TYPES = ['scene', 'mic'] as const satisfies readonly CueType[]

export type ProCueType = (typeof PRO_CUE_TYPES)[number]

/** Whether a cue type is Pro, and so refused where it runs without a licence. */
export function isProCueType(type: CueType): type is ProCueType {
  return PRO_CUE_TYPES.some(entry => entry === type)
}

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
  | { kind: 'cc'; channel: number; controller: number }
  | { kind: 'programChange'; channel: number; program: number }

export type CueTrigger =
  | { id: string; kind: 'osc'; address: string }
  /** `device` is the MIDI input port name, as the service reports it. */
  | { id: string; kind: 'midi'; device: string; message: TriggerMidiMessage }
  /**
   * A console's own show control command. Every field is matched, because that is what
   * makes it this cue's command and not another one's: the device it arrived from — a
   * MIDI input port, or the desk's own socket reported as "host:port" — the device ID it
   * is addressed to, what kind of equipment it is for, the command itself, and the cue it
   * names.
   */
  | {
      id: string
      kind: 'msc'
      device: string
      deviceId: number
      format: MscFormat
      command: MscCommand
      cueNumber: string
      cueList: string
    }

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
   * existed has none, and nothing fills it in — a cue with no list answers to GO alone.
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
  /**
   * Whether this cue plays only the part of its file between its first and last audible
   * samples, leaving the silence at the edges unheard. Optional on disk: a workspace
   * saved before this existed has none, and absent means off. It never rewrites the
   * region the operator set — turning it off plays the whole region again, unchanged.
   */
  trimSilence?: boolean
  /**
   * What the last measurement found: the audible extent of this cue's file. Written
   * down when the file is scanned, because playback must not wait for a scan — a cue
   * with the trim on and no measurement yet plays its whole region, which is exactly
   * what the cue did before the trim was asked for.
   */
  soundRegion?: SoundRegion | null
}

/**
 * The part of a file that is not silence, in ms from the file's own start.
 *
 * `silent` is a file whose samples never cross the threshold: its bounds span the whole
 * file, because a track with no sound in it has no silence at its edges to trim and a
 * cue trimmed to no length is a cue that plays nothing.
 */
export interface SoundRegion {
  startMs: number
  endMs: number
  /**
   * The whole length of the file, ms, as the scan measured it — carried so a cue whose
   * own length nobody has probed yet can still say how much silence it is dropping.
   */
  durationMs: number
  silent: boolean
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
/**
 * A cue that releases a vamping cue: the target stops looping its section and plays out
 * to the end of its file, from wherever the loop had reached. It acts on another cue the
 * way a stop or a fade does, which is why it names one instead of holding music itself.
 */
export interface DevampCue extends CueBase {
  type: 'devamp'
  /** The cue to release. Empty means it is not pointed at anything yet. */
  targetCueId: string
}

/**
 * A cue that mutes or unmutes a radio mic at its receiver: the pack that is offstage for the
 * scene, closed by the cue list rather than by someone's hand on a fader.
 *
 * It names a channel and says which way, and nothing else — never a toggle, because a toggle
 * run twice leaves the mic in the state the first run found it, and a cue list that can be
 * jumped around in cannot know which state that was. Muting what is muted is the state asked
 * for; the receiver is asked afterwards, and a mute that did not happen is an error the cue
 * says, never a mic left open in silence.
 */
export interface MicCue extends CueBase {
  type: 'mic'
  /** The channel the receiver reports it under, or empty for a cue not yet pointed at one. */
  channelId: string
  /** What it was called when it was chosen: so the cue reads the same when the receiver is off. */
  label: string
  action: 'mute' | 'unmute'
}

/**
 * A note in the stack: what the show needs said where it happens — "hold for the bow",
 * "LX 40 is called by the SM" — and nothing else. Its words are the cue's own name and
 * notes, so it carries no field of its own. GO on it completes at once and passes any
 * chain through it, so a memo between two cues never holds the show.
 */
export interface MemoCue extends CueBase {
  type: 'memo'
}

export interface SceneCue extends CueBase {
  type: 'scene'
  /** The scene to recall, or empty for a cue that has not been pointed at one yet. */
  sceneId: string
}

/**
 * The kind of equipment a MIDI Show Control command is addressed to. The bytes are the
 * specification's command formats; `all` is the 7F that reaches whatever is listening.
 */
export type MscFormat = 'lighting' | 'sound' | 'machinery' | 'video' | 'projection' | 'all'

/**
 * What a console is told to do. This is the set the desks a show is driven against
 * document: ETC's consoles take Go, Stop and Resume, and an Allen & Heath SQ's cue list
 * takes Go, Load and Reset.
 */
export type MscCommand = 'go' | 'stop' | 'resume' | 'load' | 'reset'

/**
 * A cue that tells another console what to do — the lighting desk to GO cue 12, an
 * automation system to reset. It is how sound talks to the rest of the building: the
 * desk's own show control, not a message this app invented.
 */
export interface MscCue extends CueBase {
  type: 'msc'
  command: MscCommand
  /** What kind of equipment it is for. Both this and the device ID have to match. */
  format: MscFormat
  /**
   * The receiving console's MIDI Show Control device ID, 0–126, or 127 for the all-call
   * every device has to answer. A show that has not been told otherwise broadcasts.
   */
  deviceId: number
  /** The cue number on that console: "12", "5.4". Empty means its next cue. */
  cueNumber: string
  /** Its cue list. Empty means whatever it has open. */
  cueList: string
  /**
   * Where the command goes: the show's desk connection, or a MIDI output port of this
   * machine, which is how a console on a cable is reached.
   */
  destination: 'desk' | 'port'
  /** The output port, when the destination is one. */
  portName: string
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
  | DevampCue
  | MscCue
  | MicCue
  | MemoCue
