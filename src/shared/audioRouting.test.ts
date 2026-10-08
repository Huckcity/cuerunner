import { describe, expect, it } from 'vitest'
import {
  assignPatchSlots,
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
