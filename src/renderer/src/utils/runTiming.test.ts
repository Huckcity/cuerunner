import { describe, it, expect } from 'vitest'
import { formatRunTime, runTiming } from './runTiming'
import type { RunningCue } from '../store'
import type { AudioProgress } from '../../../shared/audio'

const cue = { preWait: 2000, postWait: 1000 }

function run(state: RunningCue['state'], startedAt: number): RunningCue {
  return { cueId: 'c', state, startedAt, progress: 0 }
}

function audio(elapsedMs: number, durationMs: number): AudioProgress {
  return {
    cueId: 'c', runId: 'r', state: 'playing', playing: true, elapsedMs, durationMs,
    fraction: elapsedMs / durationMs, runFraction: elapsedMs / durationMs, loopsCompleted: 0, startedAtMs: 0
  }
}

describe('runTiming', () => {
  it('counts a pre-wait down against the cue’s pre-wait', () => {
    expect(runTiming(cue, run('pre-wait', 1000), 8000, 1500, null))
      .toEqual({ elapsedMs: 500, remainingMs: 1500, fraction: 0.25 })
  })

  it('counts a post-wait down against the cue’s post-wait', () => {
    expect(runTiming(cue, run('post-wait', 0), 8000, 250, null).remainingMs).toBe(750)
  })

  it('takes an audio cue’s position from the engine, not the wall clock', () => {
    const timing = runTiming(cue, run('playing', 0), 4000, 99_999, audio(2400, 4000))
    expect(timing).toEqual({ elapsedMs: 2400, remainingMs: 1600, fraction: 0.6 })
  })

  it('counts anything else from when it began, and never below zero', () => {
    expect(runTiming(cue, run('playing', 0), 8000, 3000, null).remainingMs).toBe(5000)
    expect(runTiming(cue, run('playing', 0), 8000, 9000, null))
      .toEqual({ elapsedMs: 9000, remainingMs: 0, fraction: 1 })
  })

  it('says nothing about what is left when nothing says how long it lasts', () => {
    expect(runTiming(cue, run('playing', 0), 0, 3000, null))
      .toEqual({ elapsedMs: 3000, remainingMs: null, fraction: null })
  })
})

describe('formatRunTime', () => {
  it('reads as minutes and tenths, including zero', () => {
    expect(formatRunTime(0)).toBe('0:00.0')
    expect(formatRunTime(1650)).toBe('0:01.6')
    expect(formatRunTime(61_250)).toBe('1:01.2')
    expect(formatRunTime(-40)).toBe('0:00.0')
  })
})
