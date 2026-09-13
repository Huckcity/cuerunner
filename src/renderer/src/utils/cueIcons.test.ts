import { describe, it, expect } from 'vitest'
import { CUE_ICON } from './cueIcons'

describe('CUE_ICON', () => {
  it('gives every cue type a glyph of its own', () => {
    const glyphs = Object.values(CUE_ICON)
    expect(glyphs.every(glyph => glyph.trim() !== '')).toBe(true)
    expect(new Set(glyphs).size).toBe(glyphs.length)
  })
})
