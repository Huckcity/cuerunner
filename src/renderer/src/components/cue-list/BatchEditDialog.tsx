import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { useModal } from '../../hooks/useModal'
import { NumberField } from '../common/Field'
import { batchPatches, type BatchEdit } from '../../utils/batchEdit'
import type { Cue } from '../../../../shared/cue'
import './BatchEditDialog.css'

interface Props {
  ids: string[]
  onClose: () => void
}

/** A field left empty is a field left alone; seconds in the dialog, ms in the cue. */
type Draft = {
  preWait: number | null
  postWait: number | null
  advance: Cue['advance'] | ''
  volume: number | null
  fadeIn: number | null
  fadeOut: number | null
}

const EMPTY: Draft = { preWait: null, postWait: null, advance: '', volume: null, fadeIn: null, fadeOut: null }

const ms = (seconds: number | null): number | undefined => seconds === null ? undefined : Math.round(seconds * 1000)

/** What the draft asks for, in the cue's own units. */
export function editFromDraft(draft: Draft): BatchEdit {
  return {
    preWait: ms(draft.preWait),
    postWait: ms(draft.postWait),
    advance: draft.advance === '' ? undefined : draft.advance,
    volume: draft.volume === null ? undefined : draft.volume / 100,
    fadeInDuration: ms(draft.fadeIn),
    fadeOutDuration: ms(draft.fadeOut)
  }
}

/**
 * One edit across the selection: the fields the cues share, and the audio cues' own when
 * the set holds any. Every field starts empty and an empty field changes nothing, so the
 * dialog never writes a value the operator did not type — a set of cues with three different
 * pre-waits keeps all three unless a new one is given. Apply is one undo.
 */
export function BatchEditDialog({ ids, onClose }: Props) {
  useModal()
  const cues = useStore(s => s.cues)
  const patchCues = useStore(s => s.patchCues)
  const [draft, setDraft] = useState<Draft>(EMPTY)

  const targets = cues.filter(cue => ids.includes(cue.id))
  const audioCount = targets.filter(cue => cue.type === 'audio').length
  const set = (patch: Partial<Draft>): void => setDraft(current => ({ ...current, ...patch }))
  const patches = batchPatches(cues, ids, editFromDraft(draft))
  const changing = Object.keys(patches).length

  const apply = (): void => {
    if (changing > 0) patchCues(patches)
    onClose()
  }

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="batch-edit-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="batch-edit-dialog" role="dialog" aria-modal="true" aria-label={`Edit ${targets.length} cues`}>
        <div className="batch-edit-header">
          <span className="batch-edit-title">Edit {targets.length} cues</span>
        </div>
        <p className="batch-edit-blurb">Empty fields are left as each cue has them.</p>
        <div className="batch-edit-body">
          <div className="field-row">
            <label htmlFor="batch-pre-wait">Pre-wait (s)</label>
            <NumberField id="batch-pre-wait" when="typed" min={0} step={0.1} value={draft.preWait}
              onValue={preWait => set({ preWait })} />
          </div>
          <div className="field-row">
            <label htmlFor="batch-post-wait">Post-wait (s)</label>
            <NumberField id="batch-post-wait" when="typed" min={0} step={0.1} value={draft.postWait}
              onValue={postWait => set({ postWait })} />
          </div>
          <div className="field-row">
            <label htmlFor="batch-advance">Advance</label>
            <select id="batch-advance" value={draft.advance}
              onChange={e => set({ advance: e.target.value as Draft['advance'] })}>
              <option value="">— leave —</option>
              <option value="none">None</option>
              <option value="on-start">On start</option>
              <option value="on-end">On end</option>
            </select>
          </div>
          {audioCount > 0 && (
            <>
              <div className="field-section-title">
                {audioCount === targets.length ? 'Audio' : `The ${audioCount} audio cues`}
              </div>
              <div className="field-row">
                <label htmlFor="batch-volume">Volume (%)</label>
                <NumberField id="batch-volume" when="typed" min={0} max={100} value={draft.volume}
                  onValue={volume => set({ volume })} />
              </div>
              <div className="field-row">
                <label htmlFor="batch-fade-in">Fade in (s)</label>
                <NumberField id="batch-fade-in" when="typed" min={0} step={0.1} value={draft.fadeIn}
                  onValue={fadeIn => set({ fadeIn })} />
              </div>
              <div className="field-row">
                <label htmlFor="batch-fade-out">Fade out (s)</label>
                <NumberField id="batch-fade-out" when="typed" min={0} step={0.1} value={draft.fadeOut}
                  onValue={fadeOut => set({ fadeOut })} />
              </div>
            </>
          )}
        </div>
        <div className="batch-edit-footer">
          <button className="batch-edit-cancel" onClick={onClose}>Cancel</button>
          <button className="batch-edit-apply" onClick={apply} disabled={changing === 0}>
            {changing === 0 ? 'Apply' : `Apply to ${changing}`}
          </button>
        </div>
      </div>
    </div>
  )
}
