import { useStore, usePro } from '../../store'
import { useCueRunner, useKeyboard } from '../../hooks/useCueRunner'
import { ProMark } from '../license/ProLock'
import './TransportBar.css'

interface Props {
  /** Which bottom strip is open, or none. They share the space, so only one at a time. */
  strip: ShowStrip | null
  onToggleStrip: (strip: ShowStrip) => void
}

/** The panels that live along the bottom of the window, one at a time. */
export type ShowStrip = 'log' | 'monitor' | 'rf' | 'script'

const STRIPS: { strip: ShowStrip; label: string; title: string; pro?: true }[] = [
  { strip: 'log', label: 'LOG', title: 'Show or hide the log' },
  { strip: 'monitor', label: 'MONITOR', title: 'Show or hide the show monitor', pro: true },
  { strip: 'rf', label: 'RF', title: 'Show or hide the wireless panel', pro: true },
  { strip: 'script', label: 'SCRIPT', title: 'Show or hide the script', pro: true }
]

export function TransportBar({ strip, onToggleStrip }: Props) {
  const { go, stop, panic } = useCueRunner()
  useKeyboard(go, stop, panic)
  const pro = usePro()

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
