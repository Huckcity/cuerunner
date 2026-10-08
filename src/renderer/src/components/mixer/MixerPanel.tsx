import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useStore } from '../../store'
import { audioEngine } from '../../engine/audioEngineClient'
import { currentPatchSlots } from '../../engine/audioRouting'
import {
  audioRoutingOf,
  FADER_FLOOR_DB,
  FADER_TOP_DB,
  outputFader,
  patchChannelsLabel,
  withAudioRouting,
  withOutputFader,
  type AudioRouting
} from '../../../../shared/audioRouting'
import type { AudioMeters } from '../../../../shared/audio'
import { formatDb, meterFraction, METER_POLL_MS } from '../layout/OutputStrip'
import { masterDb, MASTER_FLOOR_DB, MASTER_TOP_DB, setMasterDb, subscribeMaster } from '../../utils/masterLevel'
import '../audio/AudioIo.css'

interface Props { onClose: () => void }

/** How fast a meter bar falls back, per reading, as the output strip's does. */
const FALL_PER_READING = 0.82

interface StripProps {
  kind: 'output' | 'patch' | 'master'
  name: string
  detail: string
  db: number
  muted?: boolean
  floor: number
  top: number
  /** Live peaks, linear, one per channel the strip meters. */
  peaks: number[]
  onDb: (db: number) => void
  onMute?: (muted: boolean) => void
  testId: string
}

/** One strip: its meters, its fader in dB (double-click is 0 dB), its readout and its mute. */
function Strip({ kind, name, detail, db, muted, floor, top, peaks, onDb, onMute, testId }: StripProps) {
  const shown = useRef<number[]>([])
  const levels = peaks.map((peak, channel) => {
    const level = Math.max(meterFraction(peak), (shown.current[channel] ?? 0) * FALL_PER_READING)
    shown.current[channel] = level
    return level
  })
  return (
    <div className="mixer-strip" data-kind={kind} data-strip={testId}>
      <span className="mixer-strip-name" title={name}>{name}</span>
      <span className="mixer-strip-detail">{detail}</span>
      <div className="mixer-meters" aria-hidden="true">
        {levels.map((level, channel) => (
          <span key={channel} className="mixer-meter">
            <span className="mixer-meter-bar" style={{ height: `${Math.round(level * 100)}%` }} />
          </span>
        ))}
        <input
          type="range"
          className="mixer-fader"
          aria-label={`${name} level`}
          min={floor}
          max={top}
          step={0.5}
          value={db}
          onChange={e => onDb(Number(e.target.value))}
          onDoubleClick={() => onDb(0)}
          title={`${name} — double-click for 0 dB`}
        />
      </div>
      <span className="mixer-readout" onDoubleClick={() => onDb(0)}>{formatDb(db)}</span>
      {onMute !== undefined && (
        <button className="mixer-mute" aria-pressed={muted === true} onClick={() => onMute(!(muted === true))}>
          Mute
        </button>
      )}
    </div>
  )
}

/**
 * The mixer: a strip for every output patch, every device output and the master, each with a
 * meter read from the engine after its fader. The patches' and outputs' faders are the show's
 * — they travel in the file — and the master is this machine's, the same one the transport's
 * strip moves.
 */
export function MixerPanel({ onClose }: Props) {
  const settings = useStore(s => s.audioSettings)
  const updateAudioSettings = useStore(s => s.updateAudioSettings)
  const routing = useMemo(() => audioRoutingOf(settings), [settings])
  const master = useSyncExternalStore(subscribeMaster, masterDb)
  const [meters, setMeters] = useState<AudioMeters | null>(null)
  const [outputs, setOutputs] = useState(2)

  useEffect(() => {
    let current = true
    audioEngine.info().then(info => { if (current && info.channels > 0) setOutputs(info.channels) }).catch(() => {})
    return () => { current = false }
  }, [])

  useEffect(() => {
    let stopped = false
    const read = async (): Promise<void> => {
      try {
        const reading = await audioEngine.meters()
        if (!stopped) setMeters(reading)
      } catch {
        // No engine, no reading.
      }
    }
    const id = window.setInterval(() => { void read() }, METER_POLL_MS)
    return () => { stopped = true; window.clearInterval(id) }
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const write = (next: AudioRouting): void => updateAudioSettings(withAudioRouting(useStore.getState().audioSettings, next))
  const setPatch = (id: string, patch: { gainDb?: number; muted?: boolean }): void => {
    const latest = audioRoutingOf(useStore.getState().audioSettings)
    write({ ...latest, patches: latest.patches.map(entry => (entry.id === id ? { ...entry, ...patch } : entry)) })
  }
  const setOutput = (output: number, fader: { gainDb?: number; muted?: boolean }): void => {
    const latest = audioRoutingOf(useStore.getState().audioSettings)
    write(withOutputFader(latest, output, { ...outputFader(latest, output), ...fader }))
  }

  const slots = currentPatchSlots()
  const busPeaks = (patchId: string, channels: number): number[] => {
    const slot = slots.get(patchId)
    const bus = meters?.buses?.find(entry => entry.slot === slot)
    return Array.from({ length: Math.max(1, channels) }, (_, channel) => bus?.peaks[channel] ?? 0)
  }

  return (
    <div className="mixer-overlay" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="mixer-panel" role="dialog" aria-label="Mixer">
        <div className="mixer-header">
          <span className="mixer-title">Mixer</span>
          <button className="mixer-button mixer-close" onClick={onClose}>Close</button>
        </div>
        <div className="mixer-body">
          <div className="mixer-group-title">Output patches</div>
          <div className="mixer-strips">
            {routing.patches.length === 0 && (
              <span className="audition-status">No patches yet: add them in Settings → Audio.</span>
            )}
            {routing.patches.map(patch => (
              <Strip
                key={patch.id}
                kind="patch"
                testId={`patch-${patch.id}`}
                name={patch.name}
                detail={patchChannelsLabel(patch.channels)}
                db={patch.gainDb}
                muted={patch.muted}
                floor={FADER_FLOOR_DB}
                top={FADER_TOP_DB}
                peaks={busPeaks(patch.id, patch.channels.length)}
                onDb={db => setPatch(patch.id, { gainDb: db })}
                onMute={muted => setPatch(patch.id, { muted })}
              />
            ))}
          </div>
          <div className="mixer-group-title">Outputs and master</div>
          <div className="mixer-strips">
            {Array.from({ length: outputs }, (_, output) => {
              const fader = outputFader(routing, output)
              return (
                <Strip
                  key={output}
                  kind="output"
                  testId={`output-${output + 1}`}
                  name={`Out ${output + 1}`}
                  detail="output"
                  db={fader.gainDb}
                  muted={fader.muted}
                  floor={FADER_FLOOR_DB}
                  top={FADER_TOP_DB}
                  peaks={[meters?.peaks[output] ?? 0]}
                  onDb={db => setOutput(output, { gainDb: db })}
                  onMute={muted => setOutput(output, { muted })}
                />
              )
            })}
            <Strip
              kind="master"
              testId="master"
              name="Master"
              detail="this machine"
              db={master}
              floor={MASTER_FLOOR_DB}
              top={MASTER_TOP_DB}
              peaks={(meters?.peaks ?? [0, 0]).slice(0, 2)}
              onDb={setMasterDb}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
