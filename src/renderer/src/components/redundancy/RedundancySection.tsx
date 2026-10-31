import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { NumberField, TextField } from '../common/Field'
import { Advanced, ServiceBlock } from '../common/SettingsBlock'
import {
  MAX_TIMEOUT_MS,
  MIN_TIMEOUT_MS,
  type RedundancySettings,
  type RedundancyStatus
} from '../../../../shared/redundancy'
import './Redundancy.css'

/**
 * This machine's half of a redundant pair, and what it is doing about it.
 *
 * The settings here belong to the machine rather than to the show — both machines run
 * the same workspace file, so a role written into the show would be read as the same
 * answer by both of them — and they are kept beside the machine's other settings, not in the file the
 * two machines share. The status below them is the machine's own account of what it has
 * heard, which is the half of redundancy an operator actually runs a show on.
 */
export function RedundancySection(): React.JSX.Element {
  const settings = useStore(s => s.redundancySettings)
  const setRedundancySettings = useStore(s => s.setRedundancySettings)
  const status = useStore(s => s.redundancy)
  const service = useStore(s => s.showServices.find(candidate => candidate.id === 'redundancy'))
  // The age of the last word from the partner moves on its own; the store is written
  // only when something changes, so the page keeps the clock.
  const [, setTick] = useState(0)
  /** Why the last change was not taken, if it was not. */
  const [failed, setFailed] = useState<string | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), 500)
    // The store only learns redundancy from change events, so a quiet pair plus a
    // renderer reload leaves this panel on "waiting" with no takeover button. Ask for
    // the service's current reading on mount: the command exists for exactly this.
    window.cuerunner.show.command('redundancy', 'status')
      .then(result => {
        if (result.ok && result.result && typeof result.result === 'object') {
          useStore.getState().applyShowEvents([{
            kind: 'redundancy',
            at: Date.now(),
            status: result.result as RedundancyStatus
          }])
        }
      })
      .catch(() => {})
    return () => clearInterval(timer)
  }, [])

  if (settings === null) {
    return <p className="inspector-hint">Reading this machine’s settings…</p>
  }

  const update = (patch: Partial<RedundancySettings>): void => {
    setFailed(null)
    void window.cuerunner.redundancy.configure(patch).then(
      result => {
        // What the main process accepted is what stands: a port out of range comes back
        // as the port the machine has, not as the one that was typed.
        setRedundancySettings(result.settings)
        if (!result.ok && result.error) setFailed(result.error)
      },
      error => {
        // A settings file that cannot be written — a read-only profile, a full disk —
        // leaves the machine as it was, and the operator is told rather than watching a
        // control snap back with nothing said.
        setFailed(error instanceof Error ? error.message : String(error))
      }
    )
  }

  const takeover = (): void => {
    void window.cuerunner.show.command('redundancy', 'takeover').catch(() => {
      // A service that is not running cannot be told to take a show; the status line
      // above says what this machine is.
    })
  }

  const release = (): void => {
    void window.cuerunner.show.command('redundancy', 'release').catch(() => {})
  }

  return (
    <>
      <ServiceBlock
        title="Redundant playback"
        blurb="Keep a second computer on the same show, ready to pick it up where this one stopped."
        id="settings-redundancy-enabled"
        enabled={settings.enabled}
        onEnabled={enabled => update({ enabled })}
        service={service}
      >
        <div className="field-row">
          <label htmlFor="settings-redundancy-role">This computer is</label>
          <select
            id="settings-redundancy-role"
            value={settings.role}
            disabled={!settings.enabled}
            onChange={event => update({ role: event.target.value === 'standby' ? 'standby' : 'live' })}
          >
            <option value="live">Live — it runs the show</option>
            <option value="standby">Standby — it follows the other one</option>
          </select>
        </div>

        <div className="field-row">
          <label htmlFor="settings-redundancy-name">Called</label>
          <TextField
            id="settings-redundancy-name"
            when="leave"
            value={settings.name}
            disabled={!settings.enabled}
            placeholder="desk-a"
            onValue={name => { if (name !== settings.name) update({ name }) }}
          />
        </div>

        <div className="field-row">
          <label htmlFor="settings-redundancy-takeover">If the other one stops</label>
          <select
            id="settings-redundancy-takeover"
            value={settings.takeover}
            disabled={!settings.enabled}
            onChange={event => update({ takeover: event.target.value === 'auto' ? 'auto' : 'manual' })}
          >
            <option value="manual">Tell me, and let an operator take the show</option>
            <option value="auto">Take the show over by itself</option>
          </select>
        </div>

        {failed !== null && (
          <p className="inspector-hint settings-refusal">Those settings were not taken: {failed}</p>
        )}
        {settings.enabled && settings.token === '' && (
          <p className="inspector-hint settings-refusal">
            Set an access code below, the same on both computers. Without one, any machine
            that finds this port can claim the pair.
          </p>
        )}

        <Advanced summary="How the two find each other: ports, address and access code">
          <div className="field-row">
            <label htmlFor="settings-redundancy-port">Port here</label>
            <NumberField
              id="settings-redundancy-port"
              value={settings.port}
              min={1}
              max={65535}
              disabled={!settings.enabled}
              onValue={port => { if (port !== null) update({ port }) }}
            />
          </div>
          <div className="field-row">
            <label htmlFor="settings-redundancy-peer-host">Other computer</label>
            <TextField
              id="settings-redundancy-peer-host"
              when="leave"
              value={settings.peerHost}
              disabled={!settings.enabled}
              placeholder="10.0.0.9 — leave empty to wait for it"
              onValue={peerHost => { if (peerHost !== settings.peerHost) update({ peerHost }) }}
            />
          </div>
          <div className="field-row">
            <label htmlFor="settings-redundancy-peer-port">Its port</label>
            <NumberField
              id="settings-redundancy-peer-port"
              value={settings.peerPort}
              min={1}
              max={65535}
              disabled={!settings.enabled}
              onValue={peerPort => { if (peerPort !== null) update({ peerPort }) }}
            />
          </div>
          <div className="field-row">
            <label htmlFor="settings-redundancy-token">Access code</label>
            <TextField
              id="settings-redundancy-token"
              when="leave"
              value={settings.token}
              disabled={!settings.enabled}
              placeholder="The same on both computers"
              onValue={token => { if (token !== settings.token) update({ token }) }}
            />
            <button
              className="inspector-btn"
              onClick={() => update({ token: crypto.randomUUID().slice(0, 8) })}
            >
              New code
            </button>
          </div>
          <div className="field-row">
            <label htmlFor="settings-redundancy-timeout">Gone after</label>
            <NumberField
              id="settings-redundancy-timeout"
              value={settings.timeoutMs}
              min={MIN_TIMEOUT_MS}
              max={MAX_TIMEOUT_MS}
              disabled={!settings.enabled}
              onValue={timeoutMs => { if (timeoutMs !== null) update({ timeoutMs }) }}
            />
            <span className="settings-info">ms of silence</span>
          </div>
        </Advanced>
      </ServiceBlock>

      <div className="field-section-title">Where the pair stands</div>
      {status === null || !status.enabled ? (
        <p className="inspector-hint" data-scope="panel">
          {settings.enabled
            ? 'Waiting to hear from the service. If another program is holding the port, the Monitor says so.'
            : 'Not paired — this computer is running the show on its own.'}
        </p>
      ) : (
        <div className="redundancy-status">
          <div className="redundancy-line" data-field="machine" data-role={status.role} data-driving={status.driving}>
            <span className="redundancy-label">This machine</span>
            <span className="redundancy-value">
              {status.name} — {status.driving ? 'running the show' : 'standing by'}
              {status.listening ? '' : ' (not listening)'}
            </span>
          </div>
          <div className="redundancy-line" data-field="partner" data-alive={status.peer?.alive ?? false}>
            <span className="redundancy-label">Partner</span>
            <span className="redundancy-value">{describePeer(status)}</span>
          </div>
          {status.peer && (
            <div className="redundancy-line" data-field="show">
              <span className="redundancy-label">Show</span>
              <span className="redundancy-value">
                {status.peer.inSync ? 'In sync' : `Out of sync — ${status.peer.note}`}
                {status.peer.prepared > 0 && `; ${status.peer.prepared} ${status.peer.prepared === 1 ? 'file' : 'files'} warmed there`}
              </span>
            </div>
          )}
          {status.lastEvent && (
            <div className="redundancy-line" data-field="last">
              <span className="redundancy-label">Last</span>
              <span className="redundancy-value">{status.lastEvent}</span>
            </div>
          )}
          <div className="redundancy-actions">
            {!status.driving && (
              <button className="inspector-btn" onClick={takeover} disabled={status.peer === null}>
                Take the show over now
              </button>
            )}
            {status.driving && status.role === 'standby' && (
              <button className="inspector-btn" onClick={release}>
                Give the show back
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/**
 * What is known about the partner, in the terms an operator checks it in.
 *
 * A partner that was answering when the machine last spoke about it is answering: the
 * beats are half a second apart, and a partner that had stopped would have been declared
 * gone and reported as such. The age is worked out only for the machine that has gone
 * quiet, where the status is published as the silence grows a second at a time — a number
 * computed from a status that is merely old would say "last heard 12.5 s ago" beside a
 * partner answering five times a second.
 */
function describePeer(status: RedundancyStatus): string {
  const peer = status.peer
  if (!peer) return 'nothing has answered yet'
  const what = `${peer.name} (${peer.role === 'live' ? 'live' : 'standby'})`
  const running = `${peer.running} ${peer.running === 1 ? 'cue' : 'cues'}`
  if (!peer.alive) {
    const silence = peer.silentMs + (Date.now() - status.at)
    return `${what} — gone quiet, last heard ${(silence / 1000).toFixed(1)} s ago`
  }
  return `${what} — answering, running ${running}`
}
