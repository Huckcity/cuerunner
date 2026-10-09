import { useEffect } from 'react'
import { useStore } from '../../store'
import { useModal } from '../../hooks/useModal'
import { NumberField, TextField } from '../common/Field'
import { CUE_COLORS, CUE_COLOR_SWATCH } from '../../utils/cueColors'
import { CUE_LIST_OFFSET_MAX_FRAMES } from '../../../../shared/cueLists'

interface Props {
  listId: string
  onClose: () => void
}

/**
 * One list's own settings, each taking effect as it is changed and each one undo: its name and
 * colour, whether it is shown as rows or as a cart, whether it is in the show at all, and how
 * it follows the incoming clock — whether its timecode triggers fire, and how many frames
 * later than the show's own offset its cues sit on the clock.
 */
export function ListSettingsDialog({ listId, onClose }: Props) {
  useModal()
  const list = useStore(s => s.cueLists.find(entry => entry.id === listId))
  const updateCueList = useStore(s => s.updateCueList)

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (list === undefined) return null
  const clock = list.timecode ?? { enabled: true, offsetFrames: 0 }

  return (
    <div className="cue-list-dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cue-list-dialog" role="dialog" aria-modal="true" aria-label="List settings">
        <div className="cue-list-dialog-header">
          <span className="cue-list-dialog-title">List settings</span>
          <button className="cue-list-dialog-dismiss" onClick={onClose} aria-label="Close list settings">✕</button>
        </div>
        <div className="cue-list-dialog-body">
          <div className="field-row">
            <label htmlFor="list-name">Name</label>
            <TextField id="list-name" value={list.name} onValue={name => updateCueList(listId, { name })} />
          </div>
          <div className="field-row">
            <label>Colour</label>
            <div className="cue-list-dialog-swatches" role="group" aria-label="Colour">
              {CUE_COLORS.map(color => (
                <button
                  key={color}
                  className="cue-context-menu-color"
                  title={color}
                  aria-label={color}
                  data-active={(list.color ?? 'none') === color}
                  style={{ background: CUE_COLOR_SWATCH[color] }}
                  onClick={() => updateCueList(listId, { color })}
                />
              ))}
            </div>
          </div>
          <div className="field-row">
            <label htmlFor="list-face">Shown as</label>
            <select id="list-face" value={list.cart === true ? 'cart' : 'list'}
              onChange={e => updateCueList(listId, { cart: e.target.value === 'cart' })}>
              <option value="list">A list of rows</option>
              <option value="cart">A cart of tiles</option>
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="list-armed">Armed</label>
            <input id="list-armed" type="checkbox" checked={list.disarmed !== true}
              onChange={e => updateCueList(listId, { disarmed: !e.target.checked })} />
          </div>
          <div className="field-row">
            <label htmlFor="list-timecode">Follows timecode</label>
            <input id="list-timecode" type="checkbox" checked={clock.enabled}
              onChange={e => updateCueList(listId, { timecode: { ...clock, enabled: e.target.checked } })} />
          </div>
          <div className="field-row">
            <label htmlFor="list-offset">Offset (frames)</label>
            <NumberField id="list-offset" value={clock.offsetFrames} disabled={!clock.enabled}
              min={-CUE_LIST_OFFSET_MAX_FRAMES} max={CUE_LIST_OFFSET_MAX_FRAMES}
              onValue={frames => {
                if (frames !== null) updateCueList(listId, { timecode: { ...clock, offsetFrames: Math.round(frames) } })
              }} />
          </div>
          <p className="inspector-hint">Added to the show’s own offset, for this list’s timecode triggers.</p>
        </div>
        <div className="cue-list-dialog-footer">
          <button className="cue-list-dialog-button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
