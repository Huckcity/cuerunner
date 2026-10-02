import type { MicCue } from '../../../shared/cue'

export interface MicResult {
  ok: boolean
  /** What the operator is told when the mic was not muted or unmuted. */
  error?: string
}

/**
 * Tells a receiver to mute or unmute a radio mic, and answers only once it has.
 *
 * The receiver is asked afterwards and says so when it is not in the state the cue asked for,
 * so an `ok` here is a mic that is closed, not a command that was sent. Everything else is an
 * error the cue reports in the log and on its row: a mic left open in silence is the failure
 * this cue exists to prevent, so it is never swallowed. A bridge that throws is the same thing
 * said in other words.
 */
export async function sendMic(cue: MicCue): Promise<MicResult> {
  if (cue.channelId === '') return { ok: false, error: 'no mic chosen' }
  try {
    const result = await window.cuerunner.show.command('rf', 'mute', {
      channelId: cue.channelId,
      mute: cue.action === 'mute'
    })
    return result.ok ? { ok: true } : { ok: false, error: result.error ?? 'the receiver did not take it' }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}
