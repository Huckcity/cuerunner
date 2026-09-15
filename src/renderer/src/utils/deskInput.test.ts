// What the desk's own buttons look like on the wire, per range. A button is a *change*: the
// desk reports its state when a client connects, so the first sighting of a group primes and
// only a movement is a press — a case below opens on a muted group and shows that a show does
// not recall a scene by itself. The other half is what must never read as a press: the app's
// own DCA mutes, which is what a scene recall sounds like coming back off the desk.
import { describe, it, expect } from 'vitest'
import { DeskButtons, MUTE_GROUP_COUNT, muteGroupGet } from './deskInput'
import type { DeskButton } from './deskInput'
import type { DeskProfile } from '../types/show'
import type { MidiMessageKind } from '../types/cue'
import type { ShowEvent } from '../types/show'

const DEVICE = '10.0.0.5:51325'
const desk = (message: MidiMessageKind, device = DEVICE): ShowEvent =>
  ({ kind: 'midi', at: 1, device, message })

/** The SQ's mute message for one group: page 04, parameter <group - 1>, absolute form. */
function sqMute(channel: number, group: number, on: boolean): MidiMessageKind[] {
  return [
    { kind: 'cc', channel, controller: 0x63, value: 0x04 },
    { kind: 'cc', channel, controller: 0x62, value: group - 1 },
    { kind: 'cc', channel, controller: 0x06, value: 0x00 },
    { kind: 'cc', channel, controller: 0x26, value: on ? 0x01 : 0x00 }
  ]
}

/** Every message in order, and the last button any of them produced. */
function press(reader: DeskButtons, profile: DeskProfile, messages: MidiMessageKind[]): DeskButton | null {
  let read: DeskButton | null = null
  for (const message of messages) {
    const button = reader.read(profile, desk(message))
    if (button !== null) read = button
  }
  return read
}

describe('an SQ’s mute groups read as buttons', () => {
  it('presses on a movement, and reports the desk rather than a hand the first time', () => {
    const reader = new DeskButtons()

    // The first sighting is the desk saying where the group stands — at connect, or in
    // answer to the get the app sends — and a show must not move on it.
    expect(press(reader, 'sq', sqMute(1, 5, false))).toBeNull()
    // The press after that is a movement, and both directions are presses: a key press
    // toggles the group, and the show should step whichever way it went.
    expect(press(reader, 'sq', sqMute(1, 5, true)))
      .toEqual({ device: DEVICE, control: 'muteGroup', number: 5, on: true })
    expect(press(reader, 'sq', sqMute(1, 5, false)))
      .toEqual({ device: DEVICE, control: 'muteGroup', number: 5, on: false })
  })

  it('is not a press when the same state arrives twice', () => {
    const reader = new DeskButtons()

    press(reader, 'sq', sqMute(1, 5, false))
    expect(press(reader, 'sq', sqMute(1, 5, true))?.number).toBe(5)
    // A desk that reports the state again — a repeat, a second get — is saying nothing new.
    expect(press(reader, 'sq', sqMute(1, 5, true))).toBeNull()
  })

  it('counts the last group, and nothing past it', () => {
    const reader = new DeskButtons()

    press(reader, 'sq', sqMute(1, MUTE_GROUP_COUNT, false))
    expect(press(reader, 'sq', sqMute(1, MUTE_GROUP_COUNT, true))?.number).toBe(MUTE_GROUP_COUNT)
    expect(press(reader, 'sq', sqMute(1, MUTE_GROUP_COUNT + 1, true))).toBeNull()
  })

  it('is not a DCA mute, which is the message the app sends itself', () => {
    // Page 02 is the DCAs: a scene recall moving a fader must not run the show, and the
    // desk echoing one back must not either. This is the case that says so.
    const reader = new DeskButtons()
    const dca = [
      { kind: 'cc', channel: 1, controller: 0x63, value: 0x02 },
      { kind: 'cc', channel: 1, controller: 0x62, value: 0x00 },
      { kind: 'cc', channel: 1, controller: 0x06, value: 0x00 },
      { kind: 'cc', channel: 1, controller: 0x26, value: 0x01 }
    ] as MidiMessageKind[]

    expect(press(reader, 'sq', dca)).toBeNull()
    // And it leaves the groups alone: the desk's report primes, and the press after it is
    // still the movement that moves the show.
    expect(press(reader, 'sq', sqMute(1, 5, false))).toBeNull()
    expect(press(reader, 'sq', sqMute(1, 5, true))?.number).toBe(5)
  })

  it('survives a sequence interrupted by another message', () => {
    const reader = new DeskButtons()
    expect(press(reader, 'sq', sqMute(1, 5, false))).toBeNull()

    const [page, parameter, coarse, fine] = sqMute(1, 5, true)
    reader.read('sq', desk(page))
    reader.read('sq', desk(parameter))
    reader.read('sq', desk({ kind: 'noteOn', channel: 1, note: 0x30, velocity: 0x7f }))
    reader.read('sq', desk(coarse))

    // A message from another hand between the select and the value must not swallow the
    // button: the latch is what the next fine byte is read against.
    expect(reader.read('sq', desk(fine)))
      .toMatchObject({ control: 'muteGroup', number: 5, on: true })
  })

  it('forgets everything when the show is reset, so the next sighting primes again', () => {
    const reader = new DeskButtons()

    press(reader, 'sq', sqMute(1, 5, false))
    expect(press(reader, 'sq', sqMute(1, 5, true))?.number).toBe(5)
    reader.reset()
    expect(press(reader, 'sq', sqMute(1, 5, false))).toBeNull()
  })
})

describe('an Avantis’s mute groups read as buttons', () => {
  const note = (group: number, velocity: number): MidiMessageKind =>
    ({ kind: 'noteOn', channel: 16, note: 0x45 + group, velocity })

  it('presses on the note, and ignores the velocity 00 that ends the pair', () => {
    const reader = new DeskButtons()

    // 40–7F is on and 01–3F is off; 00 is the end of the message rather than a state.
    press(reader, 'avantis', [note(5, 0x3f)])
    expect(reader.read('avantis', desk(note(5, 0x00)))).toBeNull()
    expect(press(reader, 'avantis', [note(5, 0x7f)]))
      .toEqual({ device: DEVICE, control: 'muteGroup', number: 5, on: true })
  })

  it('is not a DCA mute, which is a note in the block below', () => {
    // The app drives DCAs with notes 0x36–0x45 on this desk: those are its own messages
    // coming back, not a hand on a button.
    const reader = new DeskButtons()

    expect(press(reader, 'avantis', [{ kind: 'noteOn', channel: 16, note: 0x36, velocity: 0x7f }])).toBeNull()
    expect(press(reader, 'avantis', [{ kind: 'noteOn', channel: 16, note: 0x45, velocity: 0x7f }])).toBeNull()
    // Group 1 is the note after them, and it primes before it presses like any other.
    expect(press(reader, 'avantis', [{ kind: 'noteOn', channel: 16, note: 0x46, velocity: 0x3f }])).toBeNull()
    expect(press(reader, 'avantis', [{ kind: 'noteOn', channel: 16, note: 0x46, velocity: 0x7f }]))
      .toMatchObject({ number: 1, on: true })
  })
})

describe('asking a desk where its groups stand', () => {
  it('is the SQ’s get: select the page and the parameter, then ask with 7F', () => {
    expect(muteGroupGet('sq', 1, 5)).toEqual([
      { kind: 'cc', channel: 1, controller: 0x63, value: 0x04 },
      { kind: 'cc', channel: 1, controller: 0x62, value: 4 },
      { kind: 'cc', channel: 1, controller: 0x60, value: 0x7f }
    ])
  })

  it('is nothing on a range with no published mute get', () => {
    // An Avantis has none, so there the desk's own report or the first press primes.
    expect(muteGroupGet('avantis', 16, 5)).toEqual([])
    expect(muteGroupGet('note', 1, 5)).toEqual([])
  })
})

describe('a desk that is not a modelled range', () => {
  it('has no buttons at all', () => {
    const reader = new DeskButtons()

    expect(press(reader, 'note', sqMute(1, 5, true))).toBeNull()
    expect(press(reader, 'note', [{ kind: 'noteOn', channel: 16, note: 0x4a, velocity: 0x7f }])).toBeNull()
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
