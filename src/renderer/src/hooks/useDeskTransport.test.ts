// What the desk's own buttons mean to a show: which device they arrive from, and which
// action each group has been given. Both are small decisions with a lot riding on them —
// a show that listens to the wrong device hears nothing, and one that reads the wrong group
// runs itself — so they are pinned here rather than inside the hook that reads the river.
import { describe, it, expect } from 'vitest'
import { deskButtonAction, deskDevice } from './useDeskTransport'
import { defaultDeskSettings } from '../types/show'
import type { DeskSettings } from '../types/show'

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

describe('what a group does on this show', () => {
  const buttons = { go: 5, back: 6 }

  it('is the action the group has been given', () => {
    expect(deskButtonAction(buttons, 5)).toBe('go')
    expect(deskButtonAction(buttons, 6)).toBe('back')
  })

  it('is nothing for a group the show does not listen to', () => {
    expect(deskButtonAction(buttons, 4)).toBeNull()
    expect(deskButtonAction({ go: null, back: null }, 5)).toBeNull()
  })

  it('moves the show on when one group has somehow been given both', () => {
    // The panel refuses the assignment in as many words; this is the answer for a file
    // written by hand, and going on is the safer half of a contradiction.
    expect(deskButtonAction({ go: 5, back: 5 }, 5)).toBe('go')
  })
})
