import { useEffect, useState } from 'react'
import { useStore, usePro } from '../../store'
import { useShallow } from 'zustand/react/shallow'
import { useModal } from '../../hooks/useModal'
import { audioEngine } from '../../engine/audioEngineClient'
import { applyAudioDeviceSettings, backendHasNoDevice } from '../../engine/audioDeviceSettings'
import type { AudioDeviceInfo } from '../../engine/audioEngineClient'
import { useAudioEngineInfo } from '../../hooks/useAudioEngineInfo'
import { PlaybackWarnings } from './PlaybackWarnings'
import { NumberField, TextField } from '../common/Field'
import { ServiceStatus } from '../common/ServiceStatus'
import { EwDxCredentials } from '../rf/EwDxCredentials'
import { EwDxFinder } from '../rf/EwDxFinder'
import { labelFor, targetFor } from '../../utils/ewdx'
import { Advanced, ServiceBlock } from '../common/SettingsBlock'
import { formatBytes } from '../../utils/mediaFootprint'
import { currentPlatform } from '../../utils/shortcuts'
import { DEFAULT_POLL_MS, DEFAULT_TIMEOUT_MS } from '../../../../shared/show'
import { STOP_FADE_MAX_MS, TRIGGER_GUARD_MAX_MS, TRIGGER_GUARD_MIN_MS } from '../../../../shared/workspace'
import { AUDIO_SILENCE_THRESHOLD_DB } from '../../../../shared/audio'
import { isAllowEntry, remoteEnabled } from '../../../../shared/oscRemote'
import type { EwDxFound } from '../../../../shared/ipc/show'
import type { RfThresholds, TelemetrySource, TelemetrySourceKind } from '../../../../shared/show'
import type { SettingsTab } from '../../store'
import { LicenseSection } from '../license/LicenseSection'
import { RedundancySection } from '../redundancy/RedundancySection'
import { TimecodeSection } from '../timecode/TimecodeSection'
import { UpdateSection } from '../update/UpdateSection'
import { OscSettings } from '../osc/OscSettings'
import './SettingsDialog.css'

interface Props {
  onClose: () => void
  /** Which tab to open on, e.g. the one a locked panel sent the operator to. */
  initialTab?: SettingsTab
}

interface NumberRowProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  onValue: (value: number) => void
}

/**
 * A settings number: a labelled row around the shared field. What commits when, and when
 * the field says it saved, belong to the field; this is the row and the fact that a
 * setting always has a value — a field left empty keeps the one it had.
 */
function NumberRow({ id, label, value, min, max, disabled, onValue }: NumberRowProps) {
  return (
    <div className="field-row">
      <label htmlFor={id}>{label}</label>
      <NumberField
        id={id}
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        onValue={next => { if (next !== null) onValue(next) }}
      />
    </div>
  )
}

/**
 * The tabs, by what the operator is setting up rather than by which service does it, and
 * grouped by where the setting is kept. "Where is this saved?" was a paragraph on the
 * redundancy tab explaining that its settings belong to the machine; it is a heading now,
 * and it answers for every tab at once.
 */
const SETTINGS_TABS: { id: SettingsTab; label: string; scope: 'show' | 'machine' }[] = [
  // First, because it is about the show as a whole rather than about any one of the
  // things the other tabs are the settings for.
  { id: 'general', label: 'General', scope: 'show' },
  { id: 'audio', label: 'Audio', scope: 'show' },
  { id: 'midi', label: 'MIDI', scope: 'show' },
  { id: 'network', label: 'Network', scope: 'show' },
  { id: 'wireless', label: 'Wireless', scope: 'show' },
  { id: 'redundancy', label: 'Backup machine', scope: 'machine' },
  { id: 'timecode', label: 'Timecode', scope: 'machine' },
  { id: 'license', label: 'License', scope: 'machine' },
  { id: 'updates', label: 'Updates', scope: 'machine' }
]

/** What each tab is for, in one line, under its heading. */
const TAB_BLURB: Record<SettingsTab, string> = {
  general: 'How the app behaves while a show is running.',
  audio: 'Which device the show plays on, and how it is driven.',
  midi: 'The ports cues send on, and what the app listens to.',
  network: 'How consoles, tablets and other gear reach this show.',
  wireless: 'Where pack readings come from, and when to warn about them.',
  redundancy: 'A second computer, ready to take the show over.',
  license: 'Cuerunner Pro on this machine.',
  timecode: 'The SMPTE clock this machine follows, and how the cue list follows it.',
  updates: 'Newer versions of Cuerunner, and when this machine may look for them.'
}

/** Which service reports for a tab, so the sidebar can show whether it is on. */
const TAB_SERVICE: Partial<Record<SettingsTab, string>> = {
  midi: 'midi-in',
  network: 'osc-in',
  wireless: 'rf',
  redundancy: 'redundancy',
  timecode: 'timecode'
}

/**
 * Why a Pro service's settings are here but not running. The settings travel with the
 * show whatever the license says; only the listening waits for one.
 */
/** The allow list as it is typed: entries by comma or space, blanks dropped. */
export function splitAllowList(text: string): string[] {
  return text.split(/[,\s]+/).map(entry => entry.trim()).filter(Boolean)
}

function ProHint({ onUnlock, children }: { onUnlock: () => void; children?: React.ReactNode }) {
  return (
    <p className="inspector-hint license-hint">
      {children ?? 'Part of Cuerunner Pro. These settings are saved with the show, and start working once this machine is licensed.'}{' '}
      <button className="license-link" onClick={onUnlock}>Enter a license key</button>
    </p>
  )
}

export function SettingsDialog({ onClose, initialTab = 'general' }: Props) {
  useModal()
  // The parts this dialog reads, compared shallowly: read whole, the dialog was redrawn
  // for every write to the store while it was open, whatever the write was about.
  const {
    audioSettings, midiSettings, showSettings, showServices, audioDeviceError,
    updateAudioSettings, updateMidiSettings, updateOscInSettings, updateMidiInSettings,
    updateRfSettings, updatePresenceSettings, updateCompanionSettings,
    triggerGuard, updateTriggerGuard
  } = useStore(useShallow(s => ({
    audioSettings: s.audioSettings,
    midiSettings: s.midiSettings,
    showSettings: s.showSettings,
    showServices: s.showServices,
    audioDeviceError: s.audioDeviceError,
    updateAudioSettings: s.updateAudioSettings,
    updateMidiSettings: s.updateMidiSettings,
    updateOscInSettings: s.updateOscInSettings,
    updateMidiInSettings: s.updateMidiInSettings,
    updateRfSettings: s.updateRfSettings,
    updatePresenceSettings: s.updatePresenceSettings,
    updateCompanionSettings: s.updateCompanionSettings,
    triggerGuard: s.triggerGuard,
    updateTriggerGuard: s.updateTriggerGuard
  })))
  const pro = usePro()
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([])
  const [reconnecting, setReconnecting] = useState(false)
  const [midiPorts, setMidiPorts] = useState<string[]>([])
  const [midiInputPorts, setMidiInputPorts] = useState<string[]>([])
  // Why this build has no MIDI, when it has none: null while it has, or has not answered.
  const [midiFault, setMidiFault] = useState<string | null>(null)
  // The engine reports its own device, sample rate, buffer and latency; the dialogs
  // show what it says rather than what the page guessed. A configure this panel sends
  // is a fresh reading, taken through `accept` rather than waited for.
  const { info, available, accept } = useAudioEngineInfo()

  useEffect(() => {
    audioEngine.devices()
      .then(setDevices)
      .catch(() => {
        // No device list: the engine section says so rather than inventing devices.
      })
    window.cuerunner.midi.listPorts().then(setMidiPorts)
    window.cuerunner.midi.listInputPorts().then(setMidiInputPorts)
    // The transport's badge sends the operator here when MIDI is missing, and both port
    // lists are empty for that reason as well as for an honest lack of ports — so the
    // page asks the same question the badge did, and says the answer where it is read.
    window.cuerunner.midi.status()
      .then(status => setMidiFault(status.available ? null : status.error ?? 'MIDI is unavailable'))
      .catch(() => setMidiFault('MIDI could not be checked'))
    // A device list belongs to the audio system that produced it, and the show can
    // change systems while this dialog is open: the devices of the old one are no
    // longer a list of anything.
  }, [info?.backend])

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

  /** The receiver whose password box has the cursor: the one just added from what was found. */
  const [focusSource, setFocusSource] = useState<string | null>(null)

  /**
   * A found receiver becomes a source with what it told us about itself. The password is the
   * one thing it could not tell us, so the cursor goes there.
   */
  const addFound = (found: EwDxFound): void => {
    const id = crypto.randomUUID()
    updateRfSettings({
      sources: [...showSettings.rf.sources, {
        id,
        label: labelFor(found, showSettings.rf.sources.map(source => source.label)),
        kind: 'ew-dx',
        target: targetFor(found),
        pollMs: DEFAULT_POLL_MS,
        timeoutMs: DEFAULT_TIMEOUT_MS
      }]
    })
    setFocusSource(id)
  }

  const removeSource = (id: string): void => {
    // The password and the trusted certificate are this machine's, not the show's, so they
    // do not leave with the source on their own: a removed receiver forgets them here.
    if (showSettings.rf.sources.find(source => source.id === id)?.kind === 'ew-dx') {
      void window.cuerunner.show.ewDxForget(id)
    }
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
  // ASIO is a Windows driver model, and a request for it is a request only a Windows
  // build can honour: elsewhere it is not offered at all.
  const asioOffered = currentPlatform() === 'win32'
  // The device the workspace picked, or the system default while the settings still
  // say "default": its channel count and sample rates are what the selects offer.
  const selectedDevice = devices.find(device => device.id === audioSettings.outputDeviceId)
    ?? devices.find(device => device.isDefault)
    ?? devices[0]
  const companionService = showServices.find(service => service.id === 'companion')

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

  // A backend with no device — the silent and offline ones a test or a dev run uses —
  // refuses every device request by design, so the lever is withheld while the engine's
  // own reading says so. An engine that cannot be reached has no reading to withhold it
  // on: that configure is the one that re-enters the engine's own start path.
  const reconnectDisabled =
    reconnecting || (available && info !== null && backendHasNoDevice(info.backend))

  // The engine's refusal of a device request belongs on the panel unless the reading
  // says the backend has no device at all — the silent, offline and `none` ones a test
  // or a dev run uses — where every request is refused by definition and the Backend row
  // already says which engine this is. While no reading has landed there is no backend to
  // hide it behind, and it shows only when the engine could not be reached at all: the one
  // state where the request itself was the thing that failed, and the lever is the way back.
  const deviceRefusalShown =
    audioDeviceError !== null && (info === null ? !available : !backendHasNoDevice(info.backend))

  // The lever the engine's revive needs: a configure with the settings already in force
  // reopens a device that was lost or latched off, and leaves a healthy one alone. The
  // show's own settings are what it sends, so nothing is pretended to have changed.
  const reconnectDevice = async (): Promise<void> => {
    setReconnecting(true)
    try {
      accept(await applyAudioDeviceSettings(audioSettings))
    } catch {
      // The refusal is in the store in the engine's own words; the line below the
      // device rows shows it, and nothing here has anything to add to it.
    } finally {
      setReconnecting(false)
    }
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

        {/* Down the side rather than across the top: seven tabs in a row were squeezed
            to the point that the last one was clipped, and the two groups say where
            each tab's settings are kept without a paragraph having to. */}
        <nav className="settings-tabs" aria-label="Settings sections">
          {(['show', 'machine'] as const).map(scope => (
            <div key={scope} className="settings-tab-group">
              <div className="settings-tab-group-title">
                {scope === 'show' ? 'This show' : 'This computer'}
              </div>
              {SETTINGS_TABS.filter(entry => entry.scope === scope).map(({ id, label }) => {
                const service = showServices.find(candidate => candidate.id === TAB_SERVICE[id])
                return (
                  <button
                    key={id}
                    className="settings-tab"
                    data-active={tab === id}
                    onClick={() => setTab(id)}
                  >
                    {label}
                    {service && (
                      <i className="settings-tab-dot" data-state={service.state} aria-hidden="true" />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="settings-body">
          <header className="settings-pane-head">
            <h2 className="settings-pane-title">
              {SETTINGS_TABS.find(entry => entry.id === tab)?.label}
            </h2>
            <p className="settings-pane-blurb">{TAB_BLURB[tab]}</p>
          </header>
          {tab === 'general' && (
            <>
              <div className="field-row">
                <label htmlFor="settings-guard-window">Repeat guard</label>
                <NumberField
                  id="settings-guard-window"
                  value={triggerGuard.windowMs}
                  min={TRIGGER_GUARD_MIN_MS}
                  max={TRIGGER_GUARD_MAX_MS}
                  step={10}
                  onValue={next => { if (next !== null) updateTriggerGuard({ windowMs: next }) }}
                />
                <span className="settings-info">ms</span>
              </div>
              <p className="inspector-hint">
                Ignores a second GO that arrives this soon after the first — a footswitch
                that bounces, a desk that sends twice, a key held down. 0 turns it off.
              </p>
              <div className="field-row">
                <label htmlFor="settings-stop-fade">STOP fade</label>
                <NumberField
                  id="settings-stop-fade"
                  value={triggerGuard.stopFadeMs ?? 0}
                  min={0}
                  max={STOP_FADE_MAX_MS}
                  step={10}
                  onValue={next => { if (next !== null) updateTriggerGuard({ stopFadeMs: next }) }}
                />
                <span className="settings-info">ms</span>
              </div>
              <p className="inspector-hint">
                0 cuts at once. With a fade, a second STOP during it cuts what is left.
              </p>
            </>
          )}
          {tab === 'audio' && (
            <>
              {/* The device belongs to the system that lists it, so choosing a system
                  forgets the device: an id from the other system is a request the new
                  backend cannot honour, and the engine refuses rather than quietly
                  substituting one. */}
              <div className="field-row">
                <label htmlFor="settings-audio-system">Audio system</label>
                <select
                  id="settings-audio-system"
                  value={audioSettings.backend ?? 'auto'}
                  onChange={e => updateAudioSettings({
                    backend: e.target.value as 'auto' | 'asio',
                    outputDeviceId: 'default'
                  })}
                >
                  <option value="auto">
                    {asioOffered ? 'Windows audio (default)' : 'System audio (default)'}
                  </option>
                  {/* An interface's own driver, past the system mixer. It exists on
                      Windows and nowhere else. */}
                  {(asioOffered || audioSettings.backend === 'asio') && <option value="asio">ASIO</option>}
                  {/* A show saved with ASIO and opened where it is not offered: the stored
                      value is shown as unavailable rather than a blank select, and picking
                      anything else writes that choice. The workspace value is preserved
                      until then. */}
                  {!asioOffered && audioSettings.backend === 'asio' && (
                    <option value="asio" disabled>ASIO (unavailable on this computer)</option>
                  )}
                </select>
                <span className="settings-info">The audio stack the engine plays through</span>
              </div>
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
              {/* A backend that holds the device for the engine by definition — ASIO
                  does — leaves nothing here to choose, and the Device readout below
                  says `exclusive` for it without the operator setting anything. The
                  hint goes with the row: an explanation of a control that is not there
                  is a line about nothing. */}
              {!(info !== null && info.backend === 'asio') && (
                <>
                  <div className="field-row">
                    <label htmlFor="settings-exclusive">Exclusive</label>
                    <input
                      id="settings-exclusive"
                      type="checkbox"
                      checked={audioSettings.exclusive ?? false}
                      onChange={e => updateAudioSettings({ exclusive: e.target.checked })}
                    />
                    <span className="settings-info">Keep other apps off this device</span>
                  </div>
                  <p className="inspector-hint">
                    Keeps other apps off the device, for every channel it has and steadier
                    timing. A driver that refuses says why here.
                  </p>
                </>
              )}
              {/* A backend with no device at all — the silent, offline and `none` ones a
                  test or a dev run uses — refuses every device request by definition,
                  including the one this window sends when it opens. That is not a fault
                  anyone can act on, and a red line that never clears teaches people to
                  ignore red lines; the Backend row below already says which engine this
                  is. A real device's refusal is shown in the engine's own words, and so is
                  one that came back with no reading to hide it behind. */}
              {deviceRefusalShown && (
                <p className="settings-device-error" role="alert">{audioDeviceError}</p>
              )}

              <div className="field-section-title">New audio cues</div>
              <div className="field-row">
                <label htmlFor="settings-auto-trim">Trim silence</label>
                <input
                  id="settings-auto-trim"
                  type="checkbox"
                  checked={audioSettings.autoTrimSilence ?? false}
                  onChange={e => updateAudioSettings({ autoTrimSilence: e.target.checked })}
                />
                <span className="settings-info">Skip silence at the start and end</span>
              </div>
              <p className="inspector-hint">
                A new audio cue starts at the first sound in its file and ends at the last,
                where silence is anything below {AUDIO_SILENCE_THRESHOLD_DB} dBFS. Cues
                already in the list keep the trim they were made with.
              </p>

              <div className="field-section-title">What the engine is doing</div>
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
                  {/* True of both reasons there is no reading: a build without an engine
                      answers the same way as one whose engine has stopped answering. */}
                  {available === false
                    ? 'The audio engine is not answering.'
                    : 'Reading the engine…'}
                </p>
              )}
              {/* The engine's revive lever, under the reading it acts on. A configure
                  with the settings already in force reopens a device that was lost or
                  latched off and leaves a healthy one alone, so what it sends is the
                  show's own settings and nothing else; the reply replaces the reading
                  above at once rather than at the next poll. */}
              <div className="field-row">
                <label />
                <button
                  id="settings-audio-reconnect"
                  className="inspector-btn"
                  disabled={reconnectDisabled}
                  onClick={reconnectDevice}
                >
                  Reconnect device
                </button>
                <span className="settings-info">Reopens the device after a loss</span>
              </div>
            </>
          )}

          {tab === 'midi' && (
            <>
              {midiFault !== null && (
                <p className="settings-warning" id="settings-midi-unavailable" role="status">
                  MIDI is unavailable: {midiFault}. MIDI cues will not send, and nothing can be listened to.
                </p>
              )}
              <div className="field-row">
                <label htmlFor="settings-midi-out">Send on</label>
                <select
                  id="settings-midi-out"
                  value={midiSettings.outputPortName}
                  onChange={e => updateMidiSettings({ outputPortName: e.target.value })}
                >
                  <option value="">— none —</option>
                  {midiPorts.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
              <p className="inspector-hint">The port MIDI cues use unless they name their own.</p>

              <ServiceBlock
                title="Listen to MIDI"
                blurb="Fire cues from notes and controllers, and see what arrives in the Monitor."
                id="settings-midi-in"
                enabled={showSettings.midiIn.enabled}
                onEnabled={enabled => updateMidiInSettings({ enabled })}
                service={midiService}
              >
                {midiFault !== null ? null : midiInputPorts.length === 0 ? (
                  <p className="inspector-hint" data-scope="panel">No MIDI inputs on this machine.</p>
                ) : (
                  <>
                    <p className="inspector-hint" data-scope="panel">
                      Tick the ports to listen to, or leave them all clear to listen to every one.
                    </p>
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
                  </>
                )}
              </ServiceBlock>
            </>
          )}

          {tab === 'network' && (
            <>
              <ServiceBlock
                title="OSC control"
                blurb="Take cues and commands from lighting consoles, sound desks and tablets."
                id="settings-osc-in"
                enabled={showSettings.oscIn.enabled}
                onEnabled={enabled => updateOscInSettings({ enabled })}
                service={oscService}
              >
                <NumberRow
                  id="settings-osc-port"
                  label="Port"
                  value={showSettings.oscIn.port}
                  min={1}
                  max={65535}
                  disabled={!showSettings.oscIn.enabled}
                  onValue={port => updateOscInSettings({ port })}
                />
                <div className="field-row">
                  <label htmlFor="settings-osc-remote">Remote</label>
                  <input
                    id="settings-osc-remote"
                    type="checkbox"
                    checked={remoteEnabled(showSettings.oscIn)}
                    disabled={!showSettings.oscIn.enabled}
                    onChange={e => updateOscInSettings({ remote: e.target.checked })}
                  />
                  <span className="settings-info">Answer /go, /stop and /cue/12/start</span>
                </div>
                <p className="inspector-hint" data-scope="panel">
                  Cuerunner's addresses and QLab's, so a QLab remote runs this show.
                </p>
                <div className="field-row">
                  <label htmlFor="settings-osc-allow">Allow from</label>
                  <TextField
                    id="settings-osc-allow"
                    placeholder="anyone"
                    value={(showSettings.oscIn.allowFrom ?? []).join(', ')}
                    disabled={!showSettings.oscIn.enabled}
                    validate={text => {
                      const bad = splitAllowList(text).find(entry => !isAllowEntry(entry))
                      return bad === undefined ? null : `“${bad}” is not an address or a range like 10.0.0.0/24`
                    }}
                    onValue={text => updateOscInSettings({ allowFrom: splitAllowList(text) })}
                  />
                </div>
                <p className="inspector-hint" data-scope="panel">
                  Addresses or ranges, comma-separated. Empty hears everyone.
                </p>
                <OscSettings />
              </ServiceBlock>

              {!pro && (
                <ProHint onUnlock={() => setTab('license')}>
                  Finding devices and the tablet view are part of Cuerunner Pro. Listening
                  for OSC is free.
                </ProHint>
              )}

              <ServiceBlock
                title="Find devices"
                blurb="List the gear on the show network in the Monitor, and warn when one drops off."
                id="settings-presence"
                enabled={showSettings.presence.enabled}
                onEnabled={enabled => updatePresenceSettings({ enabled })}
                service={presenceService}
              >
                <p className="inspector-hint" data-scope="panel">
                  Dante endpoints, interfaces and amps that announce themselves are found
                  automatically.
                </p>
                <Advanced summary="Advanced: what to look for, and when to give up on it">
                  <div className="field-row">
                    <label htmlFor="settings-presence-services">Service types</label>
                    <TextField
                      id="settings-presence-services"
                      value={showSettings.presence.services.join(', ')}
                      disabled={!showSettings.presence.enabled}
                      // A list the operator types, so it is written when the field is left: a
                      // comma or a space on the way to the next entry is not an edit.
                      onValue={text => {
                        const services = text.split(',').map(entry => entry.trim()).filter(Boolean)
                        if (services.length > 0) updatePresenceSettings({ services })
                      }}
                    />
                  </div>
                  <NumberRow
                    id="settings-presence-gone"
                    label="Gone after (s)"
                    value={showSettings.presence.goneAfterSeconds}
                    min={5}
                    max={3600}
                    disabled={!showSettings.presence.enabled}
                    onValue={goneAfterSeconds => updatePresenceSettings({ goneAfterSeconds })}
                  />
                </Advanced>
              </ServiceBlock>

              <ServiceBlock
                title="Tablet view"
                blurb="Follow the cue list on a tablet or phone. It watches only; it cannot fire cues."
                id="settings-companion"
                enabled={showSettings.companion.enabled}
                onEnabled={enabled => updateCompanionSettings({ enabled })}
                service={companionService}
              >
                <div className="field-row">
                  <label htmlFor="settings-companion-token">Access code</label>
                  <TextField
                    id="settings-companion-token"
                    when="typed"
                    value={showSettings.companion.token}
                    placeholder="Needed to connect"
                    onValue={token => updateCompanionSettings({ token })}
                  />
                  <button
                    className="inspector-btn"
                    onClick={() => updateCompanionSettings({ token: crypto.randomUUID().slice(0, 8) })}
                  >
                    New code
                  </button>
                </div>
                <NumberRow
                  id="settings-companion-port"
                  label="Port"
                  value={showSettings.companion.port}
                  min={1}
                  max={65535}
                  disabled={!showSettings.companion.enabled}
                  onValue={port => updateCompanionSettings({ port })}
                />
              </ServiceBlock>
            </>
          )}

          {tab === 'wireless' && (
            <>
              {!pro && <ProHint onUnlock={() => setTab('license')} />}
              <div className="field-section-title">Where the readings come from</div>
              {showSettings.rf.sources.length === 0 ? (
                <p className="inspector-hint" data-scope="panel">
                  Nothing is feeding the mic plot yet. Add a receiver rack, or a demo rack to
                  see what the panel does.
                </p>
              ) : (
                <div className="settings-source-list">
                  {showSettings.rf.sources.map(source => (
                    <div key={source.id} className="settings-source-entry">
                      <div className="settings-source-row">
                        {/* Taken when the field is left, not as it is typed: a source is live the
                            moment it changes, and a name or address typed a letter at a time would
                            restart the service, and reconnect to the receiver, on every letter. */}
                        <TextField
                          className="settings-source-label"
                          value={source.label}
                          aria-label="Source name"
                          onValue={label => updateSource(source.id, { label })}
                        />
                        <select
                          value={source.kind}
                          aria-label="Source kind"
                          onChange={e => updateSource(source.id, { kind: e.target.value as TelemetrySourceKind })}
                        >
                          <option value="http">HTTP</option>
                          <option value="file">File</option>
                          <option value="ew-dx">Sennheiser EW-DX</option>
                          <option value="demo">Demo</option>
                        </select>
                        <TextField
                          className="settings-source-target"
                          value={source.target}
                          aria-label="Source address"
                          placeholder={
                            source.kind === 'file' ? '/path/to/telemetry.json'
                              : source.kind === 'ew-dx' ? '192.168.0.50'
                                : 'http://10.0.0.20/telemetry'
                          }
                          disabled={source.kind === 'demo'}
                          onValue={target => updateSource(source.id, { target })}
                        />
                        <button
                          className="settings-source-remove"
                          onClick={() => removeSource(source.id)}
                          aria-label={`Remove ${source.label}`}
                        >
                          ✕
                        </button>
                      </div>
                      {source.kind === 'ew-dx' && (
                        <EwDxCredentials
                          sourceId={source.id}
                          target={source.target}
                          autoFocus={focusSource === source.id}
                          serviceKey={`${rfService?.state ?? ''}:${rfService?.detail ?? ''}`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="field-row">
                <label />
                <button className="add-row" onClick={addSource}>+ Add source</button>
              </div>
              <EwDxFinder sources={showSettings.rf.sources} onAdd={addFound} />
              <ServiceStatus service={rfService} />

              <div className="field-section-title">Warn me when</div>
              <NumberRow
                id="settings-rf-battery-warning"
                label="Battery below"
                value={showSettings.rf.thresholds.batteryWarning}
                min={1}
                max={99}
                onValue={batteryWarning => setThresholds({ batteryWarning })}
              />
              <NumberRow
                id="settings-rf-battery-critical"
                label="Battery urgent"
                value={showSettings.rf.thresholds.batteryCritical}
                min={1}
                max={99}
                onValue={batteryCritical => setThresholds({ batteryCritical })}
              />
              <NumberRow
                id="settings-rf-rf-warning"
                label="Signal below"
                value={showSettings.rf.thresholds.rfWarningDbm}
                min={-120}
                max={-20}
                onValue={rfWarningDbm => setThresholds({ rfWarningDbm })}
              />
              <NumberRow
                id="settings-rf-gone"
                label="Pack silent for"
                value={showSettings.rf.thresholds.offlineAfterSeconds}
                min={2}
                max={600}
                onValue={offlineAfterSeconds => setThresholds({ offlineAfterSeconds })}
              />
              <p className="inspector-hint">
                Battery figures are percentages, signal is dBm, and silence is counted in
                seconds.
              </p>
            </>
          )}

          {tab === 'redundancy' && <RedundancySection />}

          {tab === 'license' && <LicenseSection />}

          {tab === 'timecode' && <TimecodeSection />}

          {tab === 'updates' && <UpdateSection />}
        </div>
      </div>
    </div>
  )
}
