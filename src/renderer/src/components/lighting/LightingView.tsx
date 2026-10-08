import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { DmxMonitor } from '../../../../shared/dmxWire'
import { DMX_SERVICE_ID } from '../../../../shared/dmxWire'
import { lightingCommand, releaseLight } from '../../engine/lighting'
import { PatchPanel } from './PatchPanel'
import { GroupsPanel } from './GroupsPanel'
import { FadersPanel } from './FadersPanel'
import { DmxMonitorPanel } from './DmxMonitorPanel'
import { NetworkPanel } from './NetworkPanel'
import './Lighting.css'

type LightingTab = 'patch' | 'groups' | 'faders' | 'monitor' | 'network'

const TABS: { id: LightingTab; label: string }[] = [
  { id: 'patch', label: 'Patch' },
  { id: 'groups', label: 'Groups' },
  { id: 'faders', label: 'Faders' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'network', label: 'Network' }
]

/** How often the view reads the engine back: ten times a second, which a fader and a cell keep up with. */
export const MONITOR_POLL_MS = 100

/** How long Release all takes to bring the rig home. */
const RELEASE_ALL_MS = 2000

/**
 * The engine's own account of the rig, read back while the view is open: what is going out,
 * what is heard, what the faders hold. Polled rather than pushed — the view is the only reader,
 * and a closed view costs nothing.
 */
export function useDmxMonitor(universes: readonly number[]): DmxMonitor | null {
  const [monitor, setMonitor] = useState<DmxMonitor | null>(null)
  const key = universes.join(',')
  useEffect(() => {
    let live = true
    let busy = false
    const read = (): void => {
      if (busy) return
      busy = true
      void lightingCommand('monitor', { universes: key === '' ? [] : key.split(',').map(Number) }).then(answer => {
        busy = false
        if (live && answer.ok) setMonitor(answer.result as DmxMonitor)
      })
    }
    read()
    const timer = window.setInterval(read, MONITOR_POLL_MS)
    return () => {
      live = false
      window.clearInterval(timer)
    }
  }, [key])
  return monitor
}

/**
 * The lighting rig: the patch and its groups, the faders that build a look by hand, the DMX
 * going out of every universe, and where it goes on the network. Cues are built in the cue
 * list; this is where the rig they play on is described and watched.
 */
export function LightingView() {
  const [tab, setTab] = useState<LightingTab>('patch')
  const [universe, setUniverse] = useState(1)
  const status = useStore(s => s.showServices.find(service => service.id === DMX_SERVICE_ID))
  const monitor = useDmxMonitor(tab === 'monitor' ? [universe] : [])
  const blackout = monitor?.blackout ?? false

  return (
    <div className="lighting-view">
      <div className="lighting-header">
        <div className="lighting-tabs" role="tablist" aria-label="Lighting">
          {TABS.map(entry => (
            <button
              key={entry.id}
              className="lighting-tab"
              role="tab"
              aria-selected={tab === entry.id}
              data-active={tab === entry.id}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {status !== undefined && (
          <span className="lighting-status" data-state={status.state} title={status.error ?? status.detail}>
            {status.detail}
          </span>
        )}
        <button
          className="lighting-btn"
          title="Every cue’s levels fade home over two seconds"
          onClick={() => void releaseLight(null, RELEASE_ALL_MS)}
        >
          Release all
        </button>
        <button
          className="lighting-btn"
          data-on={blackout}
          aria-pressed={blackout}
          onClick={() => void lightingCommand('blackout', { on: !blackout })}
        >
          Blackout
        </button>
      </div>
      <div className="lighting-body">
        {tab === 'patch' && <PatchPanel />}
        {tab === 'groups' && <GroupsPanel />}
        {tab === 'faders' && <FadersPanel monitor={monitor} />}
        {tab === 'monitor' && <DmxMonitorPanel monitor={monitor} universe={universe} onUniverse={setUniverse} />}
        {tab === 'network' && <NetworkPanel />}
      </div>
    </div>
  )
}
