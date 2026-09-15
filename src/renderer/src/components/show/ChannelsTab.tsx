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
import { dcaAddress, dcaChannel, dcaLimit, dcaNumber, dcaValue, dcaValueRange, deskChannelGap } from '../../utils/desk'
import { MUTE_GROUP_COUNT } from '../../utils/deskInput'
import { DCA_LIMIT } from '../../types/show'
import type { CastSettings, DeskProfile, DeskSettings } from '../../types/show'
import { TextField, NumberField } from '../common/Field'

const DCA_COUNTS = Array.from({ length: DCA_LIMIT + 1 }, (_, index) => index)

/** What the desk is missing before it can be driven at all, or null when it is ready. */
function deskGap(desk: DeskSettings): string | null {
  if (desk.kind === 'midi' && desk.midiPort === '') return 'No MIDI port chosen.'
  if (desk.kind === 'midi-tcp' && desk.host.trim() === '') return 'No desk address.'
  // A channel the DCAs do not answer on is the same kind of missing as an address nobody
  // typed: the row says so rather than previewing a send that cannot happen.
  if (deskChannelGap(desk.profile, desk.midiChannel) && desk.kind !== 'none' && desk.kind !== 'osc') {
    return 'An Avantis answers four channels above its own, so its MIDI channel is 12 or lower.'
  }
  return null
}

/** Whether this desk has the mute groups a button is assigned to. */
function hasMuteGroups(desk: DeskSettings): boolean {
  return (desk.kind === 'midi' || desk.kind === 'midi-tcp') && desk.profile !== 'note'
}

/** The group a select is standing on, or null for the option that assigns none. */
function muteGroupOf(value: string): number | null {
  return value === '' ? null : Number(value)
}

/** Whether one group has been given both buttons, which would run the show both ways. */
function sameButton(desk: DeskSettings): boolean {
  return desk.buttons.go !== null && desk.buttons.go === desk.buttons.back
}

/** Every mute group the desk has, and the option that assigns none. */
function MuteGroupOptions({ none }: { none: string }) {
  return (
    <>
      <option value="">— {none} —</option>
      {Array.from({ length: MUTE_GROUP_COUNT }, (_, index) => (
        <option key={index + 1} value={index + 1}>Mute group {index + 1}</option>
      ))}
    </>
  )
}

/**
 * What the show sends, read back from the connection. A pattern and a port are easier to
 * check as addresses than as fields, and this is the only place the convention lives, so
 * a DCA row is left saying what it is rather than what goes out of it.
 */
function deskPreview(desk: DeskSettings, dcas: number): string {
  const last = Math.max(0, dcas - 1)
  if (desk.kind === 'osc') {
    return `Sends ${dcaAddress(desk.address, 0)} … ${dcaAddress(desk.address, last)} to ${desk.host}:${desk.port}, with 1 to open and 0 to close`
  }
  const where = desk.kind === 'midi-tcp' ? `${desk.host}:${desk.tcpPort}` : `"${desk.midiPort}"`
  // A desk with fewer faders than the show drives is worth saying here, before the night:
  // a recall of the DCAs past its list cannot be sent, and the operator should not have to
  // fire one to find out.
  const limit = dcaLimit(desk.profile)
  const beyond = limit === null || dcas <= limit
    ? ''
    : `; the desk has ${limit}, so ${dcas - limit} of the show’s DCAs are not sent`
  if (desk.profile === 'sq') {
    return `Sends an SQ’s DCA mutes — NRPN page 02 on channel ${desk.midiChannel} — to ${where}${beyond}`
  }
  if (desk.profile === 'avantis') {
    return `Sends an Avantis’s DCA mutes — note-on, 7F on and 3F off, on channel ${dcaChannel(desk.profile, desk.midiChannel)} — to ${where}${beyond}`
  }
  return `Sends note ${dcaNumber(0)} … ${dcaNumber(last)} to ${where}, on and off${beyond}`
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
            {/* The desk's own socket: an SQ and an Avantis both serve MIDI on 51325. */}
            <option value="midi-tcp">MIDI (TCP)</option>
            <option value="none">No desk</option>
          </select>

          {/* What the desk takes as an open and a close. The app's own arrangement is the
              default because it is what every show has been sending; naming the desk is how
              an operator says which range is actually in the room. */}
          {desk.kind === 'midi' || desk.kind === 'midi-tcp' ? (
            <>
              <label className="desk-label" htmlFor="desk-profile">Model</label>
              <select
                id="desk-profile"
                className="desk-profile"
                aria-label="Desk model"
                value={desk.profile}
                title="What this desk takes as an open and a close"
                onChange={e => updateDeskSettings({ profile: e.target.value as DeskProfile })}
              >
                <option value="note">Any desk — note on, note off</option>
                <option value="sq">Allen &amp; Heath SQ</option>
                <option value="avantis">Allen &amp; Heath Avantis</option>
              </select>
            </>
          ) : null}

          {desk.kind === 'osc' && (
            <>
              {/* The fields are labelled rather than left to their values: an address is
                  only obvious to whoever typed it. */}
              <label className="desk-label" htmlFor="desk-host">Host</label>
              <TextField
                id="desk-host"
                className="desk-host"
                value={desk.host}
                placeholder="127.0.0.1"
                aria-label="Desk host"
                onValue={host => updateDeskSettings({ host })}
              />
              <label className="desk-label" htmlFor="desk-port">Port</label>
              <NumberField
                id="desk-port"
                className="desk-port"
                value={desk.port}
                min={1}
                max={65535}
                aria-label="Desk port"
                onValue={port => { if (port !== null) updateDeskSettings({ port }) }}
              />
              <label className="desk-label" htmlFor="desk-address">Address</label>
              <TextField
                id="desk-address"
                className="desk-address"
                value={desk.address}
                placeholder="/dca/{n}/on"
                aria-label="Desk address"
                title="The address a DCA is sent to. {n} is its number."
                onValue={address => updateDeskSettings({ address })}
              />
            </>
          )}

          {desk.kind === 'midi' && (
            <>
              <label className="desk-label" htmlFor="desk-midi-port">Port</label>
              <select
                id="desk-midi-port"
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
              <label className="desk-label" htmlFor="desk-midi-channel">Channel</label>
              <NumberField
                id="desk-midi-channel"
                className="desk-midi-channel"
                value={desk.midiChannel}
                min={1}
                max={16}
                aria-label="Desk MIDI channel"
                onValue={midiChannel => { if (midiChannel !== null) updateDeskSettings({ midiChannel }) }}
              />
            </>
          )}

          {desk.kind === 'midi-tcp' && (
            <>
              <label className="desk-label" htmlFor="desk-tcp-host">Host</label>
              <TextField
                id="desk-tcp-host"
                className="desk-tcp-host"
                value={desk.host}
                placeholder="10.0.0.5"
                aria-label="Desk host"
                onValue={host => updateDeskSettings({ host })}
              />
              <label className="desk-label" htmlFor="desk-tcp-port">Port</label>
              <NumberField
                id="desk-tcp-port"
                className="desk-tcp-port"
                value={desk.tcpPort}
                min={1}
                max={65535}
                aria-label="Desk MIDI TCP port"
                title="The desk's MIDI over TCP port — 51325 on an SQ and on an Avantis"
                onValue={tcpPort => { if (tcpPort !== null) updateDeskSettings({ tcpPort }) }}
              />
              <label className="desk-label" htmlFor="desk-tcp-channel">Channel</label>
              <NumberField
                id="desk-tcp-channel"
                className="desk-tcp-channel"
                value={desk.midiChannel}
                min={1}
                max={16}
                aria-label="Desk MIDI channel"
                title="The channel the desk's MIDI is set to — Utility → General → MIDI on an SQ"
                onValue={midiChannel => { if (midiChannel !== null) updateDeskSettings({ midiChannel }) }}
              />
            </>
          )}

          {desk.kind === 'none' && (
            <span className="desk-hint">Nothing is sent: the show is a roster and a set of cues.</span>
          )}
        </div>

        {/* The desk's own buttons: a mute group assigned to a key at the desk is a button
            that reports itself, which is the only kind a console offers. */}
        {hasMuteGroups(desk) && !gap && (
          <div className="desk-row desk-buttons">
            <label className="desk-label" htmlFor="desk-button-go">GO button</label>
            <select
              id="desk-button-go"
              className="desk-button-go"
              aria-label="Desk GO button"
              title="The mute group your GO key is assigned to at the desk"
              value={desk.buttons.go ?? ''}
              onChange={e => updateDeskSettings({
                buttons: { ...desk.buttons, go: muteGroupOf(e.target.value) }
              })}
            >
              <MuteGroupOptions none="no GO button" />
            </select>

            <label className="desk-label" htmlFor="desk-button-back">BACK button</label>
            <select
              id="desk-button-back"
              className="desk-button-back"
              aria-label="Desk BACK button"
              title="The mute group your BACK key is assigned to at the desk"
              value={desk.buttons.back ?? ''}
              onChange={e => updateDeskSettings({
                buttons: { ...desk.buttons, back: muteGroupOf(e.target.value) }
              })}
            >
              <MuteGroupOptions none="no BACK button" />
            </select>
          </div>
        )}
        {sameButton(desk) && !gap && (
          <div className="desk-preview desk-gap">
            One mute group cannot be both buttons.
          </div>
        )}
        {hasMuteGroups(desk) && !gap && !sameButton(desk) && (
          <div className="desk-hint">
            GO recalls the next scene, BACK the one before it, in the order the Scenes view
            shows them.
          </div>
        )}

        {/* What the show sends, read back from the connection: a pattern and a port are
            easier to check as addresses. This is the only place the convention lives, so a
            DCA row is left saying what it is rather than what goes out of it. */}
        {desk.kind !== 'none' && !gap && (
          <div className="desk-preview">{deskPreview(desk, cast.dcas.length)}</div>
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
            <TextField
              className="channel-name"
              value={channel.name}
              placeholder="Name"
              aria-label={`Channel ${index + 1} name`}
              onValue={name => apply(updateChannel(cast, channel.id, { name }))}
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
          <label className="dca-count">
            <span className="dca-count-label">Count</span>
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

        {cast.dcas.length === 0 ? (
          <p className="show-empty">No DCAs: a show that drives no desk leaves this at none.</p>
        ) : (
          cast.dcas.map((dca, index) => {
            const carrying = cast.channels
              .filter(channel => channel.dcaId === dca.id)
              .map(channel => channelLabel(cast.channels, channel.id))
            // What an override may be on this desk: the DCA block's own numbers, so the
            // field refuses one that would address something else on the desk.
            const range = dcaValueRange(desk.profile)
            return (
              <div className="dca-row" key={dca.id}>
                <div className="dca-fields">
                  <span className="dca-number">{dcaNumber(index)}</span>
                  <TextField
                    className="dca-label"
                    value={dca.label}
                    placeholder="DCA"
                    aria-label={`DCA ${dcaNumber(index)} label`}
                    onValue={label => apply(updateDca(cast, dca.id, { label }))}
                  />
                  {/* The override: empty means the message the number makes, and the
                      placeholder is that message, so the field says what will be sent
                      without being typed into. */}
                  {desk.kind === 'osc' && (
                    <TextField
                      className="dca-override"
                      value={dca.address ?? ''}
                      placeholder={dcaAddress(desk.address, index)}
                      aria-label={`DCA ${dcaNumber(index)} address`}
                      title="Sent instead of the address of its number. Clear it to go back."
                      onValue={address => apply(updateDca(cast, dca.id, {
                        address: address.trim() === '' ? null : address
                      }))}
                    />
                  )}
                  {(desk.kind === 'midi' || desk.kind === 'midi-tcp') && (
                    <NumberField
                      className="dca-override"
                      value={dca.note ?? dcaValue(index, desk.profile)}
                      min={range.min}
                      max={range.max}
                      aria-label={`DCA ${dcaNumber(index)} number`}
                      title={desk.profile === 'sq'
                        ? 'Sent instead of the NRPN parameter its place makes — 0 for DCA 1'
                        : 'Sent instead of the note its place makes'}
                      onValue={note => apply(updateDca(cast, dca.id, {
                        note: note === dcaValue(index, desk.profile) ? null : note
                      }))}
                    />
                  )}
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
