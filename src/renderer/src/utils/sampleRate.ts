// What a cue's file rate means beside the rate the engine mixes at.
//
// The engine resamples, so a 44.1 kHz file on a 48 kHz rig plays at the right pitch and
// the right tempo — but an operator is owed the fact rather than left to discover it
// (or to wonder why one cue's level sits differently from the rest). Files keep their
// own rate; nothing here rewrites them.

/** "44100" → "44.1 kHz", "48000" → "48 kHz". Empty for a rate the engine has not given. */
export function formatSampleRate(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return ''
  const kHz = hz / 1000
  return `${Number.isInteger(kHz) ? kHz : kHz.toFixed(1)} kHz`
}

/**
 * The line to put under the file when it is not at the engine's rate, or null when
 * there is nothing to say: rates that match, or a file the engine has not measured yet.
 */
export function resampleNotice(fileRate: number, engineRate: number): string | null {
  if (!(fileRate > 0) || !(engineRate > 0) || fileRate === engineRate) return null
  return `${formatSampleRate(fileRate)} file — resampled to ${formatSampleRate(engineRate)}`
}
