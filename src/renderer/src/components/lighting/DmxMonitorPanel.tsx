import { useStore } from '../../store'
import type { DmxMonitor } from '../../../../shared/dmxWire'
import { DMX_LIMITS } from '../../../../shared/dmx'

interface Props {
  monitor: DmxMonitor | null
  universe: number
  onUniverse: (universe: number) => void
}

/**
 * What one universe is sending, slot by slot, as the engine computes it this tenth of a second —
 * cues, faders, identify, merge and blackout all folded in — and, under each slot, what a
 * console this machine listens to is sending on it.
 */
export function DmxMonitorPanel({ monitor, universe, onUniverse }: Props) {
  const lighting = useStore(s => s.lighting)
  const known = new Set<number>([
    ...(monitor?.universes ?? []),
    ...lighting.fixtures.map(fixture => fixture.universe),
    ...lighting.outputs.map(output => output.universe),
    ...lighting.inputs.map(input => input.universe),
    universe
  ])
  const universes = [...known].sort((a, b) => a - b).slice(0, DMX_LIMITS.universes * 2)
  const frame = monitor?.frames.find(entry => entry.universe === universe) ?? null
  const slots = frame?.output ?? new Array<number>(DMX_LIMITS.slots).fill(0)

  return (
    <div className="lighting-panel" data-panel="monitor">
      <div className="lighting-monitor-head">
        <label htmlFor="monitor-universe" className="lighting-note">Universe</label>
        <select id="monitor-universe" value={universe} onChange={e => onUniverse(Number(e.target.value))}>
          {universes.map(entry => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <span className="lighting-note" data-sent={frame?.sent ?? false}>
          {frame === null ? 'reading…' : frame.sent ? 'going out' : 'no output for this universe: computed, not sent'}
        </span>
        {frame?.inputSource != null && <span className="lighting-note">heard from {frame.inputSource}</span>}
        {monitor?.blackout === true && <span className="lighting-error">blackout</span>}
        {monitor?.error != null && <span className="lighting-error">{monitor.error}</span>}
      </div>
      <div className="lighting-cells" aria-label={`Universe ${universe}`} data-universe={universe}>
        {slots.map((value, index) => (
          <div key={index} className="lighting-cell" data-slot={index + 1} data-value={value} data-zero={value === 0}>
            <span className="lighting-cell-slot">{index + 1}</span>
            <span className="lighting-cell-value">{value}</span>
            {frame?.input != null && <span className="lighting-cell-heard">{frame.input[index]}</span>}
            <span className="lighting-cell-bar" style={{ width: `${(value / 255) * 100}%` }} />
          </div>
        ))}
      </div>
    </div>
  )
}
