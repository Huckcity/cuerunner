// What a trimmed cue plays, and what the trim drops.
//
// The rule these are held to is the one the feature promises: a trim is a way of playing
// a region, not an edit to it. The region the operator set survives every combination —
// the trim off, a file nobody has measured, a file with no sound in it, a region that
// sits past the sound — and the trim only ever shortens it.
import { describe, it, expect } from 'vitest'
import { cuesAwaitingSilence, playRegion, trimAmounts } from './silenceTrim'
import type { AudioCue, Cue } from '../../../shared/cue'

function audio(patch: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1', number: '1', name: 'Track', type: 'audio',
    colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 20_000,
    advance: 'none', isArmed: true, notes: '',
    filePath: '/show/track.wav', startTime: 0, endTime: null, fadeInDuration: 0,
    volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1,
    ...patch
  }
}

/** Two seconds of silence, six seconds of sound, twelve of silence — what a trim is for. */
const SOUND = { startMs: 2000, endMs: 8000, durationMs: 20_000, silent: false }

describe('playRegion', () => {
  it('plays the region the operator set when the trim is off', () => {
    const cue = audio({ trimSilence: true, soundRegion: SOUND, startTime: 1000, endTime: 9000 })
    expect(playRegion(cue, false)).toEqual({ startMs: 1000, endMs: 9000 })
  })

  it('drops the silence at both edges, and says how much', () => {
    const cue = audio({ trimSilence: true, soundRegion: SOUND })
    expect(playRegion(cue, true)).toEqual({ startMs: 2000, endMs: 8000 })
    expect(trimAmounts(cue)).toEqual({ headMs: 2000, tailMs: 12_000 })
  })

  it('keeps the parts of the region the operator set inside the sound', () => {
    const cue = audio({ trimSilence: true, soundRegion: SOUND, startTime: 3000, endTime: 5000 })
    expect(playRegion(cue, true)).toEqual({ startMs: 3000, endMs: 5000 })
    expect(trimAmounts(cue)).toEqual({ headMs: 0, tailMs: 0 })
  })

  it('plays the whole region until the file has been measured', () => {
    // The scan is a pass over the file; a GO that waited for one would wait on a disk.
    const cue = audio({ trimSilence: true, soundRegion: null, startTime: 1000, endTime: 9000 })
    expect(playRegion(cue, true)).toEqual({ startMs: 1000, endMs: 9000 })
    expect(trimAmounts(cue)).toBeNull()
  })

  it('leaves a file that is quiet end to end alone', () => {
    // Nothing crossed the threshold, so there is no silence at the edges to drop — and a
    // cue trimmed to no length would be a cue the operator asked to hear and cannot.
    const quiet = { startMs: 0, endMs: 20_000, durationMs: 20_000, silent: true }
    const cue = audio({ trimSilence: true, soundRegion: quiet, startTime: 1000, endTime: 9000 })
    expect(playRegion(cue, true)).toEqual({ startMs: 1000, endMs: 9000 })
    expect(trimAmounts(cue)).toBeNull()
  })

  it('does not take a region away when the trim would empty it', () => {
    // The region sits inside the head silence. The operator asked for those thousand
    // milliseconds, and the trim has no business turning the cue off.
    const cue = audio({ trimSilence: true, soundRegion: SOUND, startTime: 0, endTime: 1000 })
    expect(playRegion(cue, true)).toEqual({ startMs: 0, endMs: 1000 })
    expect(trimAmounts(cue)).toEqual({ headMs: 0, tailMs: 0 })
  })

  it('trims a region that runs to the end of the file to where the sound stops', () => {
    const cue = audio({ trimSilence: true, soundRegion: SOUND, startTime: 3000, endTime: null })
    expect(playRegion(cue, false).endMs).toBeNull()
    expect(playRegion(cue, true)).toEqual({ startMs: 3000, endMs: 8000 })
    expect(trimAmounts(cue)).toEqual({ headMs: 0, tailMs: 12_000 })
  })
})

describe('cuesAwaitingSilence', () => {
  it('asks only about cues trimming a file nobody has measured', () => {
    const cues: Cue[] = [
      audio({ id: 'a1', trimSilence: true }),
      audio({ id: 'a2', trimSilence: false }),
      audio({ id: 'a3', trimSilence: true, soundRegion: SOUND }),
      audio({ id: 'a4', trimSilence: true, filePath: '' }),
      audio({ id: 'a5', trimSilence: true })
    ]
    expect(cuesAwaitingSilence(cues, {}).map(c => c.id)).toEqual(['a1', 'a5'])
  })

  it('holds back a file the engine has already refused', () => {
    const cues: Cue[] = [audio({ id: 'a1', trimSilence: true })]
    expect(cuesAwaitingSilence(cues, { a1: '/show/track.wav' })).toEqual([])
  })

  it('asks again about a cue that now names another file', () => {
    // The refusal belongs to the file that was asked about, and this is not that file.
    const cue = audio({ trimSilence: true, filePath: '/show/relinked.wav' })
    expect(cuesAwaitingSilence([cue], { a1: '/show/track.wav' })).toHaveLength(1)
  })
})
