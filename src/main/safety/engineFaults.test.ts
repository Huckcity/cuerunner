import { describe, it, expect } from 'vitest'
import { deviceFaultAlert } from './engineFaults'
import type { AudioEngineEvent } from '../../shared/audio'

describe('deviceFaultAlert', () => {
  it('raises the engine’s own fault line for a lost device', () => {
    // The alarm is the line the log already carries, at the level a show that has stopped
    // sounding deserves, from the surface the operator configures the device on.
    const event: AudioEngineEvent = {
      type: 'error',
      at: 0,
      cueId: null,
      runId: null,
      code: 'device',
      message: 'audio device stopped unexpectedly',
      sessionId: 'session-a'
    }

    expect(deviceFaultAlert(event)).toEqual({
      level: 'critical',
      source: 'audio',
      message: 'audio device stopped unexpectedly'
    })
  })

  it('raises nothing for the engine’s other lines, including everything a deliberate stop leaves', () => {
    // A deliberate stop (a reconfigure, a shutdown) writes nothing to the wire, and a cue
    // that failed, an engine that died and a panic the operator pressed are all reported
    // as themselves rather than as a lost device.
    const lines: AudioEngineEvent[] = [
      { type: 'error', at: 0, cueId: 'a1', runId: 'run-1', code: 'decode', message: 'could not open media file', sessionId: 's' },
      { type: 'error', at: 0, cueId: null, runId: null, code: 'engine', message: 'audio engine exited (1)', sessionId: 's' },
      { type: 'error', at: 0, cueId: null, runId: null, code: 'limit', message: 'no free voice for this cue', sessionId: 's' },
      { type: 'panic', at: 0, fadeMs: 0, sessionId: 's' },
      { type: 'ended', cueId: 'a1', runId: 'run-1', at: 0, reason: 'device-lost', loopsCompleted: 0, sessionId: 's' },
      { type: 'ended', cueId: 'a1', runId: 'run-1', at: 0, reason: 'stopped', loopsCompleted: 0, sessionId: 's' },
      { type: 'state', at: 0, active: false, cueId: null, runId: null, playing: false, state: null, sessionId: 's' }
    ]

    for (const line of lines) expect(deviceFaultAlert(line)).toBeNull()
  })
})
