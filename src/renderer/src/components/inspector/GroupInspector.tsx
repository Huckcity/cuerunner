import { useStore } from '../../store'
import type { GroupCue, GroupMode } from '../../types/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { GROUP_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: GroupCue }

export function GroupInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<GroupCue>) => update(cue.id, patch)

  return (
    <div>
      <div className="field-row">
        <label>Mode</label>
        <select value={cue.mode} onChange={e => set({ mode: e.target.value as GroupMode })}>
          <option value="sequence">Sequence — run all in order</option>
          <option value="playlist">Playlist — advance manually</option>
          <option value="random">Random — pick one at random</option>
          <option value="timeline">Timeline — position by offset</option>
        </select>
        <ResetButton label="Mode" value={cue.mode} defaultValue={GROUP_DEFAULTS.mode}
          onReset={() => set({ mode: GROUP_DEFAULTS.mode })} />
      </div>
      <p className="inspector-hint">
        Expand the group in the cue list to add, remove, or reorder its children.
      </p>
      <LastRun cueId={cue.id} />
    </div>
  )
}
