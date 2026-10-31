import { describe, expect, it } from 'vitest'
import { TimecodeChase, type ChaseDeps } from './timecodeChase'
import { createCue } from '../utils/cueDefaults'
import {
  idleReceiverStatus,
  parseTimecodeFrames,
  type TimecodeOnStop,
  type TimecodeReceiverStatus
} from '../../../shared/timecode'
import type { Cue } from '../../../shared/cue'

const at = (label: string): number => parseTimecodeFrames(label, '25')!

function cueAt(id: string, type: 'audio' | 'osc', label: string, duration = 0): Cue {
  const cue = createCue(type, id)
  return { ...cue, id, number: id, duration, triggers: [{ id: `t-${id}`, kind: 'timecode', timecode: label }] } as Cue
}

function harness(options: {
  chase?: boolean
  onStop?: TimecodeOnStop
  tolerance?: number
  listShift?: ChaseDeps['listShift']
} = {}) {
  const cues: Cue[] = [
    cueAt('A', 'audio', '01:00:00:00', 10_000),
    cueAt('B', 'osc', '01:00:05:00'),
    cueAt('C', 'audio', '01:00:20:00', 5_000)
  ]
  const log: string[] = []
  const running = new Set<string>()
  const deps: ChaseDeps = {
    getCues: () => cues,
    settings: () => ({ chase: options.chase ?? false, toleranceFrames: options.tolerance ?? 10, onStop: options.onStop ?? 'hold' }),
    fire: cue => {
      log.push(`fire ${cue.id}`)
      running.add(cue.id)
    },
    chase: (cue, seekMs) => {
      log.push(`chase ${cue.id} ${Math.round(seekMs)}`)
      running.add(cue.id)
    },
    stop: cueId => {
      log.push(`stop ${cueId}`)
      running.delete(cueId)
    },
    isRunning: cueId => running.has(cueId),
    ...(options.listShift ? { listShift: options.listShift } : {})
  }
  const chase = new TimecodeChase(deps)
  let now = 0
  const status = (frames: number, state: TimecodeReceiverStatus['state'] = 'locked'): TimecodeReceiverStatus => ({
    ...idleReceiverStatus('mtc'), state, frames, at: now, rate: '25', direction: 1
  })
  /** The clock running from `from` for `ms`, looked at every 40 ms. */
  const run = (from: number, ms: number) => {
    const start = now
    for (let t = 0; t <= ms; t += 40) {
      now = start + t
      chase.update(status(from + (t * 25) / 1000), now)
    }
    now += 40
  }
  const stand = (frames: number, state: TimecodeReceiverStatus['state'] = 'lost') => {
    now += 40
    chase.update(status(frames, state), now)
  }
  return { chase, log, run, stand, cues }
}

describe('timecode triggers', () => {
  it('fire each cue once as the clock runs through its frame', () => {
    const { log, run } = harness()
    run(at('00:59:59:00'), 8000)
    expect(log).toEqual(['fire A', 'fire B'])
  })

  it('fire a cue the clock starts on, even heard a frame late', () => {
    const { log, run } = harness()
    run(at('01:00:00:02'), 200)
    expect(log).toEqual(['fire A'])
  })

  it('arm again when the clock goes back before them', () => {
    const { log, run } = harness()
    run(at('01:00:04:00'), 2000)
    run(at('01:00:04:10'), 1000)
    expect(log).toEqual(['fire B', 'fire B'])
  })

  it('fire what a short skip jumped over, and nothing a locate jumped over', () => {
    const skipped = harness()
    skipped.run(at('01:00:04:00'), 760) // to 01:00:04:19
    skipped.run(at('01:00:05:03'), 100) // eight frames on: inside the tolerance
    expect(skipped.log).toEqual(['fire B'])

    const located = harness()
    located.run(at('01:00:01:00'), 200)
    located.run(at('01:00:30:00'), 200)
    expect(located.log).toEqual([])
  })
})

describe('chase', () => {
  it('puts the cues the clock is inside of where they should be, and stops what it left', () => {
    const { log, run } = harness({ chase: true })
    run(at('01:00:03:00'), 0)
    expect(log).toEqual(['chase A 3000'])
    run(at('01:00:03:00') + 1, 2400) // runs on through B
    expect(log).toEqual(['chase A 3000', 'fire B'])
    log.length = 0
    run(at('01:00:22:00'), 0)
    expect(log).toEqual(['chase C 2000', 'stop A', 'stop B'])
  })

  it('holds what it was running when the clock stops, and picks it up where the clock comes back', () => {
    const { log, run, stand } = harness({ chase: true, onStop: 'hold' })
    run(at('01:00:01:00'), 400)
    stand(at('01:00:01:10'))
    expect(log).toEqual(['chase A 1000', 'stop A'])
    run(at('01:00:01:10'), 0)
    expect(log[2]).toBe('chase A 1400')
  })

  it('leaves the cues running when told to continue', () => {
    const { log, run, stand } = harness({ chase: true, onStop: 'continue' })
    run(at('01:00:01:00'), 400)
    stand(at('01:00:01:10'))
    expect(log).toEqual(['chase A 1000'])
  })

  it('stops the cues and does not pick them up again when told to stop', () => {
    const { log, run, stand } = harness({ chase: true, onStop: 'stop' })
    run(at('01:00:01:00'), 400)
    stand(at('01:00:01:10'))
    run(at('01:00:02:00'), 0)
    expect(log).toEqual(['chase A 1000', 'stop A'])
  })

  it('does not chase a cue with no length to land inside', () => {
    const { log, run } = harness({ chase: true })
    run(at('01:00:06:00'), 0)
    // A is inside its ten seconds; B is an OSC message, which has no inside.
    expect(log).toEqual(['chase A 6000'])
  })
})

describe('each list on the clock', () => {
  it('places a list’s cues its own offset later, and fires them there', () => {
    // A and C are in a list that sits six seconds later on the clock; B is in the main list.
    const { log, run } = harness({ listShift: cue => cue.id === 'B' ? 0 : at('00:00:06:00') })
    run(at('00:59:59:00'), 8000)
    expect(log).toEqual(['fire B', 'fire A'])
  })

  it('leaves a list that does not follow the clock alone, firing and chasing', () => {
    const { log, run } = harness({ chase: true, listShift: cue => cue.id === 'A' ? null : 0 })
    run(at('01:00:03:00'), 0)
    run(at('01:00:03:00') + 1, 2400)
    expect(log).toEqual(['fire B'])
  })

  it('chases a list’s cue to where its own offset puts the clock inside it', () => {
    const { log, run } = harness({ chase: true, listShift: cue => cue.id === 'A' ? at('00:00:02:00') : 0 })
    run(at('01:00:05:00'), 0)
    // A starts at 01:00:02:00 on this list's clock: three seconds in.
    expect(log).toContain('chase A 3000')
  })
})
