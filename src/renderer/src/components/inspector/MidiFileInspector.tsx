import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { MidiFileCue } from '../../../../shared/cue'
import type { SmfSummary } from '../../../../shared/smf'
import {
  MIDI_FILE_DRUM_CHANNEL,
  MIDI_FILE_IDENTITY_MAP,
  MIDI_FILE_RATE_MAX,
  MIDI_FILE_RATE_MIN,
  MIDI_FILE_TRANSPOSE_MAX,
  midiFileOptionsOf,
  midiFilePassMs,
  midiFileTotalMs
} from '../../../../shared/midiFile'
import { LastRun } from './LastRun'
import { ResetButton } from './ResetButton'
import { NumberField, TextField } from '../common/Field'
import { MIDI_FILE_DEFAULTS, cueNameFromFile, formatDuration } from '../../utils/cueDefaults'
import { cueEngine } from '../../engine/CueEngine'
import './MidiFileInspector.css'

interface Props { cue: MidiFileCue; tab: string }

/** What a new cue is called until somebody, or a file, names it. */
const DEFAULT_NAME = 'MIDI File'

/**
 * The cue's length as the row shows it and a group sums it: the whole run, every pass — or
 * one pass, for a cue that loops until it is stopped and so has no whole.
 */
function runLength(summary: SmfSummary, cue: MidiFileCue): number {
  const options = midiFileOptionsOf(cue)
  return Math.round(midiFileTotalMs(summary.durationMs, options) ?? midiFilePassMs(summary.durationMs, options))
}

/** The file's facts on one line: format, tracks, tempo, length. */
function summaryLine(summary: SmfSummary): string {
  const parts = [`Format ${summary.format}`, `${summary.tracks.length} track${summary.tracks.length === 1 ? '' : 's'}`]
  if (summary.initialBpm !== null) {
    const changes = summary.tempoChanges > 1 ? ` (${summary.tempoChanges} tempo changes)` : ''
    parts.push(`${Math.round(summary.initialBpm * 10) / 10} BPM${changes}`)
  } else if (summary.timing.kind === 'smpte') {
    parts.push(`SMPTE ${Math.round(summary.timing.framesPerSecond * 100) / 100} fps`)
  }
  parts.push(formatDuration(Math.round(summary.durationMs)))
  return parts.join(' · ')
}

/**
 * A MIDI File cue: which file, to which port, how fast, which part of it and how often — and,
 * on its second tab, which of its channels reach the port as which, and how far its notes
 * move. The file's own facts are read back from main as it parsed them, because a MIDI file
 * gives an operator no other way to know they picked the right one.
 */
export function MidiFileInspector({ cue, tab }: Props) {
  const update = useStore(s => s.updateCue)
  const running = useStore(s => s.running.get(cue.id))
  const set = (patch: Partial<MidiFileCue>) => update(cue.id, patch)

  const [ports, setPorts] = useState<string[]>([])
  const [summary, setSummary] = useState<SmfSummary | null>(null)
  // Why main cannot play this cue's file, in its own words; null for a file it read, and
  // for no file at all.
  const [fault, setFault] = useState<string | null>(null)
  const [reading, setReading] = useState(false)

  useEffect(() => {
    window.cuerunner.midi.listPorts().then(setPorts)
  }, [])

  useEffect(() => {
    let current = true
    setSummary(null)
    setFault(null)
    if (!cue.filePath) return
    window.cuerunner.midi.fileInspect({ filePath: cue.filePath }).then(result => {
      if (!current) return
      if (result.ok) setSummary(result.summary)
      else setFault(result.error)
    })
    return () => { current = false }
  }, [cue.filePath])

  /** An edit that changes how long the cue runs carries the new length with it. */
  const setTimed = (patch: Partial<MidiFileCue>) => {
    const next = { ...cue, ...patch }
    set(summary === null ? patch : { ...patch, duration: runLength(summary, next) })
  }

  const pickFile = async () => {
    const path = await window.cuerunner.midi.pickFile()
    if (!path) return
    setReading(true)
    try {
      const result = await window.cuerunner.midi.fileInspect({ filePath: path })
      // A cue nobody has named takes its file's name, as an audio cue does.
      const named = cue.name === DEFAULT_NAME ? { name: cueNameFromFile(path) } : {}
      if (result.ok) {
        set({ ...named, filePath: path, duration: runLength(result.summary, cue) })
      } else {
        // Chosen all the same: the operator may be about to fix the file, and the fault
        // says why it will not play until they do.
        set({ ...named, filePath: path, duration: 0 })
      }
    } finally {
      setReading(false)
    }
  }

  if (tab === 'Channels') {
    const used = new Set(summary?.channels ?? [])
    const mapAtDefault = JSON.stringify(cue.channelMap) === JSON.stringify(MIDI_FILE_IDENTITY_MAP)
    return (
      <div>
        <div className="field-row">
          <label>Transpose</label>
          <NumberField
            when="typed"
            min={-MIDI_FILE_TRANSPOSE_MAX}
            max={MIDI_FILE_TRANSPOSE_MAX}
            value={cue.transpose}
            title="Semitones every note moves by. A note moved off the keyboard is not sent."
            onValue={transpose => { if (transpose !== null) set({ transpose }) }}
          />
          <span className="inspector-readout">st</span>
          <ResetButton label="Transpose" value={cue.transpose} defaultValue={MIDI_FILE_DEFAULTS.transpose}
            onReset={() => set({ transpose: MIDI_FILE_DEFAULTS.transpose })} />
        </div>
        <div className="field-row">
          <label htmlFor="midi-file-transpose-drums">Channel {MIDI_FILE_DRUM_CHANNEL} too</label>
          <input
            id="midi-file-transpose-drums"
            type="checkbox"
            checked={cue.transposeDrums}
            onChange={e => set({ transposeDrums: e.target.checked })}
          />
          <span className="inspector-readout midi-file-wide-readout">
            {cue.transposeDrums ? 'its notes move too' : 'its drums stay where they are'}
          </span>
        </div>

        <div className="field-section-title">Channel map</div>
        <p className="inspector-hint">Each of the file’s channels goes out as the one chosen, or not at all.</p>
        {cue.channelMap.map((out, index) => {
          const channel = index + 1
          return (
            <div className="field-row midi-file-channel" key={channel} data-channel={channel}>
              <label htmlFor={`midi-file-channel-${channel}`}>Ch {channel}</label>
              <select
                id={`midi-file-channel-${channel}`}
                value={out}
                onChange={e => {
                  const channelMap = [...cue.channelMap]
                  channelMap[index] = Number(e.target.value)
                  set({ channelMap })
                }}
              >
                <option value={0}>Not sent</option>
                {MIDI_FILE_IDENTITY_MAP.map(target => (
                  <option key={target} value={target}>
                    {target === channel ? `Ch ${target} (as written)` : `Ch ${target}`}
                  </option>
                ))}
              </select>
              <span className="inspector-readout midi-file-channel-used">{used.has(channel) ? 'in file' : ''}</span>
            </div>
          )
        })}
        <button
          className="inspector-btn midi-file-map-reset"
          disabled={mapAtDefault}
          onClick={() => set({ channelMap: [...MIDI_FILE_IDENTITY_MAP] })}
        >Every channel as written</button>
      </div>
    )
  }

  const separator = Math.max(cue.filePath.lastIndexOf('/'), cue.filePath.lastIndexOf('\\'))
  const fileName = cue.filePath.slice(separator + 1)
  const folder = separator > 0 ? cue.filePath.slice(0, separator) : ''
  const toSeconds = (ms: number) => Math.round(ms / 100) / 10
  const fromSeconds = (s: number) => Math.round(s * 1000)
  // The row is the record of a hold, whoever made it — this button, the Active tab, a Control
  // cue, the show's own PAUSE — so the button reads it rather than keeping its own.
  const isRunning = running?.state === 'playing' || running?.state === 'paused'
  const held = running?.state === 'paused'
  // Held with the whole show: only the show's RESUME lets it go, so this cue's own is not offered.
  const heldWithShow = held && cueEngine.isHeld()

  return (
    <div>
      <div className="field-row">
        <label>File</label>
        <input value={fileName} readOnly
          className="midi-file-name"
          title={cue.filePath}
          data-path={cue.filePath}
          placeholder={reading ? 'Reading file…' : 'No file selected'}
          style={{ flex: 1, cursor: 'pointer' }}
          onClick={pickFile} />
        <button onClick={pickFile} disabled={reading} className="inspector-btn">Browse</button>
      </div>
      {folder !== '' && (
        <p className="inspector-hint audio-file-folder" title={folder}>{folder}</p>
      )}
      {fault !== null && (
        <p className="inspector-hint audio-file-fault midi-file-fault" role="status">
          This file cannot be played: {fault}
        </p>
      )}
      {summary !== null && (
        <p className="inspector-hint midi-file-summary">{summaryLine(summary)}</p>
      )}

      <div className="field-row">
        <label>MIDI Port</label>
        {ports.length > 0 ? (
          <select value={cue.portName} onChange={e => set({ portName: e.target.value })}>
            <option value="">— the show’s output port —</option>
            {ports.map(port => <option key={port} value={port}>{port}</option>)}
            {cue.portName !== '' && !ports.includes(cue.portName) && (
              <option value={cue.portName}>{cue.portName} (not connected)</option>
            )}
          </select>
        ) : (
          <TextField
            when="typed"
            value={cue.portName}
            placeholder="No MIDI ports found"
            onValue={portName => set({ portName })}
          />
        )}
        <button
          onClick={() => window.cuerunner.midi.listPorts().then(setPorts)}
          title="Refresh ports"
          className="inspector-btn"
        >↻</button>
      </div>

      <div className="field-section-title">Playback</div>
      <div className="field-row">
        <label>Rate</label>
        <input type="range" min={MIDI_FILE_RATE_MIN} max={MIDI_FILE_RATE_MAX} step={0.05} value={cue.playbackRate}
          aria-label="Rate"
          onChange={e => setTimed({ playbackRate: Number(e.target.value) })}
          style={{ flex: 1, accentColor: 'var(--accent-blue)' }} />
        <span className="inspector-readout">{cue.playbackRate.toFixed(2)}x</span>
        <ResetButton label="Rate" value={cue.playbackRate} defaultValue={MIDI_FILE_DEFAULTS.playbackRate}
          onReset={() => setTimed({ playbackRate: MIDI_FILE_DEFAULTS.playbackRate })} />
      </div>
      <div className="field-row">
        <label>Start time (s)</label>
        <NumberField when="typed" min={0} step={0.1} value={toSeconds(cue.startTime)}
          onValue={seconds => { if (seconds !== null) setTimed({ startTime: fromSeconds(seconds) }) }} />
        <ResetButton label="Start time" value={cue.startTime} defaultValue={MIDI_FILE_DEFAULTS.startTime}
          onReset={() => setTimed({ startTime: MIDI_FILE_DEFAULTS.startTime })} />
      </div>
      <div className="field-row">
        <label>End time (s)</label>
        <NumberField when="typed" min={0} step={0.1}
          value={cue.endTime !== null ? toSeconds(cue.endTime) : null}
          placeholder="play to end"
          onValue={seconds => setTimed({ endTime: seconds === null ? null : fromSeconds(seconds) })} />
        <ResetButton label="End time" value={cue.endTime} defaultValue={MIDI_FILE_DEFAULTS.endTime}
          onReset={() => setTimed({ endTime: MIDI_FILE_DEFAULTS.endTime })} />
      </div>
      <div className="field-row">
        <label>Loop count</label>
        <NumberField when="typed" min={-1} value={cue.loopCount}
          onValue={loopCount => { if (loopCount !== null) setTimed({ loopCount }) }} />
        <ResetButton label="Loop count" value={cue.loopCount} defaultValue={MIDI_FILE_DEFAULTS.loopCount}
          onReset={() => setTimed({ loopCount: MIDI_FILE_DEFAULTS.loopCount })} />
      </div>
      <p className="inspector-hint" style={{ marginTop: 0 }}>0 = play once, -1 = until stopped</p>
      {summary !== null && (
        <p className="inspector-hint midi-file-length">
          {cue.loopCount < 0
            ? `Each pass takes ${formatDuration(runLength(summary, cue))}; it loops until stopped.`
            : `Runs ${formatDuration(runLength(summary, cue))} at this rate.`}
        </p>
      )}

      {isRunning && (
        <div className="field-row">
          <label>Running</label>
          <button
            className="inspector-btn midi-file-hold"
            data-held={held}
            disabled={heldWithShow}
            title={heldWithShow ? 'Held with the show: RESUME lets it go' : undefined}
            onClick={() => cueEngine.togglePauseCue(cue.id)}
          >{held ? 'Resume' : 'Pause'}</button>
        </div>
      )}

      {summary !== null && (
        <>
          <div className="field-section-title">Tracks</div>
          <ol className="midi-file-tracks">
            {summary.tracks.map((track, index) => (
              <li key={index} className="midi-file-track" data-track={index + 1}>
                <span className="midi-file-track-name">{track.name || `Track ${index + 1}`}</span>
                <span className="midi-file-track-counts">
                  {track.notes} notes · {track.channelEvents} events
                  {track.sysex > 0 ? ` · ${track.sysex} SysEx` : ''}
                </span>
                <span className="midi-file-track-channels">
                  {track.channels.length === 0 ? 'no channels' : `ch ${track.channels.join(', ')}`}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      <LastRun cueId={cue.id} />
    </div>
  )
}
