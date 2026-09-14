import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import {
  addChannel,
  channelLabel,
  removeChannel,
  setDcaCount,
  updateChannel,
  updateDca
} from '../../utils/cast'
import { dcaAddress, dcaNumber, deskMessages } from '../../utils/desk'
import { DCA_LIMIT } from '../../types/show'
import type { CastSettings, DeskMessage, DeskSettings } from '../../types/show'
import { CommitInput, CommitNumber } from './CommitField'

const DCA_COUNTS = Array.from({ length: DCA_LIMIT + 1 }, (_, index) => index)

/** What the desk is missing before it can be driven at all, or null when it is ready. */
function deskGap(desk: DeskSettings): string | null {
  if (desk.kind === 'midi' && desk.midiPort === '') return 'No MIDI port chosen.'
  return null
}

/**
 * Channels: the console as the show sees it. Where the desk is, how many DCAs it has,
 * the strips and the fader each one drives, and the DCAs themselves.
 *
 * It is set up once, so the defaults do the work: a new show has twelve strips and twelve
 * DCAs, strip n driving DCA n, and the only thing nobody can guess is where the desk is.
 * What is left here is the exceptions — a chorus sharing one fader, a desk that numbers
 * its DCAs differently — which is why the DCA rows are the last thing on the tab rather
 * than the first.
 */
export function ChannelsTab() {
  const cast = useStore(s => s.showSettings.cast)
  const desk = useStore(s => s.showSettings.desk)
  const midiOutPort = useStore(s => s.midiSettings.outputPortName)
  const updateCastSettings = useStore(s => s.updateCastSettings)
  const updateDeskSettings = useStore(s => s.updateDeskSettings)
  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    window.winslab.midi.listPorts().then(found => { if (mounted) setPorts(found) })
    return () => { mounted = false }
  }, [])

  const apply = (next: CastSettings): void => updateCastSettings(next)

  // A desk the operator has just called for is driven on the port this machine already
  // has chosen for its MIDI output: the app knows it, so it is not a second question.
  const setKind = (kind: DeskSettings['kind']): void => {
    const port = desk.midiPort === '' && kind === 'midi' ? midiOutPort : desk.midiPort
    updateDeskSettings({ kind, midiPort: port })
  }

  const portOptions = desk.midiPort !== '' && !ports.includes(desk.midiPort)
    ? [desk.midiPort, ...ports]
    : ports
  const gap = deskGap(desk)

  return (
    <div className="show-tab-body">
      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Desk</span>
          <label className="dca-count">
            <span className="dca-count-label">DCAs to control</span>
            <select
              className="dca-count-select"
              aria-label="Number of DCAs"
              value={cast.dcas.length}
              onChange={e => apply(setDcaCount(cast, Number(e.target.value)))}
            >
              {/* A show from an older build can carry more DCAs than the dial offers;
                  the count it has stays selectable rather than silently shrinking. */}
              {(cast.dcas.length > DCA_LIMIT ? [...DCA_COUNTS, cast.dcas.length] : DCA_COUNTS)
                .map(count => (
                  <option key={count} value={count}>{count === 0 ? 'none' : count}</option>
                ))}
            </select>
          </label>
        </div>

        <div className="desk-row">
          <select
            className="desk-kind"
            aria-label="How the show reaches the desk"
            value={desk.kind}
            onChange={e => setKind(e.target.value as DeskSettings['kind'])}
          >
            <option value="osc">OSC</option>
            <option value="midi">MIDI</option>
            <option value="none">No desk</option>
          </select>

          {desk.kind === 'osc' && (
            <>
              <CommitInput
                className="desk-host"
                value={desk.host}
                placeholder="Host"
                aria-label="Desk host"
                onCommit={host => updateDeskSettings({ host })}
              />
              <CommitNumber
                className="desk-port"
                value={desk.port}
                min={1}
                max={65535}
                aria-label="Desk port"
                onCommit={port => updateDeskSettings({ port })}
              />
              <CommitInput
                className="desk-address"
                value={desk.address}
                placeholder="/dca/{n}/on"
                aria-label="Desk address"
                title="The address a DCA is sent to. {n} is its number."
                onCommit={address => updateDeskSettings({ address })}
              />
            </>
          )}

          {desk.kind === 'midi' && (
            <>
              <select
                className="desk-midi-port"
                aria-label="Desk MIDI port"
                value={desk.midiPort}
                onChange={e => updateDeskSettings({ midiPort: e.target.value })}
              >
                <option value="">— no port —</option>
                {portOptions.map(port => (
                  <option key={port} value={port}>{port}</option>
                ))}
              </select>
              <CommitNumber
                className="desk-midi-channel"
                value={desk.midiChannel}
                min={1}
                max={16}
                aria-label="Desk MIDI channel"
                onCommit={midiChannel => updateDeskSettings({ midiChannel })}
              />
            </>
          )}

          {desk.kind === 'none' && (
            <span className="desk-hint">Nothing is sent: the show is a roster and a set of cues.</span>
          )}
        </div>

        {/* The first and last of what the show will send, read back from the connection:
            the pattern and the port are easier to check as addresses than as a template. */}
        {desk.kind !== 'none' && !gap && (
          <div className="desk-preview">{
            desk.kind === 'osc'
              ? `${dcaAddress(desk.address, 0)} … ${dcaAddress(desk.address, Math.max(0, cast.dcas.length - 1))}`
              : `note ${dcaNumber(0)} … ${dcaNumber(Math.max(0, cast.dcas.length - 1))} → "${desk.midiPort}"`
          }</div>
        )}
        {gap !== null && <div className="desk-preview desk-gap">{gap}</div>}
      </div>

      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Channels</span>
          <button className="channel-add add-row" onClick={() => apply(addChannel(cast))}>
            + Channel
          </button>
        </div>

        {cast.channels.map((channel, index) => (
          <div className="channel-row" key={channel.id}>
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
              title="Which fader this mic rides: its own number unless a group shares one"
              onChange={e => apply(updateChannel(cast, channel.id, { dcaId: e.target.value || null }))}
            >
              <option value="">— no DCA —</option>
              {cast.dcas.map((dca, place) => (
                <option key={dca.id} value={dca.id}>{dcaNumber(place)} · {dca.label}</option>
              ))}
            </select>
            <button
              className="channel-remove"
              aria-label={`Remove channel ${index + 1}`}
              title="Remove this strip — undo puts it back"
              onClick={() => apply(removeChannel(cast, channel.id))}
            >✕</button>
          </div>
        ))}
      </div>

      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">DCAs</span>
        </div>

        {cast.dcas.length === 0 ? (
          <p className="show-empty">No DCAs: a show that drives no desk leaves this at none.</p>
        ) : (
          cast.dcas.map((dca, index) => {
            const carrying = cast.channels
              .filter(channel => channel.dcaId === dca.id)
              .map(channel => channelLabel(cast.channels, channel.id))
            const sent = deskMessages(dca, index, desk)?.unmute ?? null

            return (
              <div className="dca-row" key={dca.id}>
                <div className="dca-fields">
                  <span className="dca-number">{dcaNumber(index)}</span>
                  <CommitInput
                    className="dca-label"
                    value={dca.label}
                    placeholder="DCA"
                    aria-label={`DCA ${dcaNumber(index)} label`}
                    onCommit={label => apply(updateDca(cast, dca.id, { label }))}
                  />
                  {/* The override: empty means the message the number makes, and the
                      placeholder is that message, so the field says what will be sent
                      without being typed into. */}
                  {desk.kind === 'osc' && (
                    <CommitInput
                      className="dca-override"
                      value={dca.address ?? ''}
                      placeholder={dcaAddress(desk.address, index)}
                      aria-label={`DCA ${dcaNumber(index)} address`}
                      title="Sent instead of the address of its number. Clear it to go back."
                      onCommit={address => apply(updateDca(cast, dca.id, {
                        address: address.trim() === '' ? null : address
                      }))}
                    />
                  )}
                  {desk.kind === 'midi' && (
                    <CommitNumber
                      className="dca-override"
                      value={dca.note ?? dcaNumber(index)}
                      min={0}
                      max={127}
                      aria-label={`DCA ${dcaNumber(index)} note`}
                      title="Sent instead of the note of its number."
                      onCommit={note => apply(updateDca(cast, dca.id, {
                        note: note === dcaNumber(index) ? null : note
                      }))}
                    />
                  )}
                  <span className="dca-sent">
                    {sent === null ? 'not sent' : describeSent(sent)}
                  </span>
                </div>
                <div className="dca-carrying">
                  {carrying.length === 0 ? 'nothing assigned' : carrying.join(', ')}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** What one message will look like on the wire, short enough for a row. */
function describeSent(message: DeskMessage): string {
  if (message.kind === 'osc') return `${message.address} ${message.args.join(' ')}`
  const kind = message.message.kind
  return kind === 'sysex' ? `sysex ${message.message.data.length} bytes` : `${kind} ${message.message.channel}`
}
