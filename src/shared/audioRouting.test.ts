import { describe, expect, it } from 'vitest'
import {
  assignPatchSlots,
  describePatchFallback,
  patchDevices,
  patchFallbacks,
  audioRoutingOf,
  faderGain,
  newPatchId,
  patchChannelsLabel,
  withAudioRouting,
  withOutputFader,
  type OutputPatch
} from './audioRouting'
import type { AudioSettings } from './workspace'

const patch = (id: string, channels: number[] = [0, 1]): OutputPatch =>
  ({ id, name: id, deviceId: '', channels, gainDb: 0, muted: false })

describe('a show\'s audio routing', () => {
  it('is nothing at all in a show saved before patches: its settings save as they were', () => {
    const settings: AudioSettings = { outputDeviceId: 'default', sampleRate: 48000 }
    const routing = audioRoutingOf(settings)
    expect(routing).toEqual({ patches: [], outputs: [], auditionPatchId: null, loudnessTargetLufs: -23, truePeakCeilingDb: -1 })
    expect(withAudioRouting(settings, routing)).toEqual(settings)
    expect(JSON.stringify(withAudioRouting(settings, routing))).toBe(JSON.stringify(settings))
  })

  it('writes what it says and leaves out what is at its default', () => {
    const settings = withAudioRouting({ outputDeviceId: 'default' }, {
      patches: [patch('mains')],
      outputs: [{ gainDb: -6, muted: false }, { gainDb: 0, muted: false }],
      auditionPatchId: 'mains',
      loudnessTargetLufs: -16,
      truePeakCeilingDb: -1
    })
    expect(settings).toEqual({
      outputDeviceId: 'default',
      outputPatches: [patch('mains')],
      // The trailing fader at unity is what an absent entry means.
      outputFaders: [{ gainDb: -6, muted: false }],
      auditionPatchId: 'mains',
      loudnessTargetLufs: -16
    })
    expect(audioRoutingOf(settings).loudnessTargetLufs).toBe(-16)
  })

  it('reads a hand-edited file into ranges, dropping what is not a patch', () => {
    const routing = audioRoutingOf({
      outputDeviceId: 'default',
      outputPatches: [
        { ...patch('a'), gainDb: 40, channels: [0, 1, -1, 99] },
        { id: '', name: 'x' } as unknown as OutputPatch,
        patch('a'),
        { ...patch('b'), name: '  ' }
      ],
      auditionPatchId: 'gone',
      loudnessTargetLufs: 12
    })
    expect(routing.patches.map(entry => entry.id)).toEqual(['a', 'b'])
    expect(routing.patches[0].gainDb).toBe(12)
    expect(routing.patches[0].channels).toEqual([0, 1])
    expect(routing.patches[1].name).toBe('Patch 4')
    expect(routing.auditionPatchId).toBeNull()
    expect(routing.loudnessTargetLufs).toBe(0)
  })

  it('gives each patch a slot that stays its own while it exists', () => {
    const first = assignPatchSlots([patch('a'), patch('b'), patch('c')], new Map())
    expect([...first.entries()]).toEqual([['a', 0], ['b', 1], ['c', 2]])
    // Deleting the first moves nothing else; a new patch takes the slot that freed up.
    const second = assignPatchSlots([patch('b'), patch('c'), patch('d')], first)
    expect([...second.entries()]).toEqual([['b', 1], ['c', 2], ['d', 0]])
  })

  it('turns a fader into the engine\'s gain, the floor and the mute both silence', () => {
    expect(faderGain(0, false)).toBe(1)
    expect(faderGain(-6, false)).toBeCloseTo(0.501, 3)
    expect(faderGain(-60, false)).toBe(0)
    expect(faderGain(6, true)).toBe(0)
  })

  it('grows the output list to reach the fader that moved', () => {
    const routing = withOutputFader(audioRoutingOf({ outputDeviceId: '' }), 3, { gainDb: -3, muted: true })
    expect(routing.outputs).toEqual([
      { gainDb: 0, muted: false }, { gainDb: 0, muted: false }, { gainDb: 0, muted: false }, { gainDb: -3, muted: true }
    ])
  })

  it('names channels the way an operator reads them', () => {
    expect(patchChannelsLabel([0, 1])).toBe('1–2')
    expect(patchChannelsLabel([4, 6])).toBe('5, 7')
    expect(patchChannelsLabel([2])).toBe('3')
    expect(patchChannelsLabel([])).toBe('no outputs')
    expect(newPatchId([patch('patch-1'), patch('patch-2')])).toBe('patch-3')
  })
})

describe('patches on several output devices', () => {
  const on = (id: string, deviceId: string, channels: number[] = [2, 3]): OutputPatch =>
    ({ id, name: id, deviceId, channels, gainDb: 0, muted: false })
  const main = { id: 'hw:Main', name: 'Built-in Output' }
  const playing = (device: string, name = device) => ({ device, name, running: true, failed: false, error: null })

  it('names each extra device once, and never the show\'s own', () => {
    expect(patchDevices([on('a', ''), on('b', 'usb'), on('c', 'usb'), on('d', 'hw:Main'), on('e', 'dante')], 'hw:Main'))
      .toEqual(['usb', 'dante'])
    expect(patchDevices([on('a', '')], null)).toEqual([])
  })

  it('keeps a patch\'s device in the show whatever this machine has, so the show saves as it was made', () => {
    const settings: AudioSettings = { outputDeviceId: 'default', outputPatches: [on('fold', 'usb-interface-on-the-desk')] }
    const routing = audioRoutingOf(settings)
    expect(routing.patches[0].deviceId).toBe('usb-interface-on-the-desk')
    expect(JSON.stringify(withAudioRouting(settings, routing))).toBe(JSON.stringify(settings))
  })

  it('has nothing to say when every device a patch names is playing', () => {
    expect(patchFallbacks([on('mains', ''), on('fold', 'usb'), on('desk', 'hw:Main')], [playing('usb')], main)).toEqual([])
  })

  it('says which patch fell back, where to, and why: a device this machine does not have', () => {
    const [fallback] = patchFallbacks([on('fold', 'usb')], [], main, new Map(), new Map([['usb', 'USB Interface']]))
    expect(fallback).toEqual({
      patchId: 'fold', patchName: 'fold', deviceId: 'usb', deviceName: 'USB Interface', to: 'Built-in Output',
      outputs: '3–4', reason: 'USB Interface is not connected to this machine'
    })
    expect(describePatchFallback(fallback)).toBe('fold plays on outputs 3–4 of Built-in Output: USB Interface is not connected to this machine')
  })

  it('in the engine\'s words when it said why the device would not open', () => {
    const [fallback] = patchFallbacks([on('fold', 'usb')], [], main, new Map([['usb', 'could not open USB: device busy']]))
    expect(fallback.reason).toBe('could not open USB: device busy')
  })

  it('and a device lost since it opened, with what the engine saw', () => {
    const lost = { device: 'usb', name: 'USB Interface', running: false, failed: true, error: 'the device stopped unexpectedly' }
    const [fallback] = patchFallbacks([on('fold', 'usb'), on('iem', 'usb', [0])], [lost], main)
    expect(describePatchFallback(fallback)).toBe(
      'fold plays on outputs 3–4 of Built-in Output: USB Interface was lost (the device stopped unexpectedly)')
    expect(patchFallbacks([on('fold', 'usb'), on('iem', 'usb', [0])], [lost], main).map(entry => entry.patchId)).toEqual(['fold', 'iem'])
  })

  it('says the show\'s device when the engine has not named it yet, and skips a patch with no outputs', () => {
    const fallbacks = patchFallbacks([on('fold', 'usb'), on('empty', 'usb', [])], [], { id: null, name: '' })
    expect(fallbacks.map(entry => [entry.patchId, entry.to])).toEqual([['fold', 'the show\'s device']])
  })
})
