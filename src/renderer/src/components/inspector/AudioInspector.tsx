import { useState } from 'react'
import { useStore } from '../../store'
import type { AudioCue } from '../../types/cue'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { audioPlayer } from '../../engine/AudioPlayer'
import { AUDIO_DEFAULTS, AUDIO_OUTPUT_DEFAULTS } from '../../utils/cueDefaults'

interface Props { cue: AudioCue; tab: string }

export function AudioInspector({ cue, tab }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<AudioCue>) => update(cue.id, patch)

  const output = cue.outputs[0] ?? AUDIO_OUTPUT_DEFAULTS

  // Rate and trim are live: a running cue hears the change as the slider moves, so a
  // reset has to go through the player too.
  const applyPlaybackRate = (rate: number) => {
    set({ playbackRate: rate })
    audioPlayer.setPlaybackRate(cue.id, rate)
  }
  const applyTrim = (trim: number) => {
    set({ trim })
    audioPlayer.setTrim(cue.id, trim)
  }

  const setOutput = (patch: Partial<typeof output>) => {
    const outputs = [...cue.outputs]
    outputs[0] = { ...output, ...patch }
    set({ outputs })
    if ('volume' in patch) audioPlayer.setVolume(cue.id, patch.volume!)
    if ('pan' in patch) audioPlayer.setPan(cue.id, patch.pan!)
  }

  const [loading, setLoading] = useState(false)

  const pickFile = async () => {
    const path = await window.winslab.audio.pickFile()
    if (!path) return
    set({ filePath: path })
    setLoading(true)
    // A decoding context is a resource the browser caps: one left open on the failure
    // path is never reclaimed, so it is closed whatever the decode does.
    const ctx = new AudioContext()
    try {
      const arrayBuffer = await window.winslab.audio.readFile(path)
      const decoded = await ctx.decodeAudioData(arrayBuffer)
      set({ filePath: path, duration: Math.round(decoded.duration * 1000) })
    } catch (e) {
      console.warn('Could not decode audio for duration:', e)
    } finally {
      void ctx.close()
      setLoading(false)
    }
  }

  if (tab === 'Timing') {
    const toSeconds = (ms: number) => Math.round(ms / 100) / 10  // 1 decimal
    const fromSeconds = (s: number) => Math.round(s * 1000)
    return (
      <div>
        <div className="field-row">
          <label>Start time (s)</label>
          <input type="number" min={0} step={0.1} value={toSeconds(cue.startTime)}
            onChange={e => set({ startTime: fromSeconds(Number(e.target.value)) })} />
          <ResetButton label="Start time" value={cue.startTime} defaultValue={AUDIO_DEFAULTS.startTime}
            onReset={() => set({ startTime: AUDIO_DEFAULTS.startTime })} />
        </div>
        <div className="field-row">
          <label>End time (s)</label>
          <input type="number" min={0} step={0.1} value={cue.endTime != null ? toSeconds(cue.endTime) : ''}
            placeholder="play to end"
            onChange={e => set({ endTime: e.target.value ? fromSeconds(Number(e.target.value)) : null })} />
          <ResetButton label="End time" value={cue.endTime} defaultValue={AUDIO_DEFAULTS.endTime}
            onReset={() => set({ endTime: AUDIO_DEFAULTS.endTime })} />
        </div>
        <div className="field-row">
          <label>Fade in (s)</label>
          <input type="number" min={0} step={0.1} value={toSeconds(cue.fadeInDuration)}
            onChange={e => set({ fadeInDuration: fromSeconds(Number(e.target.value)) })} />
          <ResetButton label="Fade in" value={cue.fadeInDuration} defaultValue={AUDIO_DEFAULTS.fadeInDuration}
            onReset={() => set({ fadeInDuration: AUDIO_DEFAULTS.fadeInDuration })} />
        </div>
        <div className="field-row">
          <label>Loop count</label>
          <input type="number" min={-1} value={cue.loopCount}
            onChange={e => set({ loopCount: Number(e.target.value) })} />
          <ResetButton label="Loop count" value={cue.loopCount} defaultValue={AUDIO_DEFAULTS.loopCount}
            onReset={() => set({ loopCount: AUDIO_DEFAULTS.loopCount })} />
          <span className="inspector-hint" style={{ marginTop: 0 }}>0 = play once, -1 = forever</span>
        </div>
        <LastRun cueId={cue.id} />
      </div>
    )
  }

  return (
    <div>
      <div className="field-row">
        <label>File</label>
        <input value={cue.filePath} readOnly
          placeholder={loading ? 'Detecting duration…' : 'No file selected'}
          style={{ flex: 1, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}
          onClick={pickFile} />
        <button onClick={pickFile} disabled={loading} className="inspector-btn">Browse</button>
      </div>
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
      <div className="field-section-title">Output</div>
      <div className="field-row">
        <label>Volume</label>
        <input type="range" min={0} max={1} step={0.01} value={output.volume}
          onChange={e => setOutput({ volume: Number(e.target.value) })}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{Math.round(output.volume * 100)}%</span>
        <ResetButton label="Volume" value={output.volume} defaultValue={AUDIO_OUTPUT_DEFAULTS.volume}
          onReset={() => setOutput({ volume: AUDIO_OUTPUT_DEFAULTS.volume })} />
      </div>
      <div className="field-row">
        <label>Pan</label>
        <input type="range" min={-1} max={1} step={0.01} value={output.pan}
          onChange={e => setOutput({ pan: Number(e.target.value) })}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">
          {output.pan > 0 ? `R${Math.round(output.pan * 100)}` :
           output.pan < 0 ? `L${Math.round(-output.pan * 100)}` : 'C'}
        </span>
        <ResetButton label="Pan" value={output.pan} defaultValue={AUDIO_OUTPUT_DEFAULTS.pan}
          onReset={() => setOutput({ pan: AUDIO_OUTPUT_DEFAULTS.pan })} />
      </div>
      <LastRun cueId={cue.id} />
    </div>
  )
}
