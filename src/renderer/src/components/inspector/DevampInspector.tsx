import { useStore } from '../../store'
import type { DevampCue } from '../../types/cue'
import { LastRun } from './LastRun'

interface Props { cue: DevampCue }

/**
 * What a devamp acts on: one cue, chosen by what it is called.
 *
 * Only audio cues are offered — they are the cues that can hold a vamp — and a cue that
 * is pointed at something else is listed too, so an operator can see what a devamp is
 * aiming at rather than finding the select has quietly moved it.
 */
export function DevampInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)

  const targets = cues.filter(c => c.id !== cue.id && (c.type === 'audio' || c.id === cue.targetCueId))
  const missing = cue.targetCueId !== '' && !targets.some(c => c.id === cue.targetCueId)

  return (
    <div>
      <div className="field-row">
        <label>Release</label>
        <select value={cue.targetCueId} onChange={e => update(cue.id, { targetCueId: e.target.value })}>
          <option value="">Choose a cue…</option>
          {missing && <option value={cue.targetCueId}>— not in this show —</option>}
          {targets.map(c => {
            const displayName = c.name.length > 20 ? c.name.slice(0, 17) + '...' : c.name
            return <option key={c.id} value={c.id}>{c.number} {displayName}</option>
          })}
        </select>
      </div>
      <p className="inspector-hint">
        The target stops looping its section and plays on to the end of its file, from
        wherever the loop had reached. Set the section to loop forever in the audio cue's
        Time &amp; Loops tab to make it a vamp; this cue then lets it go.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
