import { useStore, useParentGroup } from '../../store'
import type { Cue, RefirePolicy } from '../../types/cue'
import { ResetButton } from './ResetButton'
import { NumberField, TextField } from '../common/Field'
import { CUE_COLORS, CUE_COLOR_SWATCH } from '../../utils/cueColors'
import { BASE_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: Cue }

export function BasicTab({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const updateCues = useStore(s => s.updateCues)
  const set = (patch: Partial<Cue>) => update(cue.id, patch)
  // Where a cue starts inside its group only means something in a timeline group; in a
  // sequence the children follow one another, and outside a group there is no timeline.
  const inTimeline = useParentGroup(cue.id)?.mode === 'timeline'

  // What the set has in common, and what a press here writes to: the cue being inspected
  // is part of the selection, and the selection is more than one, or it is just this cue.
  const selectedIds = useStore(s => s.selectedIds)
  const cues = useStore(s => s.cues)
  const colorTargets = selectedIds.includes(cue.id) ? selectedIds : [cue.id]
  const colors = new Set(colorTargets.map(id => (cues.find(other => other.id === id) ?? cue).colorLabel))
  // One colour across the set, or none marked when they differ.
  const sharedColor = colors.size === 1 ? [...colors][0] : null

  return (
    <div>
      <div className="field-row">
        <label>Number</label>
        <TextField when="typed" value={cue.number} onValue={number => set({ number })} />
      </div>
      <div className="field-row">
        <label>Name</label>
        <TextField when="typed" value={cue.name} onValue={name => set({ name })} />
      </div>
      <div className="field-row">
        <label>Color</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {CUE_COLORS.map(c => (
            <button
              key={c}
              title={c}
              onClick={() => updateCues(colorTargets, { colorLabel: c })}
              style={{
                width: 18, height: 18, borderRadius: 'var(--radius-md)',
                background: CUE_COLOR_SWATCH[c],
                border: sharedColor === c ? '2px solid #fff' : '2px solid transparent',
                cursor: 'pointer'
              }}
            />
          ))}
        </div>
      </div>
      {colorTargets.length > 1 && (
        <p className="inspector-hint">
          {colorTargets.length} cues selected — a colour goes on all of them, and one undo
          takes it off again.
        </p>
      )}
      <div className="field-section-title">Timing</div>
      {inTimeline && (
        <div className="field-row">
          <label>Timeline offset (s)</label>
          <NumberField when="typed" min={0} step={0.1} value={cue.timelineOffset / 1000}
            onValue={seconds => { if (seconds !== null) set({ timelineOffset: Math.round(seconds * 1000) }) }} />
          <ResetButton label="Timeline offset" value={cue.timelineOffset} defaultValue={BASE_DEFAULTS.timelineOffset}
            onReset={() => set({ timelineOffset: BASE_DEFAULTS.timelineOffset })} />
        </div>
      )}
      <div className="field-row">
        <label>Pre-wait (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={cue.preWait / 1000}
          onValue={seconds => { if (seconds !== null) set({ preWait: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Pre-wait" value={cue.preWait} defaultValue={BASE_DEFAULTS.preWait}
          onReset={() => set({ preWait: BASE_DEFAULTS.preWait })} />
      </div>
      <div className="field-row">
        <label>Post-wait (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={cue.postWait / 1000}
          onValue={seconds => { if (seconds !== null) set({ postWait: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Post-wait" value={cue.postWait} defaultValue={BASE_DEFAULTS.postWait}
          onReset={() => set({ postWait: BASE_DEFAULTS.postWait })} />
      </div>
      <div className="field-row">
        <label>Advance</label>
        <select value={cue.advance ?? BASE_DEFAULTS.advance} onChange={e => set({ advance: e.target.value as Cue['advance'] })}>
          <option value="none">None</option>
          <option value="on-start">On start</option>
          <option value="on-end">On end</option>
        </select>
        <ResetButton label="Advance" value={cue.advance ?? BASE_DEFAULTS.advance} defaultValue={BASE_DEFAULTS.advance}
          onReset={() => set({ advance: BASE_DEFAULTS.advance })} />
      </div>
      <div className="field-row">
        <label>Fired again</label>
        <select value={cue.refire ?? BASE_DEFAULTS.refire} onChange={e => set({ refire: e.target.value as RefirePolicy })}>
          <option value="ignore">Leave it running</option>
          <option value="restart">Restart it</option>
        </select>
      </div>
      <p className="inspector-hint">
        What GO, a trigger or the space bar does to this cue while it is already running.
      </p>
      <div className="field-row">
        <label>Armed</label>
        <input type="checkbox" checked={cue.isArmed}
          onChange={e => set({ isArmed: e.target.checked })} />
        <ResetButton label="Armed" value={cue.isArmed} defaultValue={BASE_DEFAULTS.isArmed}
          onReset={() => set({ isArmed: BASE_DEFAULTS.isArmed })} />
      </div>
      <div className="field-section-title">Notes</div>
      <div className="field-row">
        <label></label>
        <textarea value={cue.notes} onChange={e => set({ notes: e.target.value })} rows={3} />
      </div>
    </div>
  )
}