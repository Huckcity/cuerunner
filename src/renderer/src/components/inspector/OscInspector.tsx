import { useStore } from '../../store'
import type { OscCue, OscArg, OscArgType } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField, TextField } from '../common/Field'
import { OSC_DEFAULTS } from '../../utils/cueDefaults'

/**
 * What a new argument's value starts at, in the type the panel says it is. node-osc reads
 * the type tag off the JavaScript value, so the neutral value has to be one of that type:
 * a 0 left under a `string` argument reaches the desk as an integer, which is not what
 * the row says it is sending.
 */
function neutralValue(type: OscArgType): number | string {
  return type === 's' ? '' : 0
}

interface Props { cue: OscCue }

export function OscInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<OscCue>) => update(cue.id, patch)

  const addArg = () => {
    const arg: OscArg = { type: 'f', value: 0 }
    set({ args: [...cue.args, arg] })
  }

  const removeArg = (i: number) => set({ args: cue.args.filter((_, idx) => idx !== i) })

  const updateArg = (i: number, patch: Partial<OscArg>) => {
    const args = cue.args.map((a, idx) => idx === i ? { ...a, ...patch } : a)
    set({ args })
  }

  return (
    <div>
      <div className="field-row">
        <label>Host</label>
        <TextField when="typed" value={cue.host} onValue={host => set({ host })} />
        <ResetButton label="Host" value={cue.host} defaultValue={OSC_DEFAULTS.host}
          onReset={() => set({ host: OSC_DEFAULTS.host })} />
      </div>
      <div className="field-row">
        <label>Port</label>
        <NumberField when="typed" min={1} max={65535} value={cue.port}
          onValue={port => { if (port !== null) set({ port }) }} />
        <ResetButton label="Port" value={cue.port} defaultValue={OSC_DEFAULTS.port}
          onReset={() => set({ port: OSC_DEFAULTS.port })} />
      </div>
      <div className="field-row">
        <label>Address</label>
        <TextField when="typed" value={cue.address} onValue={address => set({ address })} />
        <ResetButton label="Address" value={cue.address} defaultValue={OSC_DEFAULTS.address}
          onReset={() => set({ address: OSC_DEFAULTS.address })} />
      </div>
      <div className="field-section-title">Arguments</div>
      {cue.args.map((arg, i) => (
        <div key={i} className="field-row">
          <label>Arg {i + 1}</label>
          <select value={arg.type}
            onChange={e => updateArg(i, {
              type: e.target.value as OscArgType,
              value: arg.type !== e.target.value ? neutralValue(e.target.value as OscArgType) : arg.value
            })}
            style={{ width: 50, flex: 'none' }}>
            <option value="i">int</option>
            <option value="f">float</option>
            <option value="s">string</option>
            <option value="T">true</option>
            <option value="F">false</option>
          </select>
          {(arg.type === 'i' || arg.type === 'f') && (
            <NumberField when="typed" step={arg.type === 'i' ? 1 : 0.001} value={arg.value as number}
              onValue={value => { if (value !== null) updateArg(i, { value }) }} />
          )}
          {arg.type === 's' && (
            <TextField when="typed" value={arg.value as string}
              onValue={value => updateArg(i, { value })} />
          )}
          {(arg.type === 'T' || arg.type === 'F') && (
            <span className="inspector-hint" style={{ flex: 1, marginTop: 0 }}>
              {arg.type === 'T' ? 'true' : 'false'}
            </span>
          )}
          <button onClick={() => removeArg(i)} className="inspector-btn-icon">✕</button>
        </div>
      ))}
      <button onClick={addArg} className="inspector-add-btn add-row">+ Add argument</button>
      <LastRun cueId={cue.id} />
    </div>
  )
}
