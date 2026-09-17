// A trigger decides whether a cue is the thing a desk or a tablet is talking to. The
// matching rules are deliberately literal: a value a desk sends is how it expresses
// itself, not which cue it means.
import { describe, it, expect } from 'vitest'
import { cueTriggers, describeTriggerSource, matchesTrigger, triggeredCues } from './triggers'
import { encodeMsc } from '../utils/msc'
import type { Cue, CueTrigger, MidiMessageKind } from '../../../shared/cue'
import type { ShowEvent } from '../../../shared/show'

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

  it('leaves a release trigger from an older show inert, and answers false rather than nothing', () => {
    // Shows saved while the picker still offered note-offs can carry one. Firing one
    // would be a cue that fires on the release of a key somebody is holding down, so it
    // matches nothing — and says so, rather than falling off the end of the switch.
    const legacy = {
      id: 't-legacy',
      kind: 'midi',
      device: 'IAC Bus 1',
      message: { kind: 'noteOff', channel: 1, note: 60 }
    } as unknown as CueTrigger
    const cues = [cue('1', [legacy])]

    expect(matchesTrigger(legacy, midiEvent({ kind: 'noteOff', channel: 1, note: 60, velocity: 0 }))).toBe(false)
    expect(matchesTrigger(legacy, midiEvent({ kind: 'noteOn', channel: 1, note: 60, velocity: 100 }))).toBe(false)
    expect(triggeredCues(cues, midiEvent({ kind: 'noteOff', channel: 1, note: 60, velocity: 0 }))).toEqual([])
  })
})

describe('a show control trigger', () => {
  const go = { deviceId: 127, format: 'all' as const, command: 'go' as const, cueNumber: '12', cueList: '' }

  it('answers the command the console sent, and nothing like it', () => {
    const trigger: CueTrigger = { id: 't-msc', kind: 'msc', device: 'IAC Bus 1', ...go }
    const event = (message: Parameters<typeof encodeMsc>[0]) => midiEvent(encodeMsc(message))

    expect(matchesTrigger(trigger, event(go))).toBe(true)

    // The cue number is the instruction: cue 13 is another cue's command, and a command
    // that names no cue at all is not the same as one that names this one.
    expect(matchesTrigger(trigger, event({ ...go, cueNumber: '13' }))).toBe(false)
    expect(matchesTrigger({ id: 't', kind: 'msc', device: 'IAC Bus 1', ...go, cueNumber: '' },
      event({ ...go, cueNumber: '' }))).toBe(true)
    expect(matchesTrigger({ id: 't', kind: 'msc', device: 'IAC Bus 1', ...go, cueNumber: '' },
      event(go))).toBe(false)

    // A different list, command, format or device ID is a different instruction.
    expect(matchesTrigger(trigger, event({ ...go, cueList: '2' }))).toBe(false)
    expect(matchesTrigger(trigger, event({ ...go, command: 'load' }))).toBe(false)
    expect(matchesTrigger(trigger, event({ ...go, format: 'lighting' }))).toBe(false)
    expect(matchesTrigger(trigger, event({ ...go, deviceId: 3 }))).toBe(false)
    // Another port is another console.
    expect(matchesTrigger(trigger, midiEvent(encodeMsc(go), 'Other Port'))).toBe(false)
  })

  it('is not answered by a plain MIDI message, nor by a sysex that is not show control', () => {
    const trigger: CueTrigger = { id: 't-msc', kind: 'msc', device: 'IAC Bus 1', ...go }

    expect(matchesTrigger(trigger, midiEvent({ kind: 'noteOn', channel: 1, note: 60, velocity: 127 }))).toBe(false)
    expect(matchesTrigger(trigger, midiEvent({ kind: 'sysex', data: [0x00, 0x20, 0x33, 0x02] }))).toBe(false)
  })

  it('is described as the command, so the log names what spoke', () => {
    expect(describeTriggerSource(midiEvent(encodeMsc({ ...go, cueList: '2' }))))
      .toBe('MSC Go cue 12 list 2 from "IAC Bus 1"')
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
