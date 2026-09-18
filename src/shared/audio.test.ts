import { describe, expect, it } from 'vitest'
import { AUDIO_LIMITS, clampWaveformPoints, defaultAudioStartOptions, isAudioFadeParam } from './audio'

describe('shared audio contract', () => {
  it('clamps waveform points into the engine’s bound', () => {
    expect(clampWaveformPoints(0)).toBe(1)
    expect(clampWaveformPoints(-5)).toBe(1)
    expect(clampWaveformPoints(512)).toBe(512)
    expect(clampWaveformPoints(AUDIO_LIMITS.maxWaveformPoints.value + 1)).toBe(AUDIO_LIMITS.maxWaveformPoints.value)
    expect(clampWaveformPoints(Number.NaN)).toBe(0)
    expect(clampWaveformPoints(12.9)).toBe(12)
  })

  it('starts a voice at unity with automatic routing', () => {
    expect(defaultAudioStartOptions()).toEqual({
      startTime: 0,
      endTime: null,
      loopCount: 0,
      rate: 1,
      trim: 1,
      volume: 1,
      pan: 0,
      fadeInDuration: 0,
      outputs: null
    })
  })

  it('recognises exactly the fadeable parameters', () => {
    for (const param of ['volume', 'pan', 'trim', 'rate']) expect(isAudioFadeParam(param)).toBe(true)
    for (const param of ['Volume', 'gain', 'outputs', '']) expect(isAudioFadeParam(param)).toBe(false)
  })
})
