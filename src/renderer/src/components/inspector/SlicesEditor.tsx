import { useState } from 'react'
import { useStore } from '../../store'
import type { AudioCue } from '../../../../shared/cue'
import {
  addMarker,
  moveMarker,
  playCountLabel,
  removeMarker,
  setPlayCount,
  slicedLengthMs,
  slicePieces,
  slicesInUse,
  SLICE_VAMP,
  type CueSlices
} from '../../../../shared/slices'
import { NumberField } from '../common/Field'
import { formatDuration } from '../../utils/cueDefaults'
import '../audio/AudioIo.css'

interface Props { cue: AudioCue }

const seconds = (ms: number): number => Math.round(ms / 10) / 100

/**
 * A cue's slices: markers in its file, and how many times each piece between them plays — a
 * number of passes, or until a devamp moves it on. The bar is the region as it will play, cut
 * at the markers inside it; the list is where a marker is moved or taken out and a count set.
 */
export function SlicesEditor({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const slices: CueSlices = cue.slices ?? { markers: [], playCounts: [1] }
  const [newMarker, setNewMarker] = useState<number | null>(null)
  const set = (next: CueSlices): void => {
    update(cue.id, { slices: slicesInUse(next) ? next : null })
  }

  const regionEnd = cue.endTime ?? (cue.duration > 0 ? cue.duration : null)
  const pieces = regionEnd !== null ? slicePieces(slices, cue.startTime, regionEnd) : null
  const total = pieces === null ? null : slicedLengthMs(pieces, cue.playbackRate)
  const span = pieces === null ? 0 : regionEnd! - cue.startTime

  const add = (): void => {
    const at = newMarker ?? (regionEnd !== null ? Math.round((cue.startTime + regionEnd) / 2) : cue.startTime + 1000)
    set(addMarker(slices, Math.round(at)))
    setNewMarker(null)
  }

  return (
    <div className="slices-editor">
      {pieces !== null && span > 0 && (
        <div className="slice-bar" aria-label="The region as it plays, cut at its markers">
          {pieces.map((piece, index) => (
            <span
              key={`${piece.startTime}-${index}`}
              className="slice-piece"
              data-vamp={piece.playCount < 0}
              style={{ flexGrow: Math.max(1, piece.endTime - piece.startTime) }}
              title={`${seconds(piece.startTime)}–${seconds(piece.endTime)} s`}
            >
              {playCountLabel(piece.playCount)}
            </span>
          ))}
        </div>
      )}
      <p className="inspector-hint slices-summary">
        {!slicesInUse(slices)
          ? 'No slices: the cue plays its region and its loop count.'
          : total === null
            ? 'Vamps: a devamp moves it on to the next slice.'
            : `Plays for ${formatDuration(total)}; with slices the loop count is not used.`}
      </p>
      <div className="slice-list">
        {Array.from({ length: slices.markers.length + 1 }, (_, index) => {
          const count = slices.playCounts[index] ?? 1
          const from = index === 0 ? null : slices.markers[index - 1]
          return (
            <div className="slice-row" key={index} data-slice={index + 1}>
              <span className="slice-range">
                Slice {index + 1}: {from === null ? 'from the start' : `from ${seconds(from)} s`}
              </span>
              {from !== null && (
                <NumberField when="typed" min={0} step={0.01} value={seconds(from)} aria-label={`Marker ${index}`}
                  className="slice-marker"
                  onValue={value => { if (value !== null) set(moveMarker(slices, index - 1, value * 1000)) }} />
              )}
              <label className="slice-vamp">
                <input type="checkbox" className="slice-vamp-toggle" checked={count < 0}
                  onChange={e => set(setPlayCount(slices, index, e.target.checked ? SLICE_VAMP : 1))} />
                Vamp
              </label>
              {count >= 0 && (
                <NumberField when="typed" min={1} step={1} value={count} aria-label={`Slice ${index + 1} plays`}
                  className="slice-count"
                  onValue={value => { if (value !== null) set(setPlayCount(slices, index, value)) }} />
              )}
              {from !== null && (
                <button className="inspector-btn slice-remove" onClick={() => set(removeMarker(slices, index - 1))}
                  title="Take this marker out: the slice joins the one before it">
                  Remove
                </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="field-row">
        <label>Add a marker at (s)</label>
        <NumberField when="typed" min={0} step={0.01} value={newMarker === null ? null : seconds(newMarker)}
          placeholder="middle of the region" className="slice-new-marker"
          onValue={value => setNewMarker(value === null ? null : value * 1000)} />
        <button className="inspector-btn slice-add" onClick={add}>Add marker</button>
      </div>
      <p className="inspector-hint">A devamp lets the vamping slice finish its pass and goes on to the next.</p>
    </div>
  )
}
