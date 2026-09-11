import { useStore } from '../../store'
import { useCueRunner, useKeyboard } from '../../hooks/useCueRunner'
import './TransportBar.css'

interface Props {
  /** Which bottom strip is open, or none. They share the space, so only one at a time. */
  strip: ShowStrip | null
  onToggleStrip: (strip: ShowStrip) => void
}

/** The panels that live along the bottom of the window, one at a time. */
export type ShowStrip = 'log' | 'monitor' | 'rf'

export function TransportBar({ strip, onToggleStrip }: Props) {
  const { go, stop, panic } = useCueRunner()
  useKeyboard(go, stop, panic)

  const selectedId = useStore(s => s.selectedId)
  const cues = useStore(s => s.cues)
  const running = useStore(s => s.running)

  const selectedCue = cues.find(c => c.id === selectedId)
  const runningCount = running.size

  return (
    <div className="transport-bar">
      <div className="transport-left">
        <span className="running-badge" data-active={runningCount > 0}>
          {runningCount > 0 ? `${runningCount} running` : 'idle'}
        </span>
        <button
          className="btn-log"
          data-active={strip === 'log'}
          onClick={() => onToggleStrip('log')}
          title="Show or hide the log"
        >
          LOG
        </button>
        <button
          className="btn-monitor"
          data-active={strip === 'monitor'}
          onClick={() => onToggleStrip('monitor')}
          title="Show or hide the show monitor"
        >
          MONITOR
        </button>
        <button
          className="btn-rf"
          data-active={strip === 'rf'}
          onClick={() => onToggleStrip('rf')}
          title="Show or hide the wireless panel"
        >
          RF
        </button>
      </div>
      <div className="transport-center">
        <button className="btn-stop" onClick={stop} title="Stop All (Esc)">
          ■ STOP
        </button>
        <button className="btn-go" onClick={go} title="Go (Space)">
          ▶ GO
        </button>
        <button className="btn-panic" onClick={panic} title="Panic (Shift+Esc)">
          ✕ PANIC
        </button>
      </div>
      <div className="transport-right">
        {selectedCue && (
          <span className="next-cue">
            <strong>{selectedCue.number}</strong> {selectedCue.name}
          </span>
        )}
      </div>
    </div>
  )
}
