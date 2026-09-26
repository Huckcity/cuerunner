// What the desk is told, and in whose numbering. Two facts go out and they are addressed
// differently, which is the whole of this file: *membership* is a fader's — each profile
// writes it its own way — and a *mic's mute* carries the channel's own number, never a
// fader's, because a DCA is a control group and closing one is not how a mic is silenced.
//
// Every table below is driven from the bytes rather than from a helper the code and the
// test share: the channel's own number and the fader's own number are both counted from
// zero on one desk and from one on the next, and a case that computed either would agree
// with an off-by-one instead of failing on it.
import { describe, it, expect } from 'vitest'
import {
  AVANTIS_ASSIGN_NRPN,
  AVANTIS_DCA_FIRST_NOTE,
  channelLimit,
  channelMutes,
  dcaAddress,
  dcaChannel,
  dcaGap,
  dcaLimit,
  dcaNumber,
  dcaPlace,
  dcaValue,
  dcaValueRange,
  describeDeskMessage,
  deskChannelGap,
  membershipWrite
} from './desk'
import { CHANNEL_LIMIT, defaultDeskSettings } from '../../../shared/show'
import type { MidiMessageKind } from '../../../shared/cue'
import type { Dca, DeskSettings } from '../../../shared/show'

function dca(overrides: Partial<Dca> = {}): Dca {
  return { id: 'dca-1', deskNumber: null, ...overrides }
}

function desk(overrides: Partial<DeskSettings> = {}): DeskSettings {
  return { ...defaultDeskSettings(), ...overrides }
}

/** The MIDI the show drives on a cable, on the port the fixtures use. */
const midi = desk({ kind: 'midi', midiPort: 'Yamaha', midiChannel: 3 })

/** The desk on the network, on the port an SQ and an Avantis both serve their MIDI on. */
const tcp = desk({ kind: 'midi-tcp', host: '10.0.0.5', midiChannel: 3 })

/** The envelope a sequence of messages leaves in, so a case reads as its bytes do. */
function overPort(messages: MidiMessageKind[]): {
  kind: 'midi'; portName: string; messages: MidiMessageKind[]
} {
  return { kind: 'midi', portName: 'Yamaha', messages }
}

function overSocket(messages: MidiMessageKind[]): {
  kind: 'midi-tcp'; host: string; port: number; messages: MidiMessageKind[]
} {
  return { kind: 'midi-tcp', host: '10.0.0.5', port: 51325, messages }
}

describe('a fader’s own number', () => {
  it('is its place in the list, counted the way the desk counts', () => {
    expect(dcaNumber(0)).toBe(1)
    expect(dcaNumber(11)).toBe(12)
    expect(dcaValue(0, 'sq')).toBe(0)
    expect(dcaValue(7, 'sq')).toBe(7)
    expect(dcaValue(0, 'avantis')).toBe(AVANTIS_DCA_FIRST_NOTE)
    expect(dcaValue(11, 'avantis')).toBe(AVANTIS_DCA_FIRST_NOTE + 11)
  })

  it('lands in the address where the pattern says, or on the end of it', () => {
    // The number is the caller's, counted from one — what `channelMutes` passes — so the
    // placeholder writes it in wherever it stands and the appended form reaches the same
    // address.
    expect(dcaAddress('/dca/{n}/on', 1)).toBe('/dca/1/on')
    expect(dcaAddress('/dca/{n}/mute', 7)).toBe('/dca/7/mute')
    // A pattern nobody put a placeholder in still reaches the right strip: the number is
    // appended, which is what an operator typing "/dca" means.
    expect(dcaAddress('/dca', 4)).toBe('/dca/4')
    expect(dcaAddress('/dca/', 4)).toBe('/dca/4')
    expect(dcaAddress('', 1)).toBe('/1')
  })

  it('is the number the show gave it where the desk numbers its faders otherwise', () => {
    // The override is read in the desk's own numbering and lands as a *place*: an SQ
    // numbers its DCAs from zero, an Avantis calls its first one 36, and every profile's
    // map starts at its own first — so an operator who typed 4 meant the desk's 4.
    expect(dcaPlace(dca(), 3, 'sq')).toBe(3)
    expect(dcaPlace(dca({ deskNumber: 4 }), 3, 'sq')).toBe(4)
    expect(dcaPlace(dca({ deskNumber: AVANTIS_DCA_FIRST_NOTE + 5 }), 0, 'avantis')).toBe(5)
    expect(dcaPlace(dca(), 0, 'note')).toBe(0)
  })

  it('and the block four channels above the desk’s own, which is the faders’ and not a mic’s', () => {
    // Both ranges put their DCAs and their mute groups on `N+4`; a mic is an input on the
    // desk's own channel. The two never share a message, which is why the mic's tables
    // below use `midiChannel` and this one is left to the group block.
    expect(dcaChannel('sq', 3)).toBe(3)
    expect(dcaChannel('note', 3)).toBe(3)
    expect(dcaChannel('avantis', 12)).toBe(16)
  })
})

describe('a mic’s mute', () => {
  const sq = desk({ ...tcp, profile: 'sq' })

  it('is page 00’s NRPN on an SQ, addressed by the channel’s own number from zero', () => {
    // Channel 0 and channel 3, so an off-by-one is visible: the parameter is the input's
    // own number — `cc 62 <ch-1>` — and a fader is nowhere in the message. The mute is the
    // pair `cc 06 00` then `cc 26 <01|00>`, on the desk's own MIDI channel.
    expect(channelMutes(0, sq)).toEqual({
      open: overSocket([
        { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x26, value: 0x00 }
      ]),
      close: overSocket([
        { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x26, value: 0x01 }
      ])
    })
    expect(channelMutes(3, sq)).toEqual({
      open: overSocket([
        { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x62, value: 0x03 },
        { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x26, value: 0x00 }
      ]),
      close: overSocket([
        { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x62, value: 0x03 },
        { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x26, value: 0x01 }
      ])
    })
  })

  it('is a note-on pair on an Avantis, on the strip’s own note from zero', () => {
    // The velocity says which half of the pair it is: `7F` is the mute, `3F` is the desk
    // releasing it, and `00` ends the message — a received velocity of 00 and a note-off
    // are both ignored, which is why the pair is not a note-on and a note-off. The desk is
    // an input, so it answers on the desk's own channel and not on the block above it.
    const avantis = desk({ ...tcp, profile: 'avantis', midiChannel: 12 })
    expect(channelMutes(0, avantis)).toEqual({
      open: overSocket([
        { kind: 'noteOn', channel: 12, note: 0x00, velocity: 0x3f },
        { kind: 'noteOn', channel: 12, note: 0x00, velocity: 0x00 }
      ]),
      close: overSocket([
        { kind: 'noteOn', channel: 12, note: 0x00, velocity: 0x7f },
        { kind: 'noteOn', channel: 12, note: 0x00, velocity: 0x00 }
      ])
    })
    expect(channelMutes(3, avantis)).toEqual({
      open: overSocket([
        { kind: 'noteOn', channel: 12, note: 0x03, velocity: 0x3f },
        { kind: 'noteOn', channel: 12, note: 0x03, velocity: 0x00 }
      ]),
      close: overSocket([
        { kind: 'noteOn', channel: 12, note: 0x03, velocity: 0x7f },
        { kind: 'noteOn', channel: 12, note: 0x03, velocity: 0x00 }
      ])
    })
  })

  it('is the channel’s own note on a desk nobody has described, counted from one', () => {
    expect(channelMutes(0, midi)).toEqual({
      open: overPort([{ kind: 'noteOn', channel: 3, note: 1, velocity: 127 }]),
      close: overPort([{ kind: 'noteOff', channel: 3, note: 1, velocity: 0 }])
    })
    // The fourth strip is note 4 — the app's own convention counts from one where an SQ
    // counts the parameter from zero, and each table says so rather than one offset
    // serving both.
    expect(channelMutes(3, midi)).toEqual({
      open: overPort([{ kind: 'noteOn', channel: 3, note: 4, velocity: 127 }]),
      close: overPort([{ kind: 'noteOff', channel: 3, note: 4, velocity: 0 }])
    })
  })

  it('is the desk’s own address with the channel’s number in it, over OSC', () => {
    const osc = desk({ kind: 'osc', host: '10.0.0.5', port: 9000, address: '/mixer/ch/{n}' })
    expect(channelMutes(0, osc)).toEqual({
      open: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/mixer/ch/1', args: [1] },
      close: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/mixer/ch/1', args: [0] }
    })
    expect(channelMutes(3, osc)).toEqual({
      open: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/mixer/ch/4', args: [1] },
      close: { kind: 'osc', host: '10.0.0.5', port: 9000, address: '/mixer/ch/4', args: [0] }
    })
    // The address a show nobody has configured sends: the number goes in where the
    // placeholder is, from one.
    expect(channelMutes(3, desk())).toMatchObject({
      open: { kind: 'osc', address: '/dca/4/on' }
    })
  })

  it('is nothing at all when there is no desk to send it to', () => {
    // A show that drives no desk, and a MIDI one whose port or address has not been chosen:
    // a message to nowhere is worse than none, because the recall would report a failure
    // that means nothing.
    expect(channelMutes(0, desk({ kind: 'none' }))).toBeNull()
    expect(channelMutes(0, desk({ kind: 'midi', midiPort: '' }))).toBeNull()
    expect(channelMutes(0, desk({ kind: 'midi-tcp', host: '   ' }))).toBeNull()
    expect(channelMutes(0, desk({ kind: 'midi-tcp', host: '' }))).toBeNull()
    // The same for an OSC show nobody has given a host: the message would go nowhere and
    // the recall would report a failure that means nothing.
    expect(channelMutes(0, desk({ kind: 'osc', host: '   ' }))).toBeNull()
    expect(channelMutes(0, desk({ kind: 'osc', host: '' }))).toBeNull()
  })
})

describe('membership: which channels ride which fader', () => {
  it('is the intent alone on an SQ, whose frames are main’s to build', () => {
    // The desk's own control service is the one route that is not a message: what leaves
    // the renderer is four facts — the channel's own number, the fader's own number, the
    // pair's state, and whether the channel rides anything after this write — each counted
    // from one, which is how the show reads them.
    const sq = desk({ ...tcp, profile: 'sq' })
    expect(membershipWrite(0, dca(), 0, true, true, sq)).toEqual({
      ok: true,
      message: { kind: 'sq-native', channel: 1, dca: 1, placed: true, rides: true }
    })
    // Taking the third channel off the second fader, and nothing else rides it afterwards.
    expect(membershipWrite(2, dca(), 1, false, false, sq)).toEqual({
      ok: true,
      message: { kind: 'sq-native', channel: 3, dca: 2, placed: false, rides: false }
    })
    // A channel that keeps a fader while this pair is cleared — the flag is per channel,
    // not per pair, which is why it cannot be read out of `placed`.
    expect(membershipWrite(2, dca(), 0, false, true, sq)).toEqual({
      ok: true,
      message: { kind: 'sq-native', channel: 3, dca: 1, placed: false, rides: true }
    })
  })

  it('is the fader’s own place inside the intent, the override included', () => {
    const sq = desk({ ...tcp, profile: 'sq' })
    // An SQ numbers its DCAs from zero, so the override is already the place; the intent
    // carries the fader's own number, from one.
    expect(membershipWrite(0, dca({ deskNumber: 3 }), 0, true, true, sq)).toEqual({
      ok: true,
      message: { kind: 'sq-native', channel: 1, dca: 4, placed: true, rides: true }
    })
  })

  it('is NRPN 40 on an Avantis, on the strip’s own number', () => {
    // Its DCAs are addressed by note, so a place is `40 + the place` and a clear is the
    // place alone: the parameter's MSB names the input, from zero — and the message goes
    // on the desk's own channel, because an input is not in the DCA block above it.
    const avantis = desk({ ...tcp, profile: 'avantis', midiChannel: 12 })
    expect(membershipWrite(0, dca(), 0, true, true, avantis)).toEqual({
      ok: true,
      message: overSocket([
        { kind: 'cc', channel: 12, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 12, controller: 0x62, value: AVANTIS_ASSIGN_NRPN },
        { kind: 'cc', channel: 12, controller: 0x06, value: AVANTIS_ASSIGN_NRPN + 0x00 }
      ])
    })
    expect(membershipWrite(3, dca(), 2, false, false, avantis)).toEqual({
      ok: true,
      message: overSocket([
        { kind: 'cc', channel: 12, controller: 0x63, value: 0x03 },
        { kind: 'cc', channel: 12, controller: 0x62, value: AVANTIS_ASSIGN_NRPN },
        { kind: 'cc', channel: 12, controller: 0x06, value: 0x02 }
      ])
    })
  })

  it('is the fader’s own place on an Avantis too, read out of the override', () => {
    // The Avantis calls its first DCA 36, so an override of 59 is the sixth place — the
    // `place`, not the note, is what the value carries.
    const avantis = desk({ ...tcp, profile: 'avantis', midiChannel: 12 })
    expect(membershipWrite(0, dca({ deskNumber: AVANTIS_DCA_FIRST_NOTE + 5 }), 0, true, true, avantis))
      .toEqual({
        ok: true,
        message: overSocket([
          { kind: 'cc', channel: 12, controller: 0x63, value: 0x00 },
          { kind: 'cc', channel: 12, controller: 0x62, value: AVANTIS_ASSIGN_NRPN },
          { kind: 'cc', channel: 12, controller: 0x06, value: AVANTIS_ASSIGN_NRPN + 0x05 }
        ])
      })
  })

  it('still goes on a desk whose own channel is too high for the block above it', () => {
    // The block four channels up is where the DCAs *and the mute groups* live, and a recall
    // writes neither: a mic's mute and its assignment are inputs, on the desk's own
    // channel. An Avantis set to 13 can be recalled — what it cannot do is report its
    // buttons, which is `deskChannelGap`'s business and the panel's.
    const tooHigh = desk({ ...tcp, profile: 'avantis', midiChannel: 13 })

    expect(deskChannelGap('avantis', 13)).toBe(true)
    expect(membershipWrite(0, dca(), 1, true, true, tooHigh)).toMatchObject({ ok: true })
    expect(channelMutes(0, tooHigh)).toEqual({
      open: overSocket([
        { kind: 'noteOn', channel: 13, note: 0x00, velocity: 0x3f },
        { kind: 'noteOn', channel: 13, note: 0x00, velocity: 0x00 }
      ]),
      close: overSocket([
        { kind: 'noteOn', channel: 13, note: 0x00, velocity: 0x7f },
        { kind: 'noteOn', channel: 13, note: 0x00, velocity: 0x00 }
      ])
    })
  })

  it('is refused by name on a desk that has no route for it', () => {
    // The mute still goes on these desks, so a silent gap would be a recall that half
    // worked and said nothing about the half that did not.
    expect(membershipWrite(0, dca(), 0, true, true, midi)).toEqual({
      ok: false,
      error: 'a note desk takes no assignment'
    })
    // An OSC show has no route for an assignment either — the number a channel rides is
    // the desk's own traffic, and this app's OSC convention is mutes.
    expect(membershipWrite(0, dca(), 0, true, true, desk({ kind: 'osc' }))).toEqual({
      ok: false,
      error: 'OSC takes no assignment'
    })
    // Even when the file still carries an SQ from an earlier setup: the transport decides
    // before the profile does, so the sentence names the route this show has rather than a
    // control service it has not got — for a fader inside the SQ's list or past it.
    expect(membershipWrite(0, dca(), 0, true, true, desk({ kind: 'osc', profile: 'sq' })))
      .toEqual({ ok: false, error: 'OSC takes no assignment' })
    expect(membershipWrite(0, dca(), 8, true, true, desk({ kind: 'osc', profile: 'sq' })))
      .toEqual({ ok: false, error: 'OSC takes no assignment' })
    // An SQ's assignment lives on its own control service and nowhere else, so a MIDI link
    // to one has no way to write it.
    expect(membershipWrite(0, dca(), 0, true, true, desk({ kind: 'midi', midiPort: 'Yamaha', profile: 'sq' })))
      .toEqual({
        ok: false,
        error: "an SQ's assignment needs the desk's own control service on its TCP port"
      })
  })

  it('is nothing at all when there is no desk to send it to', () => {
    expect(membershipWrite(0, dca(), 0, true, true, desk({ kind: 'none' }))).toBeNull()
    // An Avantis is told over a link, so a link nobody has given it is nothing to send
    // rather than a failure to report.
    expect(membershipWrite(0, dca(), 0, true, true,
      desk({ kind: 'midi', midiPort: '', profile: 'avantis' }))).toBeNull()
    expect(membershipWrite(0, dca(), 0, true, true,
      desk({ kind: 'midi-tcp', host: '  ', profile: 'avantis' }))).toBeNull()
  })

  it('is a gap, by name, once the fader is past the desk’s own list', () => {
    const sq = desk({ ...tcp, profile: 'sq' })
    const avantis = desk({ ...tcp, profile: 'avantis', midiChannel: 12 })

    expect(membershipWrite(0, dca(), 7, true, true, sq)).toMatchObject({ ok: true })
    expect(membershipWrite(0, dca(), 8, true, true, sq))
      .toEqual({ ok: false, error: 'an SQ has eight DCAs' })
    expect(membershipWrite(0, dca(), 15, true, true, avantis)).toMatchObject({ ok: true })
    expect(membershipWrite(0, dca(), 16, true, true, avantis))
      .toEqual({ ok: false, error: 'an Avantis has sixteen DCAs' })
  })

  it('is refused by name while the mic’s mute still goes', () => {
    // The fader that cannot be addressed is one write of a recall, not the recall: the
    // channel's mute is addressed by its own number and reaches the desk either way, so a
    // gap in the fader list must not silently take the mic with it.
    const sq = desk({ ...tcp, profile: 'sq' })

    expect(membershipWrite(0, dca(), 8, true, true, sq))
      .toEqual({ ok: false, error: 'an SQ has eight DCAs' })
    expect(channelMutes(0, sq)).toEqual({
      open: overSocket([
        { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x26, value: 0x00 }
      ]),
      close: overSocket([
        { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
        { kind: 'cc', channel: 3, controller: 0x26, value: 0x01 }
      ])
    })
  })
})

describe('the gaps a profile has', () => {
  it('is the desk’s own list, or nothing where it addresses as many as the show drives', () => {
    expect(dcaLimit('sq')).toBe(8)
    expect(dcaLimit('avantis')).toBe(16)
    expect(dcaLimit('note')).toBeNull()
  })

  it('states the inputs a profile has, and nothing where it states none', () => {
    // The numbers are the profiles' own published input counts rather than measured ones,
    // which is why nothing refuses on them: a profile that states one wrongly must not stop
    // a show from being recalled.
    expect(channelLimit('sq')).toBe(48)
    expect(channelLimit('avantis')).toBe(96)
    expect(channelLimit('note')).toBeNull()
  })

  it('states nothing wider than the dial’s own cap, which is that widest number', () => {
    // `CHANNEL_LIMIT` is where no profile states a ceiling of its own, so it must be the
    // widest one any profile does state: a profile stating more would be a ceiling the
    // control could not offer, and a narrower cap would stop a show short of the desk.
    const stated = (['note', 'sq', 'avantis'] as const)
      .map(profile => channelLimit(profile))
      .filter(limit => limit !== null)
    expect(Math.max(...stated)).toBe(CHANNEL_LIMIT)
  })

  it('says which fader cannot be addressed, and how many there are instead', () => {
    expect(dcaGap('sq', 8)).toBe('an SQ has eight DCAs')
    expect(dcaGap('sq', 7)).toBeNull()
    expect(dcaGap('avantis', 16)).toBe('an Avantis has sixteen DCAs')
    expect(dcaGap('avantis', 15)).toBeNull()
    expect(dcaGap('note', 40)).toBeNull()
  })

  it('is the fader list alone: the block above an Avantis is the buttons’ problem', () => {
    // A desk whose own channel is too high cannot report its mute groups, which is what a
    // recall never reads. The recall's two writes are inputs, so a high channel is not a
    // gap a recall can have.
    expect(dcaGap('avantis', 0)).toBeNull()
    expect(deskChannelGap('avantis', 12)).toBe(false)
    expect(deskChannelGap('avantis', 13)).toBe(true)
    expect(deskChannelGap('sq', 16)).toBe(false)
  })

  it('refuses a fader whose own desk number points past the list', () => {
    // A hand-edited file, or a show re-pointed from an Avantis to an SQ, can carry a desk
    // number the profile cannot address. The frame carries the *place*, so the index being
    // inside the list says nothing: a write for fader 9 of an SQ is a frame for a fader the
    // desk has not got, and it would be recorded as landed.
    const socket = desk({ ...tcp, profile: 'sq' })
    const overridden = membershipWrite(
      0, { id: 'dca-1', deskNumber: 9 }, 0, true, true, socket
    )
    expect(overridden).toEqual({
      ok: false,
      error: 'fader 10 is past the desk’s DCAs — an SQ has eight DCAs'
    })
    // The same show's eighth fader is fine: 7 is the last parameter an SQ has.
    expect(membershipWrite(
      0, { id: 'dca-1', deskNumber: 7 }, 0, true, true, socket
    )).toMatchObject({ ok: true })
  })

  it('refuses a fader whose own desk number points before the list', () => {
    // The other end of the same map: an Avantis calls its first DCA 36, so a desk number of
    // 3 is 33 places before it — and the value that would go out, `40 - 33`, is one the
    // same codec reads as a clear of another fader rather than an assignment.
    const socket = desk({ ...tcp, profile: 'avantis', midiChannel: 12 })
    expect(membershipWrite(
      0, { id: 'dca-1', deskNumber: 3 }, 0, true, true, socket
    )).toEqual({
      ok: false,
      error: 'a desk number of 3 is before the desk’s first DCA'
    })
  })

  it('offers an override only the numbers the desk’s own DCA block has', () => {
    // A number outside the block addresses something else on the desk — an FX send, a
    // mute group — so the field refuses it rather than sending it and saying nothing.
    expect(dcaValueRange('note')).toEqual({ min: 0, max: 127 })
    expect(dcaValueRange('sq')).toEqual({ min: 0, max: 7 })
    expect(dcaValueRange('avantis'))
      .toEqual({ min: AVANTIS_DCA_FIRST_NOTE, max: AVANTIS_DCA_FIRST_NOTE + 15 })
  })
})

describe('describing a message', () => {
  it('says where it goes, in one line', () => {
    expect(describeDeskMessage({
      kind: 'osc', host: '10.0.0.5', port: 9000, address: '/dca/2/on', args: [1]
    })).toBe('OSC /dca/2/on 1 → 10.0.0.5:9000')
    expect(describeDeskMessage(overPort([
      { kind: 'noteOff', channel: 1, note: 36, velocity: 0 }
    ]))).toBe('noteOff ch1 → "Yamaha"')
    // A vendor arrangement is several messages and no single one of them says what it
    // does, so the count is the honest description. The bytes here are an SQ's channel
    // mute, which is the four-message shape a recall sends.
    expect(describeDeskMessage(overSocket([
      { kind: 'cc', channel: 3, controller: 0x63, value: 0x00 },
      { kind: 'cc', channel: 3, controller: 0x62, value: 0x00 },
      { kind: 'cc', channel: 3, controller: 0x06, value: 0x00 },
      { kind: 'cc', channel: 3, controller: 0x26, value: 0x01 }
    ]))).toBe('4 messages → 10.0.0.5:51325')
    expect(describeDeskMessage(overPort([{ kind: 'sysex', data: [0xf0, 0x7d, 0xf7] }])))
      .toBe('sysex 3 bytes → "Yamaha"')
    expect(describeDeskMessage(null)).toBe('nothing')
  })

  it('names the channel and the fader on a membership intent, which is what a recall logs', () => {
    // The renderer built no frame, so the bytes cannot be the description: what the
    // operator is owed is which strip went onto which fader, and which way.
    expect(describeDeskMessage({
      kind: 'sq-native', channel: 3, dca: 2, placed: true, rides: true
    })).toBe('SQ assign ch3 onto DCA 2')
    expect(describeDeskMessage({
      kind: 'sq-native', channel: 3, dca: 2, placed: false, rides: false
    })).toBe('SQ assign ch3 off DCA 2')
  })
})
