// Wall-clock triggers, with the clock handed in: on time, missed while the show was closed or
// the machine asleep, skipped or fired late by the trigger's own policy.
import { describe, it, expect } from 'vitest'
import {
  ClockTriggerWatcher,
  clockSeconds,
  describeClockTrigger,
  formatClockTime,
  LOOK_BACK_MS,
  occurrences
} from './clockTriggers'
import type { ClockMissedPolicy, Cue, CueTrigger } from '../../../shared/cue'
import { createCue } from '../utils/cueDefaults'

type Clock = Extract<CueTrigger, { kind: 'clock' }>
const trigger = (time: string, patch: Partial<Clock> = {}): Clock =>
  ({ id: `t-${time}`, kind: 'clock', time, days: [], missed: 'skip' as ClockMissedPolicy, graceMinutes: 0, ...patch })
const cueWith = (id: string, ...triggers: CueTrigger[]): Cue => ({ ...createCue('wait', id), id, triggers })

/** A local time on a fixed day: Friday 9 October 2026. */
const at = (h: number, m: number, s = 0): number => new Date(2026, 9, 9, h, m, s).getTime()

describe('a time of day', () => {
  it('reads HH:MM and HH:MM:SS, and refuses anything else', () => {
    expect(clockSeconds('19:30')).toBe(19 * 3600 + 30 * 60)
    expect(clockSeconds('07:05:09')).toBe(7 * 3600 + 5 * 60 + 9)
    for (const bad of ['24:00', '19:60', '7pm', '', '19:30:61']) expect(clockSeconds(bad)).toBeNull()
    expect(formatClockTime(19 * 3600 + 30 * 60)).toBe('19:30')
    expect(formatClockTime(19 * 3600 + 30 * 60 + 5)).toBe('19:30:05')
  })

  it('comes round once a day, on the days it answers', () => {
    expect(occurrences(trigger('19:30'), at(0, 0), at(23, 59))).toEqual([at(19, 30)])
    // Friday is 5: a Saturday-only trigger is not today.
    expect(occurrences(trigger('19:30', { days: [6] }), at(0, 0), at(23, 59))).toEqual([])
    expect(occurrences(trigger('19:30', { days: [5] }), at(0, 0), at(23, 59))).toEqual([at(19, 30)])
    expect(describeClockTrigger(trigger('19:30', { days: [6, 0] }))).toBe('19:30 Sun, Sat')
    expect(describeClockTrigger(trigger('14:00', { missed: 'fire', graceMinutes: 5 }))).toBe('14:00 every day · fires late within 5 min')
  })
})

describe('the clock watcher', () => {
  it('fires a time the moment the clock runs through it, once', () => {
    const watcher = new ClockTriggerWatcher()
    const cues = [cueWith('w', trigger('19:30'))]
    watcher.open(at(19, 29, 58))
    expect(watcher.check(cues, at(19, 29, 59))).toEqual([])
    expect(watcher.check(cues, at(19, 30, 0))).toEqual([expect.objectContaining({ kind: 'fire', cueId: 'w', at: at(19, 30), lateMs: 0 })])
    expect(watcher.check(cues, at(19, 30, 1))).toEqual([])
  })

  it('skips a time that went by while the show was closed, and says so', () => {
    const watcher = new ClockTriggerWatcher()
    const cues = [cueWith('w', trigger('19:30'))]
    // The show is opened four minutes after the time.
    watcher.open(at(19, 34))
    expect(watcher.check(cues, at(19, 34))).toEqual([
      expect.objectContaining({ kind: 'missed', cueId: 'w', at: at(19, 30), policy: 'skip', lateMs: 4 * 60_000 })
    ])
  })

  it('fires a missed time late within its grace, and skips it past that', () => {
    const cues = [cueWith('w', trigger('19:30', { missed: 'fire', graceMinutes: 5 }))]
    const soon = new ClockTriggerWatcher()
    soon.open(at(19, 34))
    expect(soon.check(cues, at(19, 34))).toEqual([expect.objectContaining({ kind: 'fire', lateMs: 4 * 60_000 })])
    const late = new ClockTriggerWatcher()
    late.open(at(19, 40))
    expect(late.check(cues, at(19, 40))).toEqual([expect.objectContaining({ kind: 'missed', policy: 'fire' })])
  })

  it('treats a machine that slept through the time like a show that was closed', () => {
    const watcher = new ClockTriggerWatcher()
    const cues = [cueWith('w', trigger('19:30', { missed: 'fire', graceMinutes: 10 }))]
    watcher.open(at(19, 0))
    expect(watcher.check(cues, at(19, 0))).toEqual([])
    // Asleep from 19:00 to 19:35: one check, half an hour on.
    expect(watcher.check(cues, at(19, 35))).toEqual([expect.objectContaining({ kind: 'fire', lateMs: 5 * 60_000 })])
  })

  it('counts only the latest time a long gap covered, and nothing from before the hour it looks back', () => {
    const watcher = new ClockTriggerWatcher()
    const cues = [cueWith('w', trigger('19:30'))]
    watcher.open(at(19, 31) + 2 * 24 * 3600_000)
    // Two days and a minute later: one missed time, not three.
    expect(watcher.check(cues, at(19, 31) + 2 * 24 * 3600_000)).toHaveLength(1)
    const fresh = new ClockTriggerWatcher()
    fresh.open(at(19, 30) + LOOK_BACK_MS + 1000)
    expect(fresh.check(cues, at(19, 30) + LOOK_BACK_MS + 1000)).toEqual([])
  })

  it('fires nothing on a disarmed cue, and nothing when the clock moves backwards', () => {
    const watcher = new ClockTriggerWatcher()
    watcher.open(at(19, 29, 59))
    const disarmed = [{ ...cueWith('w', trigger('19:30')), isArmed: false }]
    expect(watcher.check(disarmed, at(19, 30))).toEqual([])
    const armed = [cueWith('w', trigger('19:31'))]
    expect(watcher.check(armed, at(19, 0))).toEqual([])
  })
})
