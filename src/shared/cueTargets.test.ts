// The one reading of what a cue acts on: a show saved with one target reads as a list of one,
// a list is read as written, and an edit moves a cue to the list's spelling and no further.
import { describe, it, expect } from 'vitest'
import {
  actedOnIds,
  expandTargets,
  fadeTargetIds,
  fadeTargetsPatch,
  oscDestination,
  oscMessages,
  oscMessagesPatch,
  retargeted,
  STOP_ALL,
  stopTargetIds,
  stopTargetsPatch,
  withPatch
} from './cueTargets'
import type { Cue, FadeCue, OscCue, StopCue } from './cue'

const base = { number: '1', name: '', colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: '' } as const
const fade = (patch: Partial<FadeCue>): FadeCue =>
  ({ ...base, id: 'f', type: 'fade', fadeProperty: 'volume', targetValue: 0, curve: 'linear', stopTargetWhenDone: false, ...patch })
const stop = (patch: Partial<StopCue>): StopCue =>
  ({ ...base, id: 's', type: 'stop', fadeOut: false, fadeOutDuration: 0, waitForFade: false, ...patch })
const cue = (id: string, type: Cue['type'], parentId: string | null = null): Cue =>
  ({ ...base, id, type, parentId } as unknown as Cue)

describe('what a fade and a stop act on', () => {
  it('reads one target in the single field as a list of one, and an empty one as none', () => {
    expect(fadeTargetIds(fade({ targetCueId: 'a' }))).toEqual(['a'])
    expect(fadeTargetIds(fade({ targetCueId: '' }))).toEqual([])
    expect(stopTargetIds(stop({ targetCueId: 'a' }))).toEqual(['a'])
    expect(stopTargetIds(stop({ targetCueId: '' }))).toEqual([])
    expect(stopTargetIds(stop({}))).toEqual([])
  })

  it('reads "all" as everything, and the list in preference to the single field', () => {
    expect(stopTargetIds(stop({ targetCueId: 'all' }))).toBe(STOP_ALL)
    expect(stopTargetIds(stop({ targetCueId: 'all', targetCueIds: ['b'] }))).toEqual(['b'])
    expect(fadeTargetIds(fade({ targetCueId: 'a', targetCueIds: ['b', 'c'] }))).toEqual(['b', 'c'])
  })

  it('moves a cue to the list’s spelling with nothing of the old one left behind', () => {
    const legacy = fade({ targetCueId: 'a' })
    const edited = withPatch(legacy, fadeTargetsPatch(['a', 'b', 'a']))
    expect(edited.targetCueIds).toEqual(['a', 'b'])
    expect('targetCueId' in edited).toBe(false)
    const all = withPatch(stop({ targetCueIds: ['x'] }), stopTargetsPatch(STOP_ALL))
    expect(all).toMatchObject({ targetCueId: 'all' })
    expect('targetCueIds' in all).toBe(false)
  })

  it('names what every acting cue acts on, and none for "all"', () => {
    expect(actedOnIds(fade({ targetCueIds: ['a'] }))).toEqual(['a'])
    expect(actedOnIds(stop({ targetCueId: 'all' }))).toEqual([])
    expect(actedOnIds({ ...cue('d', 'devamp'), targetCueId: 'x' } as Cue)).toEqual(['x'])
    expect(actedOnIds({ ...cue('c', 'control'), targetCueIds: ['p', 'q'] } as Cue)).toEqual(['p', 'q'])
    expect(actedOnIds(cue('w', 'wait'))).toEqual([])
  })

  it('re-points targets in the spelling the cue used, and never re-points "all"', () => {
    const map = new Map([['a', 'A'], ['all', 'ALL']])
    expect(retargeted(fade({ targetCueId: 'a' }), map).targetCueId).toBe('A')
    expect(retargeted(fade({ targetCueIds: ['a', 'b'] }), map).targetCueIds).toEqual(['A', 'b'])
    expect(retargeted(stop({ targetCueId: 'all' }), map).targetCueId).toBe('all')
  })

  it('expands a group to everything under it, once, in list order', () => {
    const cues = [
      cue('g', 'group'), cue('a', 'audio', 'g'), cue('h', 'group', 'g'), cue('b', 'audio', 'h'),
      cue('c', 'audio'), cue('d', 'audio')
    ]
    expect(expandTargets(cues, ['d', 'g', 'a']).map(entry => entry.id)).toEqual(['g', 'a', 'h', 'b', 'd'])
  })
})

describe('what an OSC cue sends', () => {
  const osc = (patch: Partial<OscCue>): OscCue => ({ ...base, id: 'o', type: 'osc', ...patch })

  it('reads a cue saved with one message on itself as a list of one', () => {
    expect(oscMessages(osc({ host: 'h', port: 9, address: '/a', args: [{ type: 'i', value: 1 }] }))).toEqual([
      { patchId: '', host: 'h', port: 9, address: '/a', args: [{ type: 'i', value: 1 }] }
    ])
  })

  it('writes the list and takes the single message’s fields away', () => {
    const edited = withPatch(osc({ host: 'h', port: 9, address: '/a', args: [] }),
      oscMessagesPatch([{ patchId: 'p', host: '', port: 0, address: '/b', args: [] }]))
    expect(Object.keys(edited).filter(key => ['host', 'port', 'address', 'args'].includes(key))).toEqual([])
    expect(edited.messages).toHaveLength(1)
  })

  it('sends a message to its patch, to its own host without one, and nowhere when its patch is gone', () => {
    const patches = [{ id: 'p', name: 'Desk', host: '10.0.0.3', port: 8000 }]
    expect(oscDestination({ patchId: 'p', host: 'x', port: 1, address: '/a', args: [] }, patches))
      .toEqual({ host: '10.0.0.3', port: 8000, via: 'Desk' })
    expect(oscDestination({ patchId: '', host: 'x', port: 1, address: '/a', args: [] }, patches))
      .toEqual({ host: 'x', port: 1, via: null })
    expect(oscDestination({ patchId: 'gone', host: 'x', port: 1, address: '/a', args: [] }, patches))
      .toEqual({ error: 'its OSC patch is not in this show' })
  })
})
