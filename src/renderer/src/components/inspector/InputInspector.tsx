import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { AudioCrosspoint, AudioCue, InputCue } from '../../../../shared/cue'
import type { AudioInputDevice, AudioInputStatus } from '../../../../shared/audio'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueEngine } from '../../engine/CueEngine'
import { NumberField } from '../common/Field'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { RoutingMatrix } from './RoutingMatrix'
import { CurveEditor } from '../audio/CurveEditor'
import { PatchSelect } from '../audio/PatchSelect'
import { meterFraction } from '../layout/OutputStrip'
import { INPUT_DEFAULTS } from '../../utils/cueDefaults'
import '../audio/AudioIo.css'

interface Props { cue: InputCue }

/** How often the input's meter and its buffer are read while the inspector shows them. */
const STATUS_POLL_MS = 100
/** Channels offered for a device that does not say how many it has before it is opened. */
const FALLBACK_CHANNELS = 8

const seconds = (ms: number): number => Math.round(ms / 10) / 100
const fromSeconds = (s: number): number => Math.round(s * 1000)

/**
 * A live input: which device and which of its channels, how loud and where, and how it opens
 * and closes. The meters and the buffer reading are the engine's, read while the inspector is
 * open — the input does not have to be running a cue for its level to be checked.
 */
export function InputInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<InputCue>) => update(cue.id, patch)
  const [devices, setDevices] = useState<AudioInputDevice[]>([])
  const [status, setStatus] = useState<AudioInputStatus | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [deviceChannels, setDeviceChannels] = useState(2)
  const device = cue.device
  const deviceKey = device === '' ? 'default' : device

  useEffect(() => {
    let current = true
    audioEngine.inputs()
      .then(list => { if (current) setDevices(list) })
      .catch(() => { if (current) setDevices([]) })
    void audioEngine.devices()
      .then(list => {
        if (!current) return
        const output = list.find(entry => entry.isDefault) ?? list[0]
        if (output && output.channels > 0) setDeviceChannels(output.channels)
      })
      .catch(() => {})
    return () => { current = false }
  }, [])

  useEffect(() => {
    let stopped = false
    const read = async (): Promise<void> => {
      try {
        const feeds = await audioEngine.inputStatus()
        if (stopped) return
        setStatus(feeds.find(feed => feed.device === deviceKey || feed.device === device) ?? null)
      } catch {
        // No engine: no reading.
      }
    }
    void read()
    const id = window.setInterval(() => { void read() }, STATUS_POLL_MS)
    return () => { stopped = true; window.clearInterval(id) }
  }, [device, deviceKey])

  const listed = devices.find(entry => entry.id === device)
  const channelCount = status?.channels ?? (listed && listed.channels > 0 ? listed.channels : FALLBACK_CHANNELS)

  const toggleChannel = (channel: number): void => {
    const chosen = cue.inputChannels.includes(channel)
      ? cue.inputChannels.filter(c => c !== channel)
      : [...cue.inputChannels, channel].sort((a, b) => a - b)
    set({ inputChannels: chosen })
  }

  const openInput = async (): Promise<void> => {
    setProblem(null)
    try {
      setStatus(await audioEngine.inputOpen({ device: deviceKey }))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    }
  }

  const applyVolume = (volume: number): void => {
    set({ volume })
    cueEngine.setLiveParameter(cue.id, 'volume', volume)
  }
  const applyPan = (pan: number): void => {
    set({ pan })
    cueEngine.setLiveParameter(cue.id, 'pan', pan)
  }
  const applyRouting = (outputs: AudioCrosspoint[] | null): void => {
    set({ outputs })
    cueEngine.setLiveRouting(cue.id)
  }

  return (
    <div className="input-inspector">
      <div className="field-row">
        <label htmlFor="input-device">Input</label>
        <select id="input-device" className="input-device" value={device} onChange={e => set({ device: e.target.value })}>
          <option value="">Default input</option>
          {device !== '' && listed === undefined && <option value={device}>{device} (not connected)</option>}
          {devices.map(entry => (
            <option key={entry.id} value={entry.id}>
              {entry.name}{entry.channels > 0 ? ` (${entry.channels} ch)` : ''}
            </option>
          ))}
        </select>
        <button className="inspector-btn input-open" onClick={() => { void openInput() }}
          title="Open the input now, so the cue goes live at once and its level can be checked">
          {status?.running ? 'Open' : 'Open input'}
        </button>
      </div>
      {problem !== null && <p className="inspector-hint input-problem" role="status">{problem}</p>}
      <div className="field-row">
        <label>Channels</label>
        <div className="input-channels">
          {Array.from({ length: channelCount }, (_, channel) => (
            <label key={channel}>
              <input
                type="checkbox"
                className="input-channel"
                data-channel={channel + 1}
                checked={cue.inputChannels.includes(channel)}
                onChange={() => toggleChannel(channel)}
              />
              {channel + 1}
            </label>
          ))}
        </div>
      </div>
      {cue.inputChannels.length === 0 && <p className="inspector-hint">Choose at least one channel: a cue with none plays nothing.</p>}
      {status !== null && (
        <>
          {cue.inputChannels.map(channel => {
            const peak = status.peaks[channel] ?? 0
            return (
              <div className="field-row" key={channel}>
                <label>Level {channel + 1}</label>
                <span className="level-meter input-meter" data-channel={channel + 1} data-clipped={peak >= 1}>
                  <span className="level-meter-bar" style={{ width: `${Math.round(meterFraction(peak) * 100)}%` }} />
                </span>
              </div>
            )
          })}
          <p className="inspector-hint input-latency" data-latency={status.latencyMs.toFixed(1)}>
            {status.running
              ? `${status.name}: ${status.sampleRate / 1000} kHz, ${status.latencyMs.toFixed(1)} ms through the engine, ` +
                `clock corrected ${status.ratioPpm >= 0 ? '+' : '−'}${Math.abs(status.ratioPpm).toFixed(0)} ppm` +
                (status.underruns + status.resyncs > 0 ? `, ${status.underruns + status.resyncs} dropouts` : '')
              : `${status.name} is closed`}
          </p>
        </>
      )}
      <div className="field-section-title">Level</div>
      <div className="field-row">
        <label>Volume</label>
        <input type="range" className="input-volume" min={0} max={1} step={0.01} value={cue.volume}
          onChange={e => applyVolume(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{Math.round(cue.volume * 100)}%</span>
        <ResetButton label="Volume" value={cue.volume} defaultValue={INPUT_DEFAULTS.volume}
          onReset={() => applyVolume(INPUT_DEFAULTS.volume)} />
      </div>
      <div className="field-row">
        <label>Pan</label>
        <input type="range" min={-1} max={1} step={0.01} value={cue.pan}
          onChange={e => applyPan(Number(e.target.value))} style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">
          {cue.pan > 0 ? `R${Math.round(cue.pan * 100)}` : cue.pan < 0 ? `L${Math.round(-cue.pan * 100)}` : 'C'}
        </span>
      </div>
      <div className="field-row">
        <label>Fade in (s)</label>
        <NumberField when="typed" min={0} step={0.05} value={seconds(cue.fadeInDuration)}
          onValue={value => { if (value !== null) set({ fadeInDuration: fromSeconds(value) }) }} />
      </div>
      <CurveEditor name="input-fade-in" label="Fade-in shape" defaultLabel="linear" shape={cue.fadeInShape}
        onChange={shape => set({ fadeInShape: shape })} />
      <div className="field-row">
        <label>Fade out (s)</label>
        <NumberField when="typed" min={0} step={0.05} value={seconds(cue.fadeOutDuration)}
          onValue={value => { if (value !== null) set({ fadeOutDuration: fromSeconds(value) }) }} />
      </div>
      <p className="inspector-hint">Runs until it is stopped, or for its duration when it has one; a stop closes it over the fade out.</p>
      <div className="field-section-title">Output routing</div>
      <PatchSelect name="input" value={cue.outputPatchId} onChange={patchId => set({ outputPatchId: patchId })} />
      <RoutingMatrix
        cue={{ outputs: cue.outputs } as AudioCue}
        fileChannels={Math.max(1, cue.inputChannels.length)}
        deviceChannels={deviceChannels}
        onChange={applyRouting}
      />
      <LastRun cueId={cue.id} />
    </div>
  )
}
