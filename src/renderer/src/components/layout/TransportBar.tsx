import { useStore } from '../../store'
import { useCueRunner, useKeyboard } from '../../hooks/useCueRunner'
import MidiStatusBadge from '../midi/MidiStatusBadge'
import { AlertChip } from './AlertChip'
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
 * alarms, the three presses, and the keys for them. Nothing else, so none of it is ever
 * pushed aside.
 */
export function TransportBar({ onShowStrip }: Props) {
  const { go, stop, panic } = useCueRunner()
  useKeyboard(go, stop, panic)

  const running = useStore(s => s.running)
  const runningCount = running.size

  return (
    <div className="transport-bar">
      <div className="transport-left">
        <span className="running-badge" data-active={runningCount > 0}>
          {runningCount > 0 ? `${runningCount} running` : 'idle'}
        </span>
        {/* Whatever the operator has open, what needs them is here. */}
        <div className="transport-alerts">
          <AlertChip onShow={onShowStrip} />
          <MidiStatusBadge />
        </div>
      </div>
      <div className="transport-center">
        <button className="btn-stop" onClick={stop} title="Stop all (Esc)">
          ■ STOP
        </button>
        <button className="btn-go" onClick={go} title="Go (Space)">
          ▶ GO
        </button>
        <button
          className="btn-panic"
          onClick={panic}
          title={`Panic (${formatShortcut('Shift+Esc')}, or ${formatShortcut('Mod+Shift+P')} from the Playback menu even when the window is busy)`}
        >
          ✕ PANIC
        </button>
      </div>
      {/* The three keys the show is run with, written for this keyboard. */}
      <div className="transport-right">
        <span className="transport-keys">
          <kbd>Space</kbd> go · <kbd>Esc</kbd> stop · <kbd>{formatShortcut('Shift+Esc')}</kbd> panic
        </span>
      </div>
    </div>
  )
}
