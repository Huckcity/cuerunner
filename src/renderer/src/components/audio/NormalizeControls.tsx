import { useState } from 'react'
import { useStore } from '../../store'
import type { AudioCue } from '../../../../shared/cue'
import { audioRoutingOf } from '../../../../shared/audioRouting'
import { formatDbtp, formatLufs } from '../../../../shared/loudness'
import { cueEngine } from '../../engine/CueEngine'
import { planNormalize } from '../../utils/normalize'

interface Props { cue: AudioCue }

/**
 * The cue's loudness, measured, and the button that sets its trim to the show's target. The
 * reading stays on the cue after it is taken, so the inspector shows what the file measured
 * and what the trim made of it without measuring again.
 */
export function NormalizeControls({ cue }: Props) {
  const patchCues = useStore(s => s.patchCues)
  const target = useStore(s => audioRoutingOf(s.audioSettings).loudnessTargetLufs)
  const ceiling = useStore(s => audioRoutingOf(s.audioSettings).truePeakCeilingDb)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const measured = cue.loudness !== undefined && cue.loudness !== null && cue.loudness.filePath === cue.filePath
    ? cue.loudness
    : null

  const normalize = async (): Promise<void> => {
    setBusy(true)
    setNote(null)
    try {
      const { patches, outcomes } = await planNormalize([cue], useStore.getState().audioSettings)
      if (Object.keys(patches).length > 0) patchCues(patches)
      const outcome = outcomes[0]
      if (outcome?.plan) {
        cueEngine.setLiveParameter(cue.id, 'trim', outcome.plan.trim)
        setNote(outcome.plan.limitedBy === 'ceiling'
          ? `held at ${formatLufs(outcome.plan.resultLufs)} by the ${ceiling.toFixed(1)} dBTP ceiling`
          : outcome.plan.limitedBy === 'range'
            ? `held at ${formatLufs(outcome.plan.resultLufs)}: the trim is at its top`
            : null)
      } else if (outcome) {
        setNote(`not normalised: ${outcome.problem ?? 'nothing to measure'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  const trimDb = cue.trim > 0 ? 20 * Math.log10(cue.trim) : -Infinity
  return (
    <>
      <div className="field-row">
        <label>Loudness</label>
        <span className="inspector-readout loudness-readout" data-lufs={measured?.integratedLufs ?? ''}>
          {measured === null
            ? 'not measured'
            : measured.silent
              ? 'silent'
              : `${formatLufs(measured.integratedLufs)}, ${formatDbtp(measured.truePeakDb)}` +
                (Number.isFinite(trimDb) ? ` → ${formatLufs(measured.integratedLufs + trimDb)} with the trim` : '')}
        </span>
        <button className="inspector-btn normalize-btn" disabled={busy || cue.filePath === ''}
          onClick={() => { void normalize() }}
          title={`Measure the file (EBU R128) and set the trim so the cue plays at ${formatLufs(target)}, its peaks under ${ceiling.toFixed(1)} dBTP`}>
          {busy ? 'Measuring…' : `Normalize to ${formatLufs(target)}`}
        </button>
      </div>
      {note !== null && <p className="inspector-hint normalize-note" role="status">{note}</p>}
    </>
  )
}
