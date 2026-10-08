import type {
  AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, NetworkCue, ScriptCue, SceneCue, DevampCue, MicCue,
  MscCue, Cue, CueType, AudioCrosspoint, MemoCue
} from '../../../shared/cue'

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
  fadeOutDuration: 0,
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

/**
 * The number a cue added to this list is born with: one past the highest whole number the
 * list already uses. A number is text — `12.5` and `LX 12` are both valid — so what is read
 * is the whole number a cue's own number begins with, and a number that begins with none
 * (`LX 12`) is nobody's place in the count.
 *
 * Read from the list rather than counted in the window: a counter that started at 1 with
 * the app gave a show that had just been opened a second cue 1, and carried on from
 * wherever the last show left it when a new one was made.
 */
export function nextCueNumber(cues: ReadonlyArray<Pick<Cue, 'number'>>): string {
  let highest = 0
  for (const cue of cues) {
    const whole = /^\s*(\d+)/.exec(cue.number)
    if (whole === null) continue
    const value = Number(whole[1])
    // A run of digits past what a number can count is a label, not a place in the count.
    if (Number.isSafeInteger(value)) highest = Math.max(highest, value)
  }
  return String(highest + 1)
}

/** What an audio cue is called until somebody, or a file, names it. */
export const DEFAULT_AUDIO_CUE_NAME = 'Audio Cue'

/** A cue's name from the file it plays: the file's own name, without its extension. */
export function cueNameFromFile(filePath: string): string {
  const filename = filePath.split(/[\\/]/).pop() ?? filePath
  const dotIdx = filename.lastIndexOf('.')
  return dotIdx > 0 ? filename.slice(0, dotIdx) : filename
}

function base(name: string, number: string): Omit<Cue, 'type'> {
  return {
    ...BASE_DEFAULTS,
    id: crypto.randomUUID(),
    number,
    name,
    parentId: null,
    notes: ''
  }
}

/**
 * A new cue of one type, with the defaults above. `number` is the caller's to give — the
 * list the cue is going into decides it (`nextCueNumber`) — and a cue made on its own is
 * the first cue of nothing.
 */
export function createCue(type: CueType, number = '1'): Cue {
  switch (type) {
    case 'audio':
      return {
        ...base(DEFAULT_AUDIO_CUE_NAME, number),
        type: 'audio',
        filePath: '',
        ...AUDIO_DEFAULTS
      } satisfies AudioCue
    case 'midi':
      return {
        ...base('MIDI Cue', number),
        type: 'midi',
        portName: '',
        messages: []
      } satisfies MidiCue
    case 'osc':
      return {
        ...base('OSC Cue', number),
        type: 'osc',
        ...OSC_DEFAULTS,
        args: []
      } satisfies OscCue
    case 'wait':
      return {
        ...base('Wait', number),
        type: 'wait',
        ...WAIT_DEFAULTS
      } satisfies WaitCue
    case 'fade':
      return {
        ...base('Fade Cue', number),
        type: 'fade',
        ...FADE_DEFAULTS
      } satisfies FadeCue
    case 'stop':
      return {
        ...base('Stop Cue', number),
        type: 'stop',
        ...STOP_DEFAULTS
      } satisfies StopCue
    case 'group':
      return {
        ...base('Group', number),
        type: 'group',
        ...GROUP_DEFAULTS
      } satisfies GroupCue
    case 'network':
      return {
        ...base('Network Cue', number),
        type: 'network',
        ...NETWORK_DEFAULTS
      } satisfies NetworkCue
    case 'script':
      return {
        ...base('Script Cue', number),
        type: 'script',
        ...SCRIPT_DEFAULTS
      } satisfies ScriptCue
    case 'scene':
      return {
        ...base('Scene Cue', number),
        type: 'scene',
        // Empty until the operator points it at one: a cue with no scene must not close
        // every mic on the desk, so the runner refuses it instead.
        sceneId: ''
      } satisfies SceneCue
    case 'devamp':
      return {
        ...base('Devamp', number),
        type: 'devamp',
        // Empty until it is pointed at one, for the same reason: a devamp aimed at
        // nothing must do nothing rather than guess which cue was vamping.
        targetCueId: ''
      } satisfies DevampCue
    case 'msc':
      return {
        ...base('Show Control', number),
        type: 'msc',
        ...MSC_DEFAULTS
      } satisfies MscCue
    case 'mic':
      return {
        ...base('Mic Cue', number),
        type: 'mic',
        // Empty until it is pointed at one: a mic cue aimed at nothing must do nothing rather
        // than guess which pack was meant.
        channelId: '',
        label: '',
        action: 'mute'
      } satisfies MicCue
    case 'memo':
      return {
        ...base('Memo', number),
        type: 'memo'
      } satisfies MemoCue
  }
}

export function formatDuration(ms: number): string {
  if (ms === 0) return '–'
  // Rounded to the tenth that is shown before it is split into minutes and seconds. Split
  // first and each part rounds on its own: 59.96 s read "60.0s" and 1:59.97 read "1:60.0",
  // a second that does not exist.
  const tenths = Math.round(ms / 100)
  const min = Math.floor(tenths / 600)
  const sec = (tenths % 600) / 10
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
