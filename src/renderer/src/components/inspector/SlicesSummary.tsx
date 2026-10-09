import { useStore } from '../../store'
import type { AudioCue } from '../../../../shared/cue'
import { playCountLabel, slicedLengthMs, slicePieces, slicesInUse, SLICE_SKIP } from '../../../../shared/slices'
import { formatDuration } from '../../utils/cueDefaults'
import { drawnPieces, formatMarkerTime } from '../../utils/sliceMarkers'
import '../audio/AudioIo.css'

interface Props { cue: AudioCue }

/**
 * A cue's slices, told in a line and listed: how many pieces, how many vamp and how many are
 * skipped, and every marker with the count of the piece it starts. Slices are made and changed
 * on the waveform, where the music is — this is where they are read, and a marker picked here
 * is the one the waveform puts under the operator's hand.
 */
export function SlicesSummary({ cue }: Props) {
  const revealWaveform = useStore(s => s.revealWaveform)
  const selectSliceMarker = useStore(s => s.selectSliceMarker)
  const selected = useStore(s => s.selectedSliceMarker)

  const slices = cue.slices ?? { markers: [], playCounts: [1] }
  const used = slicesInUse(cue.slices)
  const regionEnd = cue.endTime ?? (cue.duration > 0 ? cue.duration : null)
  const pieces = regionEnd !== null ? drawnPieces(slices, cue.startTime, regionEnd) : []
  const vamps = pieces.filter(piece => piece.count < 0).length
  const skipped = pieces.filter(piece => piece.count === SLICE_SKIP).length
  const length = regionEnd !== null ? slicedLengthMs(slicePieces(slices, cue.startTime, regionEnd), cue.playbackRate) : null

  const show = (): void => {
    selectSliceMarker(null)
    revealWaveform()
  }
  const pick = (index: number): void => {
    selectSliceMarker({ cueId: cue.id, index })
    revealWaveform()
  }

  const counts = [
    `${pieces.length} ${pieces.length === 1 ? 'slice' : 'slices'}`,
    vamps > 0 ? `${vamps} ${vamps === 1 ? 'vamp' : 'vamps'}` : null,
    skipped > 0 ? `${skipped} skipped` : null
  ].filter(part => part !== null).join(' · ')

  return (
    <div className="slices-summary-panel">
      <div className="slices-summary-head">
        <span className="slices-summary" data-used={used}>
          {!used
            ? 'No slices: the cue plays its region and its loop count.'
            : length === null
              ? `${counts} — holds until a devamp`
              : `${counts} — plays for ${formatDuration(length)}`}
        </span>
        <button type="button" className="inspector-btn slices-show" onClick={show}>
          Show on waveform
        </button>
      </div>
      {slices.markers.length > 0 && (
        <ol className="slice-marker-list" aria-label="Slice markers">
          {slices.markers.map((marker, index) => {
            const outside = marker <= cue.startTime || (regionEnd !== null && marker >= regionEnd)
            return (
              <li key={index}>
                <button
                  type="button"
                  className="slice-marker-row"
                  data-marker={index}
                  data-selected={selected?.cueId === cue.id && selected.index === index}
                  data-outside={outside}
                  onClick={() => pick(index)}
                  title="Select this marker on the waveform"
                >
                  <span className="slice-marker-row-num">{index + 1}</span>
                  <span className="slice-marker-row-time">{formatMarkerTime(marker)}</span>
                  <span className="slice-marker-row-count" data-count={slices.playCounts[index + 1] ?? 1}>
                    {outside ? 'outside the region' : `then ${playCountLabel(slices.playCounts[index + 1] ?? 1)}`}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
      <p className="inspector-hint">Double-click the waveform to add a marker.</p>
    </div>
  )
}
