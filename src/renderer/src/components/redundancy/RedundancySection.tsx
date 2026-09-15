import { useEffect, useState } from 'react'
import { usePro, useStore } from '../../store'
import { NumberField, TextField } from '../common/Field'
import { ProLock } from '../license/ProLock'
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
 * answer by both of them — and they are kept beside the license key, not in the file the
 * two machines share. The status below them is the machine's own account of what it has
 * heard, which is the half of redundancy an operator actually runs a show on.
 */
export function RedundancySection(): React.JSX.Element {
  const pro = usePro()
  const settings = useStore(s => s.redundancySettings)
  const setRedundancySettings = useStore(s => s.setRedundancySettings)
  const status = useStore(s => s.redundancy)
  const service = useStore(s => s.showServices.find(candidate => candidate.id === 'redundancy'))
  // The age of the last word from the partner moves on its own; the store is written
  // only when something changes, so the page keeps the clock.
  const [, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick(tick => tick + 1), 500)
    return () => clearInterval(timer)
  }, [])

  // A locked machine is told what the feature is rather than shown a dead panel: the
  // settings it would have are machine settings, and reading them is not the gate.
  if (!pro) {
    return (
      <ProLock
        variant="section"
        feature="Redundant playback"
        blurb="A second machine runs the same show, mirrors it cue by cue, and picks it up where it stopped if this one goes down."
      />
    )
  }

  if (settings === null) {
    return <p className="inspector-hint">Reading this machine’s settings…</p>
  }

  const update = (patch: Partial<RedundancySettings>): void => {
    void window.winslab.redundancy.configure(patch).then(result => {
      // What the main process accepted is what stands: a port out of range comes back
      // as the port the machine has, not as the one that was typed.
      setRedundancySettings(result.settings)
    })
  }

  const takeover = (): void => {
    void window.winslab.show.command('redundancy', 'takeover').catch(() => {
      // A service that is not running cannot be told to take a show; the status line
      // above says what this machine is.
    })
  }

  const release = (): void => {
    void window.winslab.show.command('redundancy', 'release').catch(() => {})
  }

  return (
    <>
      <div className="field-section-title">This machine</div>
      <p className="inspector-hint">
        Two machines run the same show and the same workspace file. Which one is the main,
        what it is called, and where the other one is are facts about the machines, so
        they are kept with this one rather than with the show.
      </p>

      <div className="field-row">
        <label htmlFor="settings-redundancy-enabled">Redundant playback</label>
        <input
          id="settings-redundancy-enabled"
          type="checkbox"
          checked={settings.enabled}
          onChange={event => update({ enabled: event.target.checked })}
        />
      </div>

      <div className="field-row">
        <label htmlFor="settings-redundancy-role">Role</label>
        <select
          id="settings-redundancy-role"
          value={settings.role}
          disabled={!settings.enabled}
          onChange={event => update({ role: event.target.value === 'standby' ? 'standby' : 'live' })}
        >
          <option value="live">Live — this machine runs the show</option>
          <option value="standby">Standby — this machine mirrors it</option>
        </select>
      </div>

      <div className="field-row">
        <label htmlFor="settings-redundancy-name">Name</label>
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
        <label htmlFor="settings-redundancy-takeover">When the partner goes quiet</label>
        <select
          id="settings-redundancy-takeover"
          value={settings.takeover}
          disabled={!settings.enabled}
          onChange={event => update({ takeover: event.target.value === 'auto' ? 'auto' : 'manual' })}
        >
          <option value="manual">Tell me — an operator takes the show</option>
          <option value="auto">Take it over — this machine carries on by itself</option>
        </select>
      </div>

      <div className="field-section-title">The pair</div>
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
        <label htmlFor="settings-redundancy-peer-host">Partner address</label>
        <TextField
          id="settings-redundancy-peer-host"
          when="leave"
          value={settings.peerHost}
          disabled={!settings.enabled}
          placeholder="10.0.0.9 — empty listens without dialling"
          onValue={peerHost => { if (peerHost !== settings.peerHost) update({ peerHost }) }}
        />
      </div>
      <div className="field-row">
        <label htmlFor="settings-redundancy-peer-port">Partner port</label>
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
        <label htmlFor="settings-redundancy-token">Token</label>
        <TextField
          id="settings-redundancy-token"
          when="leave"
          value={settings.token}
          disabled={!settings.enabled}
          placeholder="the same on both machines"
          onValue={token => { if (token !== settings.token) update({ token }) }}
        />
        <button
          className="inspector-btn"
          onClick={() => update({ token: crypto.randomUUID().slice(0, 8) })}
        >
          New
        </button>
      </div>
      <div className="field-row">
        <label htmlFor="settings-redundancy-timeout">Silence before gone</label>
        <NumberField
          id="settings-redundancy-timeout"
          value={settings.timeoutMs}
          min={MIN_TIMEOUT_MS}
          max={MAX_TIMEOUT_MS}
          disabled={!settings.enabled}
          onValue={timeoutMs => { if (timeoutMs !== null) update({ timeoutMs }) }}
        />
        <span className="settings-info">ms</span>
      </div>

      <div className="field-section-title">What this machine has heard</div>
      {status === null || !status.enabled ? (
        <p className="inspector-hint">
          {settings.enabled
            ? 'Waiting for the service to report. A port another program is holding shows under the monitor.'
            : 'Not paired: this machine is running the show on its own.'}
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
      {service && (
        <div className="settings-service" data-service={service.id} data-state={service.state}>
          {service.state} — {service.detail}
        </div>
      )}
    </>
  )
}

/** What is known about the partner, in the terms an operator checks it in. */
function describePeer(status: RedundancyStatus): string {
  const peer = status.peer
  if (!peer) return 'nothing has answered yet'
  const silence = peer.silentMs + (Date.now() - status.at)
  const heard = silence < 1500
    ? 'heard from just now'
    : `last heard ${(silence / 1000).toFixed(1)} s ago`
  const what = `${peer.name} (${peer.role === 'live' ? 'live' : 'standby'})`
  if (!peer.alive) return `${what} — gone quiet, ${heard}`
  return `${what} — ${heard}, running ${peer.running} ${peer.running === 1 ? 'cue' : 'cues'}`
}
