import { useStore } from '../../store'
import type { NetworkCue } from '../../types/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NETWORK_DEFAULTS } from '../../utils/cueDefaults'

const METHODS: NetworkCue['method'][] = ['GET', 'POST', 'PUT']

interface Props { cue: NetworkCue }

export function NetworkInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<NetworkCue>) => update(cue.id, patch)

  const headers = Object.entries(cue.headers)
  const bodyDisabled = cue.method === 'GET'

  // Headers are stored as a plain object, so edits round-trip through
  // Object.entries/Object.fromEntries. Row order is preserved, and editing a row
  // whose key collides with another row keeps the value of the last duplicate.
  const setHeader = (i: number, row: [string, string]) => {
    const rows = headers.map((h, idx) => (idx === i ? row : h))
    set({ headers: Object.fromEntries(rows) })
  }

  const removeHeader = (i: number) => {
    set({ headers: Object.fromEntries(headers.filter((_, idx) => idx !== i)) })
  }

  const addHeader = () => {
    const base = 'New-Header'
    let key = base
    for (let n = 2; key in cue.headers; n++) key = `${base}-${n}`
    set({ headers: { ...cue.headers, [key]: '' } })
  }

  return (
    <div>
      <div className="field-row">
        <label>Method</label>
        <select value={cue.method} onChange={e => set({ method: e.target.value as NetworkCue['method'] })}>
          {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <ResetButton label="Method" value={cue.method} defaultValue={NETWORK_DEFAULTS.method}
          onReset={() => set({ method: NETWORK_DEFAULTS.method })} />
      </div>
      <div className="field-row">
        <label>URL</label>
        <input
          value={cue.url}
          placeholder="https://example.com/webhook"
          onChange={e => set({ url: e.target.value })}
        />
      </div>
      <div className="field-row">
        <label>Timeout (ms)</label>
        <input
          type="number"
          min={1}
          step={100}
          value={cue.timeout}
          onChange={e => {
            const v = Number(e.target.value)
            if (!isNaN(v) && v > 0) set({ timeout: v })
          }}
        />
        <ResetButton label="Timeout" value={cue.timeout} defaultValue={NETWORK_DEFAULTS.timeout}
          onReset={() => set({ timeout: NETWORK_DEFAULTS.timeout })} />
      </div>

      <div className="field-section-title">Headers</div>
      {headers.map(([key, value], i) => (
        <div key={i} className="field-row">
          <label>Header {i + 1}</label>
          <input
            value={key}
            placeholder="Content-Type"
            onChange={e => setHeader(i, [e.target.value, value])}
          />
          <input
            value={value}
            placeholder="application/json"
            onChange={e => setHeader(i, [key, e.target.value])}
          />
          <button
            className="inspector-btn-icon"
            title="Remove header"
            onClick={() => removeHeader(i)}
          >✕</button>
        </div>
      ))}
      <button className="inspector-add-btn" onClick={addHeader}>+ Add Header</button>

      <div className="field-section-title">Body</div>
      <div className="field-row">
        <label></label>
        <textarea
          value={cue.body}
          rows={5}
          disabled={bodyDisabled}
          placeholder={bodyDisabled ? 'GET requests send no body' : '{"scene": 3}'}
          onChange={e => set({ body: e.target.value })}
        />
      </div>

      <p className="inspector-hint">
        Fires when the cue runs and holds the show until the request settles or the
        timeout elapses. The request is made by the app itself, not by the page, so a
        console on the LAN needs no CORS headers.
      </p>

      <LastRun cueId={cue.id} />
    </div>
  )
}
