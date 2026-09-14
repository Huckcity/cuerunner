import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import {
  addChannel,
  channelLabel,
  describeDeskMessage,
  midiNoteMessages,
  removeChannel,
  oscMessages,
  setDcaCount,
  updateChannel,
  updateDca
} from '../../utils/cast'
import { OSC_DEFAULTS } from '../../utils/cueDefaults'
import { DCA_LIMIT } from '../../types/show'
import type { CastSettings, Dca } from '../../types/show'
import { CommitInput, CommitPort } from './CommitField'

// A DCA with no patch of its own yet: one address per DCA, opened with a 1 and closed
// with a 0, on the host and port an OSC cue starts from.
const DCA_OSC_DEFAULTS = { ...OSC_DEFAULTS, address: '/dca/1' }

const MIDI_CHANNELS = Array.from({ length: 16 }, (_, index) => index + 1)
const MIDI_NOTES = Array.from({ length: 128 }, (_, index) => index)
const DCA_COUNTS = Array.from({ length: DCA_LIMIT + 1 }, (_, index) => index)

type Delivery = 'midi' | 'osc' | 'none'

/** How a DCA is opened and closed, read back off the messages it is carrying. */
function deliveryOf(dca: Dca): Delivery {
  if (dca.unmute === null && dca.mute === null) return 'none'
  if (dca.unmute?.kind === 'midi') return 'midi'
  if (dca.unmute?.kind === 'osc') return 'osc'
  return 'none'
}

function midiFields(
  dca: Dca,
  fallbackPort: string
): { portName: string; channel: number; note: number } {
  const message = dca.unmute?.kind === 'midi' ? dca.unmute : null
  if (message === null) return { portName: fallbackPort, channel: 1, note: 1 }
  const kind = message.message
  if (kind.kind !== 'noteOn' && kind.kind !== 'noteOff') {
    return { portName: message.portName, channel: 1, note: 1 }
  }
  return { portName: message.portName, channel: kind.channel, note: kind.note }
}

function oscFields(dca: Dca): { host: string; port: number; address: string } {
  const message = dca.unmute?.kind === 'osc' ? dca.unmute : null
  if (message === null) return DCA_OSC_DEFAULTS
  return { host: message.host, port: message.port, address: message.address }
}

/**
 * Channels: the console as the show sees it. First how many DCAs the desk has, then the
 * strips themselves — a number, a name, whether the strip is in tonight's patch, and the
 * DCA it feeds. This is where the desk routing of the whole show is set up; Scenes only
 * runs it.
 */
export function ChannelsTab() {
  const cast = useStore(s => s.showSettings.cast)
  const updateCastSettings = useStore(s => s.updateCastSettings)
  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    window.winslab.midi.listPorts().then(found => { if (mounted) setPorts(found) })
    return () => { mounted = false }
  }, [])

  const apply = (next: CastSettings): void => updateCastSettings(next)

  const setMidi = (
    dca: Dca,
    patch: Partial<{ portName: string; channel: number; note: number }>
  ): void => {
    const fields = { ...midiFields(dca, ports[0] ?? ''), ...patch }
    apply(updateDca(cast, dca.id, midiNoteMessages(fields.portName, fields.channel, fields.note)))
  }

  const setOsc = (
    dca: Dca,
    patch: Partial<{ host: string; port: number; address: string }>
  ): void => {
    const fields = { ...oscFields(dca), ...patch }
    apply(updateDca(cast, dca.id, oscMessages(fields.host, fields.port, fields.address)))
  }

  const setDelivery = (dca: Dca, delivery: Delivery): void => {
    if (delivery === 'none') {
      apply(updateDca(cast, dca.id, { mute: null, unmute: null }))
      return
    }
    if (delivery === 'midi') {
      const fields = midiFields(dca, ports[0] ?? '')
      apply(updateDca(cast, dca.id, midiNoteMessages(fields.portName, fields.channel, fields.note)))
      return
    }
    const fields = oscFields(dca)
    apply(updateDca(cast, dca.id, oscMessages(fields.host, fields.port, fields.address)))
  }

  return (
    <div className="show-tab-body">
      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">DCAs</span>
          <label className="dca-count">
            <span className="dca-count-label">Number to control</span>
            <select
              className="dca-count-select"
              aria-label="Number of DCAs"
              value={cast.dcas.length}
              onChange={e => apply(setDcaCount(cast, Number(e.target.value)))}
            >
              {/* A show migrated from one that drove more DCAs than the dial offers keeps
                  the count it has: the limit is what the dial goes up to, not a number to
                  take off somebody's desk. */}
              {(cast.dcas.length > DCA_LIMIT ? [...DCA_COUNTS, cast.dcas.length] : DCA_COUNTS)
                .map(count => (
                  <option key={count} value={count}>{count === 0 ? 'none' : count}</option>
                ))}
            </select>
          </label>
        </div>

        {cast.dcas.length === 0 ? (
          <p className="show-empty">
            No DCAs. A show that does not drive the desk leaves this at none.
          </p>
        ) : (
          cast.dcas.map((dca, index) => {
            const delivery = deliveryOf(dca)
            const midi = midiFields(dca, ports[0] ?? '')
            const osc = oscFields(dca)
            const portOptions = ports.includes(midi.portName) ? ports : [midi.portName, ...ports]
            const carrying = cast.channels
              .filter(channel => channel.dcaId === dca.id)
              .map(channel => channelLabel(cast.channels, channel.id))

            return (
              <div className="dca-row" key={dca.id}>
                <div className="dca-fields">
                  <span className="dca-number">{index + 1}</span>
                  <CommitInput
                    className="dca-label"
                    value={dca.label}
                    placeholder="DCA"
                    aria-label={`DCA ${index + 1} label`}
                    onCommit={label => apply(updateDca(cast, dca.id, { label }))}
                  />
                  <select
                    className="dca-delivery"
                    value={delivery}
                    aria-label={`DCA ${index + 1} delivery`}
                    onChange={e => setDelivery(dca, e.target.value as Delivery)}
                  >
                    <option value="midi">MIDI</option>
                    <option value="osc">OSC</option>
                    <option value="none">None</option>
                  </select>

                  {delivery === 'midi' && (
                    <>
                      <select
                        className="dca-port"
                        value={midi.portName}
                        aria-label="MIDI port"
                        onChange={e => setMidi(dca, { portName: e.target.value })}
                      >
                        {portOptions.map(port => (
                          <option key={port} value={port}>{port === '' ? '— none —' : port}</option>
                        ))}
                      </select>
                      <select
                        className="dca-channel"
                        value={midi.channel}
                        aria-label="MIDI channel"
                        onChange={e => setMidi(dca, { channel: Number(e.target.value) })}
                      >
                        {MIDI_CHANNELS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      <select
                        className="dca-note"
                        value={midi.note}
                        aria-label="MIDI note"
                        onChange={e => setMidi(dca, { note: Number(e.target.value) })}
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
                        className="dca-host"
                        value={osc.host}
                        placeholder="Host"
                        aria-label="OSC host"
                        onCommit={host => setOsc(dca, { host })}
                      />
                      <CommitPort
                        className="dca-osc-port"
                        value={osc.port}
                        aria-label="OSC port"
                        onCommit={port => setOsc(dca, { port })}
                      />
                      <CommitInput
                        className="dca-address"
                        value={osc.address}
                        placeholder="Address"
                        aria-label="OSC address"
                        onCommit={address => setOsc(dca, { address })}
                      />
                    </>
                  )}
                </div>

                <div className="dca-summary">
                  <span className="dca-summary-open">{describeDeskMessage(dca.unmute)}</span>
                  <span className="dca-summary-sep">{' / '}</span>
                  <span className="dca-summary-close">{describeDeskMessage(dca.mute)}</span>
                </div>

                <div className="dca-carrying">
                  {carrying.length === 0 ? 'nothing assigned' : carrying.join(', ')}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Channels</span>
          <button className="channel-add add-row" onClick={() => apply(addChannel(cast))}>
            + Channel
          </button>
        </div>

        {cast.channels.map((channel, index) => (
          <div className="channel-row" key={channel.id} data-enabled={channel.enabled}>
            <span className="channel-number">{index + 1}</span>
            <CommitInput
              className="channel-name"
              value={channel.name}
              placeholder="Name"
              aria-label={`Channel ${index + 1} name`}
              onCommit={name => apply(updateChannel(cast, channel.id, { name }))}
            />
            <select
              className="channel-dca"
              value={channel.dcaId ?? ''}
              aria-label={`Channel ${index + 1} DCA`}
              onChange={e => apply(updateChannel(cast, channel.id, { dcaId: e.target.value || null }))}
            >
              <option value="">— no DCA —</option>
              {cast.dcas.map(dca => (
                <option key={dca.id} value={dca.id}>{dca.label}</option>
              ))}
            </select>
            <label className="channel-enabled">
              <input
                type="checkbox"
                checked={channel.enabled}
                aria-label={`Channel ${index + 1} enabled`}
                onChange={e => apply(updateChannel(cast, channel.id, { enabled: e.target.checked }))}
              />
              <span>in patch</span>
            </label>
            <button
              className="channel-remove"
              aria-label={`Remove channel ${index + 1}`}
              title="Remove this strip — undo puts it back"
              onClick={() => apply(removeChannel(cast, channel.id))}
            >✕</button>
          </div>
        ))}
      </div>
    </div>
  )
}
