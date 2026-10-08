import { useMemo, useState } from 'react'
import { useStore } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { syncAudioRouting } from '../../engine/audioRouting'
import { useOutputDevices } from '../../hooks/useOutputDevices'
import { useAudioEngineInfo } from '../../hooks/useAudioEngineInfo'
import type { AudioOutputStatus } from '../../../../shared/audio'
import {
  audioRoutingOf,
  newPatchId,
  patchChannelsLabel,
  withAudioRouting,
  type AudioRouting,
  type OutputPatch
} from '../../../../shared/audioRouting'
import { NumberField, TextField } from '../common/Field'
import './AudioIo.css'

/**
 * Device outputs as an operator types them — "1-2", "5, 6", "3" — read into zero-based
 * outputs; null for text that is not that.
 */
export function parseChannels(text: string): number[] | null {
  const outputs: number[] = []
  for (const part of text.split(',').map(piece => piece.trim()).filter(piece => piece !== '')) {
    const range = /^(\d+)\s*[-–]\s*(\d+)$/.exec(part)
    if (range) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from < 1 || to < from || to > 32) return null
      for (let n = from; n <= to; n++) outputs.push(n - 1)
      continue
    }
    if (!/^\d+$/.test(part)) return null
    const n = Number(part)
    if (n < 1 || n > 32) return null
    outputs.push(n - 1)
  }
  return outputs.length > 0 && outputs.length <= 32 ? outputs : null
}

/** A clock error as the readout writes it: signed, to a tenth of a part per million. */
export function formatDriftPpm(ppm: number): string {
  const rounded = Math.round(ppm * 10) / 10
  return `${rounded > 0 ? '+' : rounded < 0 ? '−' : '±'}${Math.abs(rounded).toFixed(1)} ppm`
}

/**
 * One extra output device's state in a line: playing, its rate, how far its clock runs from
 * the show's device's and how far behind it the device sounds — or lost, and why.
 */
export function outputDeviceLine(status: AudioOutputStatus): string {
  if (status.failed) return `Lost${status.error ? ` — ${status.error}` : ''}`
  if (!status.running) return 'Closed'
  const latency = status.latencyMs + status.deviceLatencyMs
  return `Playing · ${status.sampleRate.toLocaleString()} Hz · ${status.channels} ch · ` +
    `clock ${formatDriftPpm(status.driftPpm)} · ${latency.toFixed(1)} ms behind`
}

/**
 * The show's routing settings, in Settings → Audio: its output patches (a name, the device
 * they play on and the outputs they are), the devices they play on as the engine has them,
 * the patch audition plays through, and the loudness a cue is normalised to.
 */
export function AudioRoutingSection() {
  const settings = useStore(s => s.audioSettings)
  const updateAudioSettings = useStore(s => s.updateAudioSettings)
  const routing = useMemo(() => audioRoutingOf(settings), [settings])
  const { statuses, devices, fallbacks, main, refresh, relist } = useOutputDevices({ listDevices: true })
  const { info } = useAudioEngineInfo()
  const [reconnecting, setReconnecting] = useState<string | null>(null)
  const [reconnectError, setReconnectError] = useState<{ device: string; message: string } | null>(null)

  const reconnect = async (device: string): Promise<void> => {
    setReconnecting(device)
    setReconnectError(null)
    try {
      await audioEngine.outputOpen({ device })
      // The engine brings back every patch that named it; the show's routing is sent again
      // so a fader moved while it was gone is where the show says.
      await syncAudioRouting(useStore.getState().audioSettings, true)
    } catch (error) {
      setReconnectError({ device, message: error instanceof Error ? error.message : String(error) })
    } finally {
      setReconnecting(null)
      refresh()
    }
  }

  const write = (next: AudioRouting): void =>
    updateAudioSettings(withAudioRouting(useStore.getState().audioSettings, next))
  const setPatch = (id: string, patch: Partial<OutputPatch>): void =>
    write({ ...routing, patches: routing.patches.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)) })
  const addPatch = (): void => {
    const id = newPatchId(routing.patches)
    const first = routing.patches.reduce((most, patch) => Math.max(most, ...patch.channels, -1), -1) + 1
    const channels = first + 1 < 32 ? [first, first + 1] : [0, 1]
    write({
      ...routing,
      patches: [...routing.patches, { id, name: `Patch ${routing.patches.length + 1}`, deviceId: '', channels, gainDb: 0, muted: false }]
    })
  }
  const removePatch = (id: string): void =>
    write({
      ...routing,
      patches: routing.patches.filter(patch => patch.id !== id),
      auditionPatchId: routing.auditionPatchId === id ? null : routing.auditionPatchId
    })

  return (
    <div className="audio-routing-section">
      <div className="field-section-title">Output patches</div>
      <div className="patch-list">
        {routing.patches.map(patch => {
          const fallback = fallbacks.find(entry => entry.patchId === patch.id)
          return (
            <div key={patch.id} className="patch-entry" data-patch={patch.id}>
              <div className="patch-row">
                <TextField value={patch.name} aria-label="Patch name" className="patch-name"
                  onValue={name => setPatch(patch.id, { name: name.trim() === '' ? patch.name : name })} />
                <select aria-label="Patch device" className="patch-device" value={patch.deviceId}
                  onChange={e => setPatch(patch.id, { deviceId: e.target.value })}>
                  <option value="">The show's device</option>
                  {devices.filter(device => device.id !== main.id).map(device => (
                    <option key={device.id} value={device.id}>{device.name}</option>
                  ))}
                  {patch.deviceId !== '' && patch.deviceId !== main.id && !devices.some(device => device.id === patch.deviceId) && (
                    <option value={patch.deviceId}>{patch.deviceId} (not connected)</option>
                  )}
                </select>
                <TextField value={patchChannelsLabel(patch.channels)} aria-label="Patch outputs" className="patch-channels"
                  validate={text => (parseChannels(text) === null ? 'Outputs like 1-2 or 5, 6' : null)}
                  onValue={text => {
                    const channels = parseChannels(text)
                    if (channels !== null) setPatch(patch.id, { channels })
                  }} />
                <button className="inspector-btn patch-remove" onClick={() => removePatch(patch.id)}>Remove</button>
              </div>
              {fallback && (
                <p className="inspector-hint patch-fallback"
                  title={`Plays on outputs ${fallback.outputs} of ${fallback.to}: ${fallback.reason}.`}>
                  Plays on outputs {fallback.outputs} of {fallback.to}: {fallback.reason}.
                </p>
              )}
            </div>
          )
        })}
      </div>
      <div className="field-row">
        <button className="inspector-btn patch-add" onClick={addPatch} disabled={routing.patches.length >= 16}>
          Add patch
        </button>
        <button className="inspector-btn output-relist" onClick={() => {
          // A device plugged in since the show loaded: listed again, and every patch sent again,
          // so one that fell back opens on it.
          relist()
          void syncAudioRouting(useStore.getState().audioSettings, true).finally(refresh)
        }}>Look for devices</button>
      </div>
      <div className="field-section-title">Output devices</div>
      <div className="output-device-list">
        <div className="field-row output-device" data-device="main">
          <label>{main.name || 'The show\'s device'}</label>
          <span className="settings-info output-device-state">
            {info === null
              ? 'Reading the engine…'
              : `The show's device · ${info.sampleRate.toLocaleString()} Hz · the clock the others follow` +
                (info.latencyMs !== null && info.latencyMs > 0 ? ` · ${info.latencyMs.toFixed(1)} ms` : '')}
          </span>
        </div>
        {statuses.map(status => (
          <div key={status.device} className="field-row output-device" data-device={status.device}
            data-state={status.failed ? 'lost' : status.running ? 'playing' : 'closed'}>
            <label>{status.name}</label>
            <span className="settings-info output-device-state"
              title={status.running
                ? `The lock holds ${status.latencyMs.toFixed(1)} ms; the device's own buffer is ${status.deviceLatencyMs.toFixed(1)} ms`
                : undefined}>
              {reconnectError?.device === status.device ? `Lost — ${reconnectError.message}` : outputDeviceLine(status)}
            </span>
            {status.failed && (
              <button className="inspector-btn output-reconnect" disabled={reconnecting !== null}
                onClick={() => { void reconnect(status.device) }}>
                Reconnect
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="field-row">
        <label htmlFor="audition-patch">Audition output</label>
        <select id="audition-patch" className="audition-patch" value={routing.auditionPatchId ?? ''}
          onChange={e => write({ ...routing, auditionPatchId: e.target.value === '' ? null : e.target.value })}>
          <option value="">None — audition is off</option>
          {routing.patches.map(patch => <option key={patch.id} value={patch.id}>{patch.name}</option>)}
        </select>
      </div>
      <div className="field-section-title">Loudness</div>
      <div className="field-row">
        <label htmlFor="loudness-target">Normalize to (LUFS)</label>
        <NumberField id="loudness-target" className="loudness-target" when="typed" min={-60} max={0} step={0.5}
          value={routing.loudnessTargetLufs}
          onValue={value => { if (value !== null) write({ ...routing, loudnessTargetLufs: value }) }} />
      </div>
      <div className="field-row">
        <label htmlFor="true-peak-ceiling">True-peak ceiling (dBTP)</label>
        <NumberField id="true-peak-ceiling" className="true-peak-ceiling" when="typed" min={-20} max={0} step={0.5}
          value={routing.truePeakCeilingDb}
          onValue={value => { if (value !== null) write({ ...routing, truePeakCeilingDb: value }) }} />
      </div>
    </div>
  )
}
