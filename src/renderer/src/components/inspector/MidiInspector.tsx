import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import type { MidiCue, MidiMessageKind } from '../../../../shared/cue'
import { LastRun } from './LastRun'
import { SendNow } from './SendNow'
import { NumberField, TextField } from '../common/Field'

interface Props { cue: MidiCue }

/** A SysEx body as the field shows it: hex, two digits a byte, the way it is typed. */
function hexBytes(data: number[] | undefined): string {
  return (data ?? []).map(byte => byte.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

/** One typed byte, or null for anything that is not a byte this app would put on the wire. */
function parseByte(text: string): number | null {
  return /^[0-9a-f]{1,2}$/i.test(text) ? parseInt(text, 16) : null
}

export function MidiInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const set = (patch: Partial<MidiCue>) => update(cue.id, patch as any)

  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    window.cuerunner.midi.listPorts().then(setPorts)
  }, [])

  const addMsg = () => {
    const msg: MidiMessageKind = { kind: 'noteOn', channel: 1, note: 60, velocity: 127 }
    set({ messages: [...cue.messages, msg] })
  }

  const removeMsg = (i: number) => {
    set({ messages: cue.messages.filter((_, idx) => idx !== i) })
  }

  const updateMsg = (i: number, patch: Partial<MidiMessageKind>) => {
    const messages = cue.messages.map((m, idx) =>
      idx === i ? { ...m, ...patch } as MidiMessageKind : m
    )
    set({ messages })
  }

  return (
    <div>
      <div className="field-row">
        <label>MIDI Port</label>
        {ports.length > 0 ? (
          <select value={cue.portName} onChange={e => set({ portName: e.target.value })}>
            <option value="">— select port —</option>
            {ports.map(p => <option key={p} value={p}>{p}</option>)}
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
      <div className="field-section-title">Messages</div>
      {cue.messages.map((msg, i) => (
        <div key={i} className="inspector-card">
          <div className="field-row">
            <label>Type</label>
            <select value={msg.kind} onChange={e => updateMsg(i, { kind: e.target.value as any })}>
              <option value="noteOn">Note On</option>
              <option value="noteOff">Note Off</option>
              <option value="cc">CC</option>
              <option value="programChange">Program Change</option>
              <option value="sysex">SysEx</option>
            </select>
            <button
              onClick={() => removeMsg(i)}
              className="inspector-btn-icon inspector-btn-remove"
              title="Remove this message"
              aria-label="Remove this message"
            >✕</button>
          </div>
          {msg.kind !== 'sysex' && (
            <div className="field-row">
              <label>Channel</label>
              <NumberField when="typed" min={1} max={16} value={'channel' in msg ? msg.channel : 1}
                onValue={channel => { if (channel !== null) updateMsg(i, { channel } as Partial<MidiMessageKind>) }} />
            </div>
          )}
          {(msg.kind === 'noteOn' || msg.kind === 'noteOff') && (
            <>
              <div className="field-row">
                <label>Note</label>
                <NumberField when="typed" min={0} max={127} value={msg.note}
                  onValue={note => { if (note !== null) updateMsg(i, { note }) }} />
              </div>
              <div className="field-row">
                <label>Velocity</label>
                <NumberField when="typed" min={0} max={127} value={msg.velocity}
                  onValue={velocity => { if (velocity !== null) updateMsg(i, { velocity }) }} />
              </div>
            </>
          )}
          {msg.kind === 'cc' && (
            <>
              <div className="field-row">
                <label>Controller</label>
                <NumberField when="typed" min={0} max={127} value={msg.controller}
                  onValue={controller => { if (controller !== null) updateMsg(i, { controller }) }} />
              </div>
              <div className="field-row">
                <label>Value</label>
                <NumberField when="typed" min={0} max={127} value={msg.value}
                  onValue={value => { if (value !== null) updateMsg(i, { value }) }} />
              </div>
            </>
          )}
          {msg.kind === 'programChange' && (
            <div className="field-row">
              <label>Program</label>
              <NumberField when="typed" min={0} max={127} value={msg.program}
                onValue={program => { if (program !== null) updateMsg(i, { program }) }} />
            </div>
          )}
          {msg.kind === 'sysex' && (
            <div className="field-row">
              <label>Bytes</label>
              <TextField
                when="typed"
                // Hex, the way the field is typed, the placeholder reads and the monitor
                // prints the bytes that went out: the cue's data is bytes, so showing
                // them in decimal would put a number the operator never typed back into
                // the field — and parsing it as hex again on the next keystroke would
                // send something else entirely.
                value={hexBytes(msg.data)}
                placeholder="F0 41 10 42 12 ... F7"
                onValue={text => {
                  const data = text.split(/\s+/).map(parseByte).filter(byte => byte !== null)
                  updateMsg(i, { data })
                }}
              />
            </div>
          )}
        </div>
      ))}
      <button onClick={addMsg} className="inspector-add-btn add-row">+ Add message</button>
      <SendNow
        what={cue.messages.length === 1 ? 'the message' : `${cue.messages.length} messages`}
        disabled={cue.messages.length === 0}
        send={() => window.cuerunner.midi.send({
          // The port the cue would use: its own, or the show's default when it names none.
          portName: cue.portName || useStore.getState().midiSettings.outputPortName,
          messages: cue.messages
        })}
      />
      <LastRun cueId={cue.id} />
    </div>
  )
}
