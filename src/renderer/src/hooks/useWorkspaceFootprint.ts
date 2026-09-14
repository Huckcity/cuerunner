// What the loaded workspace's media would cost in memory, measured from metadata only.
// Each distinct file is asked about once, and the measurement stops early once the
// engine's budget is already blown — there is nothing to gain from reading the rest of a
// show that is over it.

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { audioEngine } from '../engine/audioEngineClient'
import type { AudioEngineInfo } from '../engine/audioEngineClient'
import { decodedBytesFor, distinctMediaPaths, summariseFootprint, type MediaFootprint } from '../utils/mediaFootprint'
import type { AudioProbe } from '../../../shared/audio'

/** Files measured at once: quick on a big show, and never a flood on the engine. */
const PROBE_CONCURRENCY = 3

async function measure(
  paths: string[],
  limitBytes: number
): Promise<{ probes: AudioProbe[]; truncated: boolean }> {
  const probes: AudioProbe[] = []
  let next = 0
  let total = 0
  let truncated = false

  const workers = Array.from({ length: Math.min(PROBE_CONCURRENCY, paths.length) }, async () => {
    while (!truncated && next < paths.length) {
      const filePath = paths[next++]
      try {
        const probe = await audioEngine.probe(filePath)
        probes.push(probe)
        total += decodedBytesFor(probe)
        if (limitBytes > 0 && total > limitBytes && next < paths.length) truncated = true
      } catch {
        // A file that is missing, or that the engine cannot read, is not guessed at.
      }
    }
  })
  await Promise.all(workers)

  return { probes, truncated }
}

/**
 * The workspace's media estimate, or null while there is nothing to say: no workspace
 * media, no engine to ask, or a measurement still in flight.
 */
export function useWorkspaceFootprint(info: AudioEngineInfo | null): MediaFootprint | null {
  const cues = useStore(s => s.cues)
  const paths = useMemo(() => distinctMediaPaths(cues), [cues])
  const pathsKey = paths.join('\n')

  const [probes, setProbes] = useState<AudioProbe[] | null>(null)
  const [truncated, setTruncated] = useState(false)

  const ready = info !== null
  const limitBytes = info?.cache.limitBytes ?? 0

  useEffect(() => {
    if (!ready || paths.length === 0) {
      setProbes(null)
      setTruncated(false)
      return
    }
    let current = true
    void measure(paths, limitBytes).then(result => {
      if (!current) return
      setProbes(result.probes)
      setTruncated(result.truncated)
    })
    return () => { current = false }
    // Keyed by path, not by array identity: a re-render must not re-measure the show.
  }, [pathsKey, ready, limitBytes])

  return useMemo(() => {
    if (!info || probes === null) return null
    return summariseFootprint(
      probes,
      { limitBytes: info.cache.limitBytes, maxFileBytes: info.cache.maxFileBytes },
      paths.length,
      truncated
    )
  }, [info, probes, truncated, paths.length])
}
