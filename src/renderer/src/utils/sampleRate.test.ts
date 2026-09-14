import { describe, it, expect } from 'vitest'
import { formatSampleRate, resampleNotice } from './sampleRate'

describe('formatSampleRate', () => {
  it('reads rates the way a desk does', () => {
    expect(formatSampleRate(44100)).toBe('44.1 kHz')
    expect(formatSampleRate(48000)).toBe('48 kHz')
    expect(formatSampleRate(96000)).toBe('96 kHz')
  })

  it('says nothing about a rate that is not one', () => {
    expect(formatSampleRate(0)).toBe('')
    expect(formatSampleRate(-1)).toBe('')
    expect(formatSampleRate(Number.NaN)).toBe('')
  })
})

describe('resampleNotice', () => {
  it('states the resample when the file is not at the engine rate', () => {
    expect(resampleNotice(44100, 48000)).toBe('44.1 kHz file — resampled to 48 kHz')
    expect(resampleNotice(48000, 44100)).toBe('48 kHz file — resampled to 44.1 kHz')
  })

  it('says nothing when the rates match', () => {
    expect(resampleNotice(48000, 48000)).toBeNull()
  })

  it('says nothing before the engine has answered, or for a file it cannot measure', () => {
    expect(resampleNotice(44100, 0)).toBeNull()
    expect(resampleNotice(0, 48000)).toBeNull()
  })
})
