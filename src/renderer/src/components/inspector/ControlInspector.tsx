import { useStore } from '../../store'
import type { ControlAction, ControlCue } from '../../../../shared/cue'
import { CONTROL_ACTIONS } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { TargetList } from './TargetList'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { CONTROL_DEFAULTS } from '../../utils/cueDefaults'

/** Each verb as the panel names it, and what it does in a line. */
export const CONTROL_ACTION_LABEL: Record<ControlAction, { label: string; does: string }> = {
  start: { label: 'Start', does: 'Starts each target where it is, as its own GO would.' },
  stop: { label: 'Stop', does: 'Stops each target at once; a group stops whole.' },
  pause: { label: 'Pause', does: 'Holds each playing sound where it is.' },
  resume: { label: 'Resume', does: 'Lets each held sound go on.' },
  load: { label: 'Load', does: 'Readies each target to start at the time below.' },
  reset: { label: 'Reset', does: 'Stops each target and puts it back as the show opened it.' },
  goto: { label: 'Go to', does: 'Moves the playhead to the first target, firing nothing.' },
  arm: { label: 'Arm', does: 'Arms each target, so GO and its triggers fire it.' },
  disarm: { label: 'Disarm', does: 'Disarms each target, so GO passes it by.' }
}

interface Props { cue: ControlCue }

/**
 * A Control cue: one verb, the cues it acts on, and — for a Load — how far into them. The verb
 * is the cue's to change, so a Start written for a rehearsal can become a Reset without
 * re-picking its targets.
 */
export function ControlInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<ControlCue>): void => update(cue.id, patch)

  return (
    <div>
      <div className="field-row">
        <label htmlFor="control-action">Action</label>
        <select
          id="control-action"
          value={cue.action}
          onChange={e => set({ action: e.target.value as ControlAction })}
        >
          {CONTROL_ACTIONS.map(action => (
            <option key={action} value={action}>{CONTROL_ACTION_LABEL[action].label}</option>
          ))}
        </select>
        <ResetButton label="Action" value={cue.action} defaultValue={CONTROL_DEFAULTS.action}
          onReset={() => set({ action: CONTROL_DEFAULTS.action })} />
      </div>
      <p className="inspector-hint control-does">{CONTROL_ACTION_LABEL[cue.action].does}</p>
      {cue.action === 'load' && (
        <div className="field-row">
          <label htmlFor="control-load-to">Load to (s)</label>
          <NumberField id="control-load-to" when="typed" min={0} step={0.1} value={cue.loadToMs / 1000}
            onValue={seconds => { if (seconds !== null) set({ loadToMs: Math.round(seconds * 1000) }) }} />
          <ResetButton label="Load to" value={cue.loadToMs} defaultValue={CONTROL_DEFAULTS.loadToMs}
            onReset={() => set({ loadToMs: CONTROL_DEFAULTS.loadToMs })} />
        </div>
      )}
      <div className="field-section-title">Targets</div>
      <TargetList
        id="control-target-add"
        cueId={cue.id}
        ids={cue.targetCueIds}
        cues={cues}
        // Any cue at all: what a verb means for a cue of a kind is the runner's to say.
        eligible={() => true}
        onChange={targetCueIds => set({ targetCueIds })}
        empty="No cue chosen: this cue does nothing."
      />
      <LastRun cueId={cue.id} />
    </div>
  )
}
