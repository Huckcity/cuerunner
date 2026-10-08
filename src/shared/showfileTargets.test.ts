// The compare view and the merge read a fade's or a stop's targets, and an OSC cue's messages,
// as what they mean: a show saved with one target is the same targets as the list of it, a
// change of targets is named by the cues' own labels, and a merge writes the list back.
import { describe, it, expect } from 'vitest'
import { describeField, diffWorkspaces } from './showfile'
import { mergeWorkspaces } from './showfileMerge'
import type { Cue, FadeCue, OscCue, StopCue } from './cue'
import type { Workspace } from './workspace'

const base = {
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
  advance: 'none', isArmed: true, notes: ''
} as const

const audio = (id: string, number: string, name: string): Cue =>
  ({ ...base, id, number, name, type: 'audio', filePath: '', startTime: 0, endTime: null, fadeInDuration: 0, volume: 1, pan: 0, outputs: null, loopCount: 0, playbackRate: 1, trim: 1 } as Cue)
const fade = (patch: Partial<FadeCue>): FadeCue =>
  ({ ...base, id: 'f', number: '9', name: 'Fade', type: 'fade', duration: 1000, fadeProperty: 'volume', targetValue: 0, curve: 'linear', stopTargetWhenDone: false, ...patch })
const stop = (patch: Partial<StopCue>): StopCue =>
  ({ ...base, id: 's', number: '10', name: 'Stop', type: 'stop', fadeOut: false, fadeOutDuration: 0, waitForFade: false, ...patch })
const osc = (patch: Partial<OscCue>): OscCue => ({ ...base, id: 'o', number: '11', name: 'GO', type: 'osc', ...patch })

const show = (...cues: Cue[]): Workspace => ({
  version: 1, id: 'w', name: 'Show', createdAt: '2026-01-01T00:00:00.000Z',
  audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' }, cues
})

const sounds = [audio('a', '1', 'Walk-in'), audio('b', '2', 'Storm'), audio('c', '3', 'Rain')]

describe('comparing a fade’s and a stop’s targets', () => {
  it('reads one target in the old field and a list of it as no change at all', () => {
    const diff = diffWorkspaces(
      show(...sounds, fade({ targetCueId: 'a' }), stop({ targetCueId: 'b' }), osc({ host: 'h', port: 1, address: '/go', args: [] })),
      show(...sounds, fade({ targetCueIds: ['a'] }), stop({ targetCueIds: ['b'] }), osc({ messages: [{ patchId: '', host: 'h', port: 1, address: '/go', args: [] }] }))
    )
    expect(diff.empty).toBe(true)
  })

  it('reads a reordering of the same targets as no change, and an added one as one', () => {
    const before = show(...sounds, fade({ targetCueIds: ['a', 'b'] }))
    expect(diffWorkspaces(before, show(...sounds, fade({ targetCueIds: ['b', 'a'] }))).empty).toBe(true)
    const diff = diffWorkspaces(before, show(...sounds, fade({ targetCueIds: ['a', 'b', 'c'] })))
    const [change] = diff.changed
    expect(change.fields?.map(field => field.field)).toEqual(['targets'])
    expect(describeField(change.fields![0])).toBe('targets 1 Walk-in, 2 Storm → 1 Walk-in, 2 Storm, 3 Rain')
  })

  it('names a stop of everything as everything', () => {
    const diff = diffWorkspaces(show(...sounds, stop({ targetCueId: 'all' })), show(...sounds, stop({ targetCueIds: ['a'] })))
    expect(describeField(diff.changed[0].fields![0])).toBe('targets everything → 1 Walk-in')
  })

  it('reads a changed message as one change to the messages, whichever spelling either side used', () => {
    const diff = diffWorkspaces(
      show(osc({ host: 'h', port: 1, address: '/go', args: [] })),
      show(osc({ messages: [{ patchId: '', host: 'h', port: 1, address: '/go', args: [] }, { patchId: 'p', host: '', port: 0, address: '/b', args: [] }] }))
    )
    expect(diff.changed[0].fields?.map(field => field.field)).toEqual(['messages'])
  })
})

describe('merging a fade’s and a stop’s targets', () => {
  it('takes the side that changed them, and writes them back as the list', () => {
    const ancestor = show(...sounds, fade({ targetCueId: 'a' }), audio('x', '20', 'Other'))
    const ours = show(...sounds, fade({ targetCueId: 'a' }), { ...audio('x', '20', 'Other'), name: 'Renamed' })
    const theirs = show(...sounds, fade({ targetCueIds: ['a', 'c'] }), audio('x', '20', 'Other'))
    const merged = mergeWorkspaces(ancestor, ours, theirs).workspace
    const result = merged.cues.find(cue => cue.id === 'f') as FadeCue
    expect(result.targetCueIds).toEqual(['a', 'c'])
    expect('targetCueId' in result).toBe(false)
    expect('targets' in result).toBe(false)
  })

  it('writes a stop decided to be everything back in the single field', () => {
    const ancestor = show(...sounds, stop({ targetCueIds: ['a'] }))
    const theirs = show(...sounds, stop({ targetCueId: 'all' }))
    const result = mergeWorkspaces(ancestor, ancestor, theirs).workspace.cues.find(cue => cue.id === 's') as StopCue
    expect(result.targetCueId).toBe('all')
    expect('targetCueIds' in result).toBe(false)
  })

  it('writes an OSC cue’s merged messages as the list, with the single message taken away', () => {
    const ancestor = show(osc({ host: 'h', port: 1, address: '/go', args: [] }))
    const theirs = show(osc({ messages: [{ patchId: '', host: 'h', port: 1, address: '/go2', args: [] }] }))
    const result = mergeWorkspaces(ancestor, ancestor, theirs).workspace.cues[0] as OscCue
    expect(result.messages?.map(message => message.address)).toEqual(['/go2'])
    expect(['host', 'port', 'address', 'args'].filter(key => key in result)).toEqual([])
  })
})
