// The model behind R1: what the app knows about a file's length, and what the pass has
// left to ask about. Every surface — the Duration cell, the group's sum, the timeline
// block — reads these, so that one file that cannot be read cannot read as a zero.
import { describe, it, expect } from 'vitest'
import { createCue } from './cueDefaults'
import {
  cuesAwaitingLength,
  groupLengthState,
  mediaLengthState,
  mediaLengthsFrom,
  type MediaLengthAnswer,
  type MediaLengths
} from './mediaLength'
import type { AudioCue, Cue, GroupCue } from '../../../shared/cue'

function audio(id: string, patch: Partial<AudioCue> = {}): AudioCue {
  return {
    ...createCue('audio'),
    id,
    name: id,
    filePath: `/media/${id}.wav`,
    ...patch
  } as AudioCue
}

function group(id: string, patch: Partial<GroupCue> = {}): GroupCue {
  return { ...createCue('group'), id, name: id, ...patch } as GroupCue
}

/** The session's knowledge: answers by cue id, and the cues whose files are not there. */
function known(answers: Record<string, MediaLengthAnswer> = {}, missingIds: string[] = []): MediaLengths {
  return mediaLengthsFrom(
    answers,
    missingIds.map(cueId => ({
      cueId,
      path: `media/${cueId}.wav`,
      originalPath: `/media/${cueId}.wav`
    }))
  )
}

describe('mediaLengthState', () => {
  it('reads a file nobody has measured as measuring', () => {
    expect(mediaLengthState(audio('a1'), known())).toBe('measuring')
  })

  it('says nothing about a cue that has a length', () => {
    expect(mediaLengthState(audio('a1', { duration: 4200 }), known())).toBeNull()
  })

  it('says nothing about a cue nobody has given a file to', () => {
    expect(mediaLengthState(audio('a1', { filePath: '' }), known())).toBeNull()
  })

  it('says nothing about a cue whose length is not a file', () => {
    expect(mediaLengthState(createCue('wait'), known())).toBeNull()
    expect(mediaLengthState(group('g1'), known())).toBeNull()
  })

  it('reads a file the workspace could not find as missing', () => {
    expect(mediaLengthState(audio('a1'), known({}, ['a1']))).toBe('missing')
  })

  it('reads a missing file as missing even where a length was once recorded', () => {
    // The cue cannot play, and a length carried over from another machine would only
    // make it look like it could.
    expect(mediaLengthState(audio('a1', { duration: 9000 }), known({}, ['a1']))).toBe('missing')
  })

  it('reads the answer the pass wrote down', () => {
    const answers: Record<string, MediaLengthAnswer> = {
      a1: { path: '/media/a1.wav', state: 'no-length' }
    }
    expect(mediaLengthState(audio('a1'), known(answers))).toBe('no-length')
  })

  it('ignores an answer about a file the cue no longer names', () => {
    const answers: Record<string, MediaLengthAnswer> = {
      a1: { path: '/elsewhere/a1.wav', state: 'missing' }
    }
    expect(mediaLengthState(audio('a1'), known(answers))).toBe('measuring')
  })
})

describe('cuesAwaitingLength', () => {
  it('takes every audio cue with a file and no length, in cue order', () => {
    const cues: Cue[] = [
      audio('a1'),
      createCue('wait'),
      audio('a2', { duration: 1000 }),
      audio('a3')
    ]
    expect(cuesAwaitingLength(cues, known()).map(c => c.id)).toEqual(['a1', 'a3'])
  })

  it('leaves alone the files the workspace could not find', () => {
    const cues: Cue[] = [audio('a1'), audio('a2')]
    expect(cuesAwaitingLength(cues, known({}, ['a1'])).map(c => c.id)).toEqual(['a2'])
  })

  it('leaves alone a file that has answered', () => {
    const answers: Record<string, MediaLengthAnswer> = {
      a1: { path: '/media/a1.wav', state: 'missing' },
      a2: { path: '/media/a2.wav', state: 'no-length' }
    }
    expect(cuesAwaitingLength([audio('a1'), audio('a2'), audio('a3')], known(answers)).map(c => c.id))
      .toEqual(['a3'])
  })

  it('asks again about a cue that now names another file', () => {
    const answers: Record<string, MediaLengthAnswer> = {
      a1: { path: '/media/a1.wav', state: 'missing' }
    }
    const relinked = audio('a1', { filePath: '/new-home/a1.wav' })
    expect(cuesAwaitingLength([relinked], known(answers)).map(c => c.id)).toEqual(['a1'])
  })

  it('says nothing about an audio cue with no file yet', () => {
    expect(cuesAwaitingLength([audio('a1', { filePath: '' })], known())).toEqual([])
  })
})

describe('groupLengthState', () => {
  it('says nothing when everything under the group is measured', () => {
    const cues: Cue[] = [
      group('g1'),
      audio('a1', { parentId: 'g1', duration: 1000 }),
      { ...createCue('wait'), id: 'w1', parentId: 'g1', duration: 500 } as Cue
    ]
    expect(groupLengthState(cues, 'g1', known())).toBeNull()
  })

  it('reads measuring while a file has not answered', () => {
    const cues: Cue[] = [group('g1'), audio('a1', { parentId: 'g1' })]
    expect(groupLengthState(cues, 'g1', known())).toBe('measuring')
  })

  it('prefers missing over measuring: one file gone is the group length unknown', () => {
    const cues: Cue[] = [
      group('g1'),
      audio('a1', { parentId: 'g1' }),
      audio('a2', { parentId: 'g1', duration: 500 })
    ]
    expect(groupLengthState(cues, 'g1', known({}, ['a2']))).toBe('missing')
  })

  it('sees through a nested group', () => {
    const cues: Cue[] = [
      group('g1'),
      group('g2', { parentId: 'g1' }),
      audio('a1', { parentId: 'g2' })
    ]
    expect(groupLengthState(cues, 'g1', known())).toBe('measuring')
  })

  it('stops at a parent chain that loops instead of looping forever', () => {
    const cues: Cue[] = [group('g1', { parentId: 'g2' }), group('g2', { parentId: 'g1' })]
    expect(groupLengthState(cues, 'g1', known())).toBeNull()
  })

  it('says nothing about a group whose length is not knowable anyway', () => {
    const cues: Cue[] = [
      group('g1', { mode: 'random' }),
      audio('a1', { parentId: 'g1' })
    ]
    expect(groupLengthState(cues, 'g1', known())).toBeNull()
  })

  it('says nothing about a cue that is not a group', () => {
    expect(groupLengthState([audio('a1')], 'a1', known())).toBeNull()
    expect(groupLengthState([], 'gone', known())).toBeNull()
  })
})