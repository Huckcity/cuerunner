import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { MSC_COMMANDS, MSC_COMMAND_NAME, MSC_FORMATS, MSC_FORMAT_NAME } from '../../utils/msc'
import type { MscCommand, MscCue, MscFormat } from '../../types/cue'
import { LastRun } from './LastRun'
import { NumberField, TextField } from '../common/Field'

interface Props { cue: MscCue }

/**
 * What a show control cue says to another console: which command, to whom, and which of
 * that console's cues it names.
 *
 * The numbers here are the receiving console's own — its device ID off its MIDI setup
 * screen, its cue number and cue list as its operator would type them. This app has
 * nothing to check them against, which is why they are fields rather than a picker, and
 * why the read-back at the bottom says what will actually go on the wire.
 */
export function MscInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const desk = useStore(s => s.showSettings.desk)
  const set = (patch: Partial<MscCue>) => update(cue.id, patch)

  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    window.winslab.midi.listPorts().then(setPorts)
  }, [])

  // A cue number and a cue list mean nothing to a RESET: the specification gives that
  // command no data, so the fields are not offered rather than being silently dropped.
  const namesACue = cue.command !== 'reset'

  return (
    <div>
      <div className="field-row">
        <label>Command</label>
        <select
          value={cue.command}
          onChange={e => set({ command: e.target.value as MscCommand })}
        >
          {MSC_COMMANDS.map(command => (
            <option key={command} value={command}>{MSC_COMMAND_NAME[command]}</option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label>For</label>
        <select value={cue.format} onChange={e => set({ format: e.target.value as MscFormat })}>
          {MSC_FORMATS.map(format => (
            <option key={format} value={format}>{MSC_FORMAT_NAME[format]}</option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <label>Device</label>
        <NumberField
          min={0}
          max={127}
          value={cue.deviceId}
          title="The receiving console's Show Control device ID. 127 is the all-call every device answers."
          onValue={deviceId => { if (deviceId !== null) set({ deviceId }) }}
        />
      </div>

      {namesACue && (
        <>
          <div className="field-row">
            <label>Cue</label>
            <TextField
              value={cue.cueNumber}
              placeholder="its next cue"
              title="The cue number on the receiving console, as its operator would type it. Empty means its next cue."
              onValue={cueNumber => set({ cueNumber })}
            />
          </div>
          <div className="field-row">
            <label>List</label>
            <TextField
              value={cue.cueList}
              placeholder="its default"
              title="The console's cue list. Empty is whatever it has open."
              onValue={cueList => set({ cueList })}
            />
          </div>
        </>
      )}

      <div className="field-row">
        <label>Send</label>
        <select
          value={cue.destination}
          onChange={e => set({ destination: e.target.value as MscCue['destination'] })}
        >
          <option value="desk">To the show’s desk</option>
          <option value="port">To a MIDI port</option>
        </select>
      </div>

      {cue.destination === 'port' && (
        <div className="field-row">
          <label>Port</label>
          {ports.length > 0 ? (
            <select value={cue.portName} onChange={e => set({ portName: e.target.value })}>
              <option value="">— the show’s output port —</option>
              {ports.map(port => <option key={port} value={port}>{port}</option>)}
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
            onClick={() => window.winslab.midi.listPorts().then(setPorts)}
            title="Refresh ports"
            className="inspector-btn"
          >↻</button>
        </div>
      )}

      <p className="inspector-hint">
        {cue.destination === 'desk'
          ? desk.kind === 'midi' || desk.kind === 'midi-tcp'
            ? 'Sent on the show’s desk connection, the one the DCAs use.'
            : 'This show has no desk that takes MIDI. Set one up in Show Settings, or send this cue to a MIDI port instead.'
          : 'Sent on this machine’s MIDI, like any other MIDI cue.'}
      </p>

      <LastRun cueId={cue.id} />
    </div>
  )
}
