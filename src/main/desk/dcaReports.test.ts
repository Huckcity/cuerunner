// The DCA masters as the desk reports them on its MIDI service. The bytes are the 2026-10-04
// capture's own (integration/fixtures/vendor/sq6-dca-levels-2026-10-04.json): DCA 1 rising off
// -inf to its first step, its mute, and the get the desk answers.
import { describe, expect, it } from 'vitest'
import { DcaReportReader, dcaGets, type DcaReport } from './dcaReports'
import type { MidiMessageKind } from '../../shared/cue'

/** Raw controller bytes as the desk sent them, as the decoder hands them over. */
function cc(...bytes: number[]): MidiMessageKind[] {
  const messages: MidiMessageKind[] = []
  for (let index = 0; index < bytes.length; index += 3) {
    messages.push({
      kind: 'cc',
      channel: (bytes[index] & 0x0f) + 1,
      controller: bytes[index + 1],
      value: bytes[index + 2]
    })
  }
  return messages
}

function read(reader: DcaReportReader, messages: MidiMessageKind[]): DcaReport[] {
  return messages.flatMap(message => {
    const report = reader.read(message)
    return report === null ? [] : [report]
  })
}

describe('DcaReportReader', () => {
  it('reads a DCA level as the 14-bit value the desk sent, on the fine byte', () => {
    const reader = new DcaReportReader(1)
    expect(read(reader, cc(0xb0, 0x63, 0x4f, 0xb0, 0x62, 0x20, 0xb0, 0x06, 0x1a, 0xb0, 0x26, 0x72)))
      .toEqual([{ dca: 1, level: 3442 }])
    // The eighth master, and unity as eight reset masters read it: 76 5C.
    expect(read(reader, cc(0xb0, 0x63, 0x4f, 0xb0, 0x62, 0x27, 0xb0, 0x06, 0x76, 0xb0, 0x26, 0x5c)))
      .toEqual([{ dca: 8, level: 15196 }])
  })

  it('reads a DCA mute on and off', () => {
    const reader = new DcaReportReader(1)
    expect(read(reader, cc(
      0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x01,
      0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x00
    ))).toEqual([{ dca: 1, muted: true }, { dca: 1, muted: false }])
  })

  it('reads nothing but the DCA masters, and only on the show’s channel', () => {
    const reader = new DcaReportReader(1)
    // Input 1 to LR (40 00), the aux 8 master (4F 08), a mute group (04 00), and DCA 1 on
    // another channel: real parameters, none of them a DCA master on this desk's channel.
    expect(read(reader, cc(
      0xb0, 0x63, 0x40, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x76, 0xb0, 0x26, 0x1f,
      0xb0, 0x63, 0x4f, 0xb0, 0x62, 0x08, 0xb0, 0x06, 0x51, 0xb0, 0x26, 0x75,
      0xb0, 0x63, 0x04, 0xb0, 0x62, 0x00, 0xb0, 0x06, 0x00, 0xb0, 0x26, 0x01,
      0xb1, 0x63, 0x4f, 0xb1, 0x62, 0x20, 0xb1, 0x06, 0x1a, 0xb1, 0x26, 0x72
    ))).toEqual([])
  })

  it('reads no value from a fine byte with no coarse byte before it', () => {
    const reader = new DcaReportReader(1)
    expect(read(reader, cc(0xb0, 0x63, 0x4f, 0xb0, 0x62, 0x20, 0xb0, 0x26, 0x72))).toEqual([])
    reader.reset()
    expect(read(reader, cc(0xb0, 0x06, 0x1a, 0xb0, 0x26, 0x72))).toEqual([])
  })
})

describe('dcaGets', () => {
  it('asks every master for its level and its mute, as the desk answered on 2026-10-04', () => {
    const gets = dcaGets(1)
    expect(gets).toHaveLength(8 * 2 * 3)
    expect(gets.slice(0, 6)).toEqual(cc(
      0xb0, 0x63, 0x4f, 0xb0, 0x62, 0x20, 0xb0, 0x60, 0x7f,
      0xb0, 0x63, 0x02, 0xb0, 0x62, 0x00, 0xb0, 0x60, 0x7f
    ))
    expect(gets.slice(-6)).toEqual(cc(
      0xb0, 0x63, 0x4f, 0xb0, 0x62, 0x27, 0xb0, 0x60, 0x7f,
      0xb0, 0x63, 0x02, 0xb0, 0x62, 0x07, 0xb0, 0x60, 0x7f
    ))
  })
})
