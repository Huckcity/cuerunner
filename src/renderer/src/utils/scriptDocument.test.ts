// The one definition of where a script's lines end, shared by the panel an operator reads
// and the tablet served the same document: if the two disagreed, a cue would be pinned to
// different lines in the two places.
import { describe, it, expect } from 'vitest'
import { scriptLines } from './scriptDocument'

describe('scriptLines', () => {
  it('splits a document into its lines', () => {
    expect(scriptLines('ACT ONE\n\nALDonza enters.')).toEqual(['ACT ONE', '', 'ALDonza enters.'])
  })

  it('does not count the newline a file ends with as an empty line', () => {
    expect(scriptLines('ACT ONE\nALDonza enters.\n')).toEqual(['ACT ONE', 'ALDonza enters.'])
  })

  it('keeps an empty line in the middle, which is a line of the script', () => {
    expect(scriptLines('ACT ONE\n\n\nSANCHO: I am Sancho.\n'))
      .toEqual(['ACT ONE', '', '', 'SANCHO: I am Sancho.'])
  })

  it('reads an empty document as a single empty line rather than none', () => {
    // A saved-and-not-yet-written script is still a document with a first line.
    expect(scriptLines('')).toEqual([''])
  })
})
