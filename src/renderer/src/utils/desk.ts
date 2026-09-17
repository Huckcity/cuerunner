import type { MidiMessageKind } from '../../../shared/cue'
import type { Dca, DeskMessage, DeskProfile, DeskSettings } from '../../../shared/show'

/**
 * How the desk is driven.
 *
 * The show has one connection and a DCA's message is derived from its number, so a
 * twelve-mic show is not twelve patches to type. A DCA that carries an override — a desk
 * that numbers its DCAs differently, a mute group on another address — is sent that
 * instead, and only for the connection it belongs to.
 *
 * What a desk makes of a number is the profile, because "open this fader" is the desk's
 * own arrangement and not the app's: a desk that takes notes takes one note, an SQ takes a
 * sequence of NRPN controllers and has eight DCAs, and an Avantis takes a note whose
 * velocity says which half of the pair it is, four channels above its own. A desk nobody
 * has described is sent what this app has always sent — one note, on and off.
 */

/** The number a DCA's own message carries: DCA 1 is note 1, and the DCA's place in the list. */
export function dcaNumber(index: number): number {
  return index + 1
}

/**
 * The address a DCA's own number makes. `{n}` is the number; a pattern without one has
 * the number appended, so `/dca/` and `/dca` both reach `/dca/4` — nobody has to learn
 * the placeholder to use the field.
 */
export function dcaAddress(pattern: string, index: number): string {
  const number = dcaNumber(index)
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
 * An SQ mutes with NRPN: `B0 63 02 B0 62 <parameter> B0 06 00 B0 26 <01|00>`. Its DCAs
 * are the parameters 0–7 of page 02, so DCA 1 is parameter 0 — the desk numbers them from
 * zero where the show numbers them from one.
 */
export const SQ_DCA_PAGE = 0x02
export const SQ_DCA_COUNT = 8

/**
 * An Avantis's DCAs are notes 36–45 on the channel four above the desk's own, and its
 * mute is a note-on whose velocity says which half of the pair it is: a received velocity
 * of 00 and a note-off are both ignored, which is why velocity 00 ends the message rather
 * than the message being the note-off the app's own arrangement sends.
 */
export const AVANTIS_DCA_FIRST_NOTE = 0x36
export const AVANTIS_DCA_COUNT = 16
export const AVANTIS_CHANNEL_OFFSET = 4
export const AVANTIS_MUTE_ON = 0x7f
export const AVANTIS_MUTE_OFF = 0x3f

/** The number this DCA's place makes on this desk, before any override. */
export function dcaValue(index: number, profile: DeskProfile): number {
  if (profile === 'sq') return index
  if (profile === 'avantis') return AVANTIS_DCA_FIRST_NOTE + index
  return dcaNumber(index)
}

/** The MIDI channel this profile's DCAs answer on. */
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
 * What the profile cannot address at all, or null when it can: a DCA past the desk's own
 * list, or a channel past the ones MIDI has.
 */
export function dcaGap(profile: DeskProfile, index: number, midiChannel: number): string | null {
  if (profile === 'sq' && index >= SQ_DCA_COUNT) return 'an SQ has eight DCAs'
  if (profile === 'avantis' && index >= AVANTIS_DCA_COUNT) return 'an Avantis has sixteen DCAs'
  if (deskChannelGap(profile, midiChannel)) {
    return 'an Avantis answers four channels above its own, so its MIDI channel is 12 or lower'
  }
  return null
}

/** An SQ's mute: select the parameter and its page, then set the value. */
export function sqMute(channel: number, parameter: number, on: boolean): MidiMessageKind[] {
  const cc = (controller: number, value: number): MidiMessageKind =>
    ({ kind: 'cc', channel, controller, value })
  return [cc(0x63, SQ_DCA_PAGE), cc(0x62, parameter), cc(0x06, 0x00), cc(0x26, on ? 0x01 : 0x00)]
}

/** An Avantis's mute: the note carrying which half, then velocity 00 to end it. */
export function avantisMute(channel: number, note: number, on: boolean): MidiMessageKind[] {
  return [
    { kind: 'noteOn', channel, note, velocity: on ? AVANTIS_MUTE_ON : AVANTIS_MUTE_OFF },
    { kind: 'noteOn', channel, note, velocity: 0x00 }
  ]
}

/**
 * The desk's own arrangement for one DCA, as the messages it takes. `value` is what the
 * DCA is addressed by on this desk — a note, or an SQ's NRPN parameter.
 */
export function profileMessages(
  profile: DeskProfile,
  channel: number,
  value: number,
  on: boolean
): MidiMessageKind[] {
  if (profile === 'sq') return sqMute(channel, value, on)
  if (profile === 'avantis') return avantisMute(channel, value, on)
  return [{ kind: on ? 'noteOn' : 'noteOff', channel, note: value, velocity: on ? 127 : 0 }]
}

/** A message over one of the ways this app speaks to a desk. */
export type MidiDeskMessage = Extract<DeskMessage, { kind: 'midi' }>
export type MidiTcpDeskMessage = Extract<DeskMessage, { kind: 'midi-tcp' }>
export type OscDeskMessage = Extract<DeskMessage, { kind: 'osc' }>

/**
 * What a DCA is sent on this show: its own patch when it carries an override, otherwise
 * the message its number makes.
 *
 * `null` is nothing to send at all — a show that drives no desk, and a MIDI one whose port
 * or address has not been chosen, because a message to nowhere is worse than none: the
 * recall would report a failure that means nothing. `{ error }` is the other kind of
 * nothing: a desk that is there and cannot be told about this DCA, which the operator is
 * owed rather than left to notice.
 */
export type DeskSend =
  | { ok: true; mute: DeskMessage; unmute: DeskMessage }
  | { ok: false; error: string }

export function deskMessages(
  dca: Dca,
  index: number,
  desk: DeskSettings
): DeskSend | null {
  if (desk.kind === 'none') return null

  if (desk.kind === 'osc') {
    const address = dca.address ?? dcaAddress(desk.address, index)
    return { ok: true, ...oscMessages(desk.host, desk.port, address) }
  }

  // Over a port and over the desk's own socket the desk's semantics are the same; only
  // the way the bytes leave this machine differs.
  const gap = dcaGap(desk.profile, index, desk.midiChannel)
  if (gap !== null) return { ok: false, error: gap }
  const channel = dcaChannel(desk.profile, desk.midiChannel)
  const value = dca.note ?? dcaValue(index, desk.profile)
  const opened = profileMessages(desk.profile, channel, value, true)
  const closed = profileMessages(desk.profile, channel, value, false)
  const unmute = deskMidi(desk, opened)
  const mute = deskMidi(desk, closed)
  // Both take the same envelope, so a null from either is the same "nowhere to send it".
  if (unmute === null || mute === null) return null
  return { ok: true, unmute, mute }
}

/**
 * Any sequence of MIDI messages addressed at the show's desk, or null when the show
 * drives no desk that takes MIDI at all.
 *
 * A DCA and a show control command both go this way, and they differ in what is sent
 * rather than where: this is the where, so neither has to decide it twice.
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

export function describeDeskMessage(message: DeskMessage | null): string {
  if (message === null) return 'nothing'
  if (message.kind === 'osc') {
    return `OSC ${message.address} ${message.args.join(' ')} → ${message.host}:${message.port}`
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
