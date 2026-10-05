import { describe, expect, it } from 'vitest'
import { isPlayableAudioFile } from './media'

describe('the audio files the window offers', () => {
  it('takes every kind the engine has a decoder for, by the names those files carry', () => {
    for (const name of [
      'walk-in.wav', 'WALK-IN.WAV', 'bed.wave', 'twelve-hours.rf64', 'twelve-hours.w64',
      'sting.aif', 'sting.aiff', 'sting.aifc', 'overture.flac', 'overture.mp3', 'overture.m4a', 'overture.ogg'
    ]) {
      expect(isPlayableAudioFile(name), name).toBe(true)
    }
  })

  it('refuses the kinds it has none for, rather than making a cue that cannot sound', () => {
    // Opus, WMA and raw AAC were taken by a drop and reached an engine that cannot read them.
    for (const name of ['voice.opus', 'jingle.wma', 'stream.aac', 'video.mp4', 'notes.txt', 'no-extension', '.wav-hidden.txt']) {
      expect(isPlayableAudioFile(name), name).toBe(false)
    }
  })
})
