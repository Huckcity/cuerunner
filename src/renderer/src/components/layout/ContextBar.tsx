import { useEffect, useState } from 'react'
import { useStore, type RunningCue } from '../../store'
import type { Cue, SceneCue } from '../../../../shared/cue'
import { audioEngine } from '../../engine/audioEngineClient'
import { groupDurationMs } from '../../utils/cueDuration'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import './ContextBar.css'

// Enough to read a countdown by; the engine's own tick is for the audio, not for this.
const TICK_MS = 100

/**
 * The cue GO fires, by the runner's own rule: the selected cue, or the first cue when
 * nothing is selected. A selection that points at nothing fires nothing.
 */
export function standbyCue(cues: Cue[], selectedId: string | null): Cue | null {
  if (selectedId === null) return cues[0] ?? null
  return cues.find(cue => cue.id === selectedId) ?? null
}

/**
 * The runs worth a place on the line: the outermost ones, oldest first. A child of a
 * running group is already inside the group's time.
 */
export function outermostRuns(cues: Cue[], running: Map<string, RunningCue>): Array<{ cue: Cue; run: RunningCue }> {
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const runs: Array<{ cue: Cue; run: RunningCue }> = []
  for (const run of running.values()) {
    const cue = byId.get(run.cueId)
    if (!cue) continue
    if (cue.parentId !== null && running.has(cue.parentId)) continue
    runs.push({ cue, run })
  }
  return runs.sort((a, b) => a.run.startedAt - b.run.startedAt)
}

function firstLine(text: string): string {
  return text.split('\n').find(line => line.trim() !== '')?.trim() ?? ''
}

/**
 * The two questions the booth asks mid-show, side by side under the toolbar: what is
 * playing, and what does GO do next.
 *
 * It used to be one line for the next cue with the running ones squeezed onto the end of
 * it, which meant three cues were named where two mattered and a cue's notes — the line
 * the operator wrote for themselves — were the first thing dropped when the line ran out
 * of room. Each half now carries a cue's number, name and its first note; the live half
 * adds the clock and a progress line, and the next half is set larger, because that is
 * the one GO acts on.
 */
export function ContextBar() {
  const cues = useStore(s => s.cues)
  const selectedId = useStore(s => s.selectedId)
  const running = useStore(s => s.running)
  const scenes = useStore(s => s.showSettings.scenes.list)

  const [now, setNow] = useState(() => Date.now())
  const active = running.size > 0
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [active])

  const standby = standbyCue(cues, selectedId)
  const runs = outermostRuns(cues, running)
  // The one that has been going longest, which is the one an operator means by "what is
  // playing". The rest are a count, and the cue list is where they are read one by one.
  const live = runs[0] ?? null

  // A scene cue's name is the operator's; which scene it moves the desk to is the fact.
  const recalls = standby?.type === 'scene'
    ? scenes.find(scene => scene.id === (standby as SceneCue).sceneId)?.name ?? null
    : null

  const liveTiming = live === null
    ? null
    : runTiming(
        live.cue,
        live.run,
        live.cue.type === 'group' ? groupDurationMs(cues, live.cue.id) : live.cue.duration,
        now,
        live.cue.type === 'audio' ? audioEngine.getProgress(live.cue.id) : null
      )

  return (
    <div className="context-bar" data-empty={standby === null}>
      <div className="ctx-side ctx-live" data-running={live !== null} data-state={live?.run.state}>
        {live === null ? (
          <div className="ctx-head">
            <span className="ctx-tag">Nothing playing</span>
          </div>
        ) : (
          <>
            <div className="ctx-head">
              <span className="ctx-tag ctx-tag-live"><i />Live</span>
              <span className="ctx-number">{live.cue.number}</span>
              <span className="ctx-name">{live.cue.name || 'untitled'}</span>
              {live.run.state !== 'playing' && <span className="ctx-phase">{live.run.state}</span>}
              {runs.length > 1 && (
                <span className="ctx-more">+{runs.length - 1} more</span>
              )}
              {liveTiming !== null && (
                <span className="ctx-clock">
                  {formatRunTime(liveTiming.elapsedMs)}
                  {liveTiming.remainingMs !== null && (
                    <span className="ctx-remaining"> / −{formatRunTime(liveTiming.remainingMs)}</span>
                  )}
                </span>
              )}
            </div>
            <p className="ctx-note">{firstLine(live.cue.notes)}</p>
            <div className="ctx-progress">
              <i style={{ width: `${(liveTiming?.fraction ?? 0) * 100}%` }} />
            </div>
          </>
        )}
      </div>

      <div className="ctx-side ctx-next" title="What GO fires (Space)">
        <div className="ctx-head">
          <span className="ctx-tag ctx-tag-next">Next</span>
          {standby === null ? (
            <span className="ctx-none">{cues.length === 0 ? 'No cues yet' : 'Nothing selected'}</span>
          ) : (
            <>
              <span className="ctx-number">{standby.number}</span>
              <span className="ctx-name">{standby.name || 'untitled'}</span>
              {!standby.isArmed && <span className="ctx-disarmed">Disarmed — GO skips it</span>}
              {recalls !== null && <span className="ctx-recalls">Recalls {recalls}</span>}
            </>
          )}
        </div>
        {standby !== null && <p className="ctx-note">{firstLine(standby.notes)}</p>}
      </div>
    </div>
  )
}
