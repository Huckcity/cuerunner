import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import {
  addChannel,
  updateChannel,
  updateDca
} from '../../utils/cast'
import { placementFor, rowChannels } from '../../utils/scenes'
import {
  channelLimit,
  dcaAddress,
  dcaLimit,
  dcaNumber,
  dcaValue,
  dcaValueRange,
  deskChannelGap
} from '../../utils/desk'
import { MUTE_GROUP_COUNT } from '../../utils/deskInput'
import { CHANNEL_LIMIT, DCA_LIMIT } from '../../../../shared/show'
import type { CastSettings, DeskProfile, DeskSettings } from '../../../../shared/show'
import { TextField, NumberField } from '../common/Field'

/**
 * The counts a dial offers: every size up to the limit, or — for a show already larger than
 * it — the show's own whole range, so each size between the two stays reachable and the
 * count it has is the count the dial reports.
 */
function dialCounts(length: number, limit: number): number[] {
  return Array.from({ length: Math.max(length, limit) + 1 }, (_, index) => index)
}

/** What the desk is missing before it can be driven at all, or null when it is ready. */
function deskGap(desk: DeskSettings): string | null {
  if (desk.kind === 'midi' && desk.midiPort === '') return 'No MIDI port chosen.'
  if (desk.kind === 'midi-tcp' && desk.host.trim() === '') return 'No desk address.'
  return null
}

/** Whether this desk has the mute groups a button is assigned to. */
function hasMuteGroups(desk: DeskSettings): boolean {
  return (desk.kind === 'midi' || desk.kind === 'midi-tcp') && desk.profile !== 'note'
}

/**
 * How many strips this show's desk takes, or null while no desk model is in force.
 *
 * A profile is a statement about a MIDI desk — which desk it is and how it is addressed —
 * so OSC and "no desk" state no ceiling, whatever the profile field happens to hold from
 * an earlier setup.
 */
function channelCeiling(desk: DeskSettings): number | null {
  return desk.kind === 'midi' || desk.kind === 'midi-tcp' ? channelLimit(desk.profile) : null
}

/**
 * Whether this desk has a key that transmits a MIDI note. An SQ's soft keys do — a key set
 * to MIDI Note sends note on while it is held — and the desk's own traffic there is NRPN,
 * so a note cannot be that desk echoing the app's DCA mutes back. An Avantis's mute groups
 * *are* notes and its surface keys latch, and the app's DCA mutes are notes on both it and
 * a `note` desk, so a note read there could be the app's own echo.
 */
function hasNoteKeys(desk: DeskSettings): boolean {
  return (desk.kind === 'midi' || desk.kind === 'midi-tcp') && desk.profile === 'sq'
}

/** The group a select is standing on, or null for the option that assigns none. */
function muteGroupOf(value: string): number | null {
  return value === '' ? null : Number(value)
}

/** Whether one group has been given both buttons, which would run the show both ways. */
function sameButton(desk: DeskSettings): boolean {
  // Absent and null are the same thing here, as everywhere else a field may be left out:
  // an older file's section has no `go` key at all, and two absent groups are two
  // unassigned buttons rather than one group given both.
  const go = desk.buttons.go ?? null
  return go !== null && go === (desk.buttons.back ?? null)
}

/** Whether one note has been given both buttons, which would run the show both ways. */
function sameNote(desk: DeskSettings): boolean {
  const go = desk.buttons.goNote ?? null
  return go !== null && go === (desk.buttons.backNote ?? null)
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
 * What a recall will touch, read back from the connection. The set is the show's own
 * channels — a recall writes their mutes and their membership and nothing else — and each
 * profile says what of that it can be told. A pattern and a port are easier to check as
 * addresses than as fields, and this is the only place the convention lives, so a DCA row
 * is left saying what it is rather than what goes out of it.
 */
function deskPreview(desk: DeskSettings, channels: number, dcas: number): string {
  // The set, as the operator counts it: the strips a recall writes, and nothing else.
  const set = channels === 1 ? '1 channel' : `${channels} channels`
  const mutes = channels === 1 ? `1 channel mute` : `${channels} channel mutes`
  const last = Math.max(1, channels)
  if (desk.kind === 'osc') {
    return `Sends ${dcaAddress(desk.address, 1)} … ${dcaAddress(desk.address, last)} to ${desk.host}:${desk.port}, with 1 to open and 0 to close — a recall writes ${mutes} there and takes no assignment`
  }
  const where = desk.kind === 'midi-tcp' ? `${desk.host}:${desk.tcpPort}` : `"${desk.midiPort}"`
  // A desk with fewer faders than the show drives is worth saying here, before the night:
  // a recall of the DCAs past its list cannot be sent, and the operator should not have to
  // fire one to find out.
  const limit = dcaLimit(desk.profile)
  const beyond = limit === null || dcas <= limit
    ? ''
    : `; the desk has ${limit}, so ${dcas - limit} of the show’s DCAs are not sent`
  // The strips are read the same way and by the same rule: the profile's own stated input
  // count, named with the number exceeded. Nothing is truncated on it — the ceiling is a
  // statement rather than a measurement, so a set past it is reported and sent as it always
  // was, and the count control is the one place the number is obeyed.
  const inputs = channelLimit(desk.profile)
  const past = inputs === null ? 0 : channels - inputs
  const channelsBeyond = inputs === null || past <= 0
    ? ''
    : `; the desk has ${inputs} inputs, so ${past === 1 ? '1 channel is' : `${past} channels are`} past its last one`
  if (desk.profile === 'sq') {
    // The assignment is written over the desk's own control service, which is the socket
    // only: a show that reaches its SQ through a MIDI port can mute it and nothing more.
    const assignment = desk.kind === 'midi-tcp'
      ? 'and its assignment over the desk’s own control service'
      : 'and no assignment — an SQ’s assignment needs the desk’s own control service, on its TCP route'
    return `Sends an SQ’s channel mutes — NRPN page 00 on channel ${desk.midiChannel} — to ${where}, ${assignment} — a recall writes ${set} and nothing else${channelsBeyond}${beyond}`
  }
  if (desk.profile === 'avantis') {
    return `Sends an Avantis’s channel mutes — note-on, 7F on and 3F off, on channel ${desk.midiChannel} — to ${where}, and its assignment as NRPN 40 on the same channel — a recall writes ${set} and nothing else${channelsBeyond}${beyond}`
  }
  return `Sends note 1 … ${last} to ${where}, on and off — a recall writes ${mutes} and takes no assignment`
}

/**
 * Channels: the console as the show sees it. Where the desk is, the strips on it, and
 * the faders a scene can place them on.
 *
 * It is set up once, so the defaults do the work: a new show has twelve strips and twelve
 * faders, and the only thing nobody can guess is where the desk is. A strip is a name and
 * a number — which fader it rides is the scene's decision, made in the Scenes view — and a
 * fader is a label and the number the desk answers it by, which is its place unless the
 * number beside it says otherwise.
 */
export function ChannelsTab() {
  const cast = useStore(s => s.showSettings.cast)
  const scenes = useStore(s => s.showSettings.scenes.list)
  const allowDuplicates = useStore(s => s.showSettings.scenes.allowDuplicateAssignment)
  const desk = useStore(s => s.showSettings.desk)
  const midiOutPort = useStore(s => s.midiSettings.outputPortName)
  const updateCastSettings = useStore(s => s.updateCastSettings)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)
  const updateDeskSettings = useStore(s => s.updateDeskSettings)
  const removeChannel = useStore(s => s.removeChannel)
  const setChannelCount = useStore(s => s.setChannelCount)
  const setDcaCount = useStore(s => s.setDcaCount)
  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    window.cuerunner.midi.listPorts().then(found => { if (mounted) setPorts(found) })
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
  // An Avantis answers for its buttons four channels above its own, which past channel 12
  // is past what MIDI has: a desk up there cannot be run from its keys, though a recall —
  // mutes and assignment both go on the desk's own channel — still sends.
  const buttonsBlocked = deskChannelGap(desk.profile, desk.midiChannel)
  // The desk's own ceiling where it states one, and the dial's own cap where it does not:
  // where the show is already larger, the options carry its whole range, so the set it has
  // and every size between it and the desk's number stay reachable.
  const ceiling = channelCeiling(desk) ?? CHANNEL_LIMIT
  const countOptions = dialCounts(cast.channels.length, ceiling)

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
        {hasMuteGroups(desk) && !gap && !buttonsBlocked && (
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
        {/* The block four channels up a high desk would answer on is past what MIDI has,
            so there are no keys to assign: the show is run from the window, and a recall
            still sends. */}
        {hasMuteGroups(desk) && !gap && buttonsBlocked && (
          <div className="desk-preview desk-gap">
            {`An Avantis reads its GO and BACK keys four channels above its own — past what MIDI has from channel ${desk.midiChannel} — so the desk cannot run the show from its keys, but a recall still sends.`}
          </div>
        )}
        {sameButton(desk) && !gap && !buttonsBlocked && (
          <div className="desk-preview desk-gap">
            One mute group cannot be both buttons.
          </div>
        )}
        {hasMuteGroups(desk) && !gap && !sameButton(desk) && !buttonsBlocked && (
          <div className="desk-hint">
            GO recalls the next scene, BACK the one before it, in the order the Scenes view
            shows them.
          </div>
        )}

        {/* A key that sends a MIDI note instead of toggling a group: an SQ's soft key set
            to MIDI Note transmits while it is held, so a press steps the show and nothing
            is left lit at the desk. The number is the desk's own setting, so the field
            takes the whole range and the steps to set it are its title. */}
        {hasNoteKeys(desk) && !gap && (
          <div className="desk-row desk-notes">
            <label className="desk-label" htmlFor="desk-note-go">GO note</label>
            <NumberField
              id="desk-note-go"
              className="desk-note desk-note-go"
              value={desk.buttons.goNote}
              min={0}
              max={127}
              aria-label="Desk GO note"
              title="The note your GO key transmits — at the desk: Setup → Surface → Soft Controls → MIDI Note. An SQ’s soft keys send 48–63."
              onValue={goNote => updateDeskSettings({ buttons: { ...desk.buttons, goNote } })}
            />

            <label className="desk-label" htmlFor="desk-note-back">BACK note</label>
            <NumberField
              id="desk-note-back"
              className="desk-note desk-note-back"
              value={desk.buttons.backNote}
              min={0}
              max={127}
              aria-label="Desk BACK note"
              title="The note your BACK key transmits — at the desk: Setup → Surface → Soft Controls → MIDI Note. An SQ’s soft keys send 48–63."
              onValue={backNote => updateDeskSettings({ buttons: { ...desk.buttons, backNote } })}
            />
          </div>
        )}
        {hasNoteKeys(desk) && !gap && sameNote(desk) && (
          <div className="desk-preview desk-gap">
            One note cannot be both buttons.
          </div>
        )}
        {hasNoteKeys(desk) && !gap && !sameNote(desk) && (
          <div className="desk-note-hint">
            Set the key in Setup → Surface → Soft Controls → MIDI Note for a key that does
            not stay lit; a mute group is for one that should.
          </div>
        )}

        {/* What a recall will touch, read back from the connection: the set and what this
            profile can be told of it. This is the only place the convention lives, so a
            DCA row is left saying what it is rather than what goes out of it. */}
        {desk.kind !== 'none' && !gap && (
          <div className="desk-preview">{deskPreview(desk, cast.channels.length, cast.dcas.length)}</div>
        )}
        {gap !== null && <div className="desk-preview desk-gap">{gap}</div>}
      </div>

      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Channels</span>
          <div className="show-section-tools">
            <label className="channel-count">
              <span className="channel-count-label">Count</span>
              <select
                className="channel-count-select"
                aria-label="Number of channels"
                title="How many strips the console has — set it to the desk's own input count and the list is that long"
                value={cast.channels.length}
                onChange={e => setChannelCount(Number(e.target.value))}
              >
                {/* A show larger than the desk states keeps its own count selectable, so
                    the control reads the show rather than truncating it. */}
                {countOptions.map(count => (
                  <option key={count} value={count}>{count === 0 ? 'none' : count}</option>
                ))}
              </select>
            </label>
            <button className="channel-add add-row" onClick={() => apply(addChannel(cast))}>
              + Channel
            </button>
          </div>
        </div>

        {/* A strip is a name and a number: which fader it rides is the scene's decision,
            made in the Scenes view, so there is nothing to choose here. */}
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
            <button
              className="channel-remove"
              aria-label={`Remove channel ${index + 1}`}
              title="Remove this strip — undo puts it back"
              onClick={() => removeChannel(channel.id)}
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
              title="How many faders the show drives — a fader that goes takes every scene’s row for that place with it, and one grown back comes back empty"
              value={cast.dcas.length}
              onChange={e => setDcaCount(Number(e.target.value))}
            >
              {/* A show from an older build can carry more DCAs than the dial offers; the
                  count it has, and every size between it and the dial, stay selectable
                  rather than the list being silently shrunk by its own count. */}
              {dialCounts(cast.dcas.length, DCA_LIMIT)
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
            // A fader's channels are placed per scene now, so this line names the scenes
            // that place something on it: a fader nobody places anything on is one a
            // recall never writes.
            const placing = scenes.filter(scene =>
              rowChannels(cast, placementFor(scene, dca.id)).length > 0).length
            const carrying = placing === 0
              ? 'nothing is placed on it yet'
              : placing === 1
                ? '1 scene places mics here'
                : `${placing} scenes place mics here`
            // What an override may be on this desk: the DCA block's own numbers, so the
            // field refuses one that would address something else on the desk.
            const range = dcaValueRange(desk.profile)
            // The number its place derives, which is what the field says until it is typed
            // in: empty means derived, so the placeholder carries it.
            const derived = dcaValue(index, desk.profile)
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
                  {/* The one override: empty means the number its place makes, and the
                      placeholder is that number, so the field says what will be sent
                      without being typed into. */}
                  {(desk.kind === 'midi' || desk.kind === 'midi-tcp') && (
                    <NumberField
                      className="dca-override"
                      value={dca.deskNumber}
                      min={range.min}
                      max={range.max}
                      placeholder={String(derived)}
                      aria-label={`DCA ${dcaNumber(index)} number`}
                      title={`Sent instead of the number its place makes — ${derived} for DCA ${dcaNumber(index)}. Clear it to go back.`}
                      onValue={deskNumber => apply(updateDca(cast, dca.id, {
                        deskNumber: deskNumber === derived ? null : deskNumber
                      }))}
                    />
                  )}
                </div>
                <div className="dca-carrying">
                  {carrying}
                </div>
              </div>
            )
          })
        )}

        {/* The grid's rule about a strip that rides two faders at once, which is the show's
            fact rather than a scene's — and the one part of the rule the grid itself cannot
            state. Left on, a channel rides as many faders as a scene places it on; switched
            off, the editor keeps one per channel in a scene and a recall folds whatever a
            file still carries down to the lowest-numbered fader. */}
        <label className="dca-rule">
          <input
            type="checkbox"
            className="dca-duplicates"
            checked={allowDuplicates}
            title="Off, placing a strip on a fader takes it off that scene's other faders, and a recall folds a leftover down to the lowest-numbered one"
            onChange={e => updateScenesSettings({ allowDuplicateAssignment: e.target.checked })}
          />
          <span>Allow a channel to ride more than one fader</span>
        </label>
      </div>
    </div>
  )
}
