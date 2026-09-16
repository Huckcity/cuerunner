import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import { cueTriggers } from '../../engine/triggers'
import { MSC_COMMANDS, MSC_COMMAND_NAME, MSC_FORMATS, MSC_FORMAT_NAME, describeMsc, parseMsc } from '../../utils/msc'
import type { Cue, CueTrigger, MidiMessageKind, MscCommand, MscFormat, TriggerMidiMessage } from '../../types/cue'
import type { ShowEvent } from '../../types/show'
import './Triggers.css'

/** The three MIDI messages a cue can answer to, in the order the picker offers them. */
const MIDI_KINDS = ['noteOn', 'cc', 'programChange'] as const
type TriggerMidiKind = (typeof MIDI_KINDS)[number]

/** The one number each kind carries, named the way the operator thinks of it. */
const VALUE_LABEL: Record<TriggerMidiKind, string> = {
  noteOn: 'Note',
  cc: 'Controller',
  programChange: 'Program'
}

/** A MIDI message that can answer a trigger; sysex has no identity to match on. */
type TriggerableMidi = Exclude<MidiMessageKind, { kind: 'sysex' }>

function toTriggerMessage(message: TriggerableMidi): TriggerMidiMessage {
  switch (message.kind) {
    case 'noteOn':
      return { kind: 'noteOn', channel: message.channel, note: message.note }
    case 'cc':
      return { kind: 'cc', channel: message.channel, controller: message.controller }
    case 'programChange':
      return { kind: 'programChange', channel: message.channel, program: message.program }
    // A release is not a firing: learning while one arrives leaves the session open.
    default:
      throw new Error('a note-off cannot answer a trigger')
  }
}

/** How a trigger reads in the list: `OSC /eos/cue/12/fire`, `MIDI noteOn ch1 note 60 on "IAC Bus 1"`. */
export function describeTrigger(trigger: CueTrigger): string {
  if (trigger.kind === 'osc') return `OSC ${trigger.address}`
  if (trigger.kind === 'msc') {
    const command = describeMsc({
      deviceId: trigger.deviceId,
      format: trigger.format,
      command: trigger.command,
      cueNumber: trigger.cueNumber,
      cueList: trigger.cueList
    })
    return `Show Control ${command} from "${trigger.device}"`
  }

  const { message, device } = trigger
  const detail =
    message.kind === 'cc' ? `controller ${message.controller}` :
    message.kind === 'programChange' ? `program ${message.program}` :
    `note ${message.note}`
  return `MIDI ${message.kind} ch${message.channel} ${detail} on "${device}"`
}

/** The trigger a learning session is looking for, or null when the event is not one. */
function triggerFromEvent(learning: 'osc' | 'midi' | 'msc', event: ShowEvent): CueTrigger | null {
  if (learning === 'osc') {
    return event.kind === 'osc'
      ? { id: crypto.randomUUID(), kind: 'osc', address: event.address }
      : null
  }
  if (event.kind !== 'midi') return null
  const message = event.message

  if (learning === 'msc') {
    // A command this app cannot read is not one it can learn either, so anything else on
    // the river leaves the session open for the next message.
    const msc = parseMsc(message)
    if (msc === null) return null
    return {
      id: crypto.randomUUID(),
      kind: 'msc',
      device: event.device,
      deviceId: msc.deviceId,
      format: msc.format,
      command: msc.command,
      cueNumber: msc.cueNumber,
      cueList: msc.cueList
    }
  }
  // Sysex has no channel and no note, and a release is not a firing, so neither can
  // become a plain MIDI trigger; learning stays open and the next real message is the
  // one that counts.
  if (message.kind === 'sysex' || message.kind === 'noteOff') return null
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
  const [learning, setLearning] = useState<'osc' | 'midi' | 'msc' | null>(null)
  // The show control form starts at the all-call and the all-types format, which is what
  // a console's own document writes for "go, whoever is listening".
  const [mscDevice, setMscDevice] = useState('')
  const [mscDeviceId, setMscDeviceId] = useState(127)
  const [mscFormat, setMscFormat] = useState<MscFormat>('all')
  const [mscCommand, setMscCommand] = useState<MscCommand>('go')
  const [mscCueNumber, setMscCueNumber] = useState('')
  const [mscCueList, setMscCueList] = useState('')

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

  function startLearning(kind: 'osc' | 'midi' | 'msc'): void {
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

  function addMsc(): void {
    if (mscDevice === '') return
    addTrigger({
      id: crypto.randomUUID(),
      kind: 'msc',
      device: mscDevice,
      deviceId: mscDeviceId,
      format: mscFormat,
      command: mscCommand,
      cueNumber: mscCueNumber.trim(),
      cueList: mscCueList.trim()
    })
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

        <div className="trigger-section" data-kind="msc">
          <div className="trigger-section-label">Show Control</div>
          <div className="field-row">
            <label htmlFor="trigger-msc-device">From</label>
            <select
              id="trigger-msc-device"
              value={mscDevice}
              onChange={e => setMscDevice(e.target.value)}
            >
              <option value="">— none —</option>
              {ports.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="trigger-msc-command">Command</label>
            <select
              id="trigger-msc-command"
              value={mscCommand}
              onChange={e => setMscCommand(e.target.value as MscCommand)}
            >
              {MSC_COMMANDS.map(command => (
                <option key={command} value={command}>{MSC_COMMAND_NAME[command]}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="trigger-msc-format">For</label>
            <select
              id="trigger-msc-format"
              value={mscFormat}
              onChange={e => setMscFormat(e.target.value as MscFormat)}
            >
              {MSC_FORMATS.map(format => (
                <option key={format} value={format}>{MSC_FORMAT_NAME[format]}</option>
              ))}
            </select>
          </div>
          <div className="field-row">
            <label htmlFor="trigger-msc-device-id">Device ID</label>
            <input
              id="trigger-msc-device-id"
              type="number"
              min={0}
              max={127}
              value={mscDeviceId}
              onChange={e => {
                const n = clamp(e.target.value, 0, 127)
                if (n !== null) setMscDeviceId(n)
              }}
            />
          </div>
          <div className="field-row">
            <label htmlFor="trigger-msc-cue">Cue</label>
            <input
              id="trigger-msc-cue"
              value={mscCueNumber}
              placeholder="none named"
              onChange={e => setMscCueNumber(e.target.value)}
            />
          </div>
          <div className="field-row">
            <label htmlFor="trigger-msc-list">List</label>
            <input
              id="trigger-msc-list"
              value={mscCueList}
              placeholder="its default"
              onChange={e => setMscCueList(e.target.value)}
            />
          </div>
          <p className="inspector-hint">
            Fires on the console’s command as it sent it: every field has to match, so a
            cue left empty answers a command that names no cue, not any command at all.
          </p>
          <div className="trigger-actions">
            <button
              type="button"
              className="inspector-btn trigger-add"
              disabled={mscDevice === ''}
              onClick={addMsc}
            >Add</button>
            <button
              type="button"
              className="inspector-btn trigger-learn"
              onClick={() => startLearning('msc')}
            >Learn</button>
          </div>
          {learning === 'msc' && <LearningStrip onCancel={() => setLearning(null)} />}
        </div>
      </div>
    </>
  )
}
