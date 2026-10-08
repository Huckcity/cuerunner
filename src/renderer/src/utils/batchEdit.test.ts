// A batch edit from the list's menu, and the fade or stop made for a selection: which cue
// gets which field, and what the made cues aim at.
import { describe, it, expect, beforeEach } from 'vitest'
import { batchPatches, canTarget, editsAudio, renumbered, targetingBlock } from './batchEdit'
import { createCue } from './cueDefaults'
import { editFromDraft } from '../components/cue-list/BatchEditDialog'
import { useStore } from '../store'
import type { AudioCue, Cue, FadeCue, GroupCue, StopCue } from '../../../shared/cue'

function cue(type: Cue['type'], id: string, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type, id), id, name: `Cue ${id}`, ...patch } as Cue
}

describe('batchPatches', () => {
  const show = [
    cue('audio', 'a1', { preWait: 500 } as Partial<AudioCue>),
    cue('wait', 'w1'),
    cue('audio', 'a2', { volume: 0.5 } as Partial<AudioCue>),
    cue('audio', 'a3')
  ]

  it('writes the fields every cue has to every cue in the set, and nothing outside it', () => {
    const patches = batchPatches(show, ['a1', 'w1'], { postWait: 2000, advance: 'on-end' })
    expect(patches).toEqual({
      a1: { postWait: 2000, advance: 'on-end' },
      w1: { postWait: 2000, advance: 'on-end' }
    })
  })

  it('writes an audio cue’s own fields to the audio cues alone', () => {
    const patches = batchPatches(show, ['a1', 'w1', 'a2'], { volume: 0.8, fadeOutDuration: 1000 })
    expect(Object.keys(patches)).toEqual(['a1', 'a2'])
    expect(patches.a2).toEqual({ volume: 0.8, fadeOutDuration: 1000 })
  })

  it('leaves out a cue the edit does not change', () => {
    expect(batchPatches(show, ['a1', 'a2'], { preWait: 500 })).toEqual({ a2: { preWait: 500 } })
    expect(batchPatches(show, ['a1'], {})).toEqual({})
  })

  it('knows when an edit reaches only audio', () => {
    expect(editsAudio({ volume: 1 })).toBe(true)
    expect(editsAudio({ preWait: 0 })).toBe(false)
  })
})

describe('renumbered', () => {
  const show = [cue('wait', 'a', { number: '1' }), cue('wait', 'b', { number: '7' }), cue('wait', 'c', { number: '3' }), cue('wait', 'd', { number: '200' })]

  it('numbers the selection in list order from a start, by a step', () => {
    expect(renumbered(show, ['a', 'b', 'c'], 10, 10)).toEqual({
      ok: true, patches: { a: { number: '10' }, b: { number: '20' }, c: { number: '30' } }
    })
  })

  it('keeps the decimals the step is written in, and leaves a number that is already right', () => {
    expect(renumbered(show, ['a', 'c'], 1, 0.5)).toEqual({ ok: true, patches: { c: { number: '1.5' } } })
  })

  it('refuses a plan that would give two cues one number, naming the one that has it', () => {
    expect(renumbered(show, ['a', 'b'], 199, 1)).toEqual({ ok: false, reason: 'Cue 200 is already called that' })
  })

  it('refuses a step that goes nowhere', () => {
    expect(renumbered(show, ['a'], 1, 0).ok).toBe(false)
  })
})

describe('editFromDraft', () => {
  it('reads seconds and percent into the cue’s ms and gain, and an empty field as no change', () => {
    expect(editFromDraft({ numberFrom: null, step: null, preWait: 1.5, postWait: null, advance: '', volume: 80, fadeIn: null, fadeOut: 2 })).toEqual({
      preWait: 1500,
      postWait: undefined,
      advance: undefined,
      volume: 0.8,
      fadeInDuration: undefined,
      fadeOutDuration: 2000
    })
  })
})

describe('targetingBlock', () => {
  const music = cue('audio', 'a1', { name: 'Walk-in' })
  const sting = cue('audio', 'a2', { name: 'Sting' })
  const hold = cue('wait', 'w1')
  const note = cue('memo', 'm1')

  it('aims one fade at one sound, to silence and stopping it there', () => {
    const [fade] = targetingBlock('fade', [music], '9') as FadeCue[]
    expect(fade).toMatchObject({
      type: 'fade', number: '9', name: 'Fade out Walk-in', targetCueId: 'a1',
      fadeProperty: 'volume', targetValue: 0, stopTargetWhenDone: true
    })
  })

  it('makes one GO of several: a timeline group with a cue aimed at each, all at zero', () => {
    const block = targetingBlock('stop', [music, hold, sting], '12')
    const [group, ...children] = block as [GroupCue, ...StopCue[]]
    expect(group).toMatchObject({ type: 'group', mode: 'timeline', number: '12', name: 'Stop 3 cues', parentId: null })
    expect(children.map(child => [child.number, child.targetCueId, child.parentId, child.timelineOffset])).toEqual([
      ['12.1', 'a1', group.id, 0],
      ['12.2', 'w1', group.id, 0],
      ['12.3', 'a2', group.id, 0]
    ])
  })

  it('aims a fade at sounds only, and a stop at anything that runs', () => {
    expect(canTarget('fade', hold)).toBe(false)
    expect(canTarget('stop', hold)).toBe(true)
    expect(canTarget('stop', note)).toBe(false)
    expect(targetingBlock('fade', [hold, note], '1')).toEqual([])
    // Of a mixed set the fade takes the one sound, as a single cue rather than a group of one.
    expect(targetingBlock('fade', [hold, music], '1').map(made => made.type)).toEqual(['fade'])
  })
})

describe('the store’s batch actions', () => {
  beforeEach(() => {
    useStore.setState({ cues: [], past: [], future: [], isDirty: false })
  })

  it('patches each cue with its own patch as one undo', () => {
    useStore.setState({ cues: [cue('audio', 'a1'), cue('wait', 'w1')] })
    useStore.getState().patchCues({ a1: { volume: 0.25 } as Partial<Cue>, w1: { preWait: 900 } })
    const after = useStore.getState().cues
    expect((after[0] as AudioCue).volume).toBe(0.25)
    expect(after[1].preWait).toBe(900)
    expect(useStore.getState().past).toHaveLength(1)

    useStore.getState().undo()
    expect((useStore.getState().cues[0] as AudioCue).volume).toBe(1)
    expect(useStore.getState().cues[1].preWait).toBe(0)
  })

  it('puts a made block after the top-level cue that holds its last target, as one undo', () => {
    const group = cue('group', 'g1')
    const child = cue('audio', 'c1', { parentId: 'g1' })
    const after = cue('wait', 'w9')
    useStore.setState({ cues: [group, child, after] })
    const block = targetingBlock('fade', [child], '10')
    useStore.getState().insertCues(block, 'c1')
    const ids = useStore.getState().cues.map(c => c.id)
    // Not inside the group it acts on: after its whole subtree, before what followed it.
    expect(ids).toEqual(['g1', 'c1', block[0].id, 'w9'])
    expect(useStore.getState().selectedId).toBe(block[0].id)
    expect(useStore.getState().past).toHaveLength(1)
  })
})
