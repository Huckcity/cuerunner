import { useStore, usePro } from '../../store'
import { useCueRunner, useKeyboard } from '../../hooks/useCueRunner'
import { ProMark } from '../license/ProLock'
import MidiStatusBadge from '../midi/MidiStatusBadge'
import { AlertChip } from './AlertChip'
import { formatShortcut } from '../../utils/shortcuts'
import './TransportBar.css'

interface Props {
  /** Which bottom strip is open, or none. They share the space, so only one at a time. */
  strip: ShowStrip | null
  onToggleStrip: (strip: ShowStrip) => void
  /** Opens a strip without toggling it: an alarm asks for its panel, never to hide it. */
  onShowStrip: (strip: ShowStrip) => void
}

/** The panels that live along the bottom of the window, one at a time. */
export type ShowStrip = 'log' | 'monitor' | 'rf' | 'script'

const STRIPS: { strip: ShowStrip; label: string; title: string; pro?: true }[] = [
  { strip: 'log', label: 'LOG', title: 'Show or hide the log' },
  { strip: 'monitor', label: 'MONITOR', title: 'Show or hide the show monitor', pro: true },
  { strip: 'rf', label: 'RF', title: 'Show or hide the wireless panel', pro: true },
  { strip: 'script', label: 'SCRIPT', title: 'Show or hide the script', pro: true }
]

export function TransportBar({ strip, onToggleStrip, onShowStrip }: Props) {
  const { go, stop, panic } = useCueRunner()
  useKeyboard(go, stop, panic)
  const pro = usePro()

  const running = useStore(s => s.running)
  const runningCount = running.size

  return (
    <div className="transport-bar">
      <div className="transport-left">
        <span className="running-badge" data-active={runningCount > 0}>
          {runningCount > 0 ? `${runningCount} running` : 'idle'}
        </span>
        {STRIPS.map(({ strip: id, label, title, pro: gated }) => (
          <button
            key={id}
            className={`btn-${id}`}
            data-active={strip === id}
            data-locked={gated === true && !pro}
            onClick={() => onToggleStrip(id)}
            title={gated === true && !pro ? `${title} — part of WinsLab Pro` : title}
          >
            {label}
            {gated === true && !pro && <ProMark />}
          </button>
        ))}
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
