import { useEffect, useState } from 'react'
import { useTimecodeStatus } from '../../engine/timecodeStatus'
import {
  formatFrames,
  positionAt,
  rateInfo,
  type TimecodeLockState,
  type TimecodeReceiverStatus
} from '../../../../shared/timecode'
import './Timecode.css'

const STATE_LABEL: Record<TimecodeLockState, string> = {
  off: 'Off',
  waiting: 'Waiting',
  locked: 'Locked',
  freewheel: 'Freewheel',
  stopped: 'Stopped',
  lost: 'Lost'
}

/** The label the clock reads now, carried on between pushes so the frames tick by. */
function useClockLabel(receiver: TimecodeReceiverStatus): string | null {
  const moving = receiver.state === 'locked' || receiver.state === 'freewheel'
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!moving) return
    // Redrawn once a frame of the fastest rate; the label cannot change faster than that.
    const timer = setInterval(() => setNow(Date.now()), 33)
    return () => clearInterval(timer)
  }, [moving])
  const frames = positionAt(receiver, moving ? Math.max(now, receiver.at) : receiver.at)
  return frames === null ? null : formatFrames(Math.floor(frames), receiver.rate)
}

/** How the rate reads: what is being followed, and whether it was measured or declared. */
export function describeRate(receiver: TimecodeReceiverStatus): string {
  const label = rateInfo(receiver.rate).label
  if (receiver.rateDetected) return `${label} (detected)`
  return label
}

/**
 * The incoming clock, in the transport bar: where it is, whether it is locked, and at what
 * rate. Nothing at all on a machine that is not following one — the bar is the show's, and
 * an idle clock has nothing to tell it.
 */
export function TimecodeChip() {
  const { receiver } = useTimecodeStatus()
  const label = useClockLabel(receiver)
  if (receiver.source === 'none' || receiver.state === 'off') return null
  return (
    <div
      className="timecode-chip"
      data-state={receiver.state}
      title={`${STATE_LABEL[receiver.state]} · ${describeRate(receiver)}${receiver.detail ? ` · ${receiver.detail}` : ''}`}
    >
      <span className="timecode-chip-label">TC</span>
      <span className="timecode-chip-value">{label ?? '--:--:--:--'}</span>
      <span className="timecode-chip-state">{STATE_LABEL[receiver.state]}</span>
    </div>
  )
}

/**
 * The same clock in the show monitor, with the rest of what an operator asks when the
 * lighting desk has not gone: which wire, which rate it declared and which it measures, and
 * what the timecode cues are sending.
 */
export function TimecodePanel() {
  const { receiver, generators } = useTimecodeStatus()
  const label = useClockLabel(receiver)
  return (
    <div className="timecode-panel" data-state={receiver.state}>
      <div className="timecode-panel-head">
        <span className="timecode-panel-value">{label ?? '--:--:--:--'}</span>
        <span className="timecode-panel-state" data-state={receiver.state}>{STATE_LABEL[receiver.state]}</span>
      </div>
      <div className="timecode-panel-line">
        {receiver.source === 'none'
          ? 'No timecode source chosen (Settings, Timecode).'
          : `${receiver.detail || receiver.source} · ${describeRate(receiver)}`}
        {receiver.measuredFps !== null && ` · measured ${receiver.measuredFps.toFixed(3)} fps`}
        {receiver.direction === -1 && ' · running backwards'}
      </div>
      {generators.map(gen => (
        <div key={gen.cueId} className="timecode-panel-line timecode-panel-generator">
          Sending {formatFrames(Math.floor(gen.frames), gen.rate)} {gen.running ? '' : '(paused) '}
          on {gen.outputs.join(', ')}
        </div>
      ))}
    </div>
  )
}
