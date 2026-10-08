import type { IntensityRule, LightEffect, LightLevel } from './dmx'
import type { TimecodeRate } from './timecode'
import type { FadeShape } from './fadeShape'
import type { CueSlices } from './slices'
import type { CueLoudness } from './loudness'

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
  'memo', 'midiFile', 'light',
  'timecode',
  'video', 'image', 'text',
  'input'
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
 *
 * `light` too: a Light cue puts a look on the rig that the lighting engine holds and sends on
 * the show's behalf for as long as the show runs, the way the desk is held by a scene.
 *
 * `timecode` too: a clock that drives the lighting desk, the video server and the band's
 * click from the cue list is the production running the building, not a send of its own.
 */
export const PRO_CUE_TYPES = ['scene', 'mic', 'light', 'timecode'] as const satisfies readonly CueType[]

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
  /**
   * A frame of the incoming SMPTE clock: the cue fires when the clock runs through it. The
   * label is read at the rate the clock arrives at, as an operator reads it off the desk.
   * Whichever wire the clock came in on, the trigger is the same — the receiver is the
   * machine's, the moment is the show's.
   */
  | { id: string; kind: 'timecode'; timecode: string }

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
  /**
   * How long, in ms, the cue fades to silence before its own end — the end of its region, or
   * of its last loop. Optional on disk: a show saved before it existed has none, and absent
   * is no fade, which is what that show did. A cue that loops for ever has no end to land a
   * fade on; it is faded by a fade cue or a stop cue, as it always was.
   */
  fadeOutDuration?: number
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
  /**
   * The output patch the cue plays through (src/shared/audioRouting.ts), by id; its matrix
   * then addresses the patch's channels. Absent or null is the device's own channels, which
   * is what every cue did before patches existed.
   */
  outputPatchId?: string | null
  /** The fade-in's drawn shape; absent or null is the straight line it always was. */
  fadeInShape?: FadeShape | null
  /** The fade-out's drawn shape; absent or null is the S-curve it always was. */
  fadeOutShape?: FadeShape | null
  /**
   * The file cut into slices, each played a number of times or until a devamp moves it on
   * (src/shared/slices.ts). With slices the loop count is not used. Absent or null is the one
   * region and its loop count.
   */
  slices?: CueSlices | null
  /** The last loudness measurement of the cue's file, which a normalise wrote down. */
  loudness?: CueLoudness | null
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
  /**
   * What the fade moves. `opacity` is a picture's: a video, image or text cue's layer on its
   * output, 0–1 (see src/shared/visual.ts). A video's sound is still `volume`.
   */
  fadeProperty: 'volume' | 'pan' | 'opacity'
  targetValue: number
  /**
   * Where a volume fade takes the pan as well, −1 to 1, over the same time and curve — the
   * sound that walks off to one side as it goes. Optional on disk, and absent or null is a
   * fade of the one property, which is what a show saved before it existed did.
   */
  panTargetValue?: number | null
  curve: FadeCurve
  stopTargetWhenDone: boolean
  /**
   * The fade's drawn shape, which plays in place of `curve` where there is one; `curve` stays
   * the nearest named shape, for a build that has no drawn ones. Absent or null is `curve`.
   */
  shape?: FadeShape | null
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
  /**
   * What the release does to a sliced (or looping) target: `next` lets the slice it is in
   * finish its pass and moves on to the next; `stop` ends the target at the end of that pass.
   * Absent is `next`, which is what a devamp always did.
   */
  devampMode?: 'next' | 'stop'
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

/**
 * A cue that plays a Standard MIDI File to one MIDI output port: a backing track's keys,
 * a click, a lighting desk's own timecoded show — whatever the file holds, at the file's own
 * tempo map, from main, where the port is.
 *
 * Everything about the performance is the file's. What the cue adds is where it goes and how
 * it is played there: the rate, the part of the file, how often it loops, which of its
 * channels reach the port and as which channel, and a transposition.
 */
export interface MidiFileCue extends CueBase {
  type: 'midiFile'
  /** The `.mid` on this machine, or empty for a cue that has not been given one. */
  filePath: string
  /** The output port, or empty for the show's own MIDI output port. */
  portName: string
  /** 1 is the file's own tempo; 2 plays it in half the time. */
  playbackRate: number
  /** Where in the file the cue starts, ms of the file at its own tempo. */
  startTime: number
  /** Where it stops, the same way, or null for the end of the file. */
  endTime: number | null
  /** 0 plays the region once, n plays it n more times, and −1 loops it until stopped. */
  loopCount: number
  /**
   * Sixteen entries, one per channel of the file: the channel it is sent on, 1–16, or 0 for
   * a channel that is not sent at all. `[1, 2, … 16]` is the file as written.
   */
  channelMap: number[]
  /** Semitones every note moves by; 0 is the file as written. */
  transpose: number
  /**
   * Whether the transposition reaches the file's channel 10 too. Off by default: that is
   * where a General MIDI file keeps its drums, and a transposed drum kit is other drums.
   */
  transposeDrums: boolean
}

/**
 * A cue that puts a look on the lighting rig: the parameters it names fade to its values over
 * its duration, and everything it does not name stays where the cues before it left it —
 * tracking, the way a lighting console runs a cue list. A later cue that sets the same
 * parameter takes it (latest takes precedence); intensity may instead combine highest takes
 * precedence with every other cue that asks for that.
 *
 * Stopping a Light cue stops its fade where it is and leaves the light on; a Stop cue with a
 * fade-out releases it, so what it holds fades home. A Fade cue aimed at one moves its
 * intensity to a share of what it set.
 */
export interface LightCue extends CueBase {
  type: 'light'
  /** What the cue changes, and nothing it tracks. */
  look: LightLevel[]
  /** Parameters that keep moving once the cue has run — a sine, a chase. */
  effects: LightEffect[]
  curve: FadeCurve
  intensity: IntensityRule
  /** The fade's drawn shape, in place of `curve` where there is one. Absent or null is `curve`. */
  shape?: FadeShape | null
}

/**
 * A live input through the engine: channels of an input device — a microphone, a line from
 * the band, a playback machine — played as a voice with a level, a pan, routing (or a patch)
 * and fades, until it is stopped. The input is resampled to the output's clock with drift
 * correction (native/audio/src/live_input.h), so a separate interface works as well as the
 * output's own.
 *
 * Not to be confused with the `mic` cue, which mutes and unmutes a radio mic at its
 * receiver; this one carries the sound.
 */
export interface InputCue extends CueBase {
  type: 'input'
  /** The input device by the id the engine lists it under; empty is the default input. */
  device: string
  /** The device's input channels, zero-based, that are the cue's own channels in order. */
  inputChannels: number[]
  /** Level, 0–1, and pan, −1 to 1, as an audio cue's. */
  volume: number
  pan: number
  /** ms; 0 opens at its level. */
  fadeInDuration: number
  /** How long a stop of this cue fades for, ms; 0 is a cut. */
  fadeOutDuration: number
  /** Crosspoints from the cue's channels, or null for automatic routing. */
  outputs: AudioCrosspoint[] | null
  outputPatchId?: string | null
  fadeInShape?: FadeShape | null
}

/**
 * A cue that runs a SMPTE clock: from a start time, to an end time or until it is stopped,
 * out of whichever of the three wires the rest of the building listens on — MTC to a MIDI
 * port, LTC from an output channel of the audio engine, ArtTimeCode to the lighting
 * network. The clock is one position read by all three, so they cannot disagree.
 */
export interface TimecodeCue extends CueBase {
  type: 'timecode'
  rate: TimecodeRate
  /** The label the clock starts from: `01:00:00:00`. */
  startTimecode: string
  /** The label it stops itself at, or empty to run until it is stopped. */
  endTimecode: string
  /**
   * Start from the clock being received instead, keep to it while it runs, and carry on
   * alone when it drops out: a jam sync, which is what regenerates a clock cleanly.
   */
  jamSync: boolean
  mtc: boolean
  /** The MIDI output for MTC; empty is the show's own MIDI port. */
  mtcPortName: string
  ltc: boolean
  /** The engine output channel LTC is written to, zero-based: a channel of its own. */
  ltcChannel: number
  /** LTC's level, dBFS. */
  ltcLevelDb: number
  artnet: boolean
  /** Where ArtTimeCode goes: a broadcast address, a node, or "host:port". */
  artnetHost: string
}
// The picture cues. Their shapes live with the rest of the visual model — outputs, geometry,
// layers — in src/shared/visual.ts, which imports nothing from here but `CueBase`.
import type { VideoCue, ImageCue, TextCue } from './visual'
export type { VideoCue, ImageCue, TextCue } from './visual'

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
  | MidiFileCue
  | LightCue
  | TimecodeCue
  | VideoCue
  | ImageCue
  | TextCue
  | InputCue
