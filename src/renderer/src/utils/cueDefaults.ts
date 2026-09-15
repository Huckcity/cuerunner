import type {
  AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, NetworkCue, ScriptCue, SceneCue, DevampCue,
  MscCue, Cue, CueType, AudioCrosspoint
} from '../types/cue'

// Every field a new cue is born with. createCue builds on these, and the inspector's
// reset controls restore them — one definition, so the two can never drift apart.

type BaseDefaults = Pick<
  Cue,
  'colorLabel' | 'preWait' | 'postWait' | 'timelineOffset' | 'duration' | 'advance' | 'isArmed' | 'refire'
>

export const BASE_DEFAULTS: BaseDefaults = {
  colorLabel: 'none',
  preWait: 0,
  postWait: 0,
  timelineOffset: 0,
  duration: 0,
  advance: 'none',
  isArmed: true,
  // A cue that is running is not restarted by a second press of the same thing. See
  // `RefirePolicy`: the opt-out is there for the cue that is itself the repeat.
  refire: 'ignore'
}

export const AUDIO_DEFAULTS = {
  startTime: 0,
  endTime: null as number | null,
  fadeInDuration: 0,
  volume: 1,
  pan: 0,
  // Automatic channel routing: the file's own channel layout decides where it goes.
  // An empty list would be a cue that is deliberately silent, which is not what a new
  // cue means.
  outputs: null as AudioCrosspoint[] | null,
  loopCount: 0,
  playbackRate: 1,
  trim: 1,
  // A new cue plays its whole region unless the show says otherwise: the default is the
  // one that surprises nobody, and the show that wants the other one sets it in Settings.
  trimSilence: false
}

export const AUDIO_CROSSPOINT_DEFAULTS: AudioCrosspoint = { inputChannel: 0, outputChannel: 0, gain: 1 }

export const OSC_DEFAULTS = {
  host: '127.0.0.1',
  port: 53000,
  address: '/cue/1/start'
}

export const WAIT_DEFAULTS = { duration: 2000 }

export const FADE_DEFAULTS = {
  targetCueId: '',
  fadeProperty: 'volume' as const,
  targetValue: 0,
  curve: 'linear' as const,
  stopTargetWhenDone: true,
  duration: 3000
}

export const STOP_DEFAULTS = {
  targetCueId: 'all',
  fadeOut: false,
  fadeOutDuration: 500,
  waitForFade: false
}

export const GROUP_DEFAULTS = { mode: 'sequence' as const }

export const NETWORK_DEFAULTS = {
  method: 'GET' as const,
  url: 'http://',
  body: '',
  headers: {},
  timeout: 5000
}

export const SCRIPT_DEFAULTS = {
  language: 'javascript' as const,
  script: '',
  timeout: 60000
}

export const MSC_DEFAULTS = {
  command: 'go' as const,
  // The all-types format and the all-call device ID, which is the pair the desks' own
  // documents write for "go, whoever is listening": every device has to answer the
  // all-call, so a cue nobody has addressed yet still reaches the console in the room.
  format: 'all' as const,
  deviceId: 127,
  cueNumber: '',
  cueList: '',
  // The show's own desk connection, because a show has already been pointed at one; a
  // console on a cable is the other answer, and it is one field away.
  destination: 'desk' as const,
  portName: ''
}

let _counter = 1
function nextNumber(): string {
  return String(_counter++)
}

function base(name: string): Omit<Cue, 'type'> {
  return {
    ...BASE_DEFAULTS,
    id: crypto.randomUUID(),
    number: nextNumber(),
    name,
    parentId: null,
    notes: ''
  }
}

export function createCue(type: CueType): Cue {
  switch (type) {
    case 'audio':
      return {
        ...base('Audio Cue'),
        type: 'audio',
        filePath: '',
        ...AUDIO_DEFAULTS
      } satisfies AudioCue
    case 'midi':
      return {
        ...base('MIDI Cue'),
        type: 'midi',
        portName: '',
        messages: []
      } satisfies MidiCue
    case 'osc':
      return {
        ...base('OSC Cue'),
        type: 'osc',
        ...OSC_DEFAULTS,
        args: []
      } satisfies OscCue
    case 'wait':
      return {
        ...base('Wait'),
        type: 'wait',
        ...WAIT_DEFAULTS
      } satisfies WaitCue
    case 'fade':
      return {
        ...base('Fade Cue'),
        type: 'fade',
        ...FADE_DEFAULTS
      } satisfies FadeCue
    case 'stop':
      return {
        ...base('Stop Cue'),
        type: 'stop',
        ...STOP_DEFAULTS
      } satisfies StopCue
    case 'group':
      return {
        ...base('Group'),
        type: 'group',
        ...GROUP_DEFAULTS
      } satisfies GroupCue
    case 'network':
      return {
        ...base('Network Cue'),
        type: 'network',
        ...NETWORK_DEFAULTS
      } satisfies NetworkCue
    case 'script':
      return {
        ...base('Script Cue'),
        type: 'script',
        ...SCRIPT_DEFAULTS
      } satisfies ScriptCue
    case 'scene':
      return {
        ...base('Scene Cue'),
        type: 'scene',
        // Empty until the operator points it at one: a cue with no scene must not close
        // every mic on the desk, so the runner refuses it instead.
        sceneId: ''
      } satisfies SceneCue
    case 'devamp':
      return {
        ...base('Devamp'),
        type: 'devamp',
        // Empty until it is pointed at one, for the same reason: a devamp aimed at
        // nothing must do nothing rather than guess which cue was vamping.
        targetCueId: ''
      } satisfies DevampCue
    case 'msc':
      return {
        ...base('Show Control'),
        type: 'msc',
        ...MSC_DEFAULTS
      } satisfies MscCue
  }
}

export function formatDuration(ms: number): string {
  if (ms === 0) return '–'
  const s = ms / 1000
  const min = Math.floor(s / 60)
  const sec = s % 60
  if (min > 0) return `${min}:${sec.toFixed(1).padStart(4, '0')}`
  return `${sec.toFixed(1)}s`
}

// Wall-clock time of a timestamp, 24h with seconds: "17:10:41". Built from Date parts
// rather than toLocaleTimeString so the format is stable across locales.
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map(n => String(n).padStart(2, '0'))
    .join(':')
}
