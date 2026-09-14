// The saved form of a session. What matters here is that it is a function of the state
// and the show's identity — nothing in it comes from the clock or from a fresh random
// value at save time, because a showfile that rewrites itself on every save cannot be
// diffed. The store owns the identity; this is where it is spent.
import { describe, it, expect } from 'vitest'
import { buildWorkspace } from './workspace'
import type { AudioCue } from '../types/cue'
import { defaultShowSettings } from '../types/show'
import { DEFAULT_TRIGGER_GUARD } from '../types/workspace'

const identity = { id: 'w-press-night', createdAt: '2026-01-01T00:00:00.000Z' }

function cue(overrides: Partial<AudioCue> = {}): AudioCue {
  return {
    id: 'a1',
    number: '1',
    name: 'Walk-in',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    type: 'audio',
    filePath: '/shows/walk-in.wav',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1,
    ...overrides
  }
}

// A show's settings as the state holds them: one value, not one per call. Asking for a
// fresh default per save would be a different state every time, which is the thing this
// file exists to say a showfile is not.
const settings = defaultShowSettings()
const guard = DEFAULT_TRIGGER_GUARD

const build = () =>
  buildWorkspace('Press Night', [cue()], { outputDeviceId: 'default' }, { outputPortName: '' }, settings, identity, guard)

describe('buildWorkspace', () => {
  it('writes the identity it was given, not one of its own', () => {
    const workspace = build()

    expect(workspace.id).toBe(identity.id)
    expect(workspace.createdAt).toBe(identity.createdAt)
  })

  it('carries the guard with the show', () => {
    // The window is what the desk that sends twice is answered with, so it travels in
    // the file rather than in this machine's settings.
    expect(build().triggerGuard).toEqual(guard)
  })

  it('builds the same bytes twice for the same state', () => {
    // The clock has moved on between the two calls; the file must not have noticed.
    const first = JSON.stringify(build())
    const second = JSON.stringify(build())

    expect(second).toBe(first)
  })
})
