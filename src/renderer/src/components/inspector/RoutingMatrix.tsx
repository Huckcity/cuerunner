// Where an audio cue's channels go. Automatic is the file's own layout straight to the
// device; a matrix is a list of crosspoints from file channel to device channel, and can
// be any size the two channel counts allow; silent routes nothing at all, on purpose.
import type { AudioCrosspoint, AudioCue } from '../../types/cue'

export type RoutingMode = 'automatic' | 'matrix' | 'silent'

export function routingMode(cue: AudioCue): RoutingMode {
  if (cue.outputs === null) return 'automatic'
  return cue.outputs.length === 0 ? 'silent' : 'matrix'
}

/**
 * What a cue starts from when it is switched to a matrix: the file's own channels to
 * the matching device channels, which is the routing automatic already gives it. The
 * operator then edits from something that sounds right rather than from nothing.
 */
function defaultCrosspoints(fileChannels: number, deviceChannels: number): AudioCrosspoint[] {
  const channels = Math.max(1, Math.min(fileChannels || 2, deviceChannels || 2))
  return Array.from({ length: channels }, (_, channel) => ({
    inputChannel: channel,
    outputChannel: channel,
    gain: 1
  }))
}

interface Props {
  cue: AudioCue
  /** Channels in the selected file, as the engine reports them. */
  fileChannels: number
  /** Channels the output device really has. */
  deviceChannels: number
  onChange: (outputs: AudioCrosspoint[] | null) => void
}

export function RoutingMatrix({ cue, fileChannels, deviceChannels, onChange }: Props) {
  const mode = routingMode(cue)
  const outputs = cue.outputs ?? []

  const setMode = (next: RoutingMode): void => {
    if (next === 'automatic') onChange(null)
    else if (next === 'silent') onChange([])
    else onChange(outputs.length > 0 ? outputs : defaultCrosspoints(fileChannels, deviceChannels))
  }

  const patchCrosspoint = (index: number, patch: Partial<AudioCrosspoint>): void => {
    onChange(outputs.map((crosspoint, i) => i === index ? { ...crosspoint, ...patch } : crosspoint))
  }

  const inputOptions = Array.from({ length: Math.max(fileChannels, 2) }, (_, channel) => channel)
  const outputOptions = Array.from({ length: Math.max(deviceChannels, 2) }, (_, channel) => channel)

  return (
    <div className="routing-matrix">
      <div className="field-row">
        <label htmlFor="routing-mode">Routing</label>
        <select
          id="routing-mode"
          value={mode}
          onChange={e => setMode(e.target.value as RoutingMode)}
        >
          <option value="automatic">Automatic</option>
          <option value="matrix">Matrix</option>
          <option value="silent">Silent</option>
        </select>
        <span className="inspector-readout">
          {mode === 'automatic' && `${fileChannels || 2} ch → device`}
          {mode === 'matrix' && `${outputs.length} crosspoint${outputs.length === 1 ? '' : 's'}`}
          {mode === 'silent' && 'no output'}
        </span>
      </div>

      {mode === 'automatic' && (
        <p className="inspector-hint">
          The file's channels play in order on the output device. {fileChannels > 0
            ? `This file has ${fileChannels} channel${fileChannels === 1 ? '' : 's'}.`
            : 'The file has not been read yet.'}
        </p>
      )}
      {mode === 'silent' && (
        <p className="inspector-hint">
          Deliberately silent: the cue runs and takes its time, and sends nothing to the device.
        </p>
      )}

      {mode === 'matrix' && (
        <>
          {outputs.map((crosspoint, index) => (
            <div className="routing-row" key={index}>
              <select
                aria-label={`Crosspoint ${index + 1} file channel`}
                value={crosspoint.inputChannel}
                onChange={e => patchCrosspoint(index, { inputChannel: Number(e.target.value) })}
              >
                {inputOptions.map(channel => (
                  <option key={channel} value={channel}>Ch {channel + 1}</option>
                ))}
              </select>
              <span className="routing-arrow">→</span>
              <select
                aria-label={`Crosspoint ${index + 1} device channel`}
                value={crosspoint.outputChannel}
                onChange={e => patchCrosspoint(index, { outputChannel: Number(e.target.value) })}
              >
                {outputOptions.map(channel => (
                  <option key={channel} value={channel}>Ch {channel + 1}</option>
                ))}
              </select>
              <input
                type="range"
                aria-label={`Crosspoint ${index + 1} gain`}
                min={0}
                max={1}
                step={0.01}
                value={crosspoint.gain}
                onChange={e => patchCrosspoint(index, { gain: Number(e.target.value) })}
                style={{ flex: 1, accentColor: 'var(--accent-blue)' }}
              />
              <span className="inspector-readout">{Math.round(crosspoint.gain * 100)}%</span>
              <button
                type="button"
                className="inspector-btn-icon"
                title={`Remove crosspoint ${index + 1}`}
                aria-label={`Remove crosspoint ${index + 1}`}
                onClick={() => onChange(outputs.filter((_, i) => i !== index))}
              >✕</button>
            </div>
          ))}
          <button
            type="button"
            className="inspector-add-btn add-row"
            onClick={() => onChange([...outputs, {
              inputChannel: 0,
              outputChannel: Math.min(outputs.length, Math.max(deviceChannels - 1, 0)),
              gain: 1
            }])}
          >+ Add crosspoint</button>
          <p className="inspector-hint">
            File channels 1–{Math.max(fileChannels, 2)}, device channels 1–{Math.max(deviceChannels, 2)}.
            Add as many crosspoints as the routing needs: one file channel can feed several
            outputs, and several file channels can meet on one.
          </p>
        </>
      )}
    </div>
  )
}
