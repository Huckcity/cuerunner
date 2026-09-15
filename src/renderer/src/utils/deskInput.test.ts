// What the desk's own buttons look like on the wire, per range, and what must not look like
// one. A misread here runs the show, so the cases below are as much about the messages that
// are *not* buttons — the app's own DCA mutes, most of all — as about the ones that are.
import { describe, it, expect } from 'vitest'
import { DeskButtons, MUTE_GROUP_COUNT } from './deskInput'
import type { DeskButton } from './deskInput'
import type { DeskProfile } from '../types/show'
import type { MidiMessageKind } from '../types/cue'
import type { ShowEvent } from '../types/show'

const from = (device: string) => (message: MidiMessageKind): ShowEvent =>
  ({ kind: 'midi', at: 1, device, message })

const desk = from('10.0.0.5:51325')

/** The SQ's mute message for one group: select the page and parameter, then set it. */
function sqMuteSequence(channel: number, page: number, parameter: number, on: boolean): MidiMessageKind[] {
  return [
    { kind: 'cc', channel, controller: 0x63, value: page },
    { kind: 'cc', channel, controller: 0x62, value: parameter },
    { kind: 'cc', channel, controller: 0x06, value: 0x00 },
    { kind: 'cc', channel, controller: 0x26, value: on ? 0x01 : 0x00 }
  ]
}

/** Every message of the sequence, in order, and the last button any of them produced. */
function press(reader: DeskButtons, profile: DeskProfile, messages: MidiMessageKind[]): DeskButton | null {
  let read: DeskButton | null = null
  for (const message of messages) {
    const button = reader.read(profile, desk(message))
    if (button !== null) read = button
  }
  return read
}

describe('an SQ’s mute groups read as buttons', () => {
  it('is the group the sequence addresses, on either half of the toggle', () => {
    const reader = new DeskButtons()

    // Mute group 5 is parameter 4 of page 04 — the desk counts from zero, the panel from
    // one — and the fine byte is the half it went to.
    expect(press(reader, 'sq', sqMuteSequence(1, 0x04, 4, true)))
      .toEqual({ device: '10.0.0.5:51325', control: 'muteGroup', number: 5 })
    // A key press is a toggle: the press that unmutes is the same button as the one that
    // muted, and the show should move either way.
    expect(press(reader, 'sq', sqMuteSequence(1, 0x04, 4, false)))
      .toEqual({ device: '10.0.0.5:51325', control: 'muteGroup', number: 5 })
  })

  it('counts the last group, and nothing past it', () => {
    const reader = new DeskButtons()

    expect(press(reader, 'sq', sqMuteSequence(1, 0x04, MUTE_GROUP_COUNT - 1, true))?.number)
      .toBe(MUTE_GROUP_COUNT)
    expect(press(reader, 'sq', sqMuteSequence(1, 0x04, MUTE_GROUP_COUNT, true))).toBeNull()
  })

  it('is not a DCA mute, which is the message the app sends itself', () => {
    // Page 02 is the DCAs: a scene recall moving a fader must not run the show, and the
    // desk echoing one back must not either. This is the case that says so.
    const reader = new DeskButtons()

    expect(press(reader, 'sq', sqMuteSequence(1, 0x02, 0, true))).toBeNull()
    expect(reader.read('sq', desk({ kind: 'cc', channel: 1, controller: 0x26, value: 0x01 }))).toBeNull()
  })

  it('survives a sequence interrupted by another message', () => {
    const reader = new DeskButtons()
    const [page, parameter, coarse] = sqMuteSequence(1, 0x04, 4, true)

    reader.read('sq', desk(page))
    reader.read('sq', desk(parameter))
    reader.read('sq', desk({ kind: 'noteOn', channel: 1, note: 0x30, velocity: 0x7f }))
    reader.read('sq', desk(coarse))

    // A note between the parameter and the value does not break the latch: the desk sends
    // the select and the value as a pair, and nothing else is allowed in between on the
    // wire, but a message from another hand must not silently swallow the button.
    expect(reader.read('sq', desk({ kind: 'cc', channel: 1, controller: 0x26, value: 0x01 })))
      .toMatchObject({ control: 'muteGroup', number: 5 })
  })

  it('forgets a half-read sequence when the show is reset', () => {
    const reader = new DeskButtons()
    const [page, parameter, , fine] = sqMuteSequence(1, 0x04, 4, true)

    reader.read('sq', desk(page))
    reader.read('sq', desk(parameter))
    reader.reset()

    expect(reader.read('sq', desk(fine))).toBeNull()
  })
})

describe('an Avantis’s mute groups read as buttons', () => {
  it('is the note the group is, whichever velocity the desk used', () => {
    const reader = new DeskButtons()
    // Mute group 5 is note 0x4A: the eight after the mains in the desk's N+4 block. On is
    // 40–7F and off is 01–3F, and both are the key being pressed.
    expect(reader.read('avantis', desk({ kind: 'noteOn', channel: 16, note: 0x4a, velocity: 0x7f })))
      .toEqual({ device: '10.0.0.5:51325', control: 'muteGroup', number: 5 })
    expect(reader.read('avantis', desk({ kind: 'noteOn', channel: 16, note: 0x4a, velocity: 0x3f }))?.number)
      .toBe(5)
  })

  it('ignores the velocity 00 that ends the message, and a note off', () => {
    const reader = new DeskButtons()

    expect(reader.read('avantis', desk({ kind: 'noteOn', channel: 16, note: 0x4a, velocity: 0x00 }))).toBeNull()
    expect(reader.read('avantis', desk({ kind: 'noteOff', channel: 16, note: 0x4a, velocity: 0x00 }))).toBeNull()
  })

  it('is not a DCA mute, which is a note in the block below', () => {
    // The app drives DCAs with notes 0x36–0x45 on this desk: those are its own messages
    // coming back, not a hand on a button.
    const reader = new DeskButtons()

    expect(reader.read('avantis', desk({ kind: 'noteOn', channel: 16, note: 0x36, velocity: 0x7f }))).toBeNull()
    expect(reader.read('avantis', desk({ kind: 'noteOn', channel: 16, note: 0x45, velocity: 0x7f }))).toBeNull()
    // And the first group is the note after them.
    expect(reader.read('avantis', desk({ kind: 'noteOn', channel: 16, note: 0x46, velocity: 0x7f }))?.number).toBe(1)
  })
})

describe('a desk that is not a modelled range', () => {
  it('has no buttons at all', () => {
    const reader = new DeskButtons()

    expect(press(reader, 'note', sqMuteSequence(1, 0x04, 4, true))).toBeNull()
    expect(reader.read('note', desk({ kind: 'noteOn', channel: 16, note: 0x4a, velocity: 0x7f }))).toBeNull()
  })

  it('says nothing about anything that is not a MIDI message from a desk', () => {
    const reader = new DeskButtons()

    expect(reader.read('sq', { kind: 'osc', at: 1, from: '10.0.0.5:8000', address: '/go', args: [] })).toBeNull()
    expect(reader.read('sq', {
      kind: 'alert',
      at: 1,
      alert: { id: 1, at: 1, level: 'warning', source: 'midi-tcp', message: 'offline' }
    })).toBeNull()
  })
})
