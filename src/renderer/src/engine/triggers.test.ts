// A trigger decides whether a cue is the thing a desk or a tablet is talking to. The
// matching rules are deliberately literal: a value a desk sends is how it expresses
// itself, not which cue it means.
import { describe, it, expect } from 'vitest'
import { cueTriggers, describeTriggerSource, matchesTrigger, triggeredCues } from './triggers'
import type { Cue, CueTrigger, MidiMessageKind } from '../types/cue'
import type { ShowEvent } from '../types/show'

function oscTrigger(address: string): CueTrigger {
  return { id: 't-osc', kind: 'osc', address }
}

function midiTrigger(message: Extract<CueTrigger, { kind: 'midi' }>['message'], device = 'IAC Bus 1'): CueTrigger {
  return { id: 't-midi', kind: 'midi', device, message }
}

function oscEvent(address: string): ShowEvent {
  return { kind: 'osc', at: 1, from: '10.0.0.5:8000', address, args: [{ type: 'i', value: 1 }] }
}

function midiEvent(message: MidiMessageKind, device = 'IAC Bus 1'): ShowEvent {
  return { kind: 'midi', at: 1, device, message }
}

function cue(id: string, triggers: CueTrigger[], isArmed = true): Cue {
  return {
    id,
    number: id,
    name: `Cue ${id}`,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed,
    notes: '',
    triggers,
    type: 'wait'
  }
}

describe('matchesTrigger', () => {
  it('matches an OSC address exactly, and nothing else', () => {
    expect(matchesTrigger(oscTrigger('/eos/cue/12/fire'), oscEvent('/eos/cue/12/fire'))).toBe(true)
    expect(matchesTrigger(oscTrigger('/eos/cue/12/fire'), oscEvent('/eos/cue/12'))).toBe(false)
    // A prefix match would let one message fire two cues that were meant to be separate.
    expect(matchesTrigger(oscTrigger('/eos/cue'), oscEvent('/eos/cue/12/fire'))).toBe(false)
    expect(matchesTrigger(oscTrigger('/eos/cue/12/fire'), oscEvent('/eos/cue/120/fire'))).toBe(false)
  })

  it('does not match across protocols', () => {
    expect(matchesTrigger(oscTrigger('/go'), midiEvent({ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }))).toBe(false)
    expect(matchesTrigger(
      midiTrigger({ kind: 'noteOn', channel: 1, note: 60 }),
      oscEvent('/go')
    )).toBe(false)
    expect(matchesTrigger(oscTrigger('/go'), {
      kind: 'device',
      at: 1,
      device: { id: 'rf:1', service: 'rf', name: 'Pack 1', online: true, lastSeen: 1 }
    })).toBe(false)
  })

  it('matches a note whatever its velocity, on the channel and device it was learned on', () => {
    const trigger = midiTrigger({ kind: 'noteOn', channel: 3, note: 64 })

    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOn', channel: 3, note: 64, velocity: 1 }))).toBe(true)
    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOn', channel: 3, note: 64, velocity: 127 }))).toBe(true)
    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOn', channel: 3, note: 65, velocity: 100 }))).toBe(false)
    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOn', channel: 4, note: 64, velocity: 100 }))).toBe(false)
    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOn', channel: 3, note: 64, velocity: 64 }, 'Other Port'))).toBe(false)
    // A note-off is a different message from a note-on, even for the same note.
    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOff', channel: 3, note: 64, velocity: 0 }))).toBe(false)
  })

  it('matches a controller whatever it is turned to, and a program change by its number', () => {
    const cc = midiTrigger({ kind: 'cc', channel: 1, controller: 7 })
    expect(matchesTrigger(cc, midiEvent({ kind: 'cc', channel: 1, controller: 7, value: 0 }))).toBe(true)
    expect(matchesTrigger(cc, midiEvent({ kind: 'cc', channel: 1, controller: 7, value: 127 }))).toBe(true)
    expect(matchesTrigger(cc, midiEvent({ kind: 'cc', channel: 1, controller: 8, value: 64 }))).toBe(false)

    const program = midiTrigger({ kind: 'programChange', channel: 2, program: 12 })
    expect(matchesTrigger(program, midiEvent({ kind: 'programChange', channel: 2, program: 12 }))).toBe(true)
    expect(matchesTrigger(program, midiEvent({ kind: 'programChange', channel: 2, program: 13 }))).toBe(false)
  })
})

describe('triggeredCues', () => {
  it('returns the armed cues that answer to the event, in cue order', () => {
    const cues = [
      cue('1', [oscTrigger('/go')]),
      cue('2', [oscTrigger('/other')]),
      cue('3', [oscTrigger('/go'), midiTrigger({ kind: 'cc', channel: 1, controller: 1 })])
    ]

    expect(triggeredCues(cues, oscEvent('/go')).map(c => c.id)).toEqual(['1', '3'])
  })

  it('leaves a disarmed cue alone, however well the message fits', () => {
    // Disarming is how the operator takes a cue out of tonight's show; a trigger that
    // ignored it would fire something already decided against.
    const cues = [cue('1', [oscTrigger('/go')], false)]

    expect(triggeredCues(cues, oscEvent('/go'))).toEqual([])
  })

  it('ignores the rest of the bus', () => {
    const cues = [cue('1', [oscTrigger('/go')])]

    expect(triggeredCues(cues, {
      kind: 'alert',
      at: 1,
      alert: { id: 1, at: 1, level: 'warning', source: 'rf', message: 'pack low' }
    })).toEqual([])
  })

  it('treats a cue with no triggers as one that answers to nothing', () => {
    const bare = { ...cue('1', []), triggers: undefined }

    expect(cueTriggers(bare)).toEqual([])
    expect(triggeredCues([bare], oscEvent('/go'))).toEqual([])
  })
})

describe('describeTriggerSource', () => {
  it('says what fired the cue, in the log', () => {
    expect(describeTriggerSource(oscEvent('/eos/cue/12/fire')))
      .toBe('OSC /eos/cue/12/fire 1 from 10.0.0.5:8000')
    expect(describeTriggerSource(midiEvent({ kind: 'noteOn', channel: 1, note: 60, velocity: 100 })))
      .toBe('MIDI noteOn note 60 on ch1 from "IAC Bus 1"')
    expect(describeTriggerSource(midiEvent({ kind: 'cc', channel: 2, controller: 7, value: 3 })))
      .toBe('MIDI cc cc 7 on ch2 from "IAC Bus 1"')
  })

  it('leaves the arguments out when the message carried none', () => {
    expect(describeTriggerSource({
      kind: 'osc', at: 1, from: '10.0.0.5:8000', address: '/go', args: []
    })).toBe('OSC /go from 10.0.0.5:8000')
  })
})
