import type { TimecodeCue } from '../../../shared/cue'
import {
  framesToMs,
  parseTimecodeFrames,
  type TimecodeGenerateRequest,
  type TimecodeGeneratorAction
} from '../../../shared/timecode'

/**
 * What a timecode cue asks main for, or the sentence for why it cannot ask: no output
 * chosen, a start or an end that is not a frame of its rate, an end before its start.
 * Settled before anything is sent, so a cue that would have run nowhere says so instead.
 */
export function timecodeRequest(cue: TimecodeCue, defaultMidiPort: string): TimecodeGenerateRequest | string {
  const start = parseTimecodeFrames(cue.startTimecode, cue.rate)
  if (start === null && !cue.jamSync) return `start ${cue.startTimecode || '(empty)'} is not a frame at ${cue.rate} fps`
  let end: number | null = null
  if (cue.endTimecode.trim() !== '') {
    end = parseTimecodeFrames(cue.endTimecode, cue.rate)
    if (end === null) return `end ${cue.endTimecode} is not a frame at ${cue.rate} fps`
    if (!cue.jamSync && start !== null && end <= start) return 'the end is not after the start'
  }
  const mtcPort = cue.mtc ? (cue.mtcPortName || defaultMidiPort) : null
  if (cue.mtc && mtcPort === '') return 'no MIDI port chosen to send MTC on'
  const artnetHost = cue.artnet ? cue.artnetHost.trim() : null
  if (cue.artnet && artnetHost === '') return 'no address chosen to send ArtTimeCode to'
  if (!cue.mtc && !cue.ltc && !cue.artnet) return 'no output chosen: MTC, LTC or Art-Net'
  return {
    cueId: cue.id,
    rate: cue.rate,
    startFrames: start ?? 0,
    endFrames: end,
    jam: cue.jamSync,
    mtcPort,
    ltcChannel: cue.ltc ? cue.ltcChannel : null,
    ltcLevelDb: cue.ltcLevelDb,
    artnetHost
  }
}

/** How long the clock runs, ms, when the cue says: its end less its start, at its rate. */
export function timecodeLengthMs(cue: TimecodeCue): number | null {
  if (cue.jamSync || cue.endTimecode.trim() === '') return null
  const start = parseTimecodeFrames(cue.startTimecode, cue.rate)
  const end = parseTimecodeFrames(cue.endTimecode, cue.rate)
  if (start === null || end === null || end <= start) return null
  return framesToMs(end - start, cue.rate)
}

/** The cues whose clock this window started, so a stop reaches main only for those. */
const running = new Set<string>()

export async function startTimecode(request: TimecodeGenerateRequest): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const result = await window.cuerunner.timecode.generate(request)
    if (!result.ok) return { ok: false, error: result.error }
    running.add(request.cueId)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Unsubscribes for the clocks whose end only main can see: a jam sync with an end time. */
const endWatches = new Map<string, () => void>()

/**
 * Calls `onEnd` once main reports the cue's clock gone on its own — which is the only way
 * to know when a jam-synced clock reaches its end, since where it started was the
 * incoming clock's business.
 */
export function watchTimecodeEnd(cueId: string, onEnd: () => void): void {
  endWatches.get(cueId)?.()
  let seen = false
  const off = window.cuerunner.timecode.onEvents(status => {
    const present = status.generators.some(gen => gen.cueId === cueId)
    if (present) seen = true
    else if (seen) {
      off()
      endWatches.delete(cueId)
      running.delete(cueId)
      onEnd()
    }
  })
  endWatches.set(cueId, off)
}

/** Pause, resume, locate or stop a cue's clock from the inspector. */
export function controlTimecode(cueId: string, action: TimecodeGeneratorAction): Promise<boolean> {
  if (action.action === 'stop') running.delete(cueId)
  return window.cuerunner.timecode.control({ cueId, action }).catch(() => false)
}

/**
 * The cue's run was taken away — STOP, a stop cue, a restart, PANIC — and its clock goes
 * with it. A cue that never started one asks main for nothing.
 */
export function releaseTimecode(cueId: string): void {
  endWatches.get(cueId)?.()
  endWatches.delete(cueId)
  if (!running.has(cueId)) return
  running.delete(cueId)
  void controlTimecode(cueId, { action: 'stop' })
}

/** Forgets a clock main says has ended on its own. */
export function timecodeEnded(cueId: string): boolean {
  return running.delete(cueId)
}

export function timecodeRunning(cueId: string): boolean {
  return running.has(cueId)
}
