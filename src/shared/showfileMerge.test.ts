// Two files that started from a third, merged.
//
// The cases below are the ones an associate and a designer actually produce: different
// acts, the same cue changed on both sides, one person's cue deleted by the other, and the
// pieces neither side touched. What a merge does with each is a promise the report makes
// to the person reading it, so each one is asserted here rather than in the app.
import { describe, it, expect } from 'vitest'
import type { AudioCue, Cue, GroupCue } from './cue'
import type { Workspace } from './workspace'
import { mergeWorkspaces } from './showfileMerge'

function cue(over: Partial<AudioCue> & { id: string }): Cue {
  return {
    type: 'audio',
    number: over.id,
    name: `Cue ${over.id}`,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    filePath: '',
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 1,
    playbackRate: 1,
    trim: 0,
    ...over
  } as Cue
}

function group(id: string, name: string, mode: GroupCue['mode'] = 'playlist'): Cue {
  return { ...cue({ id, name }), type: 'group', mode } as unknown as Cue
}

function workspace(cues: Cue[], over: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Hamlet',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    triggerGuard: { windowMs: 300 },
    cues,
    ...over
  }
}

/** The version both people started from: three cues, nothing clever. */
function base(): Workspace {
  return workspace([
    cue({ id: 'a', number: '1', name: 'Walk-in' }),
    cue({ id: 'b', number: '2', name: 'Interval' }),
    cue({ id: 'c', number: '3', name: 'Bows' })
  ])
}

describe('two people changing different things', () => {
  it('takes both changes without asking anybody', () => {
    const ours = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.6 }),
      cue({ id: 'b', number: '2', name: 'Interval' }),
      cue({ id: 'c', number: '3', name: 'Bows' })
    ])
    const theirs = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'b', number: '2', name: 'Interval (20 min)' }),
      cue({ id: 'c', number: '3', name: 'Bows' })
    ])

    const merged = mergeWorkspaces(base(), ours, theirs)

    expect((merged.workspace.cues[0] as AudioCue).volume).toBe(0.6)
    expect(merged.workspace.cues[1].name).toBe('Interval (20 min)')
    expect(merged.notes).toEqual([])
    expect(merged.tally).toMatchObject({ conflicts: 0, oursOnly: 1, theirsOnly: 1 })
  })

  it('blends two changes to the same cue when they are different fields', () => {
    const ours = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.6 })])
    const theirs = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', preWait: 500 })])

    const merged = mergeWorkspaces(workspace([cue({ id: 'a', number: '1', name: 'Walk-in' })]), ours, theirs)

    expect(merged.workspace.cues[0]).toMatchObject({ volume: 0.6, preWait: 500 })
    expect(merged.notes).toEqual([])
    expect(merged.tally.conflicts).toBe(0)
  })

  it('keeps both sides’ new cues, in the places they were added', () => {
    const ours = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'a2', number: '9', name: 'Sting' }),
      cue({ id: 'b', number: '2', name: 'Interval' }),
      cue({ id: 'c', number: '3', name: 'Bows' })
    ])
    const theirs = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'b', number: '2', name: 'Interval' }),
      cue({ id: 'c', number: '3', name: 'Bows' }),
      cue({ id: 'z', number: '4', name: 'Curtain call' })
    ])

    const merged = mergeWorkspaces(base(), ours, theirs)

    expect(merged.workspace.cues.map(c => c.name)).toEqual([
      'Walk-in', 'Sting', 'Interval', 'Bows', 'Curtain call'
    ])
    expect(merged.tally).toMatchObject({ oursOnly: 1, theirsOnly: 1 })
  })

  it('keeps the other side’s arrangement of a list this show never touched', () => {
    const ancestor = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'b', number: '2', name: 'Interval' }),
      cue({ id: 'c', number: '3', name: 'Bows' })
    ])
    // They rearranged the top level; this show is in act two and has not.
    const theirs = workspace([
      cue({ id: 'c', number: '3', name: 'Bows' }),
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'b', number: '2', name: 'Interval' })
    ])

    const merged = mergeWorkspaces(ancestor, ancestor, theirs)

    expect(merged.workspace.cues.map(c => c.name)).toEqual(['Bows', 'Walk-in', 'Interval'])
    // A move one side made is that side's, and the report has nothing to say about it.
    expect(merged.notes).toEqual([])
  })

  it('keeps the other side’s arrangement inside a group, and this show’s addition with it', () => {
    const ancestor = workspace([
      group('g', 'Act 2'),
      cue({ id: 'a', number: '1', name: 'Top of act', parentId: 'g' }),
      cue({ id: 'b', number: '2', name: 'Changeover', parentId: 'g' }),
      cue({ id: 'z', number: '3', name: 'Curtain call' })
    ])
    // They swapped the two cues inside the group; this show added a cue at the end.
    const theirs = workspace([
      group('g', 'Act 2'),
      cue({ id: 'b', number: '2', name: 'Changeover', parentId: 'g' }),
      cue({ id: 'a', number: '1', name: 'Top of act', parentId: 'g' }),
      cue({ id: 'z', number: '3', name: 'Curtain call' })
    ])
    const ours = workspace([
      group('g', 'Act 2'),
      cue({ id: 'a', number: '1', name: 'Top of act', parentId: 'g' }),
      cue({ id: 'b', number: '2', name: 'Changeover', parentId: 'g' }),
      cue({ id: 'z', number: '3', name: 'Curtain call' }),
      cue({ id: 'w', number: '4', name: 'Walk-down' })
    ])

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect(merged.workspace.cues.map(c => c.id)).toEqual(['g', 'b', 'a', 'z', 'w'])
    expect(merged.notes).toEqual([])
  })

  it('breaks a cycle two legal moves make, instead of losing both groups', () => {
    // Each side did something an operator can do — dragged one group onto the other —
    // and the two answers together are a show where A is inside B and B is inside A.
    // Nothing is reachable from the top level then, so the walk that orders the merged
    // show would emit neither group nor anything under them, without a word.
    const ancestor = workspace([
      group('A', 'Act 1'),
      cue({ id: 'a1', number: '1', name: 'Top of act', parentId: 'A' }),
      group('B', 'Act 2'),
      cue({ id: 'b1', number: '2', name: 'Changeover', parentId: 'B' })
    ])
    const ours = workspace([
      group('A', 'Act 1'),
      cue({ id: 'a1', number: '1', name: 'Top of act', parentId: 'A' }),
      group('B', 'Act 2', ),
      cue({ id: 'b1', number: '2', name: 'Changeover', parentId: 'B' })
    ])
    // This show dragged B into A; the other dragged A into B.
    ours.cues[2] = { ...ours.cues[2], parentId: 'A' }
    const theirs = workspace([
      group('B', 'Act 2'),
      cue({ id: 'b1', number: '2', name: 'Changeover', parentId: 'B' }),
      group('A', 'Act 1'),
      cue({ id: 'a1', number: '1', name: 'Top of act', parentId: 'A' })
    ])
    theirs.cues[2] = { ...theirs.cues[2], parentId: 'B' }

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    const ids = merged.workspace.cues.map(c => c.id)
    expect(ids).toContain('A')
    expect(ids).toContain('a1')
    expect(ids).toContain('B')
    expect(ids).toContain('b1')
    // One side's place is dropped, so the other's stands, and the report says which.
    expect(merged.notes.some(note => note.detail.includes('ends up inside it'))).toBe(true)
    // Every parent named is still in the show.
    const present = new Set(ids)
    for (const mergedCue of merged.workspace.cues) {
      if (mergedCue.parentId !== null) expect(present.has(mergedCue.parentId)).toBe(true)
    }
  })

  it('applies the same change made twice once', () => {
    const ours = workspace([cue({ id: 'b', number: '2', name: 'Interval', volume: 0.4 })])
    const theirs = workspace([cue({ id: 'b', number: '2', name: 'Interval', volume: 0.4 })])

    const merged = mergeWorkspaces(workspace([cue({ id: 'b', number: '2', name: 'Interval' })]), ours, theirs)

    expect((merged.workspace.cues[0] as AudioCue).volume).toBe(0.4)
    expect(merged.notes).toEqual([])
    expect(merged.tally.conflicts).toBe(0)
  })
})

describe('two people changing the same thing', () => {
  const ours = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.6 })])
  const theirs = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.9 })])
  const ancestor = workspace([cue({ id: 'a', number: '1', name: 'Walk-in' })])

  it('keeps this show’s value by default, and says so', () => {
    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect((merged.workspace.cues[0] as AudioCue).volume).toBe(0.6)
    expect(merged.tally.conflicts).toBe(1)
    expect(merged.notes).toHaveLength(1)
    expect(merged.notes[0]).toMatchObject({ subject: '1 Walk-in', conflict: true })
    expect(merged.notes[0].detail).toContain('kept this show')
    expect(merged.notes[0].detail).toContain('0.6')
    expect(merged.notes[0].detail).toContain('0.9')
  })

  it('takes the other show’s value when that is the choice', () => {
    const merged = mergeWorkspaces(ancestor, ours, theirs, { onConflict: 'theirs' })

    expect((merged.workspace.cues[0] as AudioCue).volume).toBe(0.9)
    expect(merged.notes[0].detail).toContain('kept the other show')
  })

  it('names a cue deleted by one side and edited by the other', () => {
    const deleted = workspace([])
    const edited = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.6 })])

    // This show deleted it: the deletion is this side's answer, and it stands.
    const keptDeletion = mergeWorkspaces(ancestor, deleted, edited)
    expect(keptDeletion.workspace.cues).toEqual([])
    expect(keptDeletion.notes[0]).toMatchObject({ subject: '1 Walk-in', conflict: true })
    expect(keptDeletion.notes[0].detail).toContain('this show deleted it')

    // …unless the operator says the other side wins, which here means the cue is back.
    const tookEdit = mergeWorkspaces(ancestor, deleted, edited, { onConflict: 'theirs' })
    expect(tookEdit.workspace.cues.map(c => c.name)).toEqual(['Walk-in'])
    expect((tookEdit.workspace.cues[0] as AudioCue).volume).toBe(0.6)
  })

  it('takes a deletion the other side made of a cue this show edited, when this show is asked to', () => {
    const edited = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.6 })])

    const keptMine = mergeWorkspaces(ancestor, edited, workspace([]))
    expect(keptMine.workspace.cues.map(c => c.name)).toEqual(['Walk-in'])

    const tookDeletion = mergeWorkspaces(ancestor, edited, workspace([]), { onConflict: 'theirs' })
    expect(tookDeletion.workspace.cues).toEqual([])
  })

  it('deletes a cue both sides deleted without a word', () => {
    const merged = mergeWorkspaces(ancestor, workspace([]), workspace([]))

    expect(merged.workspace.cues).toEqual([])
    expect(merged.notes).toEqual([])
  })

  it('decides a setting both sides changed, the same way', () => {
    const ours = workspace([], { audioSettings: { outputDeviceId: 'default', sampleRate: 44100 } })
    const theirs = workspace([], { audioSettings: { outputDeviceId: 'default', sampleRate: 96000 } })

    const merged = mergeWorkspaces(workspace([]), ours, theirs)

    expect(merged.workspace.audioSettings.sampleRate).toBe(44100)
    expect(merged.notes[0]).toMatchObject({ subject: 'audio', conflict: true })
  })

  it('takes the settings only one side changed', () => {
    const ours = workspace([], { triggerGuard: { windowMs: 500 } })
    const theirs = workspace([], { showSettings: { desk: { kind: 'none' } } as Workspace['showSettings'] })

    const merged = mergeWorkspaces(workspace([]), ours, theirs)

    expect(merged.workspace.triggerGuard).toEqual({ windowMs: 500 })
    expect((merged.workspace.showSettings as { desk: { kind: string } }).desk.kind).toBe('none')
    expect(merged.notes).toEqual([])
  })
})

describe('what a merge does not carry', () => {
  it('keeps this show’s file for a cue the other side pointed elsewhere, and says so', () => {
    const ours = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', filePath: 'media/walk-in.wav' })])
    const theirs = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', filePath: 'media/bows.wav' })])
    const ancestor = workspace([cue({ id: 'a', number: '1', name: 'Walk-in', filePath: 'media/walk-in.wav' })])

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect((merged.workspace.cues[0] as AudioCue).filePath).toBe('media/walk-in.wav')
    expect(merged.notes[0].detail).toContain('the other show plays')
    expect(merged.notes[0].conflict).toBe(false)
  })

  it('keeps this show’s order, and names a cue both sides moved', () => {
    const ancestor = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'b', number: '2', name: 'Interval' }),
      cue({ id: 'c', number: '3', name: 'Bows' })
    ])
    // This show moves Bows to the top; the other moves it above Interval.
    const ours = workspace([
      cue({ id: 'c', number: '3', name: 'Bows' }),
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'b', number: '2', name: 'Interval' })
    ])
    const theirs = workspace([
      cue({ id: 'a', number: '1', name: 'Walk-in' }),
      cue({ id: 'c', number: '3', name: 'Bows' }),
      cue({ id: 'b', number: '2', name: 'Interval' })
    ])

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect(merged.workspace.cues.map(c => c.name)).toEqual(['Bows', 'Walk-in', 'Interval'])
    expect(merged.notes.some(note => note.detail.includes('moved on both sides'))).toBe(true)
  })

  it('keeps a cue under the group it belongs to, and its children with it', () => {
    const ancestor = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', parentId: 'g' }),
      cue({ id: 'b', number: '2', name: 'Interval' })
    ])
    // The other side adds a cue to the group; this side adds one after it.
    const theirs = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', parentId: 'g' }),
      cue({ id: 'a2', number: '2', name: 'Sting', parentId: 'g' }),
      cue({ id: 'b', number: '3', name: 'Interval' })
    ])
    const ours = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', parentId: 'g' }),
      cue({ id: 'b', number: '2', name: 'Interval' }),
      cue({ id: 'z', number: '3', name: 'Curtain call' })
    ])

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect(merged.workspace.cues.map(c => `${c.name}${c.parentId ? ' (in g)' : ''}`)).toEqual([
      'Act 1', 'Walk-in (in g)', 'Sting (in g)', 'Interval', 'Curtain call'
    ])
  })

  it('takes a cue into a group only the other side moved it into', () => {
    const ancestor = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in' })
    ])
    const ours = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', volume: 0.5 })
    ])
    const theirs = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', parentId: 'g' })
    ])

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect(merged.workspace.cues[1]).toMatchObject({ parentId: 'g', volume: 0.5 })
  })

  it('brings a cue whose group is gone back to the top level, and says so', () => {
    const ancestor = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', parentId: 'g' })
    ])
    // The other side deleted the group, and this show changed the cue that was inside it:
    // the cue survives the merge with nothing to sit under.
    const ours = workspace([
      group('g', 'Act 1'),
      cue({ id: 'a', number: '1', name: 'Walk-in', parentId: 'g', volume: 0.5 })
    ])
    const theirs = workspace([])

    const merged = mergeWorkspaces(ancestor, ours, theirs)

    expect(merged.workspace.cues.map(c => c.id)).toEqual(['a'])
    expect(merged.workspace.cues[0].parentId).toBeNull()
    expect((merged.workspace.cues[0] as AudioCue).volume).toBe(0.5)
    expect(merged.notes.some(note => note.detail.includes('top level'))).toBe(true)
  })
})
