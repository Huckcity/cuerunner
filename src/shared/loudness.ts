// Normalising a cue: the gain that puts its file at the show's loudness target, held under
// the show's true-peak ceiling.
//
// The engine measures the file (`AudioEngineBridge.loudness`: EBU R128 integrated loudness,
// and the true peak through an oversampler); this is the arithmetic on what it measured. The
// gain goes on the cue's trim — the gain-staging control — and leaves its volume, the fader
// the operator rides, where it was. A file the target would push past the ceiling is set to
// the ceiling instead, and the result says which of the two decided it, so a quiet cue that
// could not be brought all the way up says so rather than reading as normalised.

import type { AudioLoudness } from './audio'

/** What a cue records of its last measurement, for the inspector to show beside the trim. */
export interface CueLoudness {
  /** The file the measurement is of: a cue pointed at another file has not been measured. */
  filePath: string
  integratedLufs: number
  truePeakDb: number
  /** The file had nothing above the absolute gate: no loudness, so nothing to normalise. */
  silent: boolean
}

/** The trim range the inspector offers: silence to +6 dB. A normalised trim is held to it. */
export const NORMALIZE_MAX_TRIM = 2

export interface NormalizePlan {
  /** The trim to set, linear. */
  trim: number
  /** The gain that is, dB. */
  gainDb: number
  /** What decided it: the target, the true-peak ceiling, or the trim's own range. */
  limitedBy: 'target' | 'ceiling' | 'range'
  /** Where the cue lands, LUFS, with that trim. */
  resultLufs: number
}

/**
 * The trim that puts a measured file at `targetLufs`, kept so its true peak stays at or
 * under `ceilingDb` and inside the trim's range. Null for a silent file: there is no gain
 * that makes silence a loudness.
 */
export function normalizePlan(measured: Pick<AudioLoudness, 'integratedLufs' | 'truePeakDb' | 'silent'>,
  targetLufs: number, ceilingDb: number): NormalizePlan | null {
  if (measured.silent || !Number.isFinite(measured.integratedLufs)) return null
  let gainDb = targetLufs - measured.integratedLufs
  let limitedBy: NormalizePlan['limitedBy'] = 'target'
  if (Number.isFinite(measured.truePeakDb) && measured.truePeakDb + gainDb > ceilingDb) {
    gainDb = ceilingDb - measured.truePeakDb
    limitedBy = 'ceiling'
  }
  const maxDb = 20 * Math.log10(NORMALIZE_MAX_TRIM)
  if (gainDb > maxDb) {
    gainDb = maxDb
    limitedBy = 'range'
  }
  const trim = Math.pow(10, gainDb / 20)
  return {
    trim: Number(trim.toFixed(4)),
    gainDb: Number(gainDb.toFixed(2)),
    limitedBy,
    resultLufs: Number((measured.integratedLufs + gainDb).toFixed(1))
  }
}

/** A loudness as the window writes it: "−23.0 LUFS". */
export function formatLufs(lufs: number): string {
  const text = Math.abs(lufs).toFixed(1)
  return `${lufs < 0 ? '−' : ''}${text} LUFS`
}

/** A peak as the window writes it: "−1.2 dBTP". */
export function formatDbtp(db: number): string {
  if (db <= -120) return '−∞ dBTP'
  const text = Math.abs(db).toFixed(1)
  return `${db < 0 ? '−' : db > 0 ? '+' : ''}${text} dBTP`
}

/** A measurement as a cue may carry it; null for one that is not. */
export function normalizeCueLoudness(value: unknown): CueLoudness | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.filePath !== 'string') return null
  if (typeof record.integratedLufs !== 'number' || !Number.isFinite(record.integratedLufs)) return null
  if (typeof record.truePeakDb !== 'number' || !Number.isFinite(record.truePeakDb)) return null
  return {
    filePath: record.filePath,
    integratedLufs: record.integratedLufs,
    truePeakDb: record.truePeakDb,
    silent: record.silent === true
  }
}
