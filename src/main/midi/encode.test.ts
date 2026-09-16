// A hand-typed SysEx keeps the delimiters the inspector's placeholder told the
// operator to type; a learned one never had them. The wire takes each exactly once.
import { describe, it, expect } from 'vitest'
import { encodeMidiMessage } from './encode'

describe('encodeMidiMessage sysex', () => {
  it('frames a bare body once', () => {
    expect(encodeMidiMessage({ kind: 'sysex', data: [0x41, 0x10, 0x42] })).toEqual([
      0xf0, 0x41, 0x10, 0x42, 0xf7
    ])
  })

  it('does not double-frame a hand-typed body that kept its delimiters', () => {
    expect(encodeMidiMessage({ kind: 'sysex', data: [0xf0, 0x41, 0x10, 0x42, 0xf7] })).toEqual([
      0xf0, 0x41, 0x10, 0x42, 0xf7
    ])
  })
})
