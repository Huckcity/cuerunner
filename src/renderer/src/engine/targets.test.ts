// Where a fade's targets go, and the order a stop takes its targets away in.
import { describe, it, expect } from 'vitest'
import { fadeRoutes, stopOrder } from './targets'
import { createCue } from '../utils/cueDefaults'
import type { Cue } from '../../../shared/cue'

const cue = (type: Cue['type'], id: string, parentId: string | null = null): Cue =>
  ({ ...createCue(type, id), id, parentId })

describe('a fade’s routes', () => {
  const cues = [
    cue('group', 'g'), cue('audio', 'a1', 'g'), cue('light', 'l1', 'g'), cue('wait', 'w1', 'g'),
    cue('audio', 'a2'), cue('wait', 'w2'), cue('light', 'l2')
  ]

  it('sends sounds to the audio engine and lights to the lighting, a group’s included', () => {
    expect(fadeRoutes(cues, ['g', 'a2', 'l2'])).toEqual({
      audio: ['a1', 'a2'], light: ['l1', 'l2'], groups: ['g'], inert: [], missing: []
    })
  })

  it('names a cue with no level it was aimed at, and a target the show has lost', () => {
    expect(fadeRoutes(cues, ['w2', 'gone'])).toEqual({ audio: [], light: [], groups: [], inert: ['w2'], missing: ['gone'] })
  })

  it('names a cue once however it is reached', () => {
    expect(fadeRoutes(cues, ['a1', 'g']).audio).toEqual(['a1'])
  })
})

describe('a stop’s order', () => {
  it('takes groups first, then the rest, each once, and names what the show has lost', () => {
    const cues = [cue('audio', 'a'), cue('group', 'g'), cue('wait', 'w', 'g')]
    const { ordered, missing } = stopOrder(cues, ['w', 'a', 'g', 'a', 'gone'])
    expect(ordered.map(entry => entry.id)).toEqual(['g', 'w', 'a'])
    expect(missing).toEqual(['gone'])
  })
})
