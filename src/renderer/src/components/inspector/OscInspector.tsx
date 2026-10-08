import { useStore } from '../../store'
import type { OscCue, OscArg, OscArgType, OscMessage } from '../../../../shared/cue'
import { oscDestination, oscMessages, oscMessagesPatch } from '../../../../shared/cueTargets'
import { describeOscPatch } from '../../../../shared/oscPatches'
import { LastRun } from './LastRun'
import { SendNow } from './SendNow'
import { ResetButton } from './ResetButton'
import { NumberField, TextField } from '../common/Field'
import { OSC_DEFAULTS } from '../../utils/cueDefaults'

/**
 * What a new argument's value starts at, in the type the panel says it is. The type tag is
 * read off the JavaScript value, so the neutral value has to be one of that type: a 0 left
 * under a `string` argument reaches the desk as an integer, which is not what the row says
 * it is sending.
 */
function neutralValue(type: OscArgType): number | string {
  return type === 's' ? '' : 0
}

interface Props { cue: OscCue }

/**
 * An OSC cue's messages, in the order GO sends them. Each goes to one of the show's OSC
 * patches — chosen by name, so a show taken to another venue changes one address — or to a
 * host and port of its own. A cue written before a cue could send several shows its one
 * message here and is saved as it was until something on this tab is changed.
 */
export function OscInspector({ cue }: Props) {
  const update = useStore(s => s.updateCue)
  const patches = useStore(s => s.oscPatches)
  const messages = oscMessages(cue)
  const write = (next: OscMessage[]): void => update(cue.id, oscMessagesPatch(next))
  const setMessage = (index: number, patch: Partial<OscMessage>): void =>
    write(messages.map((message, at) => (at === index ? { ...message, ...patch } : message)))

  const addMessage = (): void => {
    const last = messages[messages.length - 1]
    // A new message goes where the last one went: the second message of a cue is usually the
    // next command to the same desk.
    write([...messages, {
      patchId: last?.patchId ?? '',
      host: last?.host ?? OSC_DEFAULTS.host,
      port: last?.port ?? OSC_DEFAULTS.port,
      address: '',
      args: []
    }])
  }

  const sendable = messages.filter(message => message.address.trim() !== '' && !('error' in oscDestination(message, patches)))

  return (
    <div className="osc-messages" data-count={messages.length}>
      {messages.map((message, index) => (
        <MessageEditor
          key={index}
          index={index}
          count={messages.length}
          message={message}
          patches={patches}
          onChange={patch => setMessage(index, patch)}
          onRemove={() => write(messages.filter((_, at) => at !== index))}
        />
      ))}
      <button onClick={addMessage} className="inspector-add-btn add-row osc-add-message">+ Add message</button>
      <SendNow
        what={messages.length === 1 ? 'the message' : `${messages.length} messages`}
        disabled={sendable.length !== messages.length}
        send={async () => {
          // The same order GO sends them in; the first that does not leave is the answer.
          for (const message of messages) {
            const destination = oscDestination(message, patches)
            if ('error' in destination) return { ok: false, error: destination.error }
            const result = await window.cuerunner.osc.send({
              host: destination.host,
              port: destination.port,
              address: message.address,
              args: message.args
            })
            if (!result.ok) return result
          }
          return { ok: true }
        }}
      />
      <LastRun cueId={cue.id} />
    </div>
  )
}

interface MessageProps {
  index: number
  count: number
  message: OscMessage
  patches: ReturnType<typeof useStore.getState>['oscPatches']
  onChange: (patch: Partial<OscMessage>) => void
  onRemove: () => void
}

function MessageEditor({ index, count, message, patches, onChange, onRemove }: MessageProps) {
  const prefix = `osc-message-${index}`
  const patchGone = message.patchId !== '' && !patches.some(patch => patch.id === message.patchId)

  const updateArg = (i: number, patch: Partial<OscArg>): void =>
    onChange({ args: message.args.map((arg, at) => (at === i ? { ...arg, ...patch } : arg)) })

  return (
    <div className="osc-message" data-index={index}>
      {count > 1 && (
        <div className="field-section-title osc-message-title">
          Message {index + 1}
          <button
            type="button"
            className="inspector-btn-icon osc-message-remove"
            title={`Remove message ${index + 1}`}
            aria-label={`Remove message ${index + 1}`}
            onClick={onRemove}
          >✕</button>
        </div>
      )}
      <div className="field-row">
        <label htmlFor={`${prefix}-patch`}>Send to</label>
        <select
          id={`${prefix}-patch`}
          value={message.patchId}
          onChange={e => onChange({ patchId: e.target.value })}
        >
          <option value="">Its own host</option>
          {/* A patch that was deleted is said, not papered over. */}
          {patchGone && <option value={message.patchId}>— patch not in this show —</option>}
          {patches.map(patch => <option key={patch.id} value={patch.id}>{describeOscPatch(patch)}</option>)}
        </select>
      </div>
      {message.patchId === '' && (
        <>
          <div className="field-row">
            <label htmlFor={`${prefix}-host`}>Host</label>
            <TextField id={`${prefix}-host`} when="typed" value={message.host} onValue={host => onChange({ host })} />
            <ResetButton label="Host" value={message.host} defaultValue={OSC_DEFAULTS.host}
              onReset={() => onChange({ host: OSC_DEFAULTS.host })} />
          </div>
          <div className="field-row">
            <label htmlFor={`${prefix}-port`}>Port</label>
            <NumberField id={`${prefix}-port`} when="typed" min={1} max={65535} value={message.port}
              onValue={port => { if (port !== null) onChange({ port }) }} />
            <ResetButton label="Port" value={message.port} defaultValue={OSC_DEFAULTS.port}
              onReset={() => onChange({ port: OSC_DEFAULTS.port })} />
          </div>
        </>
      )}
      <div className="field-row">
        <label htmlFor={`${prefix}-address`}>Address</label>
        <TextField id={`${prefix}-address`} when="typed" value={message.address} onValue={address => onChange({ address })} />
      </div>
      {message.args.map((arg, i) => (
        <div key={i} className="field-row">
          <label>Arg {i + 1}</label>
          <select value={arg.type}
            onChange={e => updateArg(i, {
              type: e.target.value as OscArgType,
              value: arg.type !== e.target.value ? neutralValue(e.target.value as OscArgType) : arg.value
            })}
            style={{ width: 50, flex: 'none' }}>
            <option value="i">int</option>
            <option value="f">float</option>
            <option value="s">string</option>
            <option value="T">true</option>
            <option value="F">false</option>
          </select>
          {(arg.type === 'i' || arg.type === 'f') && (
            <NumberField when="typed" step={arg.type === 'i' ? 1 : 0.001} value={arg.value as number}
              onValue={value => { if (value !== null) updateArg(i, { value }) }} />
          )}
          {arg.type === 's' && (
            <TextField when="typed" value={arg.value as string}
              onValue={value => updateArg(i, { value })} />
          )}
          {(arg.type === 'T' || arg.type === 'F') && (
            <span className="inspector-hint" style={{ flex: 1, marginTop: 0 }}>
              {arg.type === 'T' ? 'true' : 'false'}
            </span>
          )}
          <button onClick={() => onChange({ args: message.args.filter((_, at) => at !== i) })} className="inspector-btn-icon">✕</button>
        </div>
      ))}
      <button
        onClick={() => onChange({ args: [...message.args, { type: 'f', value: 0 }] })}
        className="inspector-add-btn add-row"
      >+ Add argument</button>
    </div>
  )
}
