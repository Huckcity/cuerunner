import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { useStore } from '../../store'
import { OSC_DEFAULTS } from '../../utils/cueDefaults'
import {
  addDeskGroup,
  addEnsemble,
  addPerformer,
  describeDeskMessage,
  ensembleMembers,
  midiNoteMessages,
  oscMessages,
  removeEnsemble,
  updateDeskGroup,
  updateEnsemble,
  updatePerformer
} from '../../utils/cast'
import type { CastSettings, DeskChannel } from '../../types/show'
import './ShowDialog.css'

interface Props {
  onClose: () => void
}

// A group with no patch of its own yet: one address per group, opened with a 1 and
// closed with a 0, on the host and port an OSC cue starts from.
const GROUP_OSC_DEFAULTS = { ...OSC_DEFAULTS, address: '/dca/1' }

const MIDI_CHANNELS = Array.from({ length: 16 }, (_, index) => index + 1)
const MIDI_NOTES = Array.from({ length: 128 }, (_, index) => index)

type Delivery = 'midi' | 'osc' | 'none'

/**
 * A field that keeps what is being typed to itself until it is left. Binding the cast to
 * every keystroke would rewrite the workspace on each character.
 */
function CommitInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }

  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/** A port that commits when it is left rather than on every keystroke. */
function CommitPort({
  value,
  onCommit,
  ...rest
}: {
  value: number
  onCommit: (value: number) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    const parsed = Number(draft)
    if (draft !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      onCommit(parsed)
    }
    setDraft(null)
  }

  return (
    <input
      {...rest}
      type="number"
      min={1}
      max={65535}
      value={draft ?? String(value)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/** How a group is opened and closed, read back off the messages it is carrying. */
function deliveryOf(group: DeskChannel): Delivery {
  if (group.unmute === null && group.mute === null) return 'none'
  if (group.unmute?.kind === 'midi') return 'midi'
  if (group.unmute?.kind === 'osc') return 'osc'
  return 'none'
}

function midiFields(
  group: DeskChannel,
  fallbackPort: string
): { portName: string; channel: number; note: number } {
  const message = group.unmute?.kind === 'midi' ? group.unmute : null
  if (message === null) return { portName: fallbackPort, channel: 1, note: 1 }
  const kind = message.message
  if (kind.kind !== 'noteOn' && kind.kind !== 'noteOff') {
    return { portName: message.portName, channel: 1, note: 1 }
  }
  return { portName: message.portName, channel: kind.channel, note: kind.note }
}

function oscFields(group: DeskChannel): { host: string; port: number; address: string } {
  const message = group.unmute?.kind === 'osc' ? group.unmute : null
  if (message === null) return GROUP_OSC_DEFAULTS
  return { host: message.host, port: message.port, address: message.address }
}

/** A performer's own group, or their ensemble's, described for the empty option. */
function noGroupLabel(ensembleId: string | null): string {
  return ensembleId === null ? '— none —' : '— use ensemble —'
}

/**
 * The Show panel: performers, the ensembles that group them, and the desk groups those
 * ensembles (or a performer alone) drive. This is the one place DCA routing is set up —
 * Scenes only runs it, and the mic plot only says who is currently wearing which pack.
 */
export function ShowDialog({ onClose }: Props) {
  const cast = useStore(s => s.showSettings.cast)
  const updateCastSettings = useStore(s => s.updateCastSettings)
  const removeCastGroup = useStore(s => s.removeCastGroup)
  const removePerformer = useStore(s => s.removePerformer)
  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    window.winslab.midi.listPorts().then(found => { if (mounted) setPorts(found) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  const apply = (next: CastSettings): void => updateCastSettings(next)

  const setMidi = (
    group: DeskChannel,
    patch: Partial<{ portName: string; channel: number; note: number }>
  ): void => {
    const fields = { ...midiFields(group, ports[0] ?? ''), ...patch }
    apply(updateDeskGroup(cast, group.id, midiNoteMessages(fields.portName, fields.channel, fields.note)))
  }

  const setOsc = (
    group: DeskChannel,
    patch: Partial<{ host: string; port: number; address: string }>
  ): void => {
    const fields = { ...oscFields(group), ...patch }
    apply(updateDeskGroup(cast, group.id, oscMessages(fields.host, fields.port, fields.address)))
  }

  const setDelivery = (group: DeskChannel, delivery: Delivery): void => {
    if (delivery === 'none') {
      apply(updateDeskGroup(cast, group.id, { mute: null, unmute: null }))
      return
    }
    if (delivery === 'midi') {
      const fields = midiFields(group, ports[0] ?? '')
      apply(updateDeskGroup(cast, group.id, midiNoteMessages(fields.portName, fields.channel, fields.note)))
      return
    }
    const fields = oscFields(group)
    apply(updateDeskGroup(cast, group.id, oscMessages(fields.host, fields.port, fields.address)))
  }

  return (
    <div className="show-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="show-dialog" role="dialog" aria-modal="true" aria-label="Show">
        <div className="show-header">
          <span className="show-title">Show</span>
        </div>

        <div className="show-body">
          <div className="show-section">
            <div className="show-section-title">Performers</div>
            {cast.performers.map(performer => (
              <div className="performer-row" key={performer.id}>
                <CommitInput
                  className="performer-name"
                  value={performer.name}
                  placeholder="Name"
                  aria-label="Performer name"
                  onCommit={name => apply(updatePerformer(cast, performer.id, { name }))}
                />
                <CommitInput
                  className="performer-role"
                  value={performer.role}
                  placeholder="Role"
                  aria-label="Performer role"
                  onCommit={role => apply(updatePerformer(cast, performer.id, { role }))}
                />
                <select
                  className="performer-ensemble"
                  value={performer.ensembleId ?? ''}
                  aria-label="Performer ensemble"
                  onChange={e => apply(updatePerformer(cast, performer.id, { ensembleId: e.target.value || null }))}
                >
                  <option value="">— none —</option>
                  {cast.ensembles.map(ensemble => (
                    <option key={ensemble.id} value={ensemble.id}>{ensemble.name}</option>
                  ))}
                </select>
                <select
                  className="performer-group"
                  value={performer.deskChannelId ?? ''}
                  aria-label="Performer desk group"
                  title="Overrides their ensemble's group, when they have one"
                  onChange={e => apply(updatePerformer(cast, performer.id, { deskChannelId: e.target.value || null }))}
                >
                  <option value="">{noGroupLabel(performer.ensembleId)}</option>
                  {cast.groups.map(group => (
                    <option key={group.id} value={group.id}>{group.label}</option>
                  ))}
                </select>
                <CommitInput
                  className="performer-notes"
                  value={performer.notes}
                  placeholder="Notes"
                  aria-label="Performer notes"
                  onCommit={notes => apply(updatePerformer(cast, performer.id, { notes }))}
                />
                <button
                  className="performer-remove"
                  aria-label={`Remove ${performer.name || 'performer'}`}
                  onClick={() => removePerformer(performer.id)}
                >✕</button>
              </div>
            ))}
            <button className="performer-add add-row" onClick={() => apply(addPerformer(cast, 'New performer', ''))}>
              + Add performer
            </button>
          </div>

          <div className="show-section">
            <div className="show-section-title">Ensembles</div>
            {cast.ensembles.map(ensemble => {
              const members = ensembleMembers(cast, ensemble.id)
              const free = cast.performers.filter(performer => performer.ensembleId !== ensemble.id)
              return (
                <div className="ensemble-row" key={ensemble.id}>
                  <div className="ensemble-fields">
                    <CommitInput
                      className="ensemble-name"
                      value={ensemble.name}
                      placeholder="Ensemble"
                      aria-label="Ensemble name"
                      onCommit={name => apply(updateEnsemble(cast, ensemble.id, { name }))}
                    />
                    <select
                      className="ensemble-group"
                      value={ensemble.deskChannelId ?? ''}
                      aria-label="Ensemble desk group"
                      onChange={e => apply(updateEnsemble(cast, ensemble.id, { deskChannelId: e.target.value || null }))}
                    >
                      <option value="">— none —</option>
                      {cast.groups.map(group => (
                        <option key={group.id} value={group.id}>{group.label}</option>
                      ))}
                    </select>
                    <button
                      className="ensemble-remove"
                      aria-label={`Remove ${ensemble.name}`}
                      onClick={() => apply(removeEnsemble(cast, ensemble.id))}
                    >✕</button>
                  </div>
                  <div className="ensemble-members">
                    {members.map(member => (
                      <span className="member-chip" key={member.id}>
                        {member.name}
                        <button
                          type="button"
                          aria-label={`Take ${member.name} out of ${ensemble.name}`}
                          onClick={() => apply(updatePerformer(cast, member.id, { ensembleId: null }))}
                        >✕</button>
                      </span>
                    ))}
                    {free.length > 0 && (
                      <select
                        className="member-add"
                        aria-label={`Add a performer to ${ensemble.name}`}
                        value=""
                        onChange={e => {
                          if (e.target.value !== '') {
                            apply(updatePerformer(cast, e.target.value, { ensembleId: ensemble.id }))
                          }
                        }}
                      >
                        <option value="">+ add member</option>
                        {free.map(performer => (
                          <option key={performer.id} value={performer.id}>{performer.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              )
            })}
            <button className="ensemble-add add-row" onClick={() => apply(addEnsemble(cast))}>
              + Add ensemble
            </button>
          </div>

          <div className="show-section">
            <div className="show-section-title">Desk groups</div>
            {cast.groups.map(group => {
              const delivery = deliveryOf(group)
              const midi = midiFields(group, ports[0] ?? '')
              const osc = oscFields(group)
              const portOptions = ports.includes(midi.portName) ? ports : [midi.portName, ...ports]
              const ensembles = cast.ensembles.filter(ensemble => ensemble.deskChannelId === group.id)
              const performers = cast.performers.filter(performer => performer.deskChannelId === group.id)
              const carrying = [...ensembles.map(e => e.name), ...performers.map(p => p.name)]

              return (
                <div className="group-row" key={group.id}>
                  <div className="group-fields">
                    <CommitInput
                      className="group-label"
                      value={group.label}
                      placeholder="Group"
                      aria-label="Group label"
                      onCommit={label => apply(updateDeskGroup(cast, group.id, { label }))}
                    />
                    <select
                      className="group-delivery"
                      value={delivery}
                      aria-label="Group delivery"
                      onChange={e => setDelivery(group, e.target.value as Delivery)}
                    >
                      <option value="midi">MIDI</option>
                      <option value="osc">OSC</option>
                      <option value="none">None</option>
                    </select>

                    {delivery === 'midi' && (
                      <>
                        <select
                          className="group-port"
                          value={midi.portName}
                          aria-label="MIDI port"
                          onChange={e => setMidi(group, { portName: e.target.value })}
                        >
                          {portOptions.map(port => (
                            <option key={port} value={port}>{port === '' ? '— none —' : port}</option>
                          ))}
                        </select>
                        <select
                          className="group-channel"
                          value={midi.channel}
                          aria-label="MIDI channel"
                          onChange={e => setMidi(group, { channel: Number(e.target.value) })}
                        >
                          {MIDI_CHANNELS.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                        <select
                          className="group-note"
                          value={midi.note}
                          aria-label="MIDI note"
                          onChange={e => setMidi(group, { note: Number(e.target.value) })}
                        >
                          {MIDI_NOTES.map(option => (
                            <option key={option} value={option}>{option}</option>
                          ))}
                        </select>
                      </>
                    )}

                    {delivery === 'osc' && (
                      <>
                        <CommitInput
                          className="group-host"
                          value={osc.host}
                          placeholder="Host"
                          aria-label="OSC host"
                          onCommit={host => setOsc(group, { host })}
                        />
                        <CommitPort
                          className="group-osc-port"
                          value={osc.port}
                          aria-label="OSC port"
                          onCommit={port => setOsc(group, { port })}
                        />
                        <CommitInput
                          className="group-address"
                          value={osc.address}
                          placeholder="Address"
                          aria-label="OSC address"
                          onCommit={address => setOsc(group, { address })}
                        />
                      </>
                    )}

                    <button
                      className="group-remove"
                      aria-label={`Remove ${group.label}`}
                      onClick={() => removeCastGroup(group.id)}
                    >✕</button>
                  </div>

                  <div className="group-summary">
                    <span className="group-summary-open">{describeDeskMessage(group.unmute)}</span>
                    <span className="group-summary-sep">{' / '}</span>
                    <span className="group-summary-close">{describeDeskMessage(group.mute)}</span>
                  </div>

                  <div className="group-carrying">
                    {carrying.length === 0 ? 'nothing assigned' : carrying.join(', ')}
                  </div>
                </div>
              )
            })}
            <button className="group-add add-row" onClick={() => apply(addDeskGroup(cast))}>
              + Add group
            </button>
          </div>
        </div>

        <div className="show-footer">
          <button className="show-close" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
