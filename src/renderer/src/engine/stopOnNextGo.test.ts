// Which pictures a GO takes down: each cue's own answer or the show's, never the cue the GO
// fires, and never a picture that GO's own crossfade is dissolving away.
import { describe, expect, it } from 'vitest'
import { picturesTakenByGo } from './stopOnNextGo'
import type { Cue } from '../../../shared/cue'
import { createOutput, defaultGeometry, type TextCue, type ImageCue } from '../../../shared/visual'

const base = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
  advance: 'none' as const, isArmed: true, notes: '', number: '', outputId: '', layer: 1, opacity: 1,
  fadeInDuration: 0, fadeOutDuration: 0, crossfade: false, geometry: defaultGeometry()
}

function text(id: string, patch: Partial<TextCue> = {}): TextCue {
  return {
    ...base, id, name: id, type: 'text', text: id, fontFamily: 'IBM Plex Sans', fontSize: 96, color: '#ffffff',
    bold: false, italic: false, position: 'center', ...patch
  }
}

function image(id: string, patch: Partial<ImageCue> = {}): ImageCue {
  return { ...base, id, name: id, type: 'image', filePath: `/${id}.png`, ...patch }
}

const wait: Cue = { ...base, id: 'w', name: 'Wait', type: 'wait' } as unknown as Cue
const outputs = [createOutput('o1', 'Stage'), createOutput('o2', 'Screen')]

describe('a GO\'s pictures', () => {
  it('takes down the pictures that say so, over their own fade out, whatever the GO fires', () => {
    const cues: Cue[] = [text('caption', { stopOnNextGo: true, fadeOutDuration: 400 }), image('still'), wait]
    expect(picturesTakenByGo({ cues, showing: ['caption', 'still'], incoming: wait, settings: { stopOnNextGo: false }, outputs }))
      .toEqual([{ cueId: 'caption', fadeMs: 400 }])
  })

  it('follows the show\'s default where a cue leaves it, and a cue\'s own no over the default', () => {
    const cues: Cue[] = [text('caption'), image('still', { stopOnNextGo: false }), image('card', { stopOnNextGo: null }), wait]
    expect(picturesTakenByGo({ cues, showing: ['caption', 'still', 'card'], incoming: wait, settings: { stopOnNextGo: true }, outputs })
      .map(stop => stop.cueId)).toEqual(['caption', 'card'])
  })

  it('leaves the cue the GO fires to be replaced, and pictures not up alone', () => {
    const cues: Cue[] = [text('caption', { stopOnNextGo: true }), text('next', { stopOnNextGo: true })]
    expect(picturesTakenByGo({ cues, showing: ['caption'], incoming: cues[0], settings: { stopOnNextGo: false }, outputs })).toEqual([])
  })

  it('takes down only on a GO in the picture\'s own list: a cart fired mid-scene leaves the surtitles up', () => {
    const effect = { ...wait, id: 'bang', listId: 'carts' } as Cue
    const group = { ...base, id: 'g', name: 'g', type: 'group', mode: 'playlist', listId: 'carts' } as unknown as Cue
    const cues: Cue[] = [
      text('surtitle', { stopOnNextGo: true }),
      { ...text('flash', { stopOnNextGo: true }), listId: 'carts' } as Cue,
      group,
      { ...text('inside', { stopOnNextGo: true }), parentId: 'g' } as Cue,
      effect,
      wait
    ]
    // A GO in the carts list takes down the carts' pictures, a child of a carts group included.
    expect(picturesTakenByGo({ cues, showing: ['surtitle', 'flash', 'inside'], incoming: effect, settings: { stopOnNextGo: false }, outputs })
      .map(stop => stop.cueId)).toEqual(['flash', 'inside'])
    // A GO in the main list takes down the main list's.
    expect(picturesTakenByGo({ cues, showing: ['surtitle', 'flash', 'inside'], incoming: wait, settings: { stopOnNextGo: false }, outputs })
      .map(stop => stop.cueId)).toEqual(['surtitle'])
  })

  it('leaves a picture the incoming crossfade dissolves away to the dissolve, and takes one it does not', () => {
    const cues: Cue[] = [
      image('under', { stopOnNextGo: true, outputId: 'o1', layer: 1 }),
      image('title', { stopOnNextGo: true, outputId: 'o1', layer: 5 }),
      image('other', { stopOnNextGo: true, outputId: 'o2', layer: 1 }),
      image('incoming', { crossfade: true, outputId: '', layer: 2, fadeInDuration: 1000 })
    ]
    expect(picturesTakenByGo({ cues, showing: ['under', 'title', 'other'], incoming: cues[3], settings: { stopOnNextGo: false }, outputs })
      .map(stop => stop.cueId)).toEqual(['title', 'other'])
  })
})
