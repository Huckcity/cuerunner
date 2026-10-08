import { useState } from 'react'
import { useStore } from '../../store'
import type { ClockMissedPolicy, CueTrigger } from '../../../../shared/cue'
import { cuesOnHotkey, hotkeyConflict, hotkeyFromPress, normalizeHotkey, tileKeysOf } from '../../utils/hotkeys'
import { formatShortcut } from '../../utils/shortcuts'
import { clockSeconds, formatClockTime, MAX_GRACE_MINUTES } from '../../engine/clockTriggers'

/**
 * The key half of a cue's triggers: a key on this machine that fires the cue. Typed, or taken
 * from the keyboard — press Record and then the key. A key the app already answers is refused
 * with the reason, and a key another cue already answers is said, because one press firing two
 * cues is sometimes the point and never a surprise.
 */
export function HotkeyTriggerSection({ cueId, onAdd }: { cueId: string; onAdd: (trigger: CueTrigger) => void }) {
  const cues = useStore(s => s.cues)
  const [text, setText] = useState('')
  const [recording, setRecording] = useState(false)
  const key = normalizeHotkey(text)
  const cueLists = useStore(s => s.cueLists)
  const conflict = key === null ? null : hotkeyConflict(key, { tileKeys: tileKeysOf(cueLists) })
  const shared = key === null ? [] : cuesOnHotkey(cues, key, cueId)

  const hint = text.trim() === ''
    ? 'A key that fires the cue while the window has it.'
    : key === null
      ? 'Not a key a cue can answer.'
      : conflict !== null
        ? `Taken: ${conflict}.`
        : shared.length > 0
          ? `${formatShortcut(key)} also fires ${shared.length === 1 ? `cue ${shared[0].number}` : `${shared.length} other cues`}.`
          : `${formatShortcut(key)} fires this cue.`

  return (
    <div className="trigger-section" data-kind="hotkey">
      <div className="trigger-section-label">Key</div>
      <div className="field-row">
        <label htmlFor="trigger-hotkey">Key</label>
        <input
          id="trigger-hotkey"
          value={recording ? 'Press a key…' : text}
          readOnly={recording}
          placeholder="F7, Shift+Q"
          onChange={e => setText(e.target.value)}
          onBlur={() => setRecording(false)}
          onKeyDown={e => {
            if (!recording) return
            const pressed = hotkeyFromPress(e.nativeEvent)
            // A modifier on its own is the start of a combination, not one.
            if (pressed === null) return
            e.preventDefault()
            e.stopPropagation()
            setText(pressed)
            setRecording(false)
          }}
        />
      </div>
      <p className="inspector-hint trigger-hotkey-hint" data-conflict={conflict !== null}>{hint}</p>
      <div className="trigger-actions">
        <button
          type="button"
          className="inspector-btn trigger-add trigger-hotkey-add"
          disabled={key === null || conflict !== null}
          onClick={() => {
            if (key === null || conflict !== null) return
            onAdd({ id: crypto.randomUUID(), kind: 'hotkey', key })
            setText('')
          }}
        >Add</button>
        <button
          type="button"
          className="inspector-btn trigger-hotkey-record"
          onClick={e => {
            setRecording(true)
            // The field takes the next press, so the focus goes there with it.
            const field = (e.currentTarget.closest('.trigger-section') as HTMLElement | null)
              ?.querySelector<HTMLInputElement>('#trigger-hotkey')
            field?.focus()
          }}
        >Record</button>
      </div>
    </div>
  )
}

const WEEKDAYS: ReadonlyArray<{ day: number; label: string }> = [
  { day: 1, label: 'Mon' }, { day: 2, label: 'Tue' }, { day: 3, label: 'Wed' }, { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' }, { day: 6, label: 'Sat' }, { day: 0, label: 'Sun' }
]

/**
 * The clock half: a time of day the cue fires at, on the days it answers, and what happens to
 * a time the show was not open to see.
 */
export function ClockTriggerSection({ onAdd }: { onAdd: (trigger: CueTrigger) => void }) {
  const [text, setText] = useState('')
  const [days, setDays] = useState<number[]>([])
  const [missed, setMissed] = useState<ClockMissedPolicy>('skip')
  const [grace, setGrace] = useState(5)
  const seconds = clockSeconds(text)

  return (
    <div className="trigger-section" data-kind="clock">
      <div className="trigger-section-label">Time of day</div>
      <div className="field-row">
        <label htmlFor="trigger-clock-time">At</label>
        <input
          id="trigger-clock-time"
          value={text}
          placeholder="19:30"
          onChange={e => setText(e.target.value)}
        />
      </div>
      <div className="field-row">
        <label>Days</label>
        <span className="trigger-clock-days">
          {WEEKDAYS.map(({ day, label }) => (
            <label key={day} className="trigger-clock-day">
              <input
                type="checkbox"
                data-day={day}
                checked={days.includes(day)}
                onChange={e => setDays(current => e.target.checked
                  ? [...current, day].sort((a, b) => a - b)
                  : current.filter(entry => entry !== day))}
              />
              {label}
            </label>
          ))}
        </span>
      </div>
      <div className="field-row">
        <label htmlFor="trigger-clock-missed">If missed</label>
        <select id="trigger-clock-missed" value={missed} onChange={e => setMissed(e.target.value as ClockMissedPolicy)}>
          <option value="skip">Skip it, and say so</option>
          <option value="fire">Fire it late</option>
        </select>
      </div>
      {missed === 'fire' && (
        <div className="field-row">
          <label htmlFor="trigger-clock-grace">Within (min)</label>
          <input
            id="trigger-clock-grace"
            type="number"
            min={1}
            max={MAX_GRACE_MINUTES}
            value={grace}
            onChange={e => {
              const n = Math.round(Number(e.target.value))
              if (Number.isFinite(n)) setGrace(Math.min(MAX_GRACE_MINUTES, Math.max(1, n)))
            }}
          />
        </div>
      )}
      <p className="inspector-hint">
        {text.trim() !== '' && seconds === null
          ? 'Write it as 19:30 or 19:30:15.'
          : 'This machine’s clock. No day ticked is every day.'}
      </p>
      <div className="trigger-actions">
        <button
          type="button"
          className="inspector-btn trigger-add trigger-clock-add"
          disabled={seconds === null}
          onClick={() => {
            if (seconds === null) return
            onAdd({
              id: crypto.randomUUID(),
              kind: 'clock',
              time: formatClockTime(seconds),
              days,
              missed,
              graceMinutes: missed === 'fire' ? grace : 0
            })
            setText('')
          }}
        >Add</button>
      </div>
    </div>
  )
}
