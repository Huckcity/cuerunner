import { describe, expect, it } from 'vitest'
import { refusedDropNotice } from './CueList'

describe('what the window says about dropped files it did not take', () => {
  it('names the files and the formats that do play', () => {
    expect(refusedDropNotice(['voice.opus', 'jingle.wma']))
      .toBe('Not added — Cuerunner plays WAV, AIFF, FLAC, MP3, M4A and OGG: voice.opus, jingle.wma')
  })

  it('counts the rest of a long drop rather than listing a folder', () => {
    const names = ['a.opus', 'b.opus', 'c.opus', 'd.opus', 'e.opus', 'f.opus', 'g.opus']
    expect(refusedDropNotice(names)).toMatch(/: a\.opus, b\.opus, c\.opus, d\.opus and 3 more$/)
  })
})
