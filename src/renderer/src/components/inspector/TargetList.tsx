import type { Cue } from '../../../../shared/cue'
import { targetLabel } from './targetLabel'
import './TargetList.css'

interface Props {
  /** The cue whose targets these are: it is never offered as its own target. */
  cueId: string
  /** The targets, in the order the cue acts on them. */
  ids: readonly string[]
  /** Every cue in the show. */
  cues: readonly Cue[]
  /** Whether a cue may be added: a fade offers what has a level, a stop anything that runs. */
  eligible: (cue: Cue) => boolean
  onChange: (ids: string[]) => void
  /** What the empty list says, and what the picker's first option says. */
  empty: string
  /** The field's own id, for the label beside the picker and for a test to find. */
  id: string
}

/**
 * The cues a cue acts on, as a list the operator builds: each target a row with its number and
 * name — a target that was deleted says so, rather than vanishing from the list — and a picker
 * underneath that adds one more. A group may be picked like any cue: what a group target means
 * is the acting cue's (a fade reaches every sound inside it; a stop takes the whole subtree).
 */
export function TargetList({ cueId, ids, cues, eligible, onChange, empty, id }: Props) {
  const byId = new Map(cues.map(cue => [cue.id, cue]))
  const chosen = new Set(ids)
  const offered = cues.filter(cue => cue.id !== cueId && !chosen.has(cue.id) && eligible(cue))

  return (
    <div className="target-list" data-count={ids.length}>
      {ids.length === 0 && <div className="target-list-empty">{empty}</div>}
      {ids.map((targetId, index) => {
        const target = byId.get(targetId)
        const text = target === undefined ? '— not in this show —' : targetLabel(target)
        return (
          <div className="target-row" key={targetId} data-target={targetId} data-gone={target === undefined}>
            <span className="target-text">{text}</span>
            <button
              type="button"
              className="inspector-btn-icon target-remove"
              title={`Remove ${text}`}
              aria-label={`Remove ${text}`}
              onClick={() => onChange(ids.filter((_, at) => at !== index))}
            >✕</button>
          </div>
        )
      })}
      <div className="field-row">
        <label htmlFor={id}>Add</label>
        <select
          id={id}
          value=""
          onChange={e => {
            const picked = e.target.value
            if (picked !== '') onChange([...ids, picked])
          }}
        >
          <option value="">— add a cue —</option>
          {offered.map(cue => <option key={cue.id} value={cue.id}>{targetLabel(cue)}</option>)}
        </select>
      </div>
    </div>
  )
}
