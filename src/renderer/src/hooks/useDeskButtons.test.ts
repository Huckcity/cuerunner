// What the desk's own buttons mean to a show: which device they arrive from, which number has
// been given which action on which route, and which groups are worth asking the desk about.
// Small decisions with a lot riding on them — a show that listens to the wrong device hears
// nothing, and one that reads the wrong number moves through the scenes on somebody else's
// key — so they are pinned here rather than inside the hook that reads the river.
import { describe, it, expect } from 'vitest'
import { deskButtonAction, deskDevice, watchedGroups } from './useDeskButtons'
import { defaultDeskSettings } from '../../../shared/show'
import type { DeskButton } from '../utils/deskInput'
import type { DeskButtons as DeskButtonMap, DeskSettings } from '../../../shared/show'

const desk = (overrides: Partial<DeskSettings> = {}): DeskSettings =>
  ({ ...defaultDeskSettings(), ...overrides })

describe('where the desk’s messages come from', () => {
  it('is the socket an SQ and an Avantis answer on', () => {
    expect(deskDevice(desk({ kind: 'midi-tcp', host: '10.0.0.5', tcpPort: 51325 })))
      .toBe('10.0.0.5:51325')
  })

  it('is the port name when the show drives a port of this machine', () => {
    expect(deskDevice(desk({ kind: 'midi', midiPort: 'SQ MIDI' }))).toBe('SQ MIDI')
  })

  it('is nothing to listen to when the show drives no desk', () => {
    expect(deskDevice(desk({ kind: 'none' }))).toBeNull()
    // An OSC desk sends addresses and hears nothing back: there is no MIDI to read.
    expect(deskDevice(desk({ kind: 'osc' }))).toBeNull()
    // A desk nobody has addressed yet is the same as none.
    expect(deskDevice(desk({ kind: 'midi-tcp', host: '   ' }))).toBeNull()
    expect(deskDevice(desk({ kind: 'midi', midiPort: '' }))).toBeNull()
  })
})

describe('what a button does on this show', () => {
  const group = (number: number): DeskButton =>
    ({ device: '10.0.0.5:51325', control: 'muteGroup', number, on: true })
  const note = (number: number): DeskButton =>
    ({ device: '10.0.0.5:51325', control: 'note', number })
  const buttons = (fields: Partial<DeskButtonMap> = {}): DeskButtonMap =>
    ({ go: null, back: null, goNote: null, backNote: null, ...fields })

  it('is the action the group has been given', () => {
    expect(deskButtonAction(buttons({ go: 5, back: 6 }), group(5))).toBe('go')
    expect(deskButtonAction(buttons({ go: 5, back: 6 }), group(6))).toBe('back')
  })

  it('is the action the note has been given', () => {
    expect(deskButtonAction(buttons({ goNote: 48, backNote: 49 }), note(48))).toBe('go')
    expect(deskButtonAction(buttons({ goNote: 48, backNote: 49 }), note(49))).toBe('back')
  })

  it('is nothing for a number the show does not listen to', () => {
    expect(deskButtonAction(buttons({ go: 5, back: 6 }), group(4))).toBeNull()
    expect(deskButtonAction(buttons({ go: 5, back: 6 }), note(48))).toBeNull()
  })

  it('resolves a number shared by the two routes on the route it arrived on', () => {
    // A note and a group are separate spaces: each press runs its own route's action, so a
    // show may name group 5 and note 5 without one stealing the other's presses.
    const both = buttons({ go: 5, back: 6, goNote: 48, backNote: 49 })
    expect(deskButtonAction(both, group(48))).toBeNull()
    expect(deskButtonAction(both, note(5))).toBeNull()

    const crossed = buttons({ go: 5, back: 6, goNote: 5, backNote: 49 })
    expect(deskButtonAction(crossed, group(5))).toBe('go')
    expect(deskButtonAction(crossed, note(5))).toBe('go')
  })

  it('moves the show on when one number has somehow been given both buttons', () => {
    // The panel refuses the assignment in as many words; this is the answer for a file
    // written by hand, and going on is the safer half of a contradiction.
    expect(deskButtonAction(buttons({ go: 5, back: 5 }), group(5))).toBe('go')
    expect(deskButtonAction(buttons({ goNote: 48, backNote: 48 }), note(48))).toBe('go')
  })
})

describe('the groups the desk is asked about', () => {
  const groups = (go: number | null, back: number | null): DeskButtonMap =>
    ({ ...defaultDeskSettings().buttons, go, back })

  it('is the ones the show listens to, once each', () => {
    expect(watchedGroups(desk({ buttons: groups(5, 6) }))).toEqual([5, 6])
  })

  it('is only what has been assigned', () => {
    expect(watchedGroups(desk({ buttons: groups(5, null) }))).toEqual([5])
    expect(watchedGroups(desk({ buttons: groups(null, null) }))).toEqual([])
  })

  it('is nothing for a note, which has no get and primes on its own press', () => {
    expect(watchedGroups(desk({
      buttons: { ...defaultDeskSettings().buttons, goNote: 48, backNote: 49 }
    }))).toEqual([])
  })
})
