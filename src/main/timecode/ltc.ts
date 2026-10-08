/**
 * The engine's LTC verbs, typed. The engine writes LTC as a voice on an output channel and
 * reads it from a capture device; what crosses the socket is declared in `AUDIO_WIRE`
 * (src/shared/audio.ts) beside the rest of the wire, and these are the shapes of its answers.
 */
import type { TimecodeRate } from '../../shared/timecode'

/** The door to the engine: `NativeAudioEngine.ltc`, or a fake in a test. */
export type LtcVerb = (verb: 'ltcStart' | 'ltcControl' | 'ltcStatus' | 'ltcInputs' | 'ltcListen' | 'ltcRead' | 'ltcUnlisten',
  params?: Record<string, unknown>) => Promise<unknown>

export interface LtcVoiceStatus {
  voiceId: string
  channel: number
  rate: TimecodeRate
  frame: number
  running: boolean
  paused: boolean
}

export interface LtcReadFrame {
  hours: number
  minutes: number
  seconds: number
  frames: number
  dropFrame: boolean
  reverse: boolean
  /** The engine's steady clock, ms, when the frame's last bit ended. */
  atMs: number
  /** Samples per bit cell: the speed the frame arrived at. */
  cellSamples: number
}

export interface LtcReadResult {
  listening: boolean
  description: string
  /** The engine's steady clock when it answered, to put `atMs` on this process's clock. */
  nowMs: number
  frames: LtcReadFrame[]
}

export interface LtcInput {
  id: string
  name: string
}

export class LtcClient {
  constructor(private readonly verb: LtcVerb) {}

  start(voiceId: string, channel: number, rate: TimecodeRate, frame: number, levelDb: number): Promise<unknown> {
    return this.verb('ltcStart', { voiceId, channel, rate, frame: Math.floor(frame), levelDb })
  }

  control(voiceId: string, action: 'stop' | 'pause' | 'resume' | 'locate', frame = 0): Promise<unknown> {
    return this.verb('ltcControl', { voiceId, action, frame: Math.floor(frame) })
  }

  async status(): Promise<LtcVoiceStatus[]> {
    const result = (await this.verb('ltcStatus')) as { voices?: LtcVoiceStatus[] }
    return result.voices ?? []
  }

  async inputs(): Promise<LtcInput[]> {
    const result = (await this.verb('ltcInputs')) as { inputs?: LtcInput[] }
    return result.inputs ?? []
  }

  async listen(device: string, channel: number): Promise<string> {
    const result = (await this.verb('ltcListen', { device, channel })) as { description?: string }
    return result.description ?? device
  }

  read(): Promise<LtcReadResult> {
    return this.verb('ltcRead', { limit: 256 }) as Promise<LtcReadResult>
  }

  unlisten(): Promise<unknown> {
    return this.verb('ltcUnlisten')
  }
}
