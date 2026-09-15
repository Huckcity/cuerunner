import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { AudioCue, AudioCrosspoint } from '../../types/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField } from '../common/Field'
import { RoutingMatrix } from './RoutingMatrix'
import { audioEngine } from '../../engine/audioEngineClient'
import { cueRunner } from '../../engine/CueRunner'
import { useAudioEngineInfo } from '../../hooks/useAudioEngineInfo'
import { resampleNotice } from '../../utils/sampleRate'
import { AUDIO_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: AudioCue; tab: string }

export function AudioInspector({ cue, tab }: Props) {
  const update = useStore(s => s.updateCue)
  const outputDeviceId = useStore(s => s.audioSettings.outputDeviceId)
  const set = (patch: Partial<AudioCue>) => update(cue.id, patch)

  const [loading, setLoading] = useState(false)
  // Real channel counts, so the matrix offers the channels the file and the device
  // actually have rather than a stereo guess.
  const [fileChannels, setFileChannels] = useState(0)
  const [fileRate, setFileRate] = useState(0)
  const [deviceChannels, setDeviceChannels] = useState(2)
  const { info } = useAudioEngineInfo()
  // A file at another rate is resampled, not wrong — but it is worth saying, on the cue
  // it applies to, rather than leaving the operator to notice a level or a length that
  // does not read the way this rig's files do.
  const rateNotice = resampleNotice(fileRate, info?.sampleRate ?? 0)

  // Playback and level are live: a running cue hears the change as the control moves,
  // so a reset has to go through the engine too.
  const applyPlaybackRate = (rate: number) => {
    set({ playbackRate: rate })
    cueRunner.setLiveParameter(cue.id, 'rate', rate)
  }
  const applyTrim = (trim: number) => {
    set({ trim })
    cueRunner.setLiveParameter(cue.id, 'trim', trim)
  }
  const applyVolume = (volume: number) => {
    set({ volume })
    cueRunner.setLiveParameter(cue.id, 'volume', volume)
  }
  const applyPan = (pan: number) => {
    set({ pan })
    cueRunner.setLiveParameter(cue.id, 'pan', pan)
  }
  const applyRouting = (outputs: AudioCrosspoint[] | null) => {
    set({ outputs })
    cueRunner.setLiveRouting(cue.id)
  }

  // The file's channel count and rate, from the engine's metadata — the media stays there.
  useEffect(() => {
    if (!cue.filePath) { setFileChannels(0); setFileRate(0); return }
    let current = true
    audioEngine.prepare(cue.id, cue.filePath)
      .then(metadata => {
        if (!current) return
        setFileChannels(metadata.channels)
        setFileRate(metadata.sampleRate)
      })
      .catch(() => {
        if (!current) return
        setFileChannels(0)
        setFileRate(0)
      })
    return () => { current = false }
  }, [cue.id, cue.filePath])

  useEffect(() => {
    let current = true
    audioEngine.devices()
      .then(devices => {
        if (!current) return
        const device = devices.find(d => d.id === outputDeviceId) ?? devices.find(d => d.isDefault)
        if (device && device.channels > 0) setDeviceChannels(device.channels)
      })
      .catch(() => {
        // No device list yet: the matrix still offers a stereo pair.
      })
    return () => { current = false }
  }, [outputDeviceId])

  const pickFile = async () => {
    const path = await audioEngine.pickFile()
    if (!path) return
    set({ filePath: path })
    setLoading(true)
    try {
      const metadata = await audioEngine.prepare(cue.id, path)
      set({ filePath: path, duration: Math.round(metadata.durationMs) })
      setFileChannels(metadata.channels)
      setFileRate(metadata.sampleRate)
    } catch (e) {
      // The file is still selected; only its length is unknown.
      console.warn('Could not read audio metadata:', e)
    } finally {
      setLoading(false)
    }
  }

  if (tab === 'Time & Loops') {
    const toSeconds = (ms: number) => Math.round(ms / 100) / 10  // 1 decimal
    const fromSeconds = (s: number) => Math.round(s * 1000)
    return (
      <div>
        <div className="field-row">
          <label>Start time (s)</label>
          <NumberField when="typed" min={0} step={0.1} value={toSeconds(cue.startTime)}
            onValue={seconds => { if (seconds !== null) set({ startTime: fromSeconds(seconds) }) }} />
          <ResetButton label="Start time" value={cue.startTime} defaultValue={AUDIO_DEFAULTS.startTime}
            onReset={() => set({ startTime: AUDIO_DEFAULTS.startTime })} />
        </div>
        <div className="field-row">
          <label>End time (s)</label>
          <NumberField when="typed" min={0} step={0.1}
            value={cue.endTime !== null ? toSeconds(cue.endTime) : null}
            placeholder="play to end"
            onValue={seconds => set({ endTime: seconds === null ? null : fromSeconds(seconds) })} />
          <ResetButton label="End time" value={cue.endTime} defaultValue={AUDIO_DEFAULTS.endTime}
            onReset={() => set({ endTime: AUDIO_DEFAULTS.endTime })} />
        </div>
        <div className="field-row">
          <label>Fade in (s)</label>
          <NumberField when="typed" min={0} step={0.1} value={toSeconds(cue.fadeInDuration)}
            onValue={seconds => { if (seconds !== null) set({ fadeInDuration: fromSeconds(seconds) }) }} />
          <ResetButton label="Fade in" value={cue.fadeInDuration} defaultValue={AUDIO_DEFAULTS.fadeInDuration}
            onReset={() => set({ fadeInDuration: AUDIO_DEFAULTS.fadeInDuration })} />
        </div>
        <div className="field-row">
          <label>Loop count</label>
          <NumberField when="typed" min={-1} value={cue.loopCount}
            onValue={loopCount => { if (loopCount !== null) set({ loopCount }) }} />
          <ResetButton label="Loop count" value={cue.loopCount} defaultValue={AUDIO_DEFAULTS.loopCount}
            onReset={() => set({ loopCount: AUDIO_DEFAULTS.loopCount })} />
        </div>
        {/* Vamping is this same region looping forever; the two are one state, so the
            button and the field are one control apart rather than two stories. */}
        <button
          className="vamp-toggle"
          data-active={cue.loopCount < 0}
          onClick={() => set({ loopCount: cue.loopCount < 0 ? AUDIO_DEFAULTS.loopCount : -1 })}
          title={cue.loopCount < 0
            ? 'Play the section once instead of looping it'
            : 'Loop the section until a devamp cue releases it'}
        >
          {cue.loopCount < 0 ? '◉ Vamping — the section loops until released' : '○ Make this a vamp'}
        </button>
        <p className="inspector-hint" style={{ marginTop: 0 }}>0 = play once, -1 = forever</p>
      </div>
    )
  }

  // The file's name is what tells two cues apart; the folder it sits in is the long,
  // shared part, so it goes under the name rather than in front of it.
  const separator = Math.max(cue.filePath.lastIndexOf('/'), cue.filePath.lastIndexOf('\\'))
  const fileName = cue.filePath.slice(separator + 1)
  const folder = separator > 0 ? cue.filePath.slice(0, separator) : ''

  return (
    <div>
      <div className="field-row">
        <label>File</label>
        <input value={fileName} readOnly
          className="audio-file-name"
          title={cue.filePath}
          data-path={cue.filePath}
          placeholder={loading ? 'Reading file…' : 'No file selected'}
          style={{ flex: 1, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
          onClick={pickFile} />
        <button onClick={pickFile} disabled={loading} className="inspector-btn">Browse</button>
      </div>
      {folder !== '' && (
        <p className="inspector-hint audio-file-folder" title={folder}>{folder}</p>
      )}
      {rateNotice !== null && (
        <p className="inspector-hint audio-file-rate"
          title="The engine resamples this file into the rig's rate; pitch and tempo are unchanged.">
          {rateNotice}
        </p>
      )}
      <div className="field-section-title">Playback</div>
      <div className="field-row">
        <label>Rate</label>
        <input type="range" min={0.25} max={4} step={0.05} value={cue.playbackRate}
          onChange={e => applyPlaybackRate(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{cue.playbackRate.toFixed(2)}x</span>
        <ResetButton label="Rate" value={cue.playbackRate} defaultValue={AUDIO_DEFAULTS.playbackRate}
          onReset={() => applyPlaybackRate(AUDIO_DEFAULTS.playbackRate)} />
      </div>
      <div className="field-row">
        <label>Trim</label>
        <input type="range" min={0} max={2} step={0.01} value={cue.trim}
          onChange={e => applyTrim(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{Math.round(cue.trim * 100)}%</span>
        <ResetButton label="Trim" value={cue.trim} defaultValue={AUDIO_DEFAULTS.trim}
          onReset={() => applyTrim(AUDIO_DEFAULTS.trim)} />
      </div>
      <div className="field-section-title">Level</div>
      <div className="field-row">
        <label>Volume</label>
        <input type="range" min={0} max={1} step={0.01} value={cue.volume}
          onChange={e => applyVolume(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{Math.round(cue.volume * 100)}%</span>
        <ResetButton label="Volume" value={cue.volume} defaultValue={AUDIO_DEFAULTS.volume}
          onReset={() => applyVolume(AUDIO_DEFAULTS.volume)} />
      </div>
      <div className="field-row">
        <label>Pan</label>
        <input type="range" min={-1} max={1} step={0.01} value={cue.pan}
          onChange={e => applyPan(Number(e.target.value))}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">
          {cue.pan > 0 ? `R${Math.round(cue.pan * 100)}` :
           cue.pan < 0 ? `L${Math.round(-cue.pan * 100)}` : 'C'}
        </span>
        <ResetButton label="Pan" value={cue.pan} defaultValue={AUDIO_DEFAULTS.pan}
          onReset={() => applyPan(AUDIO_DEFAULTS.pan)} />
      </div>
      <div className="field-section-title">Output routing</div>
      <RoutingMatrix
        cue={cue}
        fileChannels={fileChannels}
        deviceChannels={deviceChannels}
        onChange={applyRouting}
      />
      <LastRun cueId={cue.id} />
    </div>
  )
}
