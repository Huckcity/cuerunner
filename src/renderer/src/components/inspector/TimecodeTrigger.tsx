import { useState } from 'react'
import { usePro } from '../../store'
import { ProMark } from '../license/ProLock'
import { timecodeStatus, useTimecodeStatus } from '../../engine/timecodeStatus'
import {
  formatFrames,
  formatTimecode,
  parseTimecode,
  positionAt,
  rateInfo
} from '../../../../shared/timecode'
import type { CueTrigger } from '../../../../shared/cue'

/**
 * The timecode half of a cue's triggers: the frame of the incoming clock it fires on. Typed,
 * or taken from the clock as it runs — the way a programmer marks a cue against the band's
 * click: play to the moment, press Take.
 */
export function TimecodeTriggerSection({ onAdd }: { onAdd: (trigger: CueTrigger) => void }) {
  const pro = usePro()
  const { receiver } = useTimecodeStatus()
  const [text, setText] = useState('')
  const rate = receiver.rate
  const parsed = parseTimecode(text, rate)

  const take = (): void => {
    const now = timecodeStatus().receiver
    const frames = positionAt(now, Date.now())
    if (frames !== null) setText(formatFrames(Math.floor(frames), now.rate))
  }

  return (
    <div className="trigger-section" data-kind="timecode">
      <div className="trigger-section-label">Timecode {!pro && <ProMark />}</div>
      <div className="field-row">
        <label htmlFor="trigger-timecode">At</label>
        <input
          id="trigger-timecode"
          value={text}
          placeholder="01:00:10:00"
          onChange={e => setText(e.target.value)}
        />
      </div>
      <p className="inspector-hint">
        {text.trim() !== '' && parsed === null
          ? `Not a frame at ${rateInfo(rate).label}, the rate the clock is read at.`
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
