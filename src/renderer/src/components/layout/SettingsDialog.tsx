import { useEffect, useState } from 'react'
import { useStore, usePro } from '../../store'
import { useModal } from '../../hooks/useModal'
import { audioEngine } from '../../engine/audioEngineClient'
import type { AudioDeviceInfo } from '../../engine/audioEngineClient'
import { useAudioEngineInfo } from '../../hooks/useAudioEngineInfo'
import { PlaybackWarnings } from './PlaybackWarnings'
import { formatBytes } from '../../utils/mediaFootprint'
import { DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS } from '../../types/show'
import type { RfThresholds, TelemetrySource, TelemetrySourceKind } from '../../types/show'
import type { SettingsTab } from '../../store'
import { LicenseSection } from '../license/LicenseSection'
import './SettingsDialog.css'

interface Props {
  onClose: () => void
  /** Which tab to open on, e.g. the one a locked panel sent the operator to. */
  initialTab?: SettingsTab
}

interface NumberFieldProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onCommit: (value: number) => void
}

/** A backend that has no device to configure, so no device request can ever be honoured. */
function backendHasNoDevice(backend: string): boolean {
  return backend === 'silent' || backend === 'offline'
}

/**
 * An integer field that commits when it is left rather than on every keystroke: binding
 * "5" on the way to "53000" would move a listener somewhere nobody asked for, and an
 * out-of-range value is dropped rather than written.
 */
function NumberField({ id, label, value, min, max, disabled, onCommit }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    const parsed = Number(draft)
    if (draft !== null && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
      onCommit(Math.round(parsed))
    }
    setDraft(null)
  }

  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        value={draft ?? String(value)}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
        }}
      />
    </div>
  )
}

/** The tabs, by what the operator is setting up rather than by which service does it. */
const SETTINGS_TABS: { id: SettingsTab; label: string }[] = [
  { id: 'audio', label: 'Audio' },
  { id: 'midi', label: 'MIDI' },
  { id: 'network', label: 'Network' },
  { id: 'wireless', label: 'Wireless' },
  { id: 'license', label: 'License' }
]

/**
 * Why a Pro service's settings are here but not running. The settings travel with the
 * show whatever the license says; only the listening waits for one.
 */
function ProHint({ onUnlock }: { onUnlock: () => void }) {
  return (
    <p className="inspector-hint license-hint">
      WinsLab Pro: these travel with the show, and start once this machine is licensed.{' '}
      <button className="license-link" onClick={onUnlock}>Enter a license key</button>
    </p>
  )
}

export function SettingsDialog({ onClose, initialTab = 'audio' }: Props) {
  useModal()
  const {
    audioSettings, midiSettings, showSettings, showServices, audioDeviceError,
    updateAudioSettings, updateMidiSettings, updateOscInSettings, updateMidiInSettings,
    updateRfSettings, updatePresenceSettings, updateCompanionSettings
  } = useStore()
  const pro = usePro()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([])
  const [midiPorts, setMidiPorts] = useState<string[]>([])
  const [midiInputPorts, setMidiInputPorts] = useState<string[]>([])
  // The engine reports its own device, sample rate, buffer and latency; the dialogs
  // show what it says rather than what the page guessed.
  const { info, available } = useAudioEngineInfo()

  useEffect(() => {
    audioEngine.devices()
      .then(setDevices)
      .catch(() => {
        // No device list: the engine section says so rather than inventing devices.
      })
    window.winslab.midi.listPorts().then(setMidiPorts)
    window.winslab.midi.listInputPorts().then(setMidiInputPorts)
  }, [])

  const toggleInputPort = (port: string, on: boolean): void => {
    const selected = showSettings.midiIn.portNames
    updateMidiInSettings({
      portNames: on ? [...selected, port] : selected.filter(name => name !== port)
    })
  }

  const updateSource = (id: string, patch: Partial<TelemetrySource>): void => {
    updateRfSettings({
      sources: showSettings.rf.sources.map(source =>
        source.id === id ? { ...source, ...patch } : source)
    })
  }

  const addSource = (): void => {
    updateRfSettings({
      sources: [...showSettings.rf.sources, {
        id: crypto.randomUUID(),
        label: 'Receiver rack',
        kind: 'http',
        target: '',
        pollMs: DEFAULT_POLL_MS,
        timeoutMs: DEFAULT_TIMEOUT_MS
      }]
    })
  }

  const removeSource = (id: string): void => {
    updateRfSettings({
      sources: showSettings.rf.sources.filter(source => source.id !== id)
    })
  }

  const setThresholds = (patch: Partial<RfThresholds>): void => {
    updateRfSettings({ thresholds: { ...showSettings.rf.thresholds, ...patch } })
  }

  const oscService = showServices.find(service => service.id === 'osc-in')
  const midiService = showServices.find(service => service.id === 'midi-in')
  const presenceService = showServices.find(service => service.id === 'presence')
  const rfService = showServices.find(service => service.id === 'rf')
  // The device the workspace picked, or the system default while the settings still
  // say "default": its channel count and sample rates are what the selects offer.
  const selectedDevice = devices.find(device => device.id === audioSettings.outputDeviceId)
    ?? devices.find(device => device.isDefault)
    ?? devices[0]
  const companionService = showServices.find(service => service.id === 'companion')

  // The service list is a list the operator types, so it commits on the way out of the
  // field: rebuilding the input from the store on every keystroke would eat the comma
  // or the space that was about to become the next entry.
  const [servicesDraft, setServicesDraft] = useState<string | null>(null)

  const commitServices = (): void => {
    if (servicesDraft === null) return
    const services = servicesDraft.split(',').map(entry => entry.trim()).filter(Boolean)
    if (services.length > 0) updatePresenceSettings({ services })
    setServicesDraft(null)
  }

  // Dismiss on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // The bridge hook applies audio settings to the engine, so the change is written
  // where it belongs the moment it is made.
  const handleOutputDevice = (deviceId: string): void => {
    updateAudioSettings({ outputDeviceId: deviceId })
  }

  return (
    // The backdrop is what the panel is drawn on, not a close button: a dialog that
    // disappears because a press landed beside it takes the half-made change with it.
    // It closes from its ✕ and from Escape.
    <div className="settings-overlay">
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Close settings" title="Close (Esc)">✕</button>
        </div>

        <div className="settings-tabs">
          {SETTINGS_TABS.map(({ id, label }) => (
            <button
              key={id}
              className="settings-tab"
              data-active={tab === id}
              onClick={() => setTab(id)}
            >{label}</button>
          ))}
        </div>

        <div className="settings-body">
          {tab === 'audio' && (
            <>
              <div className="field-row">
                <label>Output device</label>
                <select
                  value={audioSettings.outputDeviceId}
                  onChange={e => handleOutputDevice(e.target.value)}
                >
                  <option value="default">Default Output</option>
                  {devices.map(device => (
                    <option key={device.id} value={device.id}>
                      {device.name}{device.isDefault ? ' (system default)' : ''}
                      {device.channels > 0 ? ` — ${device.channels} ch` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label>Sample rate</label>
                <select
                  value={audioSettings.sampleRate ?? ''}
                  onChange={e => updateAudioSettings({
                    sampleRate: e.target.value ? Number(e.target.value) : undefined
                  })}
                >
                  <option value="">Device default</option>
                  {selectedDevice?.sampleRates.map(rate => (
                    <option key={rate} value={rate}>{rate.toLocaleString()} Hz</option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label>Buffer</label>
                <select
                  value={audioSettings.bufferFrames ?? ''}
                  onChange={e => updateAudioSettings({
                    bufferFrames: e.target.value ? Number(e.target.value) : undefined
                  })}
                >
                  <option value="">Engine default</option>
                  {[128, 256, 512, 1024, 2048].map(frames => (
                    <option key={frames} value={frames}>{frames} frames</option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label>Channels</label>
                <select
                  value={audioSettings.channels ?? ''}
                  onChange={e => updateAudioSettings({
                    channels: e.target.value ? Number(e.target.value) : undefined
                  })}
                >
                  <option value="">Device default</option>
                  {Array.from(
                    { length: Math.max((selectedDevice?.channels ?? 0) - 1, 0) },
                    (_, i) => i + 2
                  ).map(channels => (
                    <option key={channels} value={channels}>{channels}</option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label htmlFor="settings-exclusive">Exclusive</label>
                <input
                  id="settings-exclusive"
                  type="checkbox"
                  checked={audioSettings.exclusive ?? false}
                  onChange={e => updateAudioSettings({ exclusive: e.target.checked })}
                />
                <span className="settings-info">Take the device for WinsLab alone</span>
              </div>
              <p className="inspector-hint">
                Exclusive locks system sounds and conferencing apps out of the device, for its
                real channel count and steady latency. A driver that refuses says why, here.
              </p>
              {/* A backend with no device at all — the silent and offline ones a test or
                  a dev run uses — refuses every device request by definition, including
                  the one this window sends when it opens. That is not a fault anyone can
                  act on, and a red line that never clears teaches people to ignore red
                  lines; the Backend row below already says which engine this is. A real
                  device's refusal is shown in the engine's own words. */}
              {audioDeviceError !== null && info !== null && !backendHasNoDevice(info.backend) && (
                <p className="settings-device-error" role="alert">{audioDeviceError}</p>
              )}

              <div className="field-section-title">Engine</div>
              {info ? (
                <>
                  <div className="field-row">
                    <label>Backend</label>
                    <span className="settings-info">{info.backend}</span>
                  </div>
                  <div className="field-row">
                    <label>Running at</label>
                    <span className="settings-info">
                      {info.sampleRate.toLocaleString()} Hz
                      {info.channels > 0 ? ` · ${info.channels} ch` : ''}
                      {info.bufferFrames ? ` · ${info.bufferFrames} frames` : ''}
                    </span>
                  </div>
                  <div className="field-row">
                    <label>Device</label>
                    <span className="settings-info">
                      {info.deviceName || info.deviceId || 'Default Output'}
                      {info.exclusive ? ' · exclusive' : ''}
                    </span>
                  </div>
                  <div className="field-row">
                    <label>Latency</label>
                    <span className="settings-info">
                      {info.latencySource === 'unknown' || info.latencyMs === null
                        ? 'unknown'
                        : `${info.latencyMs.toFixed(1)} ms (${info.latencySource})`}
                    </span>
                  </div>
                  <div className="field-row">
                    <label>Playing</label>
                    <span className="settings-info">
                      {info.activeVoices} {info.activeVoices === 1 ? 'voice' : 'voices'}
                      {` · ${info.media.streamingVoices} ${info.media.streamingVoices === 1 ? 'file' : 'files'} streaming`}
                    </span>
                  </div>
                  <div className="field-row">
                    <label>Media memory</label>
                    <span className="settings-info">
                      {formatBytes(info.media.residentBytes)} resident
                      {info.cache.limitBytes > 0 ? ` · cache ${formatBytes(info.cache.bytes)} of ${formatBytes(info.cache.limitBytes)}` : ''}
                    </span>
                  </div>
                  <div className="field-row">
                    <label>Dropouts</label>
                    <span className="settings-info">
                      {info.media.xruns} {info.media.xruns === 1 ? 'xrun' : 'xruns'}
                      {` · ${info.media.decodeUnderruns} ${info.media.decodeUnderruns === 1 ? 'decode underrun' : 'decode underruns'}`}
                    </span>
                  </div>
                  <PlaybackWarnings className="settings-warning" />
                </>
              ) : (
                <p className="inspector-hint">
                  {available === false
                    ? 'The audio engine is not available in this build.'
                    : 'Reading the engine…'}
                </p>
              )}
            </>
          )}

          {tab === 'midi' && (
            <>
              <div className="field-row">
                <label>Default output</label>
                <select
                  value={midiSettings.outputPortName}
                  onChange={e => updateMidiSettings({ outputPortName: e.target.value })}
                >
                  <option value="">— none —</option>
                  {midiPorts.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <p className="inspector-hint">MIDI cues without a port of their own send here.</p>

              <div className="field-section-title">MIDI input</div>
              {!pro && <ProHint onUnlock={() => setTab('license')} />}
              <div className="field-row">
                <label htmlFor="settings-midi-in">Listen</label>
                <input
                  id="settings-midi-in"
                  type="checkbox"
                  checked={showSettings.midiIn.enabled}
                  onChange={e => updateMidiInSettings({ enabled: e.target.checked })}
                />
                <span className="settings-info">Read what the show sends back</span>
              </div>
              {midiInputPorts.length === 0 ? (
                <p className="inspector-hint">No MIDI input ports were found.</p>
              ) : (
                <div className="settings-port-list">
                  {midiInputPorts.map(port => (
                    <label key={port} className="settings-port-row">
                      <input
                        type="checkbox"
                        checked={showSettings.midiIn.portNames.includes(port)}
                        disabled={!showSettings.midiIn.enabled}
                        onChange={e => toggleInputPort(port, e.target.checked)}
                      />
                      {port}
                    </label>
                  ))}
                </div>
              )}
              <p className="inspector-hint">With none ticked, every input is opened.</p>
              {midiService && (
                <div className="settings-service" data-service={midiService.id} data-state={midiService.state}>
                  {midiService.state} — {midiService.detail}
                </div>
              )}

            </>
          )}

          {tab === 'network' && (
            <>
              {!pro && <ProHint onUnlock={() => setTab('license')} />}
              <div className="field-section-title">OSC input</div>
              <div className="field-row">
                <label htmlFor="settings-osc-in">Listen</label>
                <input
                  id="settings-osc-in"
                  type="checkbox"
                  checked={showSettings.oscIn.enabled}
                  onChange={e => updateOscInSettings({ enabled: e.target.checked })}
                />
                <span className="settings-info">Listen for OSC from consoles and tablets</span>
              </div>
              <NumberField
                id="settings-osc-port"
                label="Port"
                value={showSettings.oscIn.port}
                min={1}
                max={65535}
                disabled={!showSettings.oscIn.enabled}
                onCommit={port => updateOscInSettings({ port })}
              />
              {oscService && (
                <div className="settings-service" data-service={oscService.id} data-state={oscService.state}>
                  {oscService.state} — {oscService.detail}
                </div>
              )}

              <div className="field-section-title">Network presence</div>
              <div className="field-row">
                <label htmlFor="settings-presence">Browse</label>
                <input
                  id="settings-presence"
                  type="checkbox"
                  checked={showSettings.presence.enabled}
                  onChange={e => updatePresenceSettings({ enabled: e.target.checked })}
                />
                <span className="settings-info">Watch the show network for devices</span>
              </div>
              <div className="field-row">
                <label htmlFor="settings-presence-services">Services</label>
                <input
                  id="settings-presence-services"
                  value={servicesDraft ?? showSettings.presence.services.join(', ')}
                  disabled={!showSettings.presence.enabled}
                  onChange={e => setServicesDraft(e.target.value)}
                  onBlur={commitServices}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitServices()
                  }}
                />
              </div>
              <NumberField
                id="settings-presence-gone"
                label="Gone after (s)"
                value={showSettings.presence.goneAfterSeconds}
                min={5}
                max={3600}
                disabled={!showSettings.presence.enabled}
                onCommit={goneAfterSeconds => updatePresenceSettings({ goneAfterSeconds })}
              />
              <p className="inspector-hint">
                Dante endpoints, interfaces and amps on the network appear in the monitor,
                and raise an alarm when they leave.
              </p>
              {presenceService && (
                <div className="settings-service" data-service={presenceService.id} data-state={presenceService.state}>
                  {presenceService.state} — {presenceService.detail}
                </div>
              )}

              <div className="field-section-title">Tablet companion</div>
              <div className="field-row">
                <label htmlFor="settings-companion">Serve</label>
                <input
                  id="settings-companion"
                  type="checkbox"
                  checked={showSettings.companion.enabled}
                  onChange={e => updateCompanionSettings({ enabled: e.target.checked })}
                />
                <span className="settings-info">A read-only view of the show on the local network</span>
              </div>
              <NumberField
                id="settings-companion-port"
                label="Port"
                value={showSettings.companion.port}
                min={1}
                max={65535}
                disabled={!showSettings.companion.enabled}
                onCommit={port => updateCompanionSettings({ port })}
              />
              <div className="field-row">
                <label htmlFor="settings-companion-token">Token</label>
                <input
                  id="settings-companion-token"
                  value={showSettings.companion.token}
                  placeholder="required — anyone without it is refused"
                  onChange={e => updateCompanionSettings({ token: e.target.value })}
                />
                <button
                  className="inspector-btn"
                  onClick={() => updateCompanionSettings({ token: crypto.randomUUID().slice(0, 8) })}
                >
                  New
                </button>
              </div>
              <p className="inspector-hint">
                Read-only: the tablet watches, it cannot change the show. Its address appears
                below once running.
              </p>
              {companionService && (
                <div className="settings-service" data-service={companionService.id} data-state={companionService.state}>
                  {companionService.state} — {companionService.detail}
                </div>
              )}
            </>
          )}

          {tab === 'wireless' && (
            <>
              {!pro && <ProHint onUnlock={() => setTab('license')} />}
              <div className="field-section-title">Sources</div>
              {showSettings.rf.sources.length === 0 ? (
                <p className="inspector-hint">Nothing is feeding the mic plot yet.</p>
              ) : (
                <div className="settings-source-list">
                  {showSettings.rf.sources.map(source => (
                    <div key={source.id} className="settings-source-row">
                      <input
                        className="settings-source-label"
                        value={source.label}
                        aria-label="Source name"
                        onChange={e => updateSource(source.id, { label: e.target.value })}
                      />
                      <select
                        value={source.kind}
                        aria-label="Source kind"
                        onChange={e => updateSource(source.id, { kind: e.target.value as TelemetrySourceKind })}
                      >
                        <option value="http">HTTP</option>
                        <option value="file">File</option>
                        <option value="demo">Demo</option>
                      </select>
                      <input
                        className="settings-source-target"
                        value={source.target}
                        aria-label="Source address"
                        placeholder={source.kind === 'file' ? '/path/to/telemetry.json' : 'http://10.0.0.20/telemetry'}
                        disabled={source.kind === 'demo'}
                        onChange={e => updateSource(source.id, { target: e.target.value })}
                      />
                      <button
                        className="settings-source-remove"
                        onClick={() => removeSource(source.id)}
                        aria-label={`Remove ${source.label}`}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="field-row">
                <label />
                <button className="add-row" onClick={addSource}>+ Add source</button>
              </div>
              <p className="inspector-hint">
                Each source reports battery and RF per channel; the format is in the user guide.
              </p>
              <div className="field-section-title">Alarms</div>
              <NumberField
                id="settings-rf-battery-warning"
                label="Battery low (%)"
                value={showSettings.rf.thresholds.batteryWarning}
                min={1}
                max={99}
                onCommit={batteryWarning => setThresholds({ batteryWarning })}
              />
              <NumberField
                id="settings-rf-battery-critical"
                label="Battery critical (%)"
                value={showSettings.rf.thresholds.batteryCritical}
                min={1}
                max={99}
                onCommit={batteryCritical => setThresholds({ batteryCritical })}
              />
              <NumberField
                id="settings-rf-rf-warning"
                label="RF weak (dBm)"
                value={showSettings.rf.thresholds.rfWarningDbm}
                min={-120}
                max={-20}
                onCommit={rfWarningDbm => setThresholds({ rfWarningDbm })}
              />
              <NumberField
                id="settings-rf-gone"
                label="Quiet after (s)"
                value={showSettings.rf.thresholds.offlineAfterSeconds}
                min={2}
                max={600}
                onCommit={offlineAfterSeconds => setThresholds({ offlineAfterSeconds })}
              />
              <p className="inspector-hint">
                How long a pack can go unheard before it is warned about.
              </p>
              {rfService && (
                <div className="settings-service" data-service={rfService.id} data-state={rfService.state}>
                  {rfService.state} — {rfService.detail}
                </div>
              )}

            </>
          )}

          {tab === 'license' && <LicenseSection />}
        </div>
      </div>
    </div>
  )
}
