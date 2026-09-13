import { useEffect, useState } from 'react'
import { useStore, type RunningCue } from '../../store'
import type { Cue, SceneCue } from '../../types/cue'
import { audioEngine } from '../../engine/audioEngineClient'
import { groupDurationMs } from '../../utils/cueDuration'
import { formatRunTime, runTiming } from '../../utils/runTiming'
import './StandbyBar.css'

// Enough to read a countdown by; the engine's own tick is for the audio, not for this.
const TICK_MS = 100
// Past two the line would be a list, and the list is the cue list.
const RUNNING_SHOWN = 2

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
 * What GO does next and what is already going, under the toolbar in every view. The
 * operator reads it from across the booth, so it is the largest type in the window after
 * the transport, and it answers for GO rather than for whatever view is showing.
 */
export function StandbyBar() {
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
  const shown = runs.slice(0, RUNNING_SHOWN)

  // A scene cue's name is the operator's; which scene it moves the desk to is the fact.
  const recalls = standby?.type === 'scene'
    ? scenes.find(scene => scene.id === (standby as SceneCue).sceneId)?.name ?? null
    : null
  const note = standby ? firstLine(standby.notes) : ''

  return (
    <div className="standby-bar" data-empty={standby === null}>
      <div className="standby-next" title="What GO fires (Space)">
        <span className="standby-label">Standby</span>
        {standby === null ? (
          <span className="standby-none">{cues.length === 0 ? 'no cues' : 'nothing selected'}</span>
        ) : (
          <>
            <span className="standby-number">{standby.number}</span>
            <span className="standby-name">{standby.name || 'untitled'}</span>
            {!standby.isArmed && <span className="standby-disarmed">disarmed — GO does nothing</span>}
            {recalls !== null && <span className="standby-recalls">recalls {recalls}</span>}
            {note !== '' && <span className="standby-note">{note}</span>}
          </>
        )}
      </div>

      {shown.length > 0 && (
        <div className="standby-running">
          {shown.map(({ cue, run }) => {
            const total = cue.type === 'group' ? groupDurationMs(cues, cue.id) : cue.duration
            const timing = runTiming(cue, run, total, now, cue.type === 'audio' ? audioEngine.getProgress(cue.id) : null)
            return (
              <div key={cue.id} className="standby-run" data-state={run.state}>
                <span className="standby-run-name">
                  <strong>{cue.number}</strong> {cue.name}
                </span>
                {run.state !== 'playing' && <span className="standby-run-phase">{run.state}</span>}
                {timing.fraction !== null && (
                  <span className="standby-run-bar"><i style={{ width: `${timing.fraction * 100}%` }} /></span>
                )}
                <span className="standby-run-elapsed">{formatRunTime(timing.elapsedMs)}</span>
                {timing.remainingMs !== null && (
                  <span className="standby-run-remaining">−{formatRunTime(timing.remainingMs)}</span>
                )}
              </div>
            )
          })}
          {runs.length > shown.length && (
            <span className="standby-run-more">+{runs.length - shown.length} more</span>
          )}
        </div>
      )}
    </div>
  )
}
