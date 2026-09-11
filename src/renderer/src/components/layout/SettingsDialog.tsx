import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { audioPlayer } from '../../engine/AudioPlayer'
import { DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS } from '../../types/show'
import type { TelemetrySource, TelemetrySourceKind } from '../../types/show'
import './SettingsDialog.css'

interface Props {
  onClose: () => void
}

export function SettingsDialog({ onClose }: Props) {
  const {
    audioSettings, midiSettings, showSettings, showServices,
    updateAudioSettings, updateMidiSettings, updateOscInSettings, updateMidiInSettings,
    updateRfSettings
  } = useStore()
  const [tab, setTab] = useState<'audio' | 'midi' | 'show'>('audio')
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [midiPorts, setMidiPorts] = useState<string[]>([])
  const [midiInputPorts, setMidiInputPorts] = useState<string[]>([])
  // Context values are fixed for the life of the AudioContext, so read them once on mount.
  const [contextInfo] = useState(() => audioPlayer.getContextInfo())
  // The port is committed when the field is left, not on every keystroke: binding to
  // "5" on the way to "53000" would move the listener somewhere nobody asked for.
  const [portDraft, setPortDraft] = useState<string | null>(null)

  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      setOutputDevices(devices.filter(d => d.kind === 'audiooutput'))
    })
    window.winslab.midi.listPorts().then(setMidiPorts)
    window.winslab.midi.listInputPorts().then(setMidiInputPorts)
  }, [])

  const commitPort = (): void => {
    const port = Number(portDraft)
    if (portDraft !== null && Number.isInteger(port) && port >= 1 && port <= 65535) {
      updateOscInSettings({ port })
    }
    setPortDraft(null)
  }

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

  const oscService = showServices.find(service => service.id === 'osc-in')
  const midiService = showServices.find(service => service.id === 'midi-in')

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
              <div className="field-row">
                <label htmlFor="settings-osc-port">Port</label>
                <input
                  id="settings-osc-port"
                  type="number"
                  min={1}
                  max={65535}
                  value={portDraft ?? String(showSettings.oscIn.port)}
                  disabled={!showSettings.oscIn.enabled}
                  onChange={e => setPortDraft(e.target.value)}
                  onBlur={commitPort}
                  onKeyDown={e => {
                    if (e.key === 'Enter') commitPort()
                  }}
                />
              </div>
              {oscService && (
                <div className="settings-service" data-state={oscService.state}>
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
                <div className="settings-service" data-state={midiService.state}>
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
            </>
          )}
        </div>

        <div className="settings-footer">
          <button className="inspector-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
