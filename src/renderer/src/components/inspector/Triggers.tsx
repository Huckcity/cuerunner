import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { cueTriggers } from '../../engine/triggers'
import type { Cue, CueTrigger, MidiMessageKind, TriggerMidiMessage } from '../../types/cue'
import type { ShowEvent } from '../../types/show'
import './Triggers.css'

/** The four MIDI messages a cue can answer to, in the order the picker offers them. */
const MIDI_KINDS = ['noteOn', 'noteOff', 'cc', 'programChange'] as const
type TriggerMidiKind = (typeof MIDI_KINDS)[number]

/** The one number each kind carries, named the way the operator thinks of it. */
const VALUE_LABEL: Record<TriggerMidiKind, string> = {
  noteOn: 'Note',
  noteOff: 'Note',
  cc: 'Controller',
  programChange: 'Program'
}

/** A MIDI message that can answer a trigger; sysex has no identity to match on. */
type TriggerableMidi = Exclude<MidiMessageKind, { kind: 'sysex' }>

function toTriggerMessage(message: TriggerableMidi): TriggerMidiMessage {
  switch (message.kind) {
    case 'noteOn':
      return { kind: 'noteOn', channel: message.channel, note: message.note }
    case 'noteOff':
      return { kind: 'noteOff', channel: message.channel, note: message.note }
    case 'cc':
      return { kind: 'cc', channel: message.channel, controller: message.controller }
    case 'programChange':
      return { kind: 'programChange', channel: message.channel, program: message.program }
  }
}

/** How a trigger reads in the list: `OSC /eos/cue/12/fire`, `MIDI noteOn ch1 note 60 on "IAC Bus 1"`. */
export function describeTrigger(trigger: CueTrigger): string {
  if (trigger.kind === 'osc') return `OSC ${trigger.address}`

  const { message, device } = trigger
  const detail =
    message.kind === 'cc' ? `controller ${message.controller}` :
    message.kind === 'programChange' ? `program ${message.program}` :
    `note ${message.note}`
  return `MIDI ${message.kind} ch${message.channel} ${detail} on "${device}"`
}

/** The trigger a learning session is looking for, or null when the event is not one. */
function triggerFromEvent(learning: 'osc' | 'midi', event: ShowEvent): CueTrigger | null {
  if (learning === 'osc') {
    return event.kind === 'osc'
      ? { id: crypto.randomUUID(), kind: 'osc', address: event.address }
      : null
  }
  // Sysex has no channel and no note, so it can never become a trigger; learning
  // stays open and the next real message is the one that counts.
  if (event.kind !== 'midi') return null
  const message = event.message
  if (message.kind === 'sysex') return null
  return {
    id: crypto.randomUUID(),
    kind: 'midi',
    device: event.device,
    message: toTriggerMessage(message)
  }
}

function clamp(value: string, min: number, max: number): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

function LearningStrip({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="trigger-learning">
      <span>Waiting for a message…</span>
      <button type="button" className="inspector-btn trigger-learn-cancel" onClick={onCancel}>
        Cancel
      </button>
    </div>
  )
}

interface Props { cue: Cue }

export function Triggers({ cue }: Props) {
  const updateCue = useStore(s => s.updateCue)
  const showEvents = useStore(s => s.showEvents)

  const [oscAddress, setOscAddress] = useState('')
  const [device, setDevice] = useState('')
  const [ports, setPorts] = useState<string[]>([])
  const [midiKind, setMidiKind] = useState<TriggerMidiKind>('noteOn')
  const [channel, setChannel] = useState(1)
  const [value, setValue] = useState(60)
  const [learning, setLearning] = useState<'osc' | 'midi' | null>(null)

  // The learn effect fires on the event river, so it must write against the cue as it
  // is now rather than whatever render closure it was created in.
  const cueRef = useRef(cue)
  cueRef.current = cue
  // How much of the river has been read. Events already in the log when learning starts
  // must not answer it, and a drained river must not be rescanned on every re-render.
  const readRef = useRef(0)

  const triggers = cueTriggers(cue)

  useEffect(() => {
    let live = true
    window.winslab.midi.listInputPorts().then(names => {
      // Keep the same array when the rig has not changed, so opening the tab is not
      // a state update for nothing.
      if (live) setPorts(prev =>
        prev.length === names.length && prev.every((name, i) => name === names[i]) ? prev : names)
    })
    return () => { live = false }
  }, [])

  function addTrigger(trigger: CueTrigger): void {
    const current = cueRef.current
    updateCue(current.id, { triggers: [...cueTriggers(current), trigger] })
  }

  function removeTrigger(id: string): void {
    updateCue(cue.id, { triggers: triggers.filter(trigger => trigger.id !== id) })
  }

  function startLearning(kind: 'osc' | 'midi'): void {
    readRef.current = showEvents.length
    setLearning(kind)
  }

  useEffect(() => {
    if (!learning) return

    // A cleared river rewinds the read head; otherwise anything already seen is old news.
    const from = readRef.current > showEvents.length ? 0 : readRef.current
    for (let i = from; i < showEvents.length; i++) {
      const trigger = triggerFromEvent(learning, showEvents[i])
      if (!trigger) continue
      readRef.current = i + 1
      addTrigger(trigger)
      setLearning(null)
      return
    }
    readRef.current = showEvents.length
  }, [showEvents, learning])

  function addOsc(): void {
    const address = oscAddress.trim()
    if (address === '') return
    addTrigger({ id: crypto.randomUUID(), kind: 'osc', address })
    setOscAddress('')
  }

  function addMidi(): void {
    if (device === '') return
    const message: TriggerMidiMessage = midiKind === 'cc'
      ? { kind: 'cc', channel, controller: value }
      : midiKind === 'programChange'
        ? { kind: 'programChange', channel, program: value }
        : { kind: midiKind, channel, note: value }
    addTrigger({ id: crypto.randomUUID(), kind: 'midi', device, message })
  }

  return (
    <>
      <div className="triggers">
        {triggers.length === 0 ? (
          <div className="trigger-empty">Nothing fires this cue but GO.</div>
        ) : (
          triggers.map(trigger => (
            <div className="trigger-row" data-kind={trigger.kind} key={trigger.id}>
              <span className="trigger-text">{describeTrigger(trigger)}</span>
              <button
                type="button"
                className="inspector-btn-icon trigger-remove"
                title={`Remove ${describeTrigger(trigger)}`}
                aria-label={`Remove ${describeTrigger(trigger)}`}
                onClick={() => removeTrigger(trigger.id)}
              >✕</button>
            </div>
          ))
        )}

        <div className="trigger-section" data-kind="osc">
          <div className="trigger-section-label">OSC</div>
          <div className="field-row">
            <label htmlFor="trigger-osc-address">Address</label>
            <input
              id="trigger-osc-address"
              value={oscAddress}
              placeholder="/eos/cue/12/fire"
              onChange={e => setOscAddress(e.target.value)}
            />
          </div>
          <div className="trigger-actions">
            <button
              type="button"
              className="inspector-btn trigger-add"
              disabled={oscAddress.trim() === ''}
              onClick={addOsc}
            >Add</button>
            <button
              type="button"
              className="inspector-btn trigger-learn"
              onClick={() => startLearning('osc')}
            >Learn</button>
          </div>
          {learning === 'osc' && <LearningStrip onCancel={() => setLearning(null)} />}
        </div>

        <div className="trigger-section" data-kind="midi">
          <div className="trigger-section-label">MIDI</div>
          <div className="field-row">
            <label htmlFor="trigger-midi-device">Device</label>
            <select
              id="trigger-midi-device"
              value={device}
              onChange={e => setDevice(e.target.value)}
            >
              <option value="">— none —</option>
              {ports.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="trigger-midi-kind">Message</label>
            <select
              id="trigger-midi-kind"
              value={midiKind}
              onChange={e => setMidiKind(e.target.value as TriggerMidiKind)}
            >
              {MIDI_KINDS.map(kind => <option key={kind} value={kind}>{kind}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="trigger-midi-channel">Channel</label>
            <input
              id="trigger-midi-channel"
              type="number"
              min={1}
              max={16}
              value={channel}
              onChange={e => {
                const n = clamp(e.target.value, 1, 16)
                if (n !== null) setChannel(n)
              }}
            />
          </div>
          <div className="field-row">
            <label htmlFor="trigger-midi-value">{VALUE_LABEL[midiKind]}</label>
            <input
              id="trigger-midi-value"
              type="number"
              min={0}
              max={127}
              value={value}
              onChange={e => {
                const n = clamp(e.target.value, 0, 127)
                if (n !== null) setValue(n)
              }}
            />
          </div>
          <div className="trigger-actions">
            <button
              type="button"
              className="inspector-btn trigger-add"
              disabled={device === ''}
              onClick={addMidi}
            >Add</button>
            <button
              type="button"
              className="inspector-btn trigger-learn"
              onClick={() => startLearning('midi')}
            >Learn</button>
          </div>
          {learning === 'midi' && <LearningStrip onCancel={() => setLearning(null)} />}
        </div>
      </div>
    </>
  )
}
