import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { audioPlayer } from '../../engine/AudioPlayer'
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

export function SettingsDialog({ onClose, initialTab = 'audio' }: Props) {
  const {
    audioSettings, midiSettings, showSettings, showServices,
    updateAudioSettings, updateMidiSettings, updateOscInSettings, updateMidiInSettings,
    updateRfSettings, updatePresenceSettings, updateCompanionSettings
  } = useStore()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [midiPorts, setMidiPorts] = useState<string[]>([])
  const [midiInputPorts, setMidiInputPorts] = useState<string[]>([])
  // Context values are fixed for the life of the AudioContext, so read them once on mount.
  const [contextInfo] = useState(() => audioPlayer.getContextInfo())

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setOutputDevices(devices.filter(d => d.kind === 'audiooutput'))
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

  const handleOutputDevice = async (deviceId: string) => {
    updateAudioSettings({ outputDeviceId: deviceId })
    await audioPlayer.setOutputDevice(deviceId)
  }

  return (
    <div className="settings-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="settings-dialog" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-header">
          <span className="settings-title">Settings</span>
          <button className="settings-close" onClick={onClose} aria-label="Dismiss settings">✕</button>
        </div>

        <div className="settings-tabs">
          <button
            className="settings-tab"
            data-active={tab === 'audio'}
            onClick={() => setTab('audio')}
          >Audio</button>
          <button
            className="settings-tab"
            data-active={tab === 'midi'}
            onClick={() => setTab('midi')}
          >MIDI</button>
          <button
            className="settings-tab"
            data-active={tab === 'show'}
            onClick={() => setTab('show')}
          >Show</button>
          <button
            className="settings-tab"
            data-active={tab === 'license'}
            onClick={() => setTab('license')}
          >License</button>
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
                  {outputDevices.length === 0 && (
                    <option value="default">Default Output</option>
                  )}
                  {outputDevices.map(d => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Output ${d.deviceId.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-row">
                <label>Sample rate</label>
                <span className="settings-info">{contextInfo.sampleRate.toLocaleString()} Hz</span>
              </div>
              <div className="field-row">
                <label>Base latency</label>
                <span className="settings-info">{contextInfo.baseLatencyMs.toFixed(1)} ms</span>
              </div>
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
              <p className="inspector-hint">
                MIDI cues without their own port send here; individual cues can override it
                with a per-cue port selection.
              </p>
            </>
          )}

          {tab === 'show' && (
            <>
              <div className="field-row">
                <label htmlFor="settings-osc-in">OSC input</label>
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

              <div className="field-section-title">MIDI input</div>
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
              <p className="inspector-hint">
                With nothing selected, every available input is opened. A port that drops
                out mid-show is reported in the show monitor.
              </p>
              {midiService && (
                <div className="settings-service" data-service={midiService.id} data-state={midiService.state}>
                  {midiService.state} — {midiService.detail}
                </div>
              )}

              <div className="field-section-title">Wireless telemetry</div>
              {showSettings.rf.sources.length === 0 ? (
                <p className="inspector-hint">
                  Nothing is feeding the mic plot. Add a source below, or open the wireless
                  panel and use the demo rack to see what it does.
                </p>
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
                <button className="inspector-btn" onClick={addSource}>Add source</button>
              </div>
              <p className="inspector-hint">
                A source returns <code>{'{"channels":[{"id":"…","batteryPercent":42,"rfDbm":-62}]}'}</code>{' '}
                — the field names are the contract, so a bridge written against a receiver's
                own API only has to emit them. Thresholds that raise the alarms live in the
                workspace alongside the plot.
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
                A pack that stops being reported is marked quiet and warned about once this
                long has passed. Packs switched off between scenes are normal, so a longer
                window is a fair choice — the row's colour turns as soon as the silence
                starts, whatever this is set to.
              </p>
              {rfService && (
                <div className="settings-service" data-service={rfService.id} data-state={rfService.state}>
                  {rfService.state} — {rfService.detail}
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
                Devices that announce themselves over mDNS — a Dante endpoint, an interface,
                an amplifier — appear in the show monitor while they are there, and raise an
                alarm when they leave.
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
                The address to open on the tablet is reported below once the service is
                running. Nothing on the companion can change the show: it is a window, not
                a control surface. Anyone on the same network who has the token can watch it.
              </p>
              {companionService && (
                <div className="settings-service" data-service={companionService.id} data-state={companionService.state}>
                  {companionService.state} — {companionService.detail}
                </div>
              )}
            </>
          )}

          {tab === 'license' && <LicenseSection />}
        </div>

        <div className="settings-footer">
          <button className="inspector-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
