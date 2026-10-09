// Copy and paste of cues: what a copy holds, how it reads off the clipboard, and what a paste
// makes of it in the show it lands in.
import { describe, it, expect, beforeEach } from 'vitest'
import { copyBlock, describeBlock, parseBlock, pastePlace, pastedBlock } from './cueClipboard'
import { copyCues, cutCues, pasteCues } from '../hooks/useCueClipboard'
import { createCue } from './cueDefaults'
import { useStore } from '../store'
import type { ControlCue, Cue, FadeCue, StopCue } from '../../../shared/cue'
import { fadeTargetIds } from '../../../shared/cueTargets'

function cue(type: Cue['type'], id: string, patch: Partial<Cue> = {}): Cue {
  return { ...createCue(type, id), id, name: `Cue ${id}`, ...patch } as Cue
}

const show = (): Cue[] => [
  cue('group', 'g'),
  cue('audio', 'a', { parentId: 'g' }),
  // A fade as a show saved before lists wrote it: one target, in the single field.
  cue('fade', 'f', { parentId: 'g', targetCueId: 'a', targetCueIds: undefined } as Partial<FadeCue>),
  cue('wait', 'w'),
  cue('memo', 'm')
]

describe('copyBlock', () => {
  it('takes a group with its whole subtree, in list order, its root lifted out of any group', () => {
    expect(copyBlock(show(), ['g']).map(c => [c.id, c.parentId])).toEqual([['g', null], ['a', 'g'], ['f', 'g']])
    expect(copyBlock(show(), ['m', 'a']).map(c => [c.id, c.parentId])).toEqual([['a', null], ['m', null]])
  })
})

describe('pastedBlock', () => {
  it('makes new cues: fresh ids, the next numbers, parents pointing at their own copies', () => {
    const cues = show()
    const pasted = pastedBlock(copyBlock(cues, ['g']), cues, null)
    expect(pasted.every(c => !cues.some(original => original.id === c.id))).toBe(true)
    // The show's numbers here are letters, so the count starts at one.
    expect(pasted.map(c => c.number)).toEqual(['1', '2', '3'])
    expect(pasted[1].parentId).toBe(pasted[0].id)
    expect(pasted[2].parentId).toBe(pasted[0].id)
  })

  it('aims a copied fade at the copy of its target, when the target came with it', () => {
    const cues = show()
    const [, audio, fade] = pastedBlock(copyBlock(cues, ['g']), cues, null)
    expect((fade as FadeCue).targetCueId).toBe(audio.id)
  })

  it('leaves a fade aimed where it was when its target stayed behind', () => {
    const cues = show()
    const [fade] = pastedBlock(copyBlock(cues, ['f']), cues, null)
    expect((fade as FadeCue).targetCueId).toBe('a')
  })

  it('re-points every target a list names, and leaves the ones that stayed behind', () => {
    const cues: Cue[] = [
      cue('audio', 'a'),
      cue('audio', 'b'),
      cue('fade', 'f', { targetCueIds: ['a', 'b'] } as Partial<FadeCue>),
      cue('stop', 's', { targetCueId: undefined, targetCueIds: ['a', 'b'] } as Partial<StopCue>),
      cue('control', 'c', { targetCueIds: ['b', 'a'] } as Partial<ControlCue>)
    ]
    const [audio, fade, stop, control] = pastedBlock(copyBlock(cues, ['a', 'f', 's', 'c']), cues, null)
    expect(fadeTargetIds(fade as FadeCue)).toEqual([audio.id, 'b'])
    expect((stop as StopCue).targetCueIds).toEqual([audio.id, 'b'])
    expect((control as ControlCue).targetCueIds).toEqual(['b', audio.id])
  })

  it('keeps a stop of everything a stop of everything', () => {
    const cues: Cue[] = [cue('stop', 's')]
    const [stop] = pastedBlock(copyBlock(cues, ['s']), cues, null)
    expect((stop as StopCue).targetCueId).toBe('all')
  })

  it('puts the roots in the group the paste lands in', () => {
    const cues = show()
    const pasted = pastedBlock(copyBlock(cues, ['w']), cues, 'g')
    expect(pasted[0].parentId).toBe('g')
  })
})

describe('pastePlace', () => {
  it('goes after the cue the operator stands on, past its subtree, in its group', () => {
    const cues = show()
    expect(pastePlace(cues, 'g')).toEqual({ beforeIndex: 3, parentId: null })
    expect(pastePlace(cues, 'a')).toEqual({ beforeIndex: 2, parentId: 'g' })
    expect(pastePlace(cues, null)).toEqual({ beforeIndex: 5, parentId: null })
  })
})

describe('the clipboard text', () => {
  it('reads as lines a note can take, and as JSON this build can read back', () => {
    const block = copyBlock(show(), ['g'])
    expect(describeBlock(block)).toBe('g\tCue g\n  a\tCue a\n  f\tCue f')
    expect(parseBlock(JSON.stringify(block))?.map(c => c.id)).toEqual(['g', 'a', 'f'])
  })

  it('reads anything else as nothing to paste', () => {
    expect(parseBlock('hello')).toBeNull()
    expect(parseBlock('[]')).toBeNull()
    expect(parseBlock('[{"id": 1}]')).toBeNull()
  })
})

describe('copy, cut and paste in the store', () => {
  beforeEach(() => useStore.setState({ cues: show(), selectedId: null, selectedIds: [], past: [], future: [] }))

  it('pastes a snapshot: an edit after the copy does not change what the paste brings', () => {
    copyCues(['w'])
    useStore.getState().updateCue('w', { name: 'Renamed after' })
    useStore.getState().select('m')
    pasteCues()
    const cues = useStore.getState().cues
    expect(cues).toHaveLength(6)
    expect(cues[5].name).toBe('Cue w')
    expect(useStore.getState().selectedId).toBe(cues[5].id)
  })

  it('cuts as one edit, and the cut cues paste back as new ones', () => {
    cutCues(['g'])
    expect(useStore.getState().cues.map(c => c.id)).toEqual(['w', 'm'])
    useStore.getState().select('w')
    pasteCues()
    expect(useStore.getState().cues.map(c => c.type)).toEqual(['wait', 'group', 'audio', 'fade', 'memo'])
  })
})
