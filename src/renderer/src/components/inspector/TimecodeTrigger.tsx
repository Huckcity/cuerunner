import { useState } from 'react'
import { timecodeStatus, useTimecodeStatus } from '../../engine/timecodeStatus'
import {
  formatFrames,
  formatTimecode,
  framesPerDay,
  framesToTimecode,
  msToFrames,
  parseTimecode,
  positionAt,
  rateInfo,
  type Timecode,
  type TimecodeRate
} from '../../../../shared/timecode'
import type { CueTrigger } from '../../../../shared/cue'

/**
 * A frame as the operator typed it: a label (`01:00:10:00`), or a real time from midnight in
 * seconds (`3610s`, `3610.5 s`) for a show whose times were written against a stopwatch
 * rather than a clock.
 */
export function parseTriggerText(text: string, rate: TimecodeRate): Timecode | null {
  const seconds = /^\s*(\d+(?:\.\d+)?)\s*s\s*$/i.exec(text)
  if (seconds !== null) {
    const frames = msToFrames(Number(seconds[1]) * 1000, rate)
    return frames < framesPerDay(rate) ? framesToTimecode(frames, rate) : null
  }
  return parseTimecode(text, rate)
}

/**
 * The timecode half of a cue's triggers: the frame of the incoming clock it fires on. Typed,
 * or taken from the clock as it runs — the way a programmer marks a cue against the band's
 * click: play to the moment, press Take.
 */
export function TimecodeTriggerSection({ onAdd }: { onAdd: (trigger: CueTrigger) => void }) {
  const { receiver } = useTimecodeStatus()
  const [text, setText] = useState('')
  const rate = receiver.rate
  const parsed = parseTriggerText(text, rate)

  const take = (): void => {
    const now = timecodeStatus().receiver
    const frames = positionAt(now, Date.now())
    if (frames !== null) setText(formatFrames(Math.floor(frames), now.rate))
  }

  return (
    <div className="trigger-section" data-kind="timecode">
      <div className="trigger-section-label">Timecode</div>
      <div className="field-row">
        <label htmlFor="trigger-timecode">At</label>
        <input
          id="trigger-timecode"
          value={text}
          placeholder="01:00:10:00, or 3610s"
          onChange={e => setText(e.target.value)}
        />
      </div>
      <p className="inspector-hint">
        {text.trim() !== '' && parsed === null
          ? `Not a frame at ${rateInfo(rate).label}, the rate the clock is read at.`
          : parsed !== null && /s\s*$/i.test(text)
            ? `${formatTimecode(parsed, rate)} — fires when the incoming clock runs through it.`
            : 'Fires when the incoming clock runs through this frame.'}
      </p>
      <div className="trigger-actions">
        <button
          type="button"
          className="inspector-btn trigger-add trigger-timecode-add"
          disabled={parsed === null}
          onClick={() => {
            if (parsed === null) return
            onAdd({ id: crypto.randomUUID(), kind: 'timecode', timecode: formatTimecode(parsed, rate) })
            setText('')
          }}
        >Add</button>
        <button
          type="button"
          className="inspector-btn trigger-timecode-take"
          disabled={receiver.frames === null}
          title="Take the frame the incoming clock is on now"
          onClick={take}
        >Take</button>
      </div>
    </div>
  )
}
