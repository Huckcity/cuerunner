import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { NumberField, TextField } from '../common/Field'
import type { OscPatch } from '../../../../shared/cue'
import type { OscDirection, OscInterfaceState } from '../../../../shared/ipc/osc'
import {
  defaultFeedbackSettings,
  MAX_FEEDBACK_RATE_HZ,
  type OscFeedbackSettings
} from '../../../../shared/oscFeedback'
import { MAX_OSC_PATCHES } from '../../../../shared/oscPatches'

/**
 * The OSC that is not the listener's switch: which network interface this machine listens and
 * sends on, where the show's state is pushed for a remote to read, and the show's named OSC
 * destinations. Drawn on the Network tab under the listener, as one more block each.
 */
export function OscSettings() {
  return (
    <>
      <OscInterfaceBlock />
      <OscFeedbackBlock />
      <OscPatchesBlock />
    </>
  )
}

/** Which interface each direction is pinned to: this machine's, so it says so. */
function OscInterfaceBlock() {
  const [state, setState] = useState<OscInterfaceState | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void window.cuerunner.osc.interfaces().then(answer => { if (live) setState(answer) })
    return () => { live = false }
  }, [])

  const choose = async (direction: OscDirection, name: string | null): Promise<void> => {
    const answer = await window.cuerunner.osc.setInterface({ direction, name })
    if (!answer.ok) {
      setRefusal(answer.error)
      return
    }
    setRefusal(null)
    setState(answer)
  }

  if (state === null) return null
  const row = (direction: OscDirection, label: string, id: string) => {
    const choice = direction === 'in' ? state.input : state.output
    return (
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <select
          id={id}
          value={choice.selected ?? ''}
          onChange={e => { void choose(direction, e.target.value === '' ? null : e.target.value) }}
        >
          <option value="">Any interface</option>
          {/* A chosen interface that is not on the machine now is said, not dropped. */}
          {choice.missing && choice.selected !== null && (
            <option value={choice.selected}>{choice.selected} — not on this machine</option>
          )}
          {state.interfaces.map(entry => (
            <option key={`${entry.name}-${entry.address}`} value={entry.name}>
              {entry.name} ({entry.address}){entry.internal ? ', this machine only' : ''}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <section className="osc-settings-group osc-interfaces">
      <div className="field-section-title">Network interface</div>
      <p className="inspector-hint" data-scope="panel">Kept on this machine, not in the show.</p>
      {row('in', 'Listen on', 'settings-osc-interface-in')}
      {row('out', 'Send from', 'settings-osc-interface-out')}
      {refusal !== null && <p className="settings-warning" role="status">{refusal}</p>}
    </section>
  )
}

/** Where the show's state is pushed, and how often a running cue's progress is. */
function OscFeedbackBlock() {
  const oscIn = useStore(s => s.showSettings.oscIn)
  const update = useStore(s => s.updateOscInSettings)
  const feedback = oscIn.feedback ?? defaultFeedbackSettings()
  const set = (patch: Partial<OscFeedbackSettings>): void => update({ feedback: { ...feedback, ...patch } })
  const disabled = !oscIn.enabled

  return (
    <section className="osc-settings-group osc-feedback" data-enabled={feedback.enabled}>
      <div className="field-section-title">Feedback</div>
      <div className="field-row">
        <label htmlFor="settings-osc-feedback">Push state</label>
        <input
          id="settings-osc-feedback"
          type="checkbox"
          checked={feedback.enabled}
          disabled={disabled}
          onChange={e => set({ enabled: e.target.checked })}
        />
        <span className="settings-info">The playhead, what runs, and its progress</span>
      </div>
      <div className="field-row">
        <label htmlFor="settings-osc-feedback-host">Send to</label>
        <TextField
          id="settings-osc-feedback-host"
          value={feedback.host}
          disabled={disabled}
          validate={text => (text.trim() === '' ? 'a host is needed: an address or a name' : null)}
          onValue={host => set({ host: host.trim() })}
        />
      </div>
      <div className="field-row">
        <label htmlFor="settings-osc-feedback-port">Port</label>
        <NumberField
          id="settings-osc-feedback-port"
          value={feedback.port}
          min={1}
          max={65535}
          disabled={disabled}
          onValue={port => { if (port !== null) set({ port }) }}
        />
      </div>
      <div className="field-row">
        <label htmlFor="settings-osc-feedback-rate">Progress (Hz)</label>
        <NumberField
          id="settings-osc-feedback-rate"
          value={feedback.rateHz}
          min={0}
          max={MAX_FEEDBACK_RATE_HZ}
          disabled={disabled}
          onValue={rateHz => { if (rateHz !== null) set({ rateHz }) }}
        />
      </div>
      <p className="inspector-hint" data-scope="panel">
        Remotes may also ask: /cuerunner/feedback/subscribe, or QLab’s /updates 1.
      </p>
    </section>
  )
}

/** The show's named OSC destinations, which an OSC cue's messages choose by name. */
function OscPatchesBlock() {
  const patches = useStore(s => s.oscPatches)
  const setPatches = useStore(s => s.setOscPatches)
  const cues = useStore(s => s.cues)
  const [confirming, setConfirming] = useState<string | null>(null)

  const edit = (id: string, patch: Partial<OscPatch>): void =>
    setPatches(patches.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)))

  const usedBy = (id: string): number => cues.filter(cue =>
    cue.type === 'osc' && (cue.messages ?? []).some(message => message.patchId === id)).length

  return (
    <section className="osc-settings-group osc-patches">
      <div className="field-section-title">OSC patches</div>
      <p className="inspector-hint" data-scope="panel">Named destinations an OSC cue sends to.</p>
      {patches.map((patch, index) => (
        <div className="osc-patch" key={patch.id} data-patch={patch.id}>
          <div className="field-row">
            <label htmlFor={`osc-patch-${index}-name`}>Name</label>
            <TextField id={`osc-patch-${index}-name`} value={patch.name} onValue={name => edit(patch.id, { name })} />
            <button
              type="button"
              className="inspector-btn-icon osc-patch-remove"
              title={`Remove ${patch.name || 'this patch'}`}
              aria-label={`Remove ${patch.name || 'this patch'}`}
              onClick={() => {
                // A patch cues send through is asked about first: its messages would have nowhere to go.
                if (usedBy(patch.id) > 0 && confirming !== patch.id) { setConfirming(patch.id); return }
                setConfirming(null)
                setPatches(patches.filter(entry => entry.id !== patch.id))
              }}
            >✕</button>
          </div>
          {confirming === patch.id && (
            <p className="settings-warning" role="status">
              {usedBy(patch.id)} OSC {usedBy(patch.id) === 1 ? 'cue sends' : 'cues send'} through it. Press ✕ again to remove it.
            </p>
          )}
          <div className="field-row">
            <label htmlFor={`osc-patch-${index}-host`}>Host</label>
            <TextField id={`osc-patch-${index}-host`} value={patch.host} onValue={host => edit(patch.id, { host: host.trim() })} />
          </div>
          <div className="field-row">
            <label htmlFor={`osc-patch-${index}-port`}>Port</label>
            <NumberField id={`osc-patch-${index}-port`} value={patch.port} min={1} max={65535}
              onValue={port => { if (port !== null) edit(patch.id, { port }) }} />
          </div>
        </div>
      ))}
      <button
        type="button"
        className="inspector-add-btn add-row osc-patch-add"
        disabled={patches.length >= MAX_OSC_PATCHES}
        onClick={() => setPatches([...patches, {
          id: crypto.randomUUID(),
          name: `Patch ${patches.length + 1}`,
          host: '127.0.0.1',
          port: 8000
        }])}
      >+ Add patch</button>
    </section>
  )
}
