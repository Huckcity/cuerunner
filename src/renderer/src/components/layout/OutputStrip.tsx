import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { audioEngine } from '../../engine/audioEngineClient'
import { masterDb, setMasterDb, subscribeMaster } from '../../utils/masterLevel'
import { MixerPanel } from '../mixer/MixerPanel'
import './OutputStrip.css'

/** How often the meter is read: a reading per frame of a 20 Hz display, which a meter's eye needs. */
export const METER_POLL_MS = 50

/** The floor of the meter and the fader, dB: below it is silence. */
export const FLOOR_DB = -60
/** The top of the fader, dB: the engine holds the master at +6 dB. */
export const TOP_DB = 6

/** How fast a meter bar falls back, per reading: a peak is seen, then lets go. */
const FALL_PER_READING = 0.82

/** A level in dB as the engine's linear gain: the floor is silence. */
export function gainFromDb(db: number): number {
  return db <= FLOOR_DB ? 0 : Math.pow(10, db / 20)
}

/** A linear peak as how far along the meter it reads, 0 to 1, on a dB scale from the floor. */
export function meterFraction(peak: number): number {
  if (!(peak > 0)) return 0
  const db = 20 * Math.log10(peak)
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
}

/** The fader's readout: "0.0 dB", "−12.5 dB", "−∞". */
export function formatDb(db: number): string {
  if (db <= FLOOR_DB) return '−∞'
  const text = Math.abs(db).toFixed(1)
  return db < 0 ? `−${text} dB` : db > 0 ? `+${text} dB` : `${text} dB`
}

/**
 * What leaves the engine, and how loud: a meter per output pair's channel, and the master
 * level. The master is this machine's — the level a room wants is the room's, not the show's —
 * so it is kept beside the window's other places and sent to every engine this window meets,
 * a replacement after a crash included. The meter reads the output after the master, so a
 * fader pulled down is a meter that falls with it.
 */
export function OutputStrip() {
  // The master is shared with the mixer's master strip (utils/masterLevel.ts).
  const db = useSyncExternalStore(subscribeMaster, masterDb)
  const setDb = setMasterDb
  const [mixerOpen, setMixerOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const barRefs = useRef<Array<HTMLSpanElement | null>>([])
  const levels = useRef<number[]>([0, 0])

  // The level goes to the engine now, and again to any engine that replaces this one.
  useEffect(() => {
    const send = (): void => { void audioEngine.master(gainFromDb(db)).catch(() => {}) }
    send()
    return audioEngine.onSessionChange(send)
  }, [db])

  useEffect(() => {
    let stopped = false
    const read = async (): Promise<void> => {
      if (document.visibilityState === 'hidden') return
      try {
        const meters = await audioEngine.meters()
        if (stopped) return
        const peaks = meters.peaks.slice(0, 2)
        let clip = false
        peaks.forEach((peak, channel) => {
          const fraction = meterFraction(peak)
          const shown = Math.max(fraction, (levels.current[channel] ?? 0) * FALL_PER_READING)
          levels.current[channel] = shown
          const bar = barRefs.current[channel]
          // The cover over the scale, drawn back by the reading.
          if (bar) bar.style.transform = `scaleX(${1 - shown})`
          if (peak >= 1) clip = true
        })
        if (clip) setClipped(true)
      } catch {
        // No engine, no reading: the bars stay where they fell to.
      }
    }
    const id = window.setInterval(() => { void read() }, METER_POLL_MS)
    return () => { stopped = true; window.clearInterval(id) }
  }, [])

  return (
    <div className="output-strip">
      <button
        className="output-meter"
        data-clipped={clipped}
        onClick={() => setClipped(false)}
        title={clipped ? 'The output reached full scale — press to clear' : 'What leaves the engine, after the master'}
        aria-label="Output meter"
      >
        {[0, 1].map(channel => (
          <span key={channel} className="output-meter-track">
            <span className="output-meter-bar" ref={node => { barRefs.current[channel] = node }} />
          </span>
        ))}
      </button>
      <input
        type="range"
        className="master-fader"
        aria-label="Master level"
        min={FLOOR_DB}
        max={TOP_DB}
        step={0.5}
        value={db}
        onChange={e => setDb(Number(e.target.value))}
        onDoubleClick={() => setDb(0)}
        title="Master level — double-click for 0 dB"
      />
      <span className="master-readout" onDoubleClick={() => setDb(0)}>{formatDb(db)}</span>
      <button className="mixer-open" onClick={() => setMixerOpen(true)} title="The mixer: every output, every patch and the master">
        Mixer
      </button>
      {mixerOpen && <MixerPanel onClose={() => setMixerOpen(false)} />}
    </div>
  )
}
