import type { Cue } from '../../../shared/cue'

/** The slice of a running cue this needs: which cue, and when it started. */
export interface RunOf {
  cueId: string
  startedAt: number
}

/**
 * The runs worth a place on the line: the outermost ones, oldest first. A child of a
 * running group is already inside the group's time.
 */
export function outermostRuns<R extends RunOf>(cues: Cue[], running: Map<string, R>): Array<{ cue: Cue; run: R }> {
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const runs: Array<{ cue: Cue; run: R }> = []
  for (const run of running.values()) {
    const cue = byId.get(run.cueId)
    if (!cue) continue
    if (cue.parentId !== null && running.has(cue.parentId)) continue
    runs.push({ cue, run })
  }
  return runs.sort((a, b) => a.run.startedAt - b.run.startedAt)
}

/**
 * The cue an operator means by "what is playing": the outermost one that has been going longest.
 * Null between cues, when nothing is running — which is a fact worth saying rather than a cue
 * guessed from the one that happened to finish last.
 */
export function liveCue<R extends RunOf>(cues: Cue[], running: Map<string, R>): Cue | null {
  return outermostRuns(cues, running)[0]?.cue ?? null
}
