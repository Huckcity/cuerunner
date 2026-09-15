import type { MidiMessageKind } from '../types/cue'
import type { MscCommand, MscFormat } from '../types/cue'

/**
 * MIDI Show Control: how a show tells a console to go, stop, load or reset, and how a
 * console tells the show the same thing back.
 *
 * The wire is one universal system exclusive —
 * `F0 7F <device> 02 <format> <command> <data> F7` — and the data is the receiving
 * console's own cue number and cue list, in ASCII, with `00` between the fields. The
 * codes and the order are MIDI Show Control 1.0 (MMA RP-002), and the tests hold this
 * file to the worked examples the vendors publish rather than to its own opinion: ETC's
 * `F0 7F 03 02 01 01 35 2E 34 00 39 39` is "Go cue 5.4 of list 99", and an Allen & Heath
 * SQ's `F0 7F 7F 02 7F 01 31 32 00 F7` is "Go cue 12".
 *
 * A message is addressed to a device and a format and both have to match before a console
 * acts on it, which is why a show that has not been told otherwise sends the all-call
 * device ID and the all-types format: every device has to answer the all-call, so a
 * command with nowhere in particular to go still arrives.
 */

/** The specification's command format bytes, by the name the app uses for them. */
export const MSC_FORMAT_BYTE: Record<MscFormat, number> = {
  lighting: 0x01,
  sound: 0x10,
  machinery: 0x20,
  video: 0x30,
  projection: 0x40,
  all: 0x7f
}

/** The commands this app sends, by the name the app uses for them. */
export const MSC_COMMAND_BYTE: Record<MscCommand, number> = {
  go: 0x01,
  stop: 0x02,
  resume: 0x03,
  load: 0x05,
  reset: 0x0a
}

/** How each is written in a menu and in the log. */
export const MSC_FORMAT_NAME: Record<MscFormat, string> = {
  lighting: 'Lighting',
  sound: 'Sound',
  machinery: 'Machinery',
  video: 'Video',
  projection: 'Projection',
  all: 'Everything'
}

export const MSC_COMMAND_NAME: Record<MscCommand, string> = {
  go: 'Go',
  stop: 'Stop',
  resume: 'Resume',
  load: 'Load',
  reset: 'Reset'
}

export const MSC_FORMATS = Object.keys(MSC_FORMAT_BYTE) as MscFormat[]
export const MSC_COMMANDS = Object.keys(MSC_COMMAND_BYTE) as MscCommand[]

/** The all-call device ID: every device answers it, whatever it is set to. */
export const MSC_ALL_CALL = 0x7f

/** The reverse tables, built from the same lists the encoder writes with. */
function invert<T extends string>(table: Record<T, number>): Record<number, T> {
  const inverted: Record<number, T> = {}
  for (const [name, byte] of Object.entries(table) as [T, number][]) inverted[byte] = name
  return inverted
}

const FORMAT_OF = invert(MSC_FORMAT_BYTE)
const COMMAND_OF = invert(MSC_COMMAND_BYTE)

/** A show control message, as it goes out and as it is read back in. */
export interface MscMessage {
  /** The receiving device: 0–111, a group, or 127 for the all-call. */
  deviceId: number
  format: MscFormat
  command: MscCommand
  /**
   * The cue number on the receiving console, in its own numbering — "12", "5.4". Empty
   * means the next cue, which is what a console does with a GO that names none.
   */
  cueNumber: string
  /** The receiving console's cue list. Empty is whatever it has open. */
  cueList: string
}

/** The bytes of one character of cue data: printable ASCII, and nothing else. */
function charByte(character: string): number | null {
  const code = character.charCodeAt(0)
  return code >= 0x20 && code <= 0x7e ? code : null
}

/**
 * The cue number and cue list, in the specification's standard form:
 * `<Q_number> 00 <Q_list>`. Either field may be left out, and a cue list without a cue
 * number still carries the delimiter that says the number was not sent — "00 33" is
 * "the next cue of list 3".
 */
export function mscCueData(cueNumber: string, cueList: string): number[] {
  const number = [...cueNumber].map(charByte).filter((byte): byte is number => byte !== null)
  const list = [...cueList].map(charByte).filter((byte): byte is number => byte !== null)
  if (number.length === 0) return list.length === 0 ? [] : [0x00, ...list]
  if (list.length === 0) return [...number, 0x00]
  return [...number, 0x00, ...list]
}

/** The system exclusive body of a show control message, without its F0 and F7. */
export function mscBytes(message: MscMessage): number[] {
  return [
    0x7f,
    message.deviceId & 0x7f,
    0x02,
    MSC_FORMAT_BYTE[message.format],
    MSC_COMMAND_BYTE[message.command],
    ...mscCueData(message.cueNumber, message.cueList)
  ]
}

/** The message as the app sends it: a sysex, which the MIDI engines frame with F0 and F7. */
export function encodeMsc(message: MscMessage): MidiMessageKind {
  return { kind: 'sysex', data: mscBytes(message) }
}

/** The fields of a message's data: cue number, cue list, cue path — `00` between them. */
function mscFields(data: number[]): string[] {
  const fields: string[] = []
  let field = ''
  for (const byte of data) {
    if (byte === 0x00) {
      fields.push(field)
      field = ''
      continue
    }
    if (byte >= 0x20 && byte <= 0x7e) field += String.fromCharCode(byte)
  }
  fields.push(field)
  return fields
}

/**
 * A show control message read from an incoming MIDI message, or null when it is not one.
 *
 * Anything this app does not understand — an extension-level format or command, a
 * malformed body — is null rather than a guess: a message nobody can read must not fire
 * a cue. Trailing delimiters are tolerated, because the specification tells receiving
 * devices to accept them.
 */
export function parseMsc(message: MidiMessageKind): MscMessage | null {
  if (message.kind !== 'sysex') return null
  const [universal, deviceId, subId, formatByte, commandByte, ...data] = message.data
  if (universal !== 0x7f || subId !== 0x02) return null
  if (deviceId === undefined || formatByte === undefined || commandByte === undefined) return null

  const format = FORMAT_OF[formatByte]
  const command = COMMAND_OF[commandByte]
  if (format === undefined || command === undefined) return null

  const [cueNumber = '', cueList = ''] = mscFields(data)
  return { deviceId: deviceId & 0x7f, format, command, cueNumber, cueList }
}

/**
 * What the command is, in the words a console's own front panel uses: `Go cue 12.5 in
 * list 2`, `Reset`. Used in the log, where an operator reads what a cue did and what a
 * trigger answered to.
 */
export function describeMsc(message: MscMessage): string {
  const where: string[] = []
  if (message.cueNumber !== '') where.push(`cue ${message.cueNumber}`)
  if (message.cueList !== '') where.push(`list ${message.cueList}`)
  return [MSC_COMMAND_NAME[message.command], ...where].join(' ')
}
