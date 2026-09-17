// What a DCA sends, and where. The point of the module is that a twelve-mic show is not
// twelve patches to type: the message follows from the DCA's number and one connection,
// and an override is the exception somebody typed. What the desk makes of that number is
// the profile, and each profile is pinned here by what its own document says the desk
// takes — an SQ's NRPN mute, an Avantis's note-on pair.
import { describe, it, expect } from 'vitest'
import {
  AVANTIS_DCA_FIRST_NOTE,
  dcaAddress,
  dcaChannel,
  dcaGap,
  dcaNumber,
  dcaValue,
  dcaValueRange,
  describeDeskMessage,
  deskMessages,
  oscMessages,
  profileMessages
} from './desk'
import { defaultDeskSettings } from '../../../shared/show'
import type { MidiMessageKind } from '../../../shared/cue'
import type { Dca, DeskMessage, DeskSettings } from '../../../shared/show'

function dca(overrides: Partial<Dca> = {}): Dca {
  return { id: 'dca-1', label: 'DCA 1', note: null, address: null, ...overrides }
}

function desk(overrides: Partial<DeskSettings> = {}): DeskSettings {
  return { ...defaultDeskSettings(), ...overrides }
}

/** The MIDI the show drives, on the port the fixtures use. */
const midi = desk({ kind: 'midi', midiPort: 'Yamaha', midiChannel: 3 })

/** The desk on the network, on the port an SQ and an Avantis both serve their MIDI on. */
const tcp = desk({ kind: 'midi-tcp', host: '10.0.0.5', midiChannel: 3 })

/** The NRPN parameter a MIDI desk message addresses: the value of its second controller. */
function sqParameter(message: DeskMessage): number {
  if (message.kind === 'osc') throw new Error('an OSC message addresses no parameter')
  const select = message.messages.find(
    (part): part is Extract<MidiMessageKind, { kind: 'cc' }> =>
      part.kind === 'cc' && part.controller === 0x62
  )
  if (select === undefined) throw new Error('the sequence selects no parameter')
  return select.value
}

describe('a DCA’s number', () => {
  it('is its place in the list, counted the way the desk counts', () => {
    expect(dcaNumber(0)).toBe(1)
    expect(dcaNumber(11)).toBe(12)
  })

  it('lands in the address where the pattern says, or on the end of it', () => {
    expect(dcaAddress('/dca/{n}/on', 0)).toBe('/dca/1/on')
    expect(dcaAddress('/dca/{n}/mute', 6)).toBe('/dca/7/mute')
    // A pattern nobody put a placeholder in still reaches the right strip: the number is
    // appended, which is what an operator typing "/dca" means.
    expect(dcaAddress('/dca', 3)).toBe('/dca/4')
    expect(dcaAddress('/dca/', 3)).toBe('/dca/4')
    expect(dcaAddress('', 0)).toBe('/1')
  })
})

describe('what a DCA sends', () => {
  it('is the message its number makes, on the show’s connection', () => {
    const osc = desk()
    expect(deskMessages(dca(), 3, osc)).toEqual({
      ok: true,
      unmute: { kind: 'osc', host: '127.0.0.1', port: 8000, address: '/dca/4/on', args: [1] },
      mute: { kind: 'osc', host: '127.0.0.1', port: 8000, address: '/dca/4/on', args: [0] }
    })

    // A desk nobody has described is sent what this app has always sent: one note, on to
    // open and off to close.
    expect(deskMessages(dca(), 3, midi)).toEqual({
      ok: true,
      unmute: {
        kind: 'midi',
        portName: 'Yamaha',
        messages: [{ kind: 'noteOn', channel: 3, note: 4, velocity: 127 }]
      },
      mute: {
        kind: 'midi',
        portName: 'Yamaha',
        messages: [{ kind: 'noteOff', channel: 3, note: 4, velocity: 0 }]
      }
    })
  })

  it('is the same message over the desk’s own socket, which is where an SQ and an Avantis listen', () => {
    expect(deskMessages(dca(), 3, tcp)).toEqual({
      ok: true,
      unmute: {
        kind: 'midi-tcp',
        host: '10.0.0.5',
        port: 51325,
        messages: [{ kind: 'noteOn', channel: 3, note: 4, velocity: 127 }]
      },
      mute: {
        kind: 'midi-tcp',
        host: '10.0.0.5',
        port: 51325,
        messages: [{ kind: 'noteOff', channel: 3, note: 4, velocity: 0 }]
      }
    })
  })

  it('is the override when somebody typed one, and only for its own kind', () => {
    expect(deskMessages(dca({ address: '/mixer/chorus' }), 3, desk())).toMatchObject({
      ok: true,
      unmute: { kind: 'osc', address: '/mixer/chorus' }
    })
    expect(deskMessages(dca({ note: 60 }), 3, midi)).toMatchObject({
      ok: true,
      unmute: { messages: [{ kind: 'noteOn', note: 60 }] }
    })
    // An address override means nothing to a MIDI desk, and a note means nothing to OSC:
    // switching the show from one to the other does not send either of them somewhere odd.
    expect(deskMessages(dca({ address: '/mixer/chorus' }), 3, midi)).toMatchObject({
      ok: true,
      unmute: { messages: [{ kind: 'noteOn', note: 4 }] }
    })
    expect(deskMessages(dca({ note: 60 }), 3, desk())).toMatchObject({
      ok: true,
      unmute: { kind: 'osc', address: '/dca/4/on' }
    })
    // The desk on the network is the MIDI arrangement over a socket, so an address is as
    // meaningless to it as it is to a port.
    expect(deskMessages(dca({ address: '/mixer/chorus' }), 3, tcp)).toMatchObject({
      ok: true,
      unmute: { messages: [{ kind: 'noteOn', note: 4 }] }
    })
  })

  it('is nothing at all when there is no desk to send it to', () => {
    expect(deskMessages(dca(), 0, desk({ kind: 'none' }))).toBeNull()
    // ...or when the desk is MIDI and no port has been chosen: a message to nowhere is a
    // failure the log would report for no reason.
    expect(deskMessages(dca(), 0, desk({ kind: 'midi', midiPort: '' }))).toBeNull()
    // ...or when it is on the network and nobody has said where.
    expect(deskMessages(dca(), 0, desk({ kind: 'midi-tcp', host: '   ' }))).toBeNull()
  })
})

describe('an Allen & Heath SQ', () => {
  const sq = desk({ kind: 'midi-tcp', host: '10.0.0.5', midiChannel: 3, profile: 'sq' })

  it('takes a mute as NRPN on page 02, and closes it with the fine byte rather than a note-off', () => {
    // DCA 1 is parameter 0 on page 02 — the desk numbers them from zero where the show
    // numbers them from one — and the mute is the pair `B0 06 00` then `B0 26 <01|00>`.
    expect(deskMessages(dca(), 0, sq)).toEqual({
      ok: true,
      unmute: {
        kind: 'midi-tcp',
        host: '10.0.0.5',
        port: 51325,
        messages: [
          { kind: 'cc', channel: 3, controller: 0x63, value: 0x02 },
          { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
          { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
          { kind: 'cc', channel: 3, controller: 0x26, value: 0x01 }
        ]
      },
      mute: {
        kind: 'midi-tcp',
        host: '10.0.0.5',
        port: 51325,
        messages: [
          { kind: 'cc', channel: 3, controller: 0x63, value: 0x02 },
          { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
          { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
          { kind: 'cc', channel: 3, controller: 0x26, value: 0x00 }
        ]
      }
    })
  })

  it('addresses its own channel, and counts the parameters from zero', () => {
    expect(dcaChannel('sq', 3)).toBe(3)
    expect(dcaValue(0, 'sq')).toBe(0)
    expect(dcaValue(7, 'sq')).toBe(7)
  })

  it('takes the override as the NRPN parameter, because that is the number it addresses', () => {
    const opened = deskMessages(dca({ note: 4 }), 0, sq)
    if (opened === null || !opened.ok) throw new Error('the desk takes it')
    expect(sqParameter(opened.unmute)).toBe(4)
  })

  it('has eight DCAs, and says so rather than going quiet for the rest', () => {
    expect(deskMessages(dca(), 7, sq)).toMatchObject({ ok: true })
    expect(deskMessages(dca(), 8, sq)).toEqual({ ok: false, error: 'an SQ has eight DCAs' })
    expect(dcaGap('sq', 8, 1)).toBe('an SQ has eight DCAs')
    expect(dcaGap('sq', 7, 1)).toBeNull()
  })
})

describe('an Allen & Heath Avantis', () => {
  /** The desk is set to channel 12, which is its default; its DCAs answer on 16. */
  const avantis = desk({ kind: 'midi-tcp', host: '10.0.0.5', midiChannel: 12, profile: 'avantis' })

  it('takes a mute as a note-on whose velocity is which half of the pair, then velocity 00', () => {
    // Its OFF is 01–3F and not the note-off the app's own arrangement sends: a received
    // velocity of zero and a note-off are both ignored, which is what the harness found.
    expect(deskMessages(dca(), 0, avantis)).toEqual({
      ok: true,
      unmute: {
        kind: 'midi-tcp',
        host: '10.0.0.5',
        port: 51325,
        messages: [
          { kind: 'noteOn', channel: 16, note: 0x36, velocity: 0x7f },
          { kind: 'noteOn', channel: 16, note: 0x36, velocity: 0x00 }
        ]
      },
      mute: {
        kind: 'midi-tcp',
        host: '10.0.0.5',
        port: 51325,
        messages: [
          { kind: 'noteOn', channel: 16, note: 0x36, velocity: 0x3f },
          { kind: 'noteOn', channel: 16, note: 0x36, velocity: 0x00 }
        ]
      }
    })
  })

  it('counts its notes from 36, and answers four channels above its own', () => {
    expect(dcaChannel('avantis', 12)).toBe(16)
    expect(dcaValue(0, 'avantis')).toBe(AVANTIS_DCA_FIRST_NOTE)
    expect(dcaValue(11, 'avantis')).toBe(AVANTIS_DCA_FIRST_NOTE + 11)
  })

  it('refuses a channel its DCAs do not answer on, rather than sending somewhere else', () => {
    const tooHigh = desk({ ...avantis, midiChannel: 13 })
    expect(dcaGap('avantis', 0, 13)).toBe(
      'an Avantis answers four channels above its own, so its MIDI channel is 12 or lower'
    )
    expect(deskMessages(dca(), 0, tooHigh)).toEqual({ ok: false, error: dcaGap('avantis', 0, 13) })
    expect(dcaGap('avantis', 0, 12)).toBeNull()
  })
})

describe('the arrangements themselves', () => {
  it('is one message on a desk that takes notes, and a sequence on the desks that do not', () => {
    expect(profileMessages('note', 1, 4, true)).toEqual([
      { kind: 'noteOn', channel: 1, note: 4, velocity: 127 }
    ])
    expect(profileMessages('sq', 1, 0, false)).toHaveLength(4)
    expect(profileMessages('avantis', 16, 0x36, false)).toHaveLength(2)
  })

  it('offers an override only the numbers the desk’s own DCA block has', () => {
    // A number outside the block addresses something else on the desk — an FX send, a
    // mute group — so the field refuses it rather than sending it and saying nothing.
    expect(dcaValueRange('note')).toEqual({ min: 0, max: 127 })
    expect(dcaValueRange('sq')).toEqual({ min: 0, max: 7 })
    expect(dcaValueRange('avantis')).toEqual({ min: AVANTIS_DCA_FIRST_NOTE, max: AVANTIS_DCA_FIRST_NOTE + 15 })
  })
})

describe('describing a message', () => {
  it('says where it goes, in one line', () => {
    const osc = oscMessages('10.0.0.5', 9000, '/dca/2/on')
    expect(describeDeskMessage(osc.unmute)).toBe('OSC /dca/2/on 1 → 10.0.0.5:9000')
    expect(describeDeskMessage({
      kind: 'midi',
      portName: 'Yamaha',
      messages: [{ kind: 'noteOff', channel: 1, note: 36, velocity: 0 }]
    })).toBe('noteOff ch1 → "Yamaha"')
    // A vendor arrangement is several messages and no single one of them says what it
    // does, so the count is the honest description.
    expect(describeDeskMessage({
      kind: 'midi-tcp',
      host: '10.0.0.5',
      port: 51325,
      messages: profileMessages('sq', 1, 0, true)
    })).toBe('4 messages → 10.0.0.5:51325')
    expect(describeDeskMessage(null)).toBe('nothing')
  })
})
