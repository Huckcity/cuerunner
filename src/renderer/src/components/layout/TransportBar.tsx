import { useStore } from '../../store'
import { useCueEngine, useKeyboard } from '../../hooks/useCueEngine'
import { cueEngine } from '../../engine/CueEngine'
import MidiStatusBadge from '../midi/MidiStatusBadge'
import { AudioStatusBadge } from './AudioStatusBadge'
import { TimecodeChip } from '../timecode/TimecodeDisplay'
import { AlertChip } from './AlertChip'
import { PlaybackWarnings } from './PlaybackWarnings'
import { OutputStrip } from './OutputStrip'
import { formatShortcut } from '../../utils/shortcuts'
import './TransportBar.css'

interface Props {
  /** Opens one of the dock's panels: an alarm asks for the panel that raised it. */
  onShowStrip: (strip: ShowStrip) => void
}

/** The show's panels, which share the dock with the selected cue. */
export type ShowStrip = 'log' | 'monitor' | 'rf' | 'script'

/**
 * What runs the show and what needs the operator: the running count and the standing
 * alarms, the two presses, and the keys for them. Nothing else, so none of it is ever
 * pushed aside.
 *
 * PANIC is not among the presses. It is a hard stop of everything, and a button for it
 * sat a thumb's width from GO for the length of every show; it lives on ⇧Esc and in the
 * Playback menu instead, which is where the rest of the app keeps the things that are
 * meant rather than reached for. That leaves GO as the only saturated colour on screen.
 */
export function TransportBar({ onShowStrip }: Props) {
  const { go, stop, panic, togglePause } = useCueEngine()
  useKeyboard(go, stop, panic, togglePause)

  const running = useStore(s => s.running)
  const runningCount = running.size
  // Read off the runner on every redraw: a hold and its release both rewrite the rows, which
  // is what redraws this.
  const held = cueEngine.isHeld()

  return (
    <div className="transport-bar">
      <div className="transport-left">
        <span className="running-badge" data-active={runningCount > 0} data-held={held}>
          {runningCount > 0 ? `${runningCount} ${held ? 'paused' : 'running'}` : 'idle'}
        </span>
        {/* Whatever the operator has open, what needs them is here. Warnings are among
            them: the panel that carries the long form is a tab in a dock that can be
            showing something else, or folded away, and a warning raised mid-show that
            nobody reads is a warning that was not raised. The transport is the one strip
            that is always on screen. */}
        <div className="transport-alerts">
          <AlertChip onShow={onShowStrip} />
          <AudioStatusBadge />
          <MidiStatusBadge />
          <TimecodeChip />
          <PlaybackWarnings className="transport-warning" compact />
        </div>
      </div>
      <div className="transport-center">
        <button className="btn-stop" onClick={stop} title="Stop everything that is running (Esc)">
          STOP
        </button>
        <button
          className="btn-pause"
          onClick={togglePause}
          disabled={runningCount === 0}
          data-held={held}
          title={held ? 'Let the show go on from where it was held (P)' : 'Hold the show where it stands (P)'}
        >
          {held ? 'RESUME' : 'PAUSE'}
        </button>
        <button className="btn-go" onClick={go} title="Fire the next cue (Space)">
          <svg className="btn-go-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M5 3.4v9.2L12.2 8z" />
          </svg>
          GO
        </button>
      </div>
      {/* The keys the show is run with, written for this keyboard. Panic is among them
          because it has no button: this line is where an operator finds it. */}
      <div className="transport-right">
        <OutputStrip />
        <span className="transport-keys">
          <kbd>Space</kbd> go · <kbd>P</kbd> pause · <kbd>Esc</kbd> stop · <kbd>{formatShortcut('Shift+Esc')}</kbd> panic
        </span>
      </div>
    </div>
  )
}
