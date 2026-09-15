// What a DCA sends, and where. The point of the module is that a twelve-mic show is not
// twelve patches to type: the message follows from the DCA's number and one connection,
// and an override is the exception somebody typed.
import { describe, it, expect } from 'vitest'
import {
  dcaAddress,
  dcaNumber,
  describeDeskMessage,
  deskMessages,
  midiNoteMessages,
  oscMessages,
  tcpNoteMessages
} from './desk'
import { defaultDeskSettings } from '../types/show'
import type { Dca, DeskSettings } from '../types/show'

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
      unmute: { kind: 'osc', host: '127.0.0.1', port: 8000, address: '/dca/4/on', args: [1] },
      mute: { kind: 'osc', host: '127.0.0.1', port: 8000, address: '/dca/4/on', args: [0] }
    })

    expect(deskMessages(dca(), 3, midi)).toEqual(midiNoteMessages('Yamaha', 3, 4))
  })

  it('is the same note over the desk’s own socket, which is where an SQ and an Avantis listen', () => {
    expect(deskMessages(dca(), 3, tcp)).toEqual(tcpNoteMessages('10.0.0.5', 51325, 3, 4))
  })

  it('is the override when somebody typed one, and only for its own kind', () => {
    expect(deskMessages(dca({ address: '/mixer/chorus' }), 3, desk())?.unmute)
      .toMatchObject({ kind: 'osc', address: '/mixer/chorus' })
    expect(deskMessages(dca({ note: 60 }), 3, midi)?.unmute)
      .toMatchObject({ message: { kind: 'noteOn', note: 60 } })
    // An address override means nothing to a MIDI desk, and a note means nothing to OSC:
    // switching the show from one to the other does not send either of them somewhere odd.
    expect(deskMessages(dca({ address: '/mixer/chorus' }), 3, midi)?.unmute)
      .toMatchObject({ message: { kind: 'noteOn', note: 4 } })
    expect(deskMessages(dca({ note: 60 }), 3, desk())?.unmute)
      .toMatchObject({ kind: 'osc', address: '/dca/4/on' })
    // The desk on the network is the MIDI arrangement over a socket, so an address is as
    // meaningless to it as it is to a port.
    expect(deskMessages(dca({ address: '/mixer/chorus' }), 3, tcp)?.unmute)
      .toMatchObject({ kind: 'midi-tcp', message: { kind: 'noteOn', note: 4 } })
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

describe('describing a message', () => {
  it('says where it goes, in one line', () => {
    const osc = oscMessages('10.0.0.5', 9000, '/dca/2/on')
    expect(describeDeskMessage(osc.unmute)).toBe('OSC /dca/2/on 1 → 10.0.0.5:9000')
    expect(describeDeskMessage(midiNoteMessages('Yamaha', 1, 36).mute)).toBe('noteOff ch1 → "Yamaha"')
    expect(describeDeskMessage(tcpNoteMessages('10.0.0.5', 51325, 1, 36).mute))
      .toBe('noteOff ch1 → 10.0.0.5:51325')
    expect(describeDeskMessage(null)).toBe('nothing')
  })
})
