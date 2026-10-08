import { describe, expect, it } from 'vitest'
import path from 'node:path'
import type {
  AudioCue, ControlCue, Cue, FadeCue, GroupCue, MidiCue, MscCue, OscCue, StopCue, DevampCue, WaitCue
} from '../../shared/cue'
import { mapQLabShow, mediaPath, oscTokens, parseOscMessage } from './qlabMap'
import { parseQLabWorkspace } from './qlabFile'
import { pressNightWorkspace } from './archiveFixture'
import type { QLabCue, QLabShow } from './qlabShow'

let counter = 0
const ids = (): string => `new-${++counter}`

function rec(kind: QLabCue['kind'], fields: Partial<QLabCue> = {}): QLabCue {
  return {
    kind, typeName: '', uniqueID: '', number: '', name: '', notes: '', colorName: 'none', armed: true,
    preWait: 0, postWait: 0, duration: 0, continueMode: 0, ...fields
  }
}

/** The workspace's folder, as this machine writes a folder: `C:\shows\test` on Windows. */
const BASE = path.resolve('/shows/test')

function show(cues: QLabCue[], extra: Partial<QLabShow> = {}): QLabShow {
  return { name: 'Test', baseDir: BASE, lists: [{ name: 'Main', uniqueID: 'L', cart: false, cues }], ...extra }
}

function byNumber<T extends Cue>(cues: Cue[], number: string): T {
  const found = cues.find(cue => cue.number === number)
  if (!found) throw new Error(`no cue ${number}`)
  return found as T
}

describe('the Press Night workspace, mapped', () => {
  const mapped = mapQLabShow(parseQLabWorkspace(pressNightWorkspace(), 'Press Night.qlab5'), ids)
  const cues = mapped.cues

  it('keeps QLab’s ids, numbers, names, notes and colours', () => {
    expect(byNumber<AudioCue>(cues, '1')).toMatchObject({
      id: 'A1', name: 'Walk-in', notes: 'House open', colorLabel: 'green', isArmed: true, parentId: null
    })
    expect(byNumber(cues, '4').colorLabel).toBe('red')
  })

  it('writes every child after its group, with the group as its parent', () => {
    const group = byNumber<GroupCue>(cues, '4')
    const at = cues.indexOf(group)
    expect(cues.slice(at + 1, at + 3).map(cue => [cue.number, cue.parentId])).toEqual([['4.1', 'G4'], ['4.2', 'G4']])
  })

  it('counts every QLab cue, and every type with what it became', () => {
    // 21 in the cue list, 8 inside its groups, 1 in the cart.
    expect(mapped.totalCues).toBe(30)
    const row = (qlabType: string, became: string | null) =>
      mapped.types.find(entry => entry.qlabType === qlabType && entry.becameType === became)?.count
    expect(row('Audio', 'audio')).toBe(6)
    expect(row('Memo', 'wait')).toBe(3)
    expect(row('MIDI', 'midi')).toBe(1)
    expect(row('MIDI', 'msc')).toBe(1)
    expect(row('MIDI', null)).toBe(1)
    expect(row('Network', 'osc')).toBe(2)
    expect(row('Network', null)).toBe(1)
    for (const placeholder of ['Script', 'Video', 'Light', 'Timecode']) expect(row(placeholder, null)).toBe(1)
    // QLab's Start cue is a Control cue here, not a placeholder.
    expect(row('Start', 'control')).toBe(1)
    expect(mapped.types.reduce((sum, entry) => sum + entry.count, 0)).toBe(30)
  })

  it('holds a cue type Cuerunner does not have as a disarmed placeholder that says what it was', () => {
    const video = byNumber<WaitCue>(cues, '14')
    expect(video).toMatchObject({ type: 'wait', isArmed: false, name: 'Intro film', duration: 0 })
    expect(video.notes).toContain('[From QLab: Video cue. Cuerunner has no video cue, so it is disarmed here and does nothing.]')
    expect(video.notes).toContain('File: video/intro.mov')
    expect(byNumber<WaitCue>(cues, '13').notes).toContain('tell application "QLab" to start')
    expect(byNumber<WaitCue>(cues, '15').notes).toContain('all = 0')
    expect(mapped.notes.filter(note => note.kind === 'placeholder').map(note => note.number))
      .toEqual(['10', '12', '13', '14', '15', '18'])
  })

  it('makes QLab’s Start cue a Control cue aimed at the cue it names', () => {
    expect(byNumber<ControlCue>(cues, '17')).toMatchObject({
      type: 'control', action: 'start', isArmed: true, targetCueIds: [byNumber(cues, '4').id]
    })
  })

  it('keeps a second list as a disarmed group, so GO never runs into it', () => {
    const cart = cues.find(cue => cue.name === 'Sound FX') as GroupCue
    expect(cart).toMatchObject({ type: 'group', isArmed: false, parentId: null, mode: 'sequence' })
    expect(cues.filter(cue => cue.parentId === cart.id).map(cue => cue.name)).toEqual(['Door slam'])
    expect(mapped.notes).toContainEqual(expect.objectContaining({ qlabType: 'Cart', kind: 'approximated' }))
  })
})

describe('timing', () => {
  it('maps the continue modes to advance', () => {
    const { cues } = mapQLabShow(show([
      rec('wait', { number: '1', continueMode: 0 }),
      rec('wait', { number: '2', continueMode: 1 }),
      rec('wait', { number: '3', continueMode: 2 }),
      rec('wait', { number: '4' })
    ]), ids)
    expect(cues.map(cue => cue.advance)).toEqual(['none', 'on-start', 'on-end', 'none'])
  })

  it('moves an auto-continue’s pre-wait and post-wait onto the next cue, so it fires when it did in QLab', () => {
    const mapped = mapQLabShow(show([
      rec('wait', { number: '1', preWait: 1, postWait: 2, continueMode: 1 }),
      rec('wait', { number: '2', preWait: 0.5, postWait: 3, continueMode: 1 }),
      rec('wait', { number: '3', preWait: 0.25 })
    ]), ids)
    expect(mapped.cues.map(cue => [cue.preWait, cue.postWait])).toEqual([[1000, 0], [3500, 0], [6750, 0]])
    expect(mapped.notes.filter(note => note.kind === 'retimed').map(note => note.number)).toEqual(['2', '3'])
  })

  it('reads no post-wait for auto-follow or do-not-continue, as QLab does not', () => {
    const { cues } = mapQLabShow(show([
      rec('wait', { number: '1', postWait: 4, continueMode: 2 }),
      rec('wait', { number: '2', postWait: 4 }),
      rec('wait', { number: '3' })
    ]), ids)
    expect(cues.map(cue => [cue.preWait, cue.postWait])).toEqual([[0, 0], [0, 0], [0, 0]])
  })
})

describe('groups', () => {
  const children = (modes: number[]): QLabCue[] =>
    modes.map((continueMode, i) => rec('wait', { number: `g.${i + 1}`, preWait: 1, postWait: 2, continueMode }))

  it('makes a chain of auto-continues a timeline, each child where the chain reached it', () => {
    const { cues, notes } = mapQLabShow(show([rec('group', { number: 'g', groupMode: 2, children: children([1, 1, 0]) })]), ids)
    const [group, ...kids] = cues
    expect((group as GroupCue).mode).toBe('timeline')
    expect(kids.map(kid => [kid.timelineOffset, kid.preWait, kid.postWait, kid.advance])).toEqual([
      [1000, 0, 0, 'none'], [4000, 0, 0, 'none'], [7000, 0, 0, 'none']
    ])
    expect(notes).toContainEqual(expect.objectContaining({ number: 'g', kind: 'retimed' }))
  })

  it('makes a chain of auto-follows a sequence', () => {
    const { cues, notes } = mapQLabShow(show([rec('group', { number: 'g', groupMode: 2, children: children([2, 2, 0]) })]), ids)
    expect((cues[0] as GroupCue).mode).toBe('sequence')
    expect(notes.filter(note => note.number === 'g')).toEqual([])
  })

  it('says so when the children’s chain cannot be a Cuerunner mode', () => {
    const { cues, notes } = mapQLabShow(show([rec('group', { number: 'g', groupMode: 2, children: children([1, 0, 0]) })]), ids)
    expect((cues[0] as GroupCue).mode).toBe('sequence')
    expect(notes).toContainEqual(expect.objectContaining({ number: 'g', kind: 'approximated' }))
  })

  it('maps timeline, random, playlist and enter-the-group', () => {
    const { cues, notes } = mapQLabShow(show([
      rec('group', { number: 't', groupMode: 3, children: [rec('wait', { number: 't.1', preWait: 1.5 })] }),
      rec('group', { number: 'r', groupMode: 4, children: [] }),
      rec('group', { number: 'p', groupMode: 6, children: [] }),
      rec('group', { number: 'e', groupMode: 1, children: [] })
    ]), ids)
    const mode = (number: string) => byNumber<GroupCue>(cues, number).mode
    expect([mode('t'), mode('r'), mode('p'), mode('e')]).toEqual(['timeline', 'random', 'sequence', 'playlist'])
    expect(byNumber(cues, 't.1')).toMatchObject({ timelineOffset: 1500, preWait: 0 })
    expect(notes).toContainEqual(expect.objectContaining({ number: 'e', kind: 'approximated' }))
  })
})

describe('audio', () => {
  it('maps the file, region, loop, rate, level and pan', () => {
    const { cues } = mapQLabShow(show([rec('audio', {
      number: '1', media: { relative: 'audio/a.wav', absolute: '/Users/x/a.wav' },
      startTime: 1.5, endTime: 10, playCount: 3, rate: 1.5, levels: { master: 0.25, left: 1, right: 0.5 }
    })]), ids)
    expect(cues[0]).toMatchObject({
      type: 'audio', filePath: path.join(BASE, 'audio', 'a.wav'), startTime: 1500, endTime: 10000, loopCount: 2,
      playbackRate: 1.5, volume: 0.25, outputs: null, fadeInDuration: 0
    })
    expect((cues[0] as AudioCue).pan).toBeCloseTo(-1 / 3, 5)
  })

  it('joins QLab’s relative path to the workspace folder by each platform’s own rules', () => {
    const cue = rec('audio', { media: { relative: 'audio/Walk In.wav', absolute: '/Users/sm/Show/audio/Walk In.wav' } })
    expect(mediaPath(cue, 'C:\\Shows\\Press Night', path.win32)).toBe('C:\\Shows\\Press Night\\audio\\Walk In.wav')
    expect(mediaPath(cue, '\\\\server\\shows\\Press Night', path.win32)).toBe('\\\\server\\shows\\Press Night\\audio\\Walk In.wav')
    expect(mediaPath(cue, '/Users/sm/Show', path.posix)).toBe('/Users/sm/Show/audio/Walk In.wav')
    // A relative path written with the other separator, or climbing out of the folder.
    const climbing = rec('audio', { media: { relative: '..\\Sound\\a.wav', absolute: '' } })
    expect(mediaPath(climbing, 'C:\\Shows\\Press Night', path.win32)).toBe('C:\\Shows\\Sound\\a.wav')
  })

  it('keeps a Mac absolute exactly as QLab wrote it on Windows too, rather than reading it as a drive path', () => {
    const cue = rec('audio', { media: { relative: '', absolute: '/Users/sm/Show/audio/a.wav' } })
    expect(mediaPath(cue, 'C:\\Shows', path.win32)).toBe('/Users/sm/Show/audio/a.wav')
    // A "relative" half that is really a Mac absolute is not joined to the folder.
    const misfiled = rec('audio', { media: { relative: '/Volumes/SFX/door.wav', absolute: '' } })
    expect(mediaPath(misfiled, 'C:\\Shows', path.win32)).toBe('/Volumes/SFX/door.wav')
    expect(mediaPath(misfiled, '/Users/sm/Show', path.posix)).toBe('/Volumes/SFX/door.wav')
  })

  it('loops for ever where QLab does, and names an unnamed cue after its file', () => {
    const { cues } = mapQLabShow(show([rec('audio', { media: { relative: 'audio/Walk In.wav', absolute: '' }, infiniteLoop: true })]), ids)
    expect(cues[0]).toMatchObject({ loopCount: -1, name: 'Walk In', endTime: null })
  })

  it('plays from QLab’s absolute path when there is no relative one', () => {
    const { cues } = mapQLabShow(show([rec('audio', { media: { relative: '', absolute: '/Volumes/SFX/door.wav' } })]), ids)
    expect((cues[0] as AudioCue).filePath).toBe('/Volumes/SFX/door.wav')
  })

  it('says what it could not carry: a level above unity, a rate out of range, no file', () => {
    const { cues, notes } = mapQLabShow(show([
      rec('audio', { number: '1', media: { relative: 'a.wav', absolute: '' }, levels: { master: 2, left: null, right: null } }),
      rec('audio', { number: '2', media: { relative: 'b.wav', absolute: '' }, rate: 8 }),
      rec('audio', { number: '3' })
    ]), ids)
    expect(cues.map(cue => (cue as AudioCue).volume)).toEqual([1, 1, 1])
    expect((cues[1] as AudioCue).playbackRate).toBe(4)
    expect(notes.map(note => [note.number, note.kind])).toEqual([['1', 'approximated'], ['2', 'approximated'], ['3', 'approximated']])
    expect(notes[0].detail).toContain('+6.0 dB')
  })
})

describe('fade, stop and devamp', () => {
  const target = rec('audio', { uniqueID: 'T', number: '1', media: { relative: 'a.wav', absolute: '' } })

  it('fades the level of its target to where QLab fades it', () => {
    const { cues } = mapQLabShow(show([target, rec('fade', {
      number: '2', target: { uniqueID: 'T', number: '' }, duration: 4, fadeTo: { master: 0.5, pan: null }, stopTargetWhenDone: true
    })]), ids)
    expect(byNumber<FadeCue>(cues, '2')).toMatchObject({
      type: 'fade', targetCueIds: ['T'], fadeProperty: 'volume', targetValue: 0.5, duration: 4000, curve: 'sCurve', stopTargetWhenDone: true
    })
    // The list, not the single field a show saved before lists carries.
    expect('targetCueId' in byNumber<FadeCue>(cues, '2')).toBe(false)
  })

  it('fades pan when pan is all it moves, and finds a target by number', () => {
    const { cues } = mapQLabShow(show([target, rec('fade', {
      number: '2', target: { uniqueID: '', number: '1' }, fadeTo: { master: null, pan: -0.5 }
    })]), ids)
    expect(byNumber<FadeCue>(cues, '2')).toMatchObject({ targetCueIds: ['T'], fadeProperty: 'pan', targetValue: -0.5 })
  })

  it('holds a fade with nothing Cuerunner can fade as a placeholder', () => {
    const { cues, notes } = mapQLabShow(show([rec('fade', { number: '2', fadeTo: { master: null, pan: null } })]), ids)
    expect(cues[0]).toMatchObject({ type: 'wait', isArmed: false })
    expect(notes[0]).toMatchObject({ kind: 'placeholder', qlabType: 'Fade' })
  })

  it('says when a fade’s target is missing or is not audio', () => {
    const { notes } = mapQLabShow(show([
      rec('wait', { uniqueID: 'W', number: '1' }),
      rec('fade', { number: '2', target: { uniqueID: 'W', number: '' }, fadeTo: { master: 0, pan: null } }),
      rec('fade', { number: '3', target: { uniqueID: 'nope', number: '99' }, fadeTo: { master: 0, pan: null } }),
      rec('fade', { number: '4', fadeTo: { master: 0, pan: null } })
    ]), ids)
    expect(notes.map(note => [note.number, note.detail])).toEqual([
      ['2', 'it targets a Wait cue, which a Cuerunner fade cue does not act on'],
      ['3', 'its target, cue 99, is not in this show: pick one in the inspector'],
      ['4', 'QLab gave it no target: pick one in the inspector']
    ])
  })

  it('stops and devamps its target', () => {
    const { cues } = mapQLabShow(show([
      target,
      rec('stop', { number: '2', target: { uniqueID: 'T', number: '' } }),
      rec('devamp', { number: '3', target: { uniqueID: 'T', number: '' } })
    ]), ids)
    expect(byNumber<StopCue>(cues, '2')).toMatchObject({ type: 'stop', targetCueIds: ['T'], fadeOut: false })
    // Never "all": QLab's stop stops what it names.
    expect('targetCueId' in byNumber<StopCue>(cues, '2')).toBe(false)
    expect(byNumber<DevampCue>(cues, '3')).toMatchObject({ type: 'devamp', targetCueId: 'T' })
  })

  it('keeps a stop with no target a stop of nothing, not of everything', () => {
    const { cues } = mapQLabShow(show([rec('stop', { number: '2' })]), ids)
    expect(byNumber<StopCue>(cues, '2').targetCueIds).toEqual([])
  })
})

describe('control cues', () => {
  const target = rec('audio', { uniqueID: 'T', number: '1', media: { relative: 'a.wav', absolute: '' } })

  it('makes each of QLab’s control cue types a Control cue with that verb', () => {
    const kinds = ['start', 'pause', 'load', 'reset', 'goto', 'arm', 'disarm'] as const
    const { cues, types } = mapQLabShow(show([
      target,
      ...kinds.map((kind, index) => rec(kind, { number: String(index + 2), target: { uniqueID: 'T', number: '' } }))
    ]), ids)
    expect(kinds.map((_, index) => byNumber<ControlCue>(cues, String(index + 2)))).toEqual(
      kinds.map(kind => expect.objectContaining({ type: 'control', action: kind, targetCueIds: ['T'] }))
    )
    expect(types.filter(entry => entry.becameType === 'control').reduce((sum, entry) => sum + entry.count, 0)).toBe(7)
  })

  it('keeps a Load cue’s time into its target', () => {
    const { cues } = mapQLabShow(show([target, rec('load', { number: '2', target: { uniqueID: 'T', number: '' }, loadAt: 12.5 })]), ids)
    expect(byNumber<ControlCue>(cues, '2')).toMatchObject({ action: 'load', loadToMs: 12_500 })
  })

  it('says when a control cue’s target is missing', () => {
    const { cues, notes } = mapQLabShow(show([rec('start', { number: '2', target: { uniqueID: 'nope', number: '99' } })]), ids)
    expect(byNumber<ControlCue>(cues, '2').targetCueIds).toEqual([])
    expect(notes[0].detail).toBe('its target, cue 99, is not in this show: pick one in the inspector')
  })
})

describe('MIDI', () => {
  const midi = (fields: Partial<NonNullable<QLabCue['midi']>>): QLabCue =>
    rec('midi', { number: 'm', midi: { messageType: 1, status: 1, channel: 1, byte1: 0, byte2: 0, port: 'IAC', ...fields } })

  it('maps each voice message Cuerunner sends', () => {
    const message = (fields: Partial<NonNullable<QLabCue['midi']>>) =>
      (mapQLabShow(show([midi(fields)]), ids).cues[0] as MidiCue).messages[0]
    expect(message({ status: 1, channel: 3, byte1: 60, byte2: 90 })).toEqual({ kind: 'noteOn', channel: 3, note: 60, velocity: 90 })
    expect(message({ status: 0, byte1: 60, byte2: 0 })).toEqual({ kind: 'noteOff', channel: 1, note: 60, velocity: 0 })
    expect(message({ status: 3, byte1: 7, byte2: 127 })).toEqual({ kind: 'cc', channel: 1, controller: 7, value: 127 })
    expect(message({ status: 4, byte1: 12 })).toEqual({ kind: 'programChange', channel: 1, program: 12 })
    expect(message({ messageType: 3, sysex: [0xf0, 0x7e, 0xf7] })).toEqual({ kind: 'sysex', data: [0xf0, 0x7e, 0xf7] })
    expect((mapQLabShow(show([midi({})]), ids).cues[0] as MidiCue).portName).toBe('IAC')
  })

  it('maps MIDI Show Control to the show control cue', () => {
    const { cues, notes } = mapQLabShow(show([midi({
      messageType: 2, msc: { format: 0x10, command: 0x0a, deviceId: 5, cueNumber: '3', cueList: '2' }
    })]), ids)
    expect(cues[0] as MscCue).toMatchObject({
      type: 'msc', command: 'reset', format: 'sound', deviceId: 5, cueNumber: '3', cueList: '2', destination: 'port', portName: 'IAC'
    })
    expect(notes).toEqual([])
  })

  it('says when an MSC format is a specific one sent as its general class', () => {
    const { notes } = mapQLabShow(show([midi({ messageType: 2, msc: { format: 0x02, command: 1, deviceId: 0, cueNumber: '', cueList: '' } })]), ids)
    expect(notes[0].detail).toBe('MSC format 0x02 is sent as the general lighting format')
  })

  it('holds what Cuerunner cannot send as a placeholder that keeps the bytes', () => {
    const cases: Array<Partial<NonNullable<QLabCue['midi']>>> = [
      { status: 6 },
      { messageType: 2, msc: { format: 1, command: 0x07, deviceId: 0, cueNumber: '', cueList: '' } },
      { messageType: 2, msc: { format: 0x60, command: 1, deviceId: 0, cueNumber: '', cueList: '' } },
      { messageType: 3 }
    ]
    for (const fields of cases) {
      const cue = mapQLabShow(show([midi(fields)]), ids).cues[0] as WaitCue
      expect(cue).toMatchObject({ type: 'wait', isArmed: false })
      expect(cue.notes).toContain('Message type')
    }
  })
})

describe('network', () => {
  it('sends an OSC message to the patch’s destination, its arguments typed as QLab types them', () => {
    const mapped = mapQLabShow(show([rec('network', {
      network: { kind: 'osc', message: '/eos/cue/1/go 1 -2.5 "hello world" word', host: '10.0.0.5', port: 8000, patch: 'desk' }
    })]), ids)
    const { cues, notes } = mapped
    expect(mapped.oscPatches).toEqual([{ id: expect.any(String), name: 'desk', host: '10.0.0.5', port: 8000 }])
    expect((cues[0] as OscCue).messages).toEqual([{
      patchId: mapped.oscPatches[0].id, host: '10.0.0.5', port: 8000, address: '/eos/cue/1/go',
      args: [{ type: 'i', value: 1 }, { type: 'f', value: -2.5 }, { type: 's', value: 'hello world' }, { type: 's', value: 'word' }]
    }])
    expect(notes).toEqual([])
  })

  it('makes each named patch once, shared by every cue that sends through it', () => {
    const network = (message: string, patch: string) =>
      rec('network', { network: { kind: 'osc', message, host: '10.0.0.5', port: 8000, patch } })
    const mapped = mapQLabShow(show([network('/a', 'desk'), network('/b', 'desk'), network('/c', 'video')]), ids)
    expect(mapped.oscPatches.map(patch => patch.name)).toEqual(['desk', 'video'])
    const patchOf = (index: number) => (mapped.cues[index] as OscCue).messages![0].patchId
    expect(patchOf(0)).toBe(patchOf(1))
    expect(patchOf(2)).not.toBe(patchOf(0))
  })

  it('says so when the patch does not say where it sends', () => {
    const { cues, notes } = mapQLabShow(show([rec('network', { network: { kind: 'osc', message: '/go', host: null, port: null, patch: 'Patch 3' } })]), ids)
    expect((cues[0] as OscCue).messages).toEqual([{ patchId: '', host: '127.0.0.1', port: 53000, address: '/go', args: [] }])
    expect(notes[0].detail).toBe('QLab’s network patch “Patch 3” did not say where it sends: set the host and port')
  })

  it('holds text, hex, QLab commands and a message with no address as placeholders', () => {
    for (const network of [
      { kind: 'text' as const, message: 'PWR ON' },
      { kind: 'hex' as const, message: '0A 0B' },
      { kind: 'qlab' as const, message: 'QLab command 1 on cue 4' },
      { kind: 'osc' as const, message: 'no-slash' }
    ]) {
      const cue = mapQLabShow(show([rec('network', { network: { ...network, host: null, port: null, patch: '' } })]), ids).cues[0]
      expect(cue).toMatchObject({ type: 'wait', isArmed: false })
      expect(cue.notes).toContain(`Message: ${network.message}`)
    }
  })

  it('splits a message the way QLab does', () => {
    expect(oscTokens('/a "b c" d')).toEqual(['/a', 'b c', 'd'])
    expect(parseOscMessage('"/quoted" 1')).toBeNull()
    expect(parseOscMessage('/a "12"')?.args).toEqual([{ type: 's', value: '12' }])
  })
})

describe('ids and names', () => {
  it('mints an id where QLab’s is missing, malformed or used twice', () => {
    const { cues } = mapQLabShow(show([
      rec('wait', { uniqueID: 'same', number: '1' }),
      rec('wait', { uniqueID: 'same', number: '2' }),
      rec('wait', { uniqueID: 'has spaces', number: '3' }),
      rec('wait', { number: '4' })
    ]), ids)
    const minted = cues.map(cue => cue.id)
    expect(minted[0]).toBe('same')
    expect(new Set(minted).size).toBe(4)
    expect(minted.slice(1).every(id => id.startsWith('new-'))).toBe(true)
  })

  it('gives a cue QLab left unnamed the name of its type', () => {
    expect(mapQLabShow(show([rec('stop')]), ids).cues[0].name).toBe('Stop')
  })

  it('draws QLab’s other colours in the family they belong to', () => {
    const colours = ['berry', 'crimson', 'forest', 'grape', 'cyan', 'mystery'].map(colorName =>
      mapQLabShow(show([rec('wait', { colorName })]), ids).cues[0].colorLabel)
    expect(colours).toEqual(['pink', 'red', 'green', 'purple', 'blue', 'none'])
  })
})
