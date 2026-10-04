import type { MidiMessageKind } from '../../shared/cue'

/**
 * What an SQ says about its DCA masters on the MIDI service (TCP 51325), as it was measured
 * on an SQ-6 running firmware 1.6.1 on 2026-10-04 — the capture is
 * `integration/fixtures/vendor/sq6-dca-levels-2026-10-04.json`.
 *
 * A DCA's level is NRPN page `4F`, parameters `20`–`27`, as a 14-bit value (`06` coarse, `26`
 * fine) from 0 at -inf to 16383 at the top of travel; its mute is page `02`, parameters
 * `00`–`07`, 1 on and 0 off. The desk transmits both unasked while a fader or a key moves,
 * and answers a get with the same message. Nothing here reads dB: the values only ever rise
 * as the fader does, so which of two faders is higher is a comparison of the numbers.
 */
const LEVEL_PAGE = 0x4f
const LEVEL_FIRST = 0x20
const MUTE_PAGE = 0x02

/** How many DCAs an SQ has, and so how many the reader and the gets cover. */
export const SQ_DCA_MASTERS = 8

/** One fact about one DCA: its level, or whether it is muted. The DCA is its own number, from 1. */
export type DcaReport =
  | { dca: number; level: number }
  | { dca: number; muted: boolean }

/**
 * Reads DCA reports off one desk's MIDI, one message at a time.
 *
 * The desk sends a report as four controller messages — page, parameter, coarse, fine — so
 * the reader holds the NRPN the way the desk does and answers only on the fine byte, which
 * is where a value is whole. Only the show's own MIDI channel is read: a desk transmits on
 * the channel its own setup names, and that is the channel the show was told.
 */
export class DcaReportReader {
  private page: number | null = null
  private parameter: number | null = null
  private coarse: number | null = null

  constructor(private readonly channel: number) {}

  read(message: MidiMessageKind): DcaReport | null {
    if (message.kind !== 'cc' || message.channel !== this.channel) return null
    switch (message.controller) {
      case 0x63:
        this.page = message.value
        this.parameter = null
        this.coarse = null
        return null
      case 0x62:
        this.parameter = message.value
        this.coarse = null
        return null
      case 0x06:
        this.coarse = message.value
        return null
      case 0x26:
        break
      default:
        return null
    }
    // A fine byte with no coarse before it is half a value, and half a level is not one.
    const { page, parameter, coarse } = this
    this.coarse = null
    if (page === null || parameter === null || coarse === null) return null
    if (page === LEVEL_PAGE && parameter >= LEVEL_FIRST && parameter < LEVEL_FIRST + SQ_DCA_MASTERS) {
      return { dca: parameter - LEVEL_FIRST + 1, level: (coarse << 7) | message.value }
    }
    if (page === MUTE_PAGE && parameter < SQ_DCA_MASTERS) {
      return { dca: parameter + 1, muted: message.value !== 0 }
    }
    return null
  }

  /** Forgets a half-read message: a link that dropped mid-report will never finish it. */
  reset(): void {
    this.page = null
    this.parameter = null
    this.coarse = null
  }
}

/**
 * The gets that ask an SQ where every DCA master stands: its level and its mute. A get is the
 * page and the parameter selected, then the increment carrying 7F, and the desk answers each
 * with the report it would have sent had the fader moved (measured in 5–40 ms).
 */
export function dcaGets(channel: number): MidiMessageKind[] {
  const cc = (controller: number, value: number): MidiMessageKind =>
    ({ kind: 'cc', channel, controller, value })
  const gets: MidiMessageKind[] = []
  for (let index = 0; index < SQ_DCA_MASTERS; index++) {
    gets.push(cc(0x63, LEVEL_PAGE), cc(0x62, LEVEL_FIRST + index), cc(0x60, 0x7f))
    gets.push(cc(0x63, MUTE_PAGE), cc(0x62, index), cc(0x60, 0x7f))
  }
  return gets
}
