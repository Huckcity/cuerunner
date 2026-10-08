import { useStore } from '../../store'
import type { FadeCue, FadeCurve } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { targetLabel } from './targetLabel'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { FADE_DEFAULTS } from '../../utils/cueDefaults'
import { isVisualCue } from '../../../../shared/visual'

interface Props { cue: FadeCue }

export function FadeInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<FadeCue>) => update(cue.id, patch)

  // A fade moves a sound, and only an audio cue has one: a wait, a group or a MIDI cue in
  // this list was a target that could be chosen and would do nothing. A cue of another
  // kind that an older show already aims at stays in the list, so the panel shows what
  // the cue says rather than quietly showing something else.
  const targets = cues.filter(c => c.id !== cue.id && (c.type === 'audio' || isVisualCue(c) || c.id === cue.targetCueId))
  const targetGone = cue.targetCueId !== '' && !targets.some(c => c.id === cue.targetCueId)
  // What the target has to fade: a sound's volume and pan, a picture's opacity — and a
  // video has both. A picture with no sound offers only what it has.
  const target = cues.find(c => c.id === cue.targetCueId)
  const pictureOnly = target?.type === 'image' || target?.type === 'text'
  const hasPicture = target !== undefined && isVisualCue(target)
  const aim = (targetCueId: string): void => {
    const next = cues.find(c => c.id === targetCueId)
    const silent = next?.type === 'image' || next?.type === 'text'
    set(silent && cue.fadeProperty !== 'opacity' ? { targetCueId, fadeProperty: 'opacity', targetValue: 0 } : { targetCueId })
  }

  return (
    <div>
      <div className="field-row">
        <label>Target cue</label>
        <select value={cue.targetCueId} onChange={e => aim(e.target.value)}>
          <option value="">— select —</option>
          {/* A target that was deleted is said, not papered over: a select whose value
              matches no option draws its first one, which reads as a choice nobody made. */}
          {targetGone && <option value={cue.targetCueId}>— not in this show —</option>}
          {targets.map(c => <option key={c.id} value={c.id}>{targetLabel(c)}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label>Property</label>
        <select value={cue.fadeProperty} onChange={e => set({ fadeProperty: e.target.value as FadeCue['fadeProperty'] })}>
          {!pictureOnly && <option value="volume">Volume</option>}
          {!pictureOnly && <option value="pan">Pan</option>}
          {(hasPicture || cue.fadeProperty === 'opacity') && <option value="opacity">Opacity</option>}
        </select>
        <ResetButton label="Property" value={cue.fadeProperty} defaultValue={FADE_DEFAULTS.fadeProperty}
          onReset={() => set({ fadeProperty: FADE_DEFAULTS.fadeProperty })} />
      </div>
      <div className="field-row">
        <label>Target value</label>
        <NumberField when="typed" min={0} max={1} step={0.01} value={cue.targetValue}
          onValue={targetValue => { if (targetValue !== null) set({ targetValue }) }} />
        <ResetButton label="Target value" value={cue.targetValue} defaultValue={FADE_DEFAULTS.targetValue}
          onReset={() => set({ targetValue: FADE_DEFAULTS.targetValue })} />
      </div>
      <div className="field-row">
        <label>Duration (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={cue.duration / 1000}
          onValue={seconds => { if (seconds !== null) set({ duration: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Duration" value={cue.duration} defaultValue={FADE_DEFAULTS.duration}
          onReset={() => set({ duration: FADE_DEFAULTS.duration })} />
      </div>
      <div className="field-row">
        <label>Curve</label>
        <select value={cue.curve} onChange={e => set({ curve: e.target.value as FadeCurve })}>
          <option value="linear">Linear</option>
          <option value="sCurve">S-Curve</option>
          <option value="logarithmic">Logarithmic</option>
        </select>
        <ResetButton label="Curve" value={cue.curve} defaultValue={FADE_DEFAULTS.curve}
          onReset={() => set({ curve: FADE_DEFAULTS.curve })} />
      </div>
      <div className="field-row">
        <label>Stop target when done</label>
        <input type="checkbox" checked={cue.stopTargetWhenDone}
          onChange={e => set({ stopTargetWhenDone: e.target.checked })} />
        <ResetButton label="Stop target when done" value={cue.stopTargetWhenDone} defaultValue={FADE_DEFAULTS.stopTargetWhenDone}
          onReset={() => set({ stopTargetWhenDone: FADE_DEFAULTS.stopTargetWhenDone })} />
      </div>
      <LastRun cueId={cue.id} />
    </div>
  )
}
