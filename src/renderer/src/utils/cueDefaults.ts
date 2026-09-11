import type {
  AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, NetworkCue, ScriptCue, SceneCue, Cue, CueType,
  AudioOutput
} from '../types/cue'

// Every field a new cue is born with. createCue builds on these, and the inspector's
// reset controls restore them — one definition, so the two can never drift apart.

type BaseDefaults = Pick<
  Cue,
  'colorLabel' | 'preWait' | 'postWait' | 'timelineOffset' | 'duration' | 'advance' | 'isArmed'
>

export const BASE_DEFAULTS: BaseDefaults = {
  colorLabel: 'none',
  preWait: 0,
  postWait: 0,
  timelineOffset: 0,
  duration: 0,
  advance: 'none',
  isArmed: true
}

export const AUDIO_DEFAULTS = {
  startTime: 0,
  endTime: null as number | null,
  fadeInDuration: 0,
  loopCount: 0,
  playbackRate: 1,
  trim: 1
}

export const AUDIO_OUTPUT_DEFAULTS: AudioOutput = { volume: 1, pan: 0 }

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
        ...AUDIO_DEFAULTS,
        outputs: [{ ...AUDIO_OUTPUT_DEFAULTS }]
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
