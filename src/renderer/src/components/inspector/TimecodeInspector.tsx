import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { LastRun } from './LastRun'
import { NumberField, TextField } from '../common/Field'
import { controlTimecode, timecodeLengthMs } from '../../engine/timecodeCue'
import { useTimecodeStatus } from '../../engine/timecodeStatus'
import { formatDuration } from '../../utils/cueDefaults'
import {
  TIMECODE_RATES,
  formatFrames,
  formatTimecode,
  parseTimecode,
  parseTimecodeFrames,
  rateInfo,
  type TimecodeRate
} from '../../../../shared/timecode'
import type { TimecodeCue } from '../../../../shared/cue'
import '../timecode/Timecode.css'

interface Props { cue: TimecodeCue }

/** Why a typed label is not one this rate has, or null when it is. */
function labelProblem(text: string, rate: TimecodeRate, optional: boolean): string | null {
  if (optional && text.trim() === '') return null
  return parseTimecode(text, rate) === null ? `Not a frame at ${rateInfo(rate).label}` : null
}

/**
 * A timecode cue: the clock it runs, where it starts and stops, and the wires it goes out
 * on. While it runs, the transport for that clock is here too — pause, resume, and a locate
 * to any frame — because a rehearsal goes back to the top of the scene far more often than
 * it runs a show from the top.
 */
export function TimecodeInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<TimecodeCue>) => update(cue.id, patch)
  const [ports, setPorts] = useState<string[]>([])
  const [locate, setLocate] = useState('')
  const { generators } = useTimecodeStatus()
  const running = generators.find(gen => gen.cueId === cue.id) ?? null

  useEffect(() => {
    window.cuerunner.midi.listPorts().then(setPorts).catch(() => {})
  }, [])

  // A rate change keeps the labels the operator typed when they still name a frame there,
  // and moves them to the nearest earlier one that does when they do not (00:01:00:00 is
  // not a drop-frame label; 00:01:00;02 is).
  const changeRate = (rate: TimecodeRate) => {
    const carry = (text: string): string => {
      if (text.trim() === '') return text
      const frames = parseTimecodeFrames(text, cue.rate)
      if (frames === null) return text
      const kept = parseTimecode(text, rate)
      return kept !== null ? formatTimecode(kept, rate) : formatFrames(frames, rate)
    }
    set({ rate, startTimecode: carry(cue.startTimecode), endTimecode: carry(cue.endTimecode) })
  }

  const lengthMs = timecodeLengthMs(cue)

  return (
    <div>
      <div className="field-row">
        <label htmlFor="timecode-rate">Rate</label>
        <select id="timecode-rate" value={cue.rate} onChange={e => changeRate(e.target.value as TimecodeRate)}>
          {TIMECODE_RATES.map(rate => <option key={rate} value={rate}>{rateInfo(rate).label}</option>)}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor="timecode-jam">Start from</label>
        <select
          id="timecode-jam"
          value={cue.jamSync ? 'jam' : 'start'}
          onChange={e => set({ jamSync: e.target.value === 'jam' })}
        >
          <option value="start">The start time below</option>
          <option value="jam">The incoming timecode (jam sync)</option>
        </select>
      </div>

      {!cue.jamSync && (
        <div className="field-row">
          <label htmlFor="timecode-start">Start</label>
          <TextField
            id="timecode-start"
            className="timecode-start"
            value={cue.startTimecode}
            validate={text => labelProblem(text, cue.rate, false)}
            title="Where the clock starts: hours, minutes, seconds, frames."
            onValue={text => {
              const tc = parseTimecode(text, cue.rate)
              if (tc !== null) set({ startTimecode: formatTimecode(tc, cue.rate) })
            }}
          />
        </div>
      )}

      <div className="field-row">
        <label htmlFor="timecode-end">End</label>
        <TextField
          id="timecode-end"
          className="timecode-end"
          value={cue.endTimecode}
          placeholder="runs until stopped"
          validate={text => labelProblem(text, cue.rate, true)}
          title="Where the clock stops itself. Empty runs until the cue is stopped."
          onValue={text => {
            if (text.trim() === '') { set({ endTimecode: '' }); return }
            const tc = parseTimecode(text, cue.rate)
            if (tc !== null) set({ endTimecode: formatTimecode(tc, cue.rate) })
          }}
        />
        {lengthMs !== null && <span className="inspector-hint">{formatDuration(lengthMs)}</span>}
      </div>

      <div className="field-row">
        <label htmlFor="timecode-mtc">MTC</label>
        <input id="timecode-mtc" type="checkbox" checked={cue.mtc} onChange={e => set({ mtc: e.target.checked })} />
        <select
          aria-label="MTC port"
          value={cue.mtcPortName}
          disabled={!cue.mtc}
          onChange={e => set({ mtcPortName: e.target.value })}
        >
          <option value="">— the show’s output port —</option>
          {cue.mtcPortName !== '' && !ports.includes(cue.mtcPortName) && (
            <option value={cue.mtcPortName}>{cue.mtcPortName} (not connected)</option>
          )}
          {ports.map(port => <option key={port} value={port}>{port}</option>)}
        </select>
      </div>

      <div className="field-row">
        <label htmlFor="timecode-ltc">LTC</label>
        <input id="timecode-ltc" type="checkbox" checked={cue.ltc} onChange={e => set({ ltc: e.target.checked })} />
        <NumberField
          aria-label="LTC output channel"
          className="timecode-ltc-channel"
          min={1}
          max={32}
          value={cue.ltcChannel + 1}
          disabled={!cue.ltc}
          title="The output channel the LTC is written to. Give it a channel of its own: anything else on it is heard by the reader as noise."
          onValue={channel => { if (channel !== null) set({ ltcChannel: channel - 1 }) }}
        />
        <NumberField
          aria-label="LTC level, dBFS"
          min={-40}
          max={0}
          value={cue.ltcLevelDb}
          disabled={!cue.ltc}
          title="LTC's level, dBFS. −12 to −18 suits most line inputs."
          onValue={level => { if (level !== null) set({ ltcLevelDb: level }) }}
        />
      </div>

      <div className="field-row">
        <label htmlFor="timecode-artnet">Art-Net</label>
        <input id="timecode-artnet" type="checkbox" checked={cue.artnet} onChange={e => set({ artnet: e.target.checked })} />
        <TextField
          aria-label="Art-Net address"
          className="timecode-artnet-host"
          value={cue.artnetHost}
          disabled={!cue.artnet}
          title="Where ArtTimeCode goes: a broadcast address, a node, or host:port."
          onValue={artnetHost => set({ artnetHost })}
        />
      </div>

      {running !== null && (
        <>
          <div className="field-row">
            <label>Clock</label>
            <span className="timecode-running-value">
              {formatFrames(Math.floor(running.frames), running.rate)}{running.running ? '' : ' (paused)'}
            </span>
          </div>
          <div className="field-row">
            <label htmlFor="timecode-locate">Locate</label>
            <TextField
              id="timecode-locate"
              when="typed"
              value={locate}
              placeholder={formatFrames(Math.floor(running.frames), running.rate)}
              validate={text => labelProblem(text, running.rate, true)}
              onValue={setLocate}
            />
            <div className="timecode-controls">
              <button
                className="inspector-btn timecode-locate-go"
                disabled={parseTimecodeFrames(locate, running.rate) === null}
                onClick={() => {
                  const frames = parseTimecodeFrames(locate, running.rate)
                  if (frames !== null) void controlTimecode(cue.id, { action: 'locate', frames })
                }}
              >Locate</button>
              <button
                className="inspector-btn timecode-pause"
                onClick={() => void controlTimecode(cue.id, { action: running.running ? 'pause' : 'resume' })}
              >{running.running ? 'Pause' : 'Resume'}</button>
            </div>
          </div>
        </>
      )}

      <p className="inspector-hint">
        {cue.jamSync
          ? 'Starts on the incoming clock and keeps to it; if it drops out, this one carries on.'
          : 'One clock, sent on every output ticked: they cannot disagree.'}
      </p>

      <LastRun cueId={cue.id} />
    </div>
  )
}
