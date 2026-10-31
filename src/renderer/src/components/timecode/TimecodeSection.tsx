import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { NumberField } from '../common/Field'
import { ServiceStatus } from '../common/ServiceStatus'
import { configureTimecode, useTimecodeSettings } from '../../engine/timecodeStatus'
import { TimecodePanel } from './TimecodeDisplay'
import {
  TIMECODE_HOLD_MAX_MS,
  TIMECODE_RATES,
  TIMECODE_TOLERANCE_MAX_FRAMES,
  framesToTimecode,
  formatTimecode,
  parseTimecode,
  rateInfo,
  timecodeToFrames,
  type TimecodeOnStop,
  type TimecodeSettings,
  type TimecodeShowSettings,
  type TimecodeSourceKind
} from '../../../../shared/timecode'
import type { TimecodeInputs } from '../../../../shared/ipc/timecode'
import './Timecode.css'

const SOURCES: { id: TimecodeSourceKind; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'mtc', label: 'MTC (MIDI Time Code)' },
  { id: 'ltc', label: 'LTC (an audio input)' },
  { id: 'artnet', label: 'Art-Net (ArtTimeCode)' }
]

/** The offset as a signed label at 30 fps labels: `-00:00:10:00`. */
function formatOffset(frames: number): string {
  const sign = frames < 0 ? '-' : ''
  return sign + formatTimecode(framesToTimecode(Math.abs(frames), '30'), '30')
}

function parseOffset(text: string): number | null {
  const trimmed = text.trim()
  const negative = trimmed.startsWith('-')
  const tc = parseTimecode(negative ? trimmed.slice(1) : trimmed, '30')
  if (tc === null) return null
  const frames = timecodeToFrames(tc, '30')
  return negative ? -frames : frames
}

/**
 * Where this machine hears the show's clock, and what the cue list does with it. The
 * settings are the machine's, kept in the user-data folder: which port the clock is on and which
 * input the LTC cable is in belong to this rack, not to the show that is loaded on it.
 */
export function TimecodeSection(): React.JSX.Element {
  const settings = useTimecodeSettings()
  // How the show follows the clock is the show's own: it is saved in the file, dirties it, and
  // goes back with undo. Where the clock arrives is the machine's, above.
  const show = useStore(s => s.timecode)
  const setShow = useStore(s => s.setTimecode)
  const service = useStore(s => s.showServices.find(candidate => candidate.id === 'timecode'))
  const [inputs, setInputs] = useState<TimecodeInputs>({ midi: [], audio: [] })
  const [failed, setFailed] = useState<string | null>(null)
  const [offsetText, setOffsetText] = useState<string | null>(null)

  useEffect(() => {
    window.cuerunner.timecode.inputs().then(setInputs).catch(() => {})
  }, [])

  if (settings === null) return <p className="inspector-hint">Reading this machine’s settings…</p>

  const update = (patch: Partial<TimecodeSettings>): void => {
    setFailed(null)
    configureTimecode(patch).catch(error => setFailed(error instanceof Error ? error.message : String(error)))
  }

  return (
    <>
      <section className="settings-block" data-enabled={settings.source !== 'none'}>
        <div className="settings-block-head">
          <div className="settings-block-text">
            <h3 className="settings-block-title">Incoming timecode</h3>
            <p className="settings-block-blurb">The clock the cue list follows.</p>
          </div>
          <ServiceStatus service={service} />
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-source">Source</label>
          <select
            id="settings-timecode-source"
            value={settings.source}
            onChange={e => update({ source: e.target.value as TimecodeSourceKind })}
          >
            {SOURCES.map(source => <option key={source.id} value={source.id}>{source.label}</option>)}
          </select>
        </div>

        {settings.source === 'mtc' && (
          <div className="field-row">
            <label htmlFor="settings-timecode-mtc-port">MIDI input</label>
            <select
              id="settings-timecode-mtc-port"
              value={settings.mtcPort}
              onChange={e => update({ mtcPort: e.target.value })}
            >
              <option value="">— the first one there is —</option>
              {settings.mtcPort !== '' && !inputs.midi.includes(settings.mtcPort) && (
                <option value={settings.mtcPort}>{settings.mtcPort} (not connected)</option>
              )}
              {inputs.midi.map(port => <option key={port} value={port}>{port}</option>)}
            </select>
          </div>
        )}

        {settings.source === 'ltc' && (
          <>
            <div className="field-row">
              <label htmlFor="settings-timecode-ltc-device">Audio input</label>
              <select
                id="settings-timecode-ltc-device"
                value={settings.ltcDevice}
                onChange={e => update({ ltcDevice: e.target.value })}
              >
                <option value="">— the default input —</option>
                {settings.ltcDevice !== '' && !inputs.audio.includes(settings.ltcDevice) && (
                  <option value={settings.ltcDevice}>{settings.ltcDevice} (not connected)</option>
                )}
                {inputs.audio.map(device => <option key={device} value={device}>{device}</option>)}
              </select>
            </div>
            <div className="field-row">
              <label htmlFor="settings-timecode-ltc-channel">Channel</label>
              <NumberField
                id="settings-timecode-ltc-channel"
                min={1}
                max={32}
                value={settings.ltcChannel + 1}
                onValue={channel => { if (channel !== null) update({ ltcChannel: channel - 1 }) }}
              />
            </div>
          </>
        )}

        {settings.source === 'artnet' && (
          <div className="field-row">
            <label htmlFor="settings-timecode-artnet-port">UDP port</label>
            <NumberField
              id="settings-timecode-artnet-port"
              className="settings-timecode-artnet-port"
              min={1}
              max={65535}
              value={settings.artnetPort}
              onValue={artnetPort => { if (artnetPort !== null) update({ artnetPort }) }}
            />
          </div>
        )}


        <TimecodePanel />
      </section>

      <section className="settings-block" data-enabled={show.chase}>
        <div className="settings-block-head">
          <div className="settings-block-text">
            <h3 className="settings-block-title">This show</h3>
            <p className="settings-block-blurb">How the cue list follows the clock. Saved with the show.</p>
          </div>
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-rate">Rate</label>
          <select
            id="settings-timecode-rate"
            value={show.rate}
            onChange={e => setShow({ rate: e.target.value as TimecodeShowSettings['rate'] })}
          >
            <option value="auto">Detect from the stream</option>
            {TIMECODE_RATES.map(rate => <option key={rate} value={rate}>{rateInfo(rate).label}</option>)}
          </select>
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-hold">Freewheel</label>
          <NumberField
            id="settings-timecode-hold"
            min={0}
            max={TIMECODE_HOLD_MAX_MS}
            value={show.holdMs}
            title="How long a clock that stops arriving is carried on before it is lost, ms."
            onValue={holdMs => { if (holdMs !== null) setShow({ holdMs }) }}
          />
          <span className="inspector-hint">ms</span>
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-chase">Chase</label>
          <input
            id="settings-timecode-chase"
            type="checkbox"
            checked={show.chase}
            onChange={e => setShow({ chase: e.target.checked })}
          />
          <span className="inspector-hint">A locate puts each cue where the clock is.</span>
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-on-stop">When it stops</label>
          <select
            id="settings-timecode-on-stop"
            value={show.onStop}
            disabled={!show.chase}
            onChange={e => setShow({ onStop: e.target.value as TimecodeOnStop })}
          >
            <option value="hold">Hold the cues, and pick them up again</option>
            <option value="stop">Stop the cues</option>
            <option value="continue">Let the cues run on</option>
          </select>
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-offset">Offset</label>
          <input
            id="settings-timecode-offset"
            value={offsetText ?? formatOffset(show.offsetFrames)}
            title="Added to the incoming clock before any cue reads it, as hh:mm:ss:ff at 30 fps labels; a minus sign subtracts."
            onChange={e => setOffsetText(e.target.value)}
            onBlur={() => {
              if (offsetText === null) return
              const frames = parseOffset(offsetText)
              setOffsetText(null)
              if (frames !== null) setShow({ offsetFrames: frames })
            }}
          />
        </div>

        <div className="field-row">
          <label htmlFor="settings-timecode-tolerance">Tolerance</label>
          <NumberField
            id="settings-timecode-tolerance"
            min={0}
            max={TIMECODE_TOLERANCE_MAX_FRAMES}
            value={show.toleranceFrames}
            title="How many frames the clock may skip and still fire what it skipped."
            onValue={toleranceFrames => { if (toleranceFrames !== null) setShow({ toleranceFrames }) }}
          />
          <span className="inspector-hint">frames</span>
        </div>
      </section>

      {failed !== null && <p className="inspector-hint settings-refusal">{failed}</p>}
    </>
  )
}
