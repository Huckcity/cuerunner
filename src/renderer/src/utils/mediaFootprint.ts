// What a workspace's media would cost in memory, estimated from metadata alone. Nothing
// here reads or decodes media: the numbers come from the engine's header-only probe, so a
// show with hours of audio can be measured without pulling a byte of it into the
// renderer.
//
// The engine decides what streams: a file whose decoded size is past its per-file cache
// bound is reported `streaming` and is never held, and the estimate says so rather than
// pretending every file would be resident at once.

import type { AudioProbe } from '../../../shared/audio'
import type { Cue } from '../../../shared/cue'

/** What the engine is willing to hold, as `info()` reports it. */
export interface MediaBudget {
  /** Decoded bytes held at once across files. */
  limitBytes: number
  /** Decoded size above which one file streams instead of being cached. */
  maxFileBytes: number
}

export interface MediaFootprint {
  /** Distinct files the workspace references. */
  files: number
  /** Files the engine could measure. */
  measured: number
  /** Measured files the engine will stream rather than hold decoded. */
  streaming: number
  /** Estimated decoded bytes of the measured files that could be held. */
  residentBytes: number
  /** Estimated decoded bytes of every measured file, if they were all held at once. */
  totalBytes: number
  /** True when measurement stopped because the budget was already blown. */
  truncated: boolean
  /** What to show the operator, or null when there is nothing worth saying. */
  warning: string | null
}

/** Decoded audio is float32 frames in the engine's cache. */
const BYTES_PER_SAMPLE = 4

/** Engine counters as something an operator can read: "1.2 GB", "512 MB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++ }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

/** The distinct media files a workspace's audio cues point at, in cue order. */
export function distinctMediaPaths(cues: Cue[]): string[] {
  const paths = new Set<string>()
  for (const cue of cues) {
    if (cue.type === 'audio' && cue.filePath !== '') paths.add(cue.filePath)
  }
  return [...paths]
}

/**
 * What one file would take decoded. The engine's own figure is used as it stands; when
 * the container states no frame count, the length it does state is enough to estimate.
 */
export function decodedBytesFor(probe: AudioProbe): number {
  if (probe.decodedBytes !== null && probe.decodedBytes > 0) return probe.decodedBytes
  if (probe.durationMs <= 0 || probe.sampleRate <= 0 || probe.channels <= 0) return 0
  return Math.round((probe.durationMs / 1000) * probe.sampleRate * probe.channels * BYTES_PER_SAMPLE)
}

/**
 * The one estimate the surfaces show. `files` is how many distinct files the workspace
 * references, which can be more than were measured: a file that is missing, or that the
 * engine cannot read, is not guessed at.
 */
export function summariseFootprint(
  probes: AudioProbe[],
  budget: MediaBudget,
  files: number,
  truncated = false
): MediaFootprint {
  let totalBytes = 0
  let residentBytes = 0
  let streaming = 0
  for (const probe of probes) {
    const bytes = decodedBytesFor(probe)
    if (bytes <= 0) continue
    totalBytes += bytes
    if (probe.streaming) streaming++
    else residentBytes += bytes
  }

  const measured = probes.length
  const overBudget = budget.limitBytes > 0 && totalBytes > budget.limitBytes
  const plural = (count: number): string => count === 1 ? '' : 's'

  let warning: string | null = null
  if (overBudget) {
    const soFar = truncated ? ` ${measured} of ${files} file${plural(files)} measured so far, and there is more.` : ''
    warning =
      `Workspace media decodes to about ${formatBytes(totalBytes)} — more than the ` +
      `${formatBytes(budget.limitBytes)} the engine holds at once. Files past that budget stream ` +
      `from disk as the show plays.${soFar}`
  } else if (streaming > 0) {
    const rest = files > measured ? ` ${files - measured} more file${plural(files - measured)} not measured.` : ''
    warning =
      `Workspace media: ${streaming} of ${measured} file${plural(measured)} ` +
      `${streaming === 1 ? 'is' : 'are'} above the engine's ${formatBytes(budget.maxFileBytes)} per-file ` +
      `cache bound and stream from disk instead of being held decoded.${rest}`
  }

  return { files, measured, streaming, residentBytes, totalBytes, truncated, warning }
}
