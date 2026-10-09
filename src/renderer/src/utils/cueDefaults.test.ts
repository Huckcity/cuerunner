import { describe, it, expect } from 'vitest'
import { createCue, cueNameFromFile, formatDuration, formatClock, nextCueNumber } from './cueDefaults'
import type { CueType } from '../../../shared/cue'
import { oscMessages } from '../../../shared/cueTargets'

describe('nextCueNumber', () => {
  const numbered = (...numbers: string[]) => numbers.map(number => ({ number }))

  it('starts an empty show at 1', () => {
    expect(nextCueNumber([])).toBe('1')
  })

  it('is one past the highest number the show uses, wherever that cue sits', () => {
    expect(nextCueNumber(numbered('1', '2', '3'))).toBe('4')
    expect(nextCueNumber(numbered('7', '2', '3'))).toBe('8')
  })

  it('reads the whole number a cue number begins with', () => {
    // A split leaves "12b", an operator types "12.5", and a show saved before a duplicate
    // took a number of its own still carries "12 copy".
    expect(nextCueNumber(numbered('12b'))).toBe('13')
    expect(nextCueNumber(numbered('12 copy'))).toBe('13')
    expect(nextCueNumber(numbered('12.5'))).toBe('13')
  })

  it('counts past a number that is a label rather than a place', () => {
    expect(nextCueNumber(numbered('LX 12', '', 'A'))).toBe('1')
    expect(nextCueNumber(numbered('3', 'LX 40'))).toBe('4')
    expect(nextCueNumber(numbered('2', '99999999999999999999'))).toBe('3')
  })
})

describe('createCue', () => {
  const types: CueType[] = ['audio', 'midi', 'osc', 'wait', 'fade', 'stop', 'group', 'network', 'script', 'scene', 'devamp']

  it.each(types)('creates a %s cue with correct type', (type) => {
    expect(createCue(type).type).toBe(type)
  })

  it.each(types)('creates a %s cue with a unique UUID id', (type) => {
    const a = createCue(type)
    const b = createCue(type)
    expect(a.id).not.toBe(b.id)
    expect(a.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('takes the number it is given, and is cue 1 when it is made on its own', () => {
    expect(createCue('wait', '14').number).toBe('14')
    expect(createCue('wait').number).toBe('1')
    // Two cues made on their own are both the first cue of nothing: no count is kept
    // between them, which is what used to number a new show from the last one's total.
    expect(createCue('wait').number).toBe('1')
  })

  it.each(types)('%s cue is armed by default', (type) => {
    expect(createCue(type).isArmed).toBe(true)
  })

  it.each(types)('%s cue has zero pre/post-wait by default', (type) => {
    const cue = createCue(type)
    expect(cue.preWait).toBe(0)
    expect(cue.postWait).toBe(0)
  })

  it('audio cue is born with automatic routing at full level', () => {
    const cue = createCue('audio')
    if (cue.type !== 'audio') throw new Error('wrong type')
    // null, not []: automatic routing, where an empty list would be silence.
    expect(cue.outputs).toBeNull()
    expect(cue.volume).toBe(1)
    expect(cue.pan).toBe(0)
    expect(cue.playbackRate).toBe(1.0)
    expect(cue.trim).toBe(1.0)
  })

  it('osc cue defaults to localhost port 53000', () => {
    const cue = createCue('osc')
    if (cue.type !== 'osc') throw new Error('wrong type')
    // A new cue carries its one message as a list, ready for the next.
    expect(cue.messages).toEqual([{ patchId: '', host: '127.0.0.1', port: 53000, address: '/cue/1/start', args: [] }])
    expect(oscMessages(cue)[0].host).toBe('127.0.0.1')
    expect(oscMessages(cue)[0].port).toBe(53000)
  })

  it('wait cue has non-zero default duration', () => {
    const cue = createCue('wait')
    if (cue.type !== 'wait') throw new Error('wrong type')
    expect(cue.duration).toBeGreaterThan(0)
  })

  it('fade cue defaults to 3 second duration', () => {
    const cue = createCue('fade')
    if (cue.type !== 'fade') throw new Error('wrong type')
    expect(cue.duration).toBe(3000)
  })

  it('group cue defaults to sequence mode with no parent', () => {
    const cue = createCue('group')
    if (cue.type !== 'group') throw new Error('wrong type')
    expect(cue.mode).toBe('sequence')
    expect(cue.parentId).toBeNull()
  })

  it.each(['audio', 'midi', 'osc', 'wait', 'fade', 'stop', 'group', 'network', 'script', 'scene', 'devamp'] as CueType[])(
    '%s cue has parentId null by default', (type) => {
      expect(createCue(type).parentId).toBeNull()
    }
  )
})

describe('formatClock', () => {
  it('formats a timestamp as 24h time with seconds', () => {
    expect(formatClock(new Date(2026, 0, 2, 17, 10, 41).getTime())).toBe('17:10:41')
  })

  it('pads single-digit hours, minutes, and seconds', () => {
    expect(formatClock(new Date(2026, 0, 2, 9, 5, 3).getTime())).toBe('09:05:03')
  })

  it('renders midnight as 00:00:00', () => {
    expect(formatClock(new Date(2026, 0, 2, 0, 0, 0).getTime())).toBe('00:00:00')
  })
})

describe('formatDuration', () => {
  it('returns em dash for zero', () => {
    expect(formatDuration(0)).toBe('–')
  })

  it('formats sub-minute durations as seconds', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(500)).toBe('0.5s')
    expect(formatDuration(30000)).toBe('30.0s')
  })

  it('formats minute+ durations with m:ss.s', () => {
    expect(formatDuration(60000)).toBe('1:00.0')
    expect(formatDuration(90500)).toBe('1:30.5')
    expect(formatDuration(125000)).toBe('2:05.0')
  })

  it('never writes a sixtieth second: the tenth is rounded before the minutes are taken', () => {
    expect(formatDuration(59_960)).toBe('1:00.0')
    expect(formatDuration(119_970)).toBe('2:00.0')
    expect(formatDuration(3_599_990)).toBe('60:00.0')
    // Just under the rounding boundary still belongs to the minute it is in.
    expect(formatDuration(59_940)).toBe('59.9s')
    expect(formatDuration(119_940)).toBe('1:59.9')
  })
})

describe('a cue named after its file', () => {
  it('takes the file\'s own name, without the folder or the extension', () => {
    expect(cueNameFromFile('/shows/hamlet/Door Slam.wav')).toBe('Door Slam')
    expect(cueNameFromFile('C:\\Shows\\Hamlet\\Door Slam.take2.flac')).toBe('Door Slam.take2')
  })

  it('keeps a name that is all there is: no extension, or nothing before the dot', () => {
    expect(cueNameFromFile('/shows/thunder')).toBe('thunder')
    expect(cueNameFromFile('/shows/.hidden')).toBe('.hidden')
  })
})

