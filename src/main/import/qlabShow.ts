// A QLab show, as the two readers hand it to the mapping.
//
// The workspace file and the OSC interface describe the same cues in different words —
// the file's properties are QLab's archived ones, the OSC replies are its scripting
// vocabulary — so each reader turns what it was given into this one record, and the
// mapping (`qlabMap.ts`) only ever reads this. Times are seconds, the way QLab writes
// them; levels are linear gains; everything a reader could not find is absent rather than
// guessed, so the mapping can tell "QLab said 0" from "QLab said nothing".

/** The cue types QLab has, by the key both readers normalise a type name to. */
export type QLabKind =
  | 'audio' | 'mic' | 'video' | 'camera' | 'text' | 'light'
  | 'fade' | 'network' | 'midi' | 'midifile' | 'timecode'
  | 'group' | 'start' | 'stop' | 'pause' | 'load' | 'reset' | 'devamp'
  | 'goto' | 'target' | 'arm' | 'disarm' | 'wait' | 'memo' | 'script'
  | 'unknown'

/** QLab's own name for each kind, for the report. */
export const QLAB_TYPE_LABELS: Record<QLabKind, string> = {
  audio: 'Audio', mic: 'Mic', video: 'Video', camera: 'Camera', text: 'Text', light: 'Light',
  fade: 'Fade', network: 'Network', midi: 'MIDI', midifile: 'MIDI File', timecode: 'Timecode',
  group: 'Group', start: 'Start', stop: 'Stop', pause: 'Pause', load: 'Load', reset: 'Reset',
  devamp: 'Devamp', goto: 'GoTo', target: 'Target', arm: 'Arm', disarm: 'Disarm',
  wait: 'Wait', memo: 'Memo', script: 'Script', unknown: 'Unknown'
}

/**
 * The kind a type name means: a class from the file (`AudioCue`, `OSCCue`) or a type from
 * an OSC reply (`Audio`, `MIDI File`, `Titles`). QLab has renamed some types between
 * versions — QLab 4's OSC cue is QLab 5's Network cue, its Titles cue is the Text cue — and
 * both spellings land on the same kind.
 */
export function qlabKind(typeName: string): QLabKind {
  const key = typeName.replace(/Cue$/, '').replace(/[\s_-]/g, '').toLowerCase()
  switch (key) {
    case 'audio': return 'audio'
    case 'mic': return 'mic'
    case 'video': return 'video'
    case 'camera': return 'camera'
    case 'text':
    case 'titles': return 'text'
    case 'light': return 'light'
    case 'fade': return 'fade'
    case 'network':
    case 'osc': return 'network'
    case 'midi': return 'midi'
    case 'midifile': return 'midifile'
    case 'timecode': return 'timecode'
    case 'group': return 'group'
    case 'start': return 'start'
    case 'stop': return 'stop'
    case 'pause': return 'pause'
    case 'load': return 'load'
    case 'reset': return 'reset'
    case 'devamp': return 'devamp'
    case 'goto': return 'goto'
    case 'target': return 'target'
    case 'arm': return 'arm'
    case 'disarm': return 'disarm'
    case 'wait': return 'wait'
    case 'memo': return 'memo'
    case 'script': return 'script'
    default: return 'unknown'
  }
}

/** Where an audio file is, as QLab recorded it. Either half may be empty. */
export interface QLabMedia {
  /** Relative to the workspace's own folder, the half that survives the show being moved. */
  relative: string
  /** The absolute path QLab last saw the file at, on the machine it was saved on. */
  absolute: string
}

/** A MIDI cue's message, in QLab's terms. */
export interface QLabMidi {
  /** 1 a voice message, 2 MIDI Show Control, 3 SysEx. */
  messageType: number
  /** For a voice message, QLab's index into the status nibbles: 0 note off, 1 note on, 2 key pressure, 3 control change, 4 program change, 5 channel pressure, 6 pitch bend. */
  status: number
  /** 1–16. */
  channel: number
  byte1: number
  byte2: number
  /** The destination port's name, where the workspace's patch says it. */
  port: string
  msc?: {
    /** MSC's command format byte: 0x01 lighting, 0x10 sound, 0x7F all. */
    format: number
    /** MSC's command byte: 0x01 GO, 0x02 STOP, 0x03 RESUME, 0x05 LOAD, 0x0A RESET. */
    command: number
    deviceId: number
    cueNumber: string
    cueList: string
  }
  /** SysEx bytes, delimiters optional. */
  sysex?: number[]
}

/** A Network (QLab 4: OSC) cue's message, in QLab's terms. */
export interface QLabNetwork {
  /** What it sends: an OSC message, a QLab command, plain text or raw hex bytes. */
  kind: 'osc' | 'qlab' | 'text' | 'hex' | 'unknown'
  /** The message as QLab writes it: an address and its arguments, or the text or bytes. */
  message: string
  /** Where it goes, from the workspace's patch. Null where it is not known. */
  host: string | null
  port: number | null
  /** The patch's name, for the report when the destination is not known. */
  patch: string
}

export interface QLabCue {
  kind: QLabKind
  /** The type as QLab said it, for a cue whose kind is `unknown`. */
  typeName: string
  uniqueID: string
  number: string
  name: string
  notes: string
  colorName: string
  armed: boolean
  /** Seconds. */
  preWait: number
  postWait: number
  duration: number
  /** 0 do not continue, 1 auto-continue, 2 auto-follow. */
  continueMode: number
  /** The cue a fade, stop, devamp, start or other control cue acts on. */
  target?: { uniqueID: string; number: string }
  media?: QLabMedia
  startTime?: number
  endTime?: number
  playCount?: number
  infiniteLoop?: boolean
  rate?: number
  /** An audio cue's levels: the master, and the first two outputs where the cue sets them. */
  levels?: { master: number | null; left: number | null; right: number | null }
  /** What a fade fades to: the master level, and the pan its first two outputs make. */
  fadeTo?: { master: number | null; pan: number | null }
  stopTargetWhenDone?: boolean
  /** A group's mode: 1 start first and enter, 2 start first, 3 timeline, 4 random, 6 playlist. */
  groupMode?: number
  children?: QLabCue[]
  midi?: QLabMidi
  network?: QLabNetwork
  /** A Script cue's source. */
  script?: string
  /** Anything else worth keeping for a placeholder: a light command, a title's words. */
  detail?: string
}

export interface QLabList {
  name: string
  uniqueID: string
  /** A cart is a grid of buttons rather than a running order. */
  cart: boolean
  cues: QLabCue[]
}

export interface QLabShow {
  name: string
  lists: QLabList[]
  /**
   * The folder relative media paths are relative to: the workspace file's own, or null
   * for a show read over the network, whose paths are the other machine's absolutes.
   */
  baseDir: string | null
}

/** The most QLab cues an import converts. A show past this is refused rather than half read. */
export const MAX_IMPORTED_CUES = 10_000

/** Counts every cue in a list of cues, children included. */
export function countCues(cues: QLabCue[]): number {
  let total = 0
  const stack = [...cues]
  while (stack.length > 0) {
    const cue = stack.pop()!
    total++
    if (cue.children) stack.push(...cue.children)
  }
  return total
}
