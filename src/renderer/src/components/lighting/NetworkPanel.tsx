import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import {
  artnetPortAddress,
  DMX_LIMITS,
  wireUniverseRange,
  type DmxProtocol,
  type DmxTransport,
  type LightingPanic
} from '../../../../shared/dmx'
import type { ArtNetNode, DmxInterfaces } from '../../../../shared/dmxWire'
import { NumberField, TextField } from '../common/Field'
import { addInput, addOutput, removeInput, removeOutput, updateInput, updateOutput } from '../../utils/lighting'
import { lightingCommand } from '../../engine/lighting'

function portAddressText(portAddress: number): string {
  const { net, subnet, universe } = artnetPortAddress(portAddress)
  return `${net}:${subnet}:${universe}`
}

/**
 * Where the lights go: each universe's outputs — sACN to its multicast group or one receiver,
 * Art-Net broadcast or to one node — the consoles this machine listens to, synchronisation,
 * what a panic does, and which of this machine's interfaces the traffic leaves by.
 */
export function NetworkPanel() {
  const lighting = useStore(s => s.lighting)
  const setLighting = useStore(s => s.setLighting)
  const [universe, setUniverse] = useState(1)
  const [protocol, setProtocol] = useState<DmxProtocol>('sacn')
  const [interfaces, setInterfaces] = useState<DmxInterfaces | null>(null)
  const [nodes, setNodes] = useState<ArtNetNode[] | null>(null)
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void lightingCommand('interfaces').then(answer => {
      if (answer.ok) setInterfaces(answer.result as DmxInterfaces)
      else setError(answer.error ?? null)
    })
  }, [])

  const chooseInterface = (name: string): void => {
    void lightingCommand('setInterface', { name: name === '' ? null : name }).then(answer => {
      if (answer.ok) setInterfaces(answer.result as DmxInterfaces)
      else setError(answer.error ?? null)
    })
  }

  const find = (): void => {
    setLooking(true)
    void lightingCommand('discover').then(answer => {
      setLooking(false)
      if (answer.ok) setNodes(answer.result as ArtNetNode[])
      else setError(answer.error ?? null)
    })
  }

  return (
    <div className="lighting-panel" data-panel="network">
      <div className="lighting-section-title">This machine</div>
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="dmx-interface">Interface</label>
          <select id="dmx-interface" value={interfaces?.selected ?? ''} onChange={e => chooseInterface(e.target.value)}>
            <option value="">Automatic</option>
            {interfaces?.missing === true && interfaces.selected !== null && (
              <option value={interfaces.selected}>{interfaces.selected} — not on this machine</option>
            )}
            {interfaces?.interfaces.map(entry => (
              <option key={`${entry.name}:${entry.address}`} value={entry.name}>{entry.name} · {entry.address}</option>
            ))}
          </select>
        </div>
      </div>
      {error !== null && <p className="lighting-error" role="alert">{error}</p>}

      <div className="lighting-section-title">Outputs</div>
      {lighting.outputs.length === 0 && <p className="lighting-note">No universe goes anywhere yet.</p>}
      {lighting.outputs.length > 0 && (
        <table className="lighting-table" aria-label="Outputs">
          <thead>
            <tr>
              <th className="lighting-narrow">Universe</th>
              <th>Protocol</th>
              <th>Sent by</th>
              <th>Address</th>
              <th className="lighting-narrow">On the wire</th>
              <th className="lighting-narrow">Priority</th>
              <th>On</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lighting.outputs.map(output => {
              const [low, high] = wireUniverseRange(output.protocol)
              const set = (patch: Parameters<typeof updateOutput>[2]): void => setLighting(updateOutput(lighting, output.id, patch))
              return (
                <tr key={output.id} data-output={output.universe}>
                  <td className="lighting-narrow">
                    <NumberField aria-label="Output universe" min={1} max={DMX_LIMITS.maxUniverse} value={output.universe}
                      onValue={value => { if (value !== null) set({ universe: value }) }} />
                  </td>
                  <td>
                    <select aria-label="Output protocol" value={output.protocol}
                      onChange={e => set({ protocol: e.target.value as DmxProtocol })}>
                      <option value="sacn">sACN</option>
                      <option value="artnet">Art-Net</option>
                    </select>
                  </td>
                  <td>
                    <select aria-label="Output transport" value={output.transport}
                      onChange={e => set({ transport: e.target.value as DmxTransport })}>
                      {output.protocol === 'sacn' ? (
                        <>
                          <option value="multicast">Multicast</option>
                          <option value="unicast">Unicast</option>
                        </>
                      ) : (
                        <>
                          <option value="broadcast">Broadcast</option>
                          <option value="unicast">Unicast</option>
                        </>
                      )}
                    </select>
                  </td>
                  <td>
                    <TextField aria-label="Output address" value={output.address}
                      disabled={output.protocol === 'sacn' && output.transport === 'multicast'}
                      placeholder={output.transport === 'unicast' ? '10.0.0.40' : output.protocol === 'artnet' ? 'subnet broadcast' : 'its multicast group'}
                      onValue={text => set({ address: text.trim() })} />
                  </td>
                  <td className="lighting-narrow">
                    <NumberField aria-label="Output wire universe" min={low} max={high} value={output.wireUniverse}
                      title={output.protocol === 'artnet' ? `Net:SubNet:Universe ${portAddressText(output.wireUniverse)}` : undefined}
                      onValue={value => { if (value !== null) set({ wireUniverse: value }) }} />
                  </td>
                  <td className="lighting-narrow">
                    <NumberField aria-label="Output priority" min={0} max={200} value={output.priority}
                      disabled={output.protocol !== 'sacn'}
                      onValue={value => { if (value !== null) set({ priority: value }) }} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Output on" checked={output.enabled}
                      onChange={e => set({ enabled: e.target.checked })} />
                  </td>
                  <td className="lighting-actions-cell">
                    <button className="lighting-btn lighting-btn-remove" onClick={() => setLighting(removeOutput(lighting, output.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="new-output-universe">Universe</label>
          <NumberField id="new-output-universe" when="typed" min={1} max={DMX_LIMITS.maxUniverse} value={universe}
            onValue={value => { if (value !== null) setUniverse(value) }} />
        </div>
        <div className="field-row">
          <label htmlFor="new-output-protocol">Protocol</label>
          <select id="new-output-protocol" value={protocol} onChange={e => setProtocol(e.target.value as DmxProtocol)}>
            <option value="sacn">sACN</option>
            <option value="artnet">Art-Net</option>
          </select>
        </div>
      </div>
      <div className="lighting-form-actions">
        <button className="lighting-btn" onClick={() => setLighting(addOutput(lighting, universe, protocol))}>Add output</button>
        <button className="lighting-btn" onClick={() => setLighting(addInput(lighting, universe, protocol))}>Listen to this universe</button>
      </div>

      <div className="lighting-section-title">Consoles heard</div>
      {lighting.inputs.length === 0 ? (
        <p className="lighting-note">Not listening to any. A universe heard shows in the monitor, and can be merged in.</p>
      ) : (
        <table className="lighting-table" aria-label="Inputs">
          <thead>
            <tr><th>Protocol</th><th className="lighting-narrow">On the wire</th><th className="lighting-narrow">Shown as</th><th>Merge in</th><th>On</th><th /></tr>
          </thead>
          <tbody>
            {lighting.inputs.map(input => {
              const [low, high] = wireUniverseRange(input.protocol)
              return (
                <tr key={input.id}>
                  <td>{input.protocol === 'sacn' ? 'sACN' : 'Art-Net'}</td>
                  <td className="lighting-narrow">
                    <NumberField aria-label="Input wire universe" min={low} max={high} value={input.wireUniverse}
                      onValue={value => { if (value !== null) setLighting(updateInput(lighting, input.id, { wireUniverse: value })) }} />
                  </td>
                  <td className="lighting-narrow">
                    <NumberField aria-label="Input universe" min={1} max={DMX_LIMITS.maxUniverse} value={input.universe}
                      onValue={value => { if (value !== null) setLighting(updateInput(lighting, input.id, { universe: value })) }} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Merge in" checked={input.merge}
                      onChange={e => setLighting(updateInput(lighting, input.id, { merge: e.target.checked }))} />
                  </td>
                  <td>
                    <input type="checkbox" aria-label="Input on" checked={input.enabled}
                      onChange={e => setLighting(updateInput(lighting, input.id, { enabled: e.target.checked }))} />
                  </td>
                  <td className="lighting-actions-cell">
                    <button className="lighting-btn lighting-btn-remove" onClick={() => setLighting(removeInput(lighting, input.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="lighting-section-title">Show</div>
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="dmx-sync">Synchronise</label>
          <input id="dmx-sync" type="checkbox" checked={lighting.sync}
            onChange={e => setLighting({ ...lighting, sync: e.target.checked })} />
        </div>
        <div className="field-row">
          <label htmlFor="dmx-sync-universe">Sync universe</label>
          <NumberField id="dmx-sync-universe" min={1} max={63999} value={lighting.syncUniverse} disabled={!lighting.sync}
            onValue={value => { if (value !== null) setLighting({ ...lighting, syncUniverse: value }) }} />
        </div>
        <div className="field-row">
          <label htmlFor="dmx-panic">On panic</label>
          <select id="dmx-panic" value={lighting.panic}
            onChange={e => setLighting({ ...lighting, panic: e.target.value as LightingPanic })}>
            <option value="hold">Hold the lights where they are</option>
            <option value="release">Release every cue home</option>
            <option value="blackout">Black out</option>
          </select>
        </div>
      </div>

      <div className="lighting-section-title">Art-Net nodes</div>
      <div className="lighting-form-actions">
        <button className="lighting-btn" disabled={looking} onClick={find}>{looking ? 'Looking…' : 'Find nodes'}</button>
      </div>
      {nodes !== null && nodes.length === 0 && <p className="lighting-note">No node answered.</p>}
      {nodes !== null && nodes.length > 0 && (
        <table className="lighting-table" aria-label="Art-Net nodes">
          <thead>
            <tr><th>Address</th><th>Name</th><th>Outputs</th><th>MAC</th></tr>
          </thead>
          <tbody>
            {nodes.map(node => (
              <tr key={`${node.address}#${node.bindIndex}`}>
                <td className="lighting-mono">{node.address}</td>
                <td title={node.longName}>{node.shortName || node.longName}</td>
                <td className="lighting-mono">{node.outputs.map(portAddressText).join(', ') || '—'}</td>
                <td className="lighting-mono">{node.mac}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
