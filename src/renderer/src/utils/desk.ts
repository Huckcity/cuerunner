import type { MidiMessageKind } from '../../../shared/cue'
import type { Dca, DeskMessage, DeskProfile, DeskSettings } from '../../../shared/show'

/**
 * How the desk is driven.
 *
 * Two facts go to a desk and they are addressed differently, which is the whole point of
 * this file. *Membership* — which channels ride which fader — is the desk's assignment, and
 * each profile writes it its own way. A *mute* belongs to the mic, so it carries the
 * channel's own number and never a fader's: a DCA is a control group, and closing one is not
 * how a mic is silenced (AD-26).
 *
 * One table per fact: the channel's own number per profile, the fader's own number per
 * profile, and the gap each profile cannot address at all. Nothing here derives a number a
 * second way.
 */

/** A fader's own number as the show counts them: its place in the list, from one. */
export function dcaNumber(index: number): number {
  return index + 1
}

/** The number this DCA's place makes on this desk, before any override. */
export function dcaValue(index: number, profile: DeskProfile): number {
  if (profile === 'sq') return index
  if (profile === 'avantis') return AVANTIS_DCA_FIRST_NOTE + index
  return dcaNumber(index)
}

/**
 * How far along the desk's own list this fader sits, from zero: its place in the show, or
 * the number the show gave it. Every profile's own map starts here, so an override is read
 * in the numbering the operator typed it in and nothing has to know which desk it is for.
 */
export function dcaPlace(dca: Dca, index: number, profile: DeskProfile): number {
  if (dca.deskNumber === null) return index
  return dca.deskNumber - dcaValue(0, profile)
}

/**
 * The address a fader's own number makes. `{n}` is the number; a pattern without one has
 * the number appended, so `/dca/` and `/dca` both reach `/dca/4` — nobody has to learn
 * the placeholder to use the field.
 */
export function dcaAddress(pattern: string, number: number): string {
  if (pattern.includes('{n}')) return pattern.replaceAll('{n}', String(number))
  const trimmed = pattern.trim()
  if (trimmed === '') return `/${number}`
  return trimmed.endsWith('/') ? `${trimmed}${number}` : `${trimmed}/${number}`
}

/** The same arrangement over OSC: one address, open value and close value. */
export function oscMessages(
  host: string,
  port: number,
  address: string,
  open: number[] = [1],
  close: number[] = [0]
): { mute: OscDeskMessage; unmute: OscDeskMessage } {
  return {
    unmute: { kind: 'osc', host, port, address, args: open },
    mute: { kind: 'osc', host, port, address, args: close }
  }
}

/* ── What each desk takes ────────────────────────────────────────────────────── */

/**
 * An SQ mutes a channel with NRPN on page 00 — the input mutes — where the parameter is the
 * input's own number from zero: `B0 63 00 B0 62 <channel-1> B0 06 00 B0 26 <01|00>`.
 *
 * Its DCAs are the parameters 0–7 of page 02, and this app writes none of them: what a fader
 * is told is the assignment, and the SQ's assignment lives on the desk's own control service
 * rather than on this MIDI link (`INTEGRATION-HARNESS.md` §6). Page 02 stays in the record
 * there and in the desk's own guide; nothing here sends it.
 */
export const SQ_CHANNEL_PAGE = 0x00
export const SQ_DCA_COUNT = 8

/**
 * The inputs an SQ states: 48, the width of its own input list. Like the other ceilings in
 * this file it is the profile's number rather than a measurement — see `channelLimit`.
 */
export const SQ_INPUT_COUNT = 48

/**
 * An Avantis assigns an input to a DCA with NRPN `40` on the strip's own NRPN: the
 * parameter's MSB names the input, `40` is the assignment, and the value carries `40 + the
 * fader's place` into the DCA and the place alone out of it. It goes on the desk's own
 * channel, where its inputs answer.
 *
 * The range's DCAs are notes 36–45 on the channel four above the desk's own, and its mute is
 * a note-on whose velocity says which half of the pair it is: a received velocity of 00 and a
 * note-off are both ignored, which is why velocity 00 ends the message rather than the
 * message being the note-off the app's own arrangement sends. That block is the desk's own —
 * its DCAs and its mute groups — and a recall writes neither: what a show's buttons are read
 * from is there, and there is nothing else in this app that addresses it.
 */
export const AVANTIS_ASSIGN_NRPN = 0x40
export const AVANTIS_DCA_FIRST_NOTE = 0x36
export const AVANTIS_DCA_COUNT = 16

/**
 * The inputs an Avantis states: 96, the width of its own input list, and the widest any
 * profile here states — which is why `CHANNEL_LIMIT` is this number.
 */
export const AVANTIS_INPUT_COUNT = 96
export const AVANTIS_CHANNEL_OFFSET = 4
export const AVANTIS_MUTE_ON = 0x7f
export const AVANTIS_MUTE_OFF = 0x3f

/**
 * The MIDI channel a *fader's* own block answers on — the DCAs and the mute groups, which both
 * ranges put four channels above the desk's own.
 *
 * A mic is not in that block. Every range addresses its inputs on the desk's own channel: an
 * Avantis's inputs are `CH 00–5F` on `N` and its DCAs are on `N+4`, so the two never share a
 * message. What a channel's mute and its assignment both use is therefore the desk's own
 * channel, and this function is left to the one route that is genuinely the fader block: the
 * mute groups a show's buttons are read from.
 */
export function dcaChannel(profile: DeskProfile, midiChannel: number): number {
  return profile === 'avantis' ? midiChannel + AVANTIS_CHANNEL_OFFSET : midiChannel
}

/**
 * How many DCAs the desk's own list has, or null when the profile addresses as many as
 * the show drives.
 */
export function dcaLimit(profile: DeskProfile): number | null {
  if (profile === 'sq') return SQ_DCA_COUNT
  if (profile === 'avantis') return AVANTIS_DCA_COUNT
  return null
}

/**
 * How many inputs the desk states — the ceiling a show's channel set is read against, and
 * the number the desk connection names when a show is larger than it.
 *
 * These are the profiles' own published channel counts, taken as statements rather than
 * measured: no desk has been asked, and a profile that states one wrongly reports a gap
 * for a set the desk could take. That is why nothing here refuses: the count control's
 * options stop at the number, and a show that is already larger is reported and sent
 * exactly as it was sent before. Null is a profile that states none — the app's own note
 * convention, and any desk reached over OSC.
 */
export function channelLimit(profile: DeskProfile): number | null {
  if (profile === 'sq') return SQ_INPUT_COUNT
  if (profile === 'avantis') return AVANTIS_INPUT_COUNT
  return null
}

/**
 * The numbers a DCA can be addressed by on this desk, which is what an override may be:
 * the DCA block's own range, so the field refuses a number that would address something
 * else entirely rather than sending it and saying nothing.
 */
export function dcaValueRange(profile: DeskProfile): { min: number; max: number } {
  const limit = dcaLimit(profile)
  if (limit === null) return { min: 0, max: 127 }
  return { min: dcaValue(0, profile), max: dcaValue(limit - 1, profile) }
}

/** Whether this profile's DCAs can answer on this channel at all. */
export function deskChannelGap(profile: DeskProfile, midiChannel: number): boolean {
  return profile === 'avantis' && dcaChannel(profile, midiChannel) > 16
}

/**
 * What the profile cannot address at all, or null when it can: a fader past the desk's own
 * DCA list.
 *
 * It is the DCA list alone — not the desk's channel, which `deskChannelGap` speaks for. The
 * block four channels above an Avantis's own is where its DCAs and its *mute groups* are, and
 * a recall writes the mic's mute and its assignment, both of which every range addresses on
 * the desk's own channel. A show whose desk sits too high for the group block can still be
 * recalled; what it cannot do is read its buttons.
 *
 * The number it exceeded is not in the sentence — the caller has the fader in hand and names
 * it, the way the log's "DCA 9: an SQ has eight DCAs" reads.
 */
export function dcaGap(profile: DeskProfile, index: number): string | null {
  if (profile === 'sq' && index >= SQ_DCA_COUNT) return 'an SQ has eight DCAs'
  if (profile === 'avantis' && index >= AVANTIS_DCA_COUNT) return 'an Avantis has sixteen DCAs'
  return null
}

/** One NRPN: the page and the parameter selected, then the value written. */
function nrpn(channel: number, page: number, parameter: number, value: number): MidiMessageKind[] {
  const cc = (controller: number, data: number): MidiMessageKind =>
    ({ kind: 'cc', channel, controller, value: data })
  return [cc(0x63, page), cc(0x62, parameter), cc(0x06, 0x00), cc(0x26, value)]
}

/** An SQ's channel mute: the input's own page and parameter, then the value. */
export function sqChannelMute(channel: number, input: number, on: boolean): MidiMessageKind[] {
  return nrpn(channel, SQ_CHANNEL_PAGE, input, on ? 0x01 : 0x00)
}

/** An Avantis's mute: the note carrying which half, then velocity 00 to end it. */
export function avantisMute(channel: number, note: number, on: boolean): MidiMessageKind[] {
  return [
    { kind: 'noteOn', channel, note, velocity: on ? AVANTIS_MUTE_ON : AVANTIS_MUTE_OFF },
    { kind: 'noteOn', channel, note, velocity: 0x00 }
  ]
}

/**
 * An Avantis's DCA assignment: the strip's own NRPN, the assign parameter, and the value
 * that names the fader — `40 + place` into it, the place alone out of it.
 */
export function avantisAssign(
  channel: number,
  input: number,
  place: number,
  placed: boolean
): MidiMessageKind[] {
  const cc = (controller: number, value: number): MidiMessageKind =>
    ({ kind: 'cc', channel, controller, value })
  return [
    cc(0x63, input),
    cc(0x62, AVANTIS_ASSIGN_NRPN),
    cc(0x06, placed ? AVANTIS_ASSIGN_NRPN + place : place)
  ]
}

/** A message over one of the ways this app speaks to a desk. */
export type MidiDeskMessage = Extract<DeskMessage, { kind: 'midi' }>
export type MidiTcpDeskMessage = Extract<DeskMessage, { kind: 'midi-tcp' }>
export type OscDeskMessage = Extract<DeskMessage, { kind: 'osc' }>

/**
 * What one write is, or why it cannot be made.
 *
 * `null` is nothing to send at all — a show that drives no desk, and a MIDI one whose port
 * or address has not been chosen, because a message to nowhere is worse than none: the
 * recall would report a failure that means nothing. `{ error }` is the other kind of
 * nothing: a desk that is there and cannot be told this, which the operator is owed rather
 * than left to notice.
 */
export type DeskWrite = { ok: true; message: DeskMessage } | { ok: false; error: string }

/** The two writes a channel's mute is: closed, and open. */
export interface ChannelMutes {
  /** Muted: the scene does not place the channel, or the all-closed column was recalled. */
  close: DeskMessage
  open: DeskMessage
}

/**
 * A mic's mute, addressed by the channel's own number on whatever desk is in the room.
 *
 * A fader is nowhere in this: the channel's number is its place in the controlled set, and
 * each profile says how a mixer is told to mute that input — an SQ's page 00 parameter, an
 * Avantis's note on the strip, an app-convention note, an OSC address with the number in it.
 */
export function channelMutes(channelIndex: number, desk: DeskSettings): ChannelMutes | null {
  if (desk.kind === 'none') return null
  // The channel's own number is its place in the controlled set, from one.
  const number = channelIndex + 1
  if (desk.kind === 'osc') {
    const { mute, unmute } = oscMessages(desk.host, desk.port, dcaAddress(desk.address, number))
    return { open: unmute, close: mute }
  }

  // A mic is an input, and every range addresses its inputs on the desk's own channel: an
  // Avantis's block four channels up is its DCAs and its mute groups, which is a different
  // message space rather than a longer way round to the same note.
  const midi = desk.midiChannel
  const open = desk.profile === 'sq'
    ? sqChannelMute(midi, channelIndex, false)
    : desk.profile === 'avantis'
      // An Avantis's inputs are the notes the strip's own number makes, from zero.
      ? avantisMute(midi, channelIndex, false)
      : [{ kind: 'noteOn' as const, channel: midi, note: number, velocity: 127 }]
  const close = desk.profile === 'sq'
    ? sqChannelMute(midi, channelIndex, true)
    : desk.profile === 'avantis'
      ? avantisMute(midi, channelIndex, true)
      : [{ kind: 'noteOff' as const, channel: midi, note: number, velocity: 0 }]
  const opened = deskMidi(desk, open)
  const closed = deskMidi(desk, close)
  // Both take the same envelope, so a null from either is the same "nowhere to send it".
  if (opened === null || closed === null) return null
  return { open: opened, close: closed }
}

/**
 * A fader's membership write: placing one channel on it, or taking the channel off.
 *
 * Each profile has its own route, and the two that have one could hardly be less alike —
 * an SQ is the desk's own control service, which main speaks and the renderer only asks; an
 * Avantis is an NRPN on the desk link's MIDI. The profiles without an assignment at all
 * (the app's own note convention, and OSC) say so rather than nothing: the mute still goes,
 * so a silent gap would be a recall that half worked and said nothing about the half that
 * did not.
 */
export function membershipWrite(
  channelIndex: number,
  dca: Dca,
  index: number,
  placed: boolean,
  rides: boolean,
  desk: DeskSettings
): DeskWrite | null {
  if (desk.kind === 'none') return null

  const gap = dcaGap(desk.profile, index)
  if (gap !== null) return { ok: false, error: gap }
  const place = dcaPlace(dca, index, desk.profile)
  // What the frame carries is the fader's *place*, so an override past the profile's list —
  // a hand-edited file, or a show re-pointed at another range — is a frame for a fader the
  // desk has not got, and it would be recorded as landed. The index alone does not see it.
  const beyond = dcaLimit(desk.profile)
  if (beyond !== null && place >= beyond) {
    return {
      ok: false,
      error: `fader ${place + 1} is past the desk’s DCAs — ${dcaGap(desk.profile, place)}`
    }
  }
  if (place < 0) {
    return {
      ok: false,
      error: `a desk number of ${dca.deskNumber} is before the desk’s first DCA`
    }
  }

  // The desk's own service, and the one route that is not a message: main owns those frames,
  // so what leaves here is the intent — which channel, which fader, placed or cleared, and
  // whether the channel rides a fader at all after this write. It is a MIDI-over-TCP desk's
  // route and nothing else's: an SQ on a plain MIDI port has no way to be told an assignment.
  if (desk.profile === 'sq') {
    if (desk.kind !== 'midi-tcp') {
      return {
        ok: false,
        error: "an SQ's assignment needs the desk's own control service on its TCP port"
      }
    }
    // No address is no desk: the service idles for the same reason, and a send to nowhere is
    // a failure the log would report for nothing.
    if (desk.host.trim() === '') return null
    return {
      ok: true,
      message: {
        kind: 'sq-native',
        // The frame's own convention: the channel's own number, and the fader's, both
        // from one — the codec subtracts the zero each of them carries.
        channel: channelIndex + 1,
        dca: place + 1,
        placed,
        rides
      }
    }
  }

  if (desk.kind === 'osc') return { ok: false, error: 'OSC takes no assignment' }

  if (desk.profile === 'avantis') {
    // The strip's own NRPN, on the desk's own channel: the parameter's MSB names the input
    // and the value names the fader.
    const assigned = deskMidi(desk, avantisAssign(desk.midiChannel, channelIndex, place, placed))
    return assigned === null ? null : { ok: true, message: assigned }
  }

  return { ok: false, error: 'a note desk takes no assignment' }
}

/**
 * Any sequence of MIDI messages addressed at the show's desk, or null when the show
 * drives no desk that takes MIDI at all.
 *
 * A message of the show's own arrangement and a show control command both go this way, and
 * they differ in what is sent rather than where: this is the where, so neither has to decide
 * it twice.
 */
export function deskMidi(
  desk: DeskSettings,
  messages: MidiMessageKind[]
): MidiDeskMessage | MidiTcpDeskMessage | null {
  if (desk.kind === 'midi') {
    return desk.midiPort === '' ? null : { kind: 'midi', portName: desk.midiPort, messages }
  }
  if (desk.kind === 'midi-tcp') {
    return desk.host.trim() === ''
      ? null
      : { kind: 'midi-tcp', host: desk.host, port: desk.tcpPort, messages }
  }
  return null
}

/** What one write is, as the recall's log reads it. */
export function describeDeskMessage(message: DeskMessage | null): string {
  if (message === null) return 'nothing'
  if (message.kind === 'osc') {
    return `OSC ${message.address} ${message.args.join(' ')} → ${message.host}:${message.port}`
  }
  if (message.kind === 'sq-native') {
    const where = message.placed ? 'onto' : 'off'
    return `SQ assign ch${message.channel} ${where} DCA ${message.dca}`
  }
  const where = message.kind === 'midi-tcp'
    ? `${message.host}:${message.port}`
    : `"${message.portName}"`
  // A vendor arrangement is several messages and no single one of them says what it does,
  // so the count is the honest description.
  if (message.messages.length !== 1) return `${message.messages.length} messages → ${where}`
  const [only] = message.messages
  if (only.kind === 'sysex') return `sysex ${only.data.length} bytes → ${where}`
  return `${only.kind} ch${only.channel} → ${where}`
}
