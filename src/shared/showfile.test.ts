// What a diff has to get right, in the terms the app then relies on: the compare view
// draws it, a save writes it into the file's history, and a merge applies it. The cases
// below are therefore about *meaning* — an edit is something a person typed, a move is
// the smallest set of cues that explains a reordering, and neither the route to a media
// file nor the region a scan measured is an edit at all.
import { describe, it, expect } from 'vitest'
import { CUE_TYPES } from './cue'
import type { AudioCue, Cue, CueType } from './cue'
import type { Workspace } from './workspace'
import {
  MAX_HISTORY_ENTRIES,
  MAX_LOGGED_CUES,
  appendHistory,
  describeEntry,
  describeField,
  describeValue,
  diffWorkspaces,
  historyEntry
} from './showfile'

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

/** A cue as a file stores it: the runtime cue plus the app's record of where its file is. */
function stored(cue: Cue, path: string, originalPath = `/shows/${path}`): Cue {
  return { ...cue, media: { path, originalPath } } as unknown as Cue
}

/**
 * A cue of another type. The factory above builds an audio cue, and what a field means
 * is asked per type, so the cases below need a wait and a fade as well as a group.
 */
function cueOf(type: CueType, over: { id: string } & Record<string, unknown>): Cue {
  return cue({ type, ...over } as unknown as Partial<AudioCue> & { id: string })
}

function workspace(cues: Cue[], over: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    id: 'show-1',
    name: 'Hamlet',
    createdAt: '2026-09-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    triggerGuard: { windowMs: 300 },
    cues,
    ...over
  }
}

describe('the diff between two showfiles', () => {
  it('says nothing at all about a file that did not change', () => {
    const show = workspace([cue({ id: 'a' }), cue({ id: 'b' })])
    const diff = diffWorkspaces(show, workspace([cue({ id: 'a' }), cue({ id: 'b' })]))
    expect(diff.empty).toBe(true)
    expect(diff.unchanged).toBe(2)
    expect(diff.added).toEqual([])
    expect(diff.removed).toEqual([])
    expect(diff.changed).toEqual([])
    expect(diff.settings).toEqual([])
  })

  it('reports a cue that appeared, and one that went', () => {
    const diff = diffWorkspaces(
      workspace([cue({ id: 'a' }), cue({ id: 'gone', number: '2', name: 'Interval' })]),
      workspace([cue({ id: 'a' }), cue({ id: 'new', number: '3', name: 'Bows' })])
    )
    expect(diff.added).toEqual([
      { id: 'new', label: '3 Bows', type: 'audio', place: { parent: null, after: { id: 'a', label: 'a Cue a' } } }
    ])
    expect(diff.removed).toEqual([
      {
        id: 'gone',
        label: '2 Interval',
        type: 'audio',
        place: { parent: null, after: { id: 'a', label: 'a Cue a' } }
      }
    ])
    expect(diff.changed).toEqual([])
    expect(diff.unchanged).toBe(1)
    expect(diff.empty).toBe(false)
  })

  it('names the fields a cue edit changed, and only those', () => {
    const diff = diffWorkspaces(
      workspace([cue({ id: 'a', name: 'Walk-in', volume: 0.6, notes: 'quiet' })]),
      workspace([cue({ id: 'a', name: 'Walk-in music', volume: 0.6, notes: 'quiet' })])
    )
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0]).toMatchObject({ id: 'a', label: 'a Walk-in music', type: 'audio' })
    expect(diff.changed[0].fields).toEqual([
      { field: 'name', from: 'Walk-in', to: 'Walk-in music' }
    ])
    expect(diff.changed[0].moved).toBeUndefined()
  })

  it('reports a cue that was deleted and made again as an arrival and a departure, not an edit', () => {
    const diff = diffWorkspaces(
      workspace([cue({ id: 'a', name: 'Walk-in' })]),
      workspace([cue({ id: 'a2', name: 'Walk-in' })])
    )
    expect(diff.added.map(entry => entry.id)).toEqual(['a2'])
    expect(diff.removed.map(entry => entry.id)).toEqual(['a'])
    expect(diff.changed).toEqual([])
  })

  it('reports one cue moved to the top rather than the ones it passed', () => {
    const before = ['a', 'b', 'c', 'd'].map(id => cue({ id }))
    const after = ['d', 'a', 'b', 'c'].map(id => cue({ id }))
    const diff = diffWorkspaces(workspace(before), workspace(after))
    expect(diff.changed.map(change => change.id)).toEqual(['d'])
    expect(diff.changed[0].fields).toBeUndefined()
    expect(diff.changed[0].moved?.from.after).toEqual({ id: 'c', label: 'c Cue c' })
    expect(diff.changed[0].moved?.to.after).toBeNull()
    expect(diff.unchanged).toBe(3)
  })

  it('reports one of two cues that swapped places, because either one explains it', () => {
    const diff = diffWorkspaces(
      workspace([cue({ id: 'a' }), cue({ id: 'b' })]),
      workspace([cue({ id: 'b' }), cue({ id: 'a' })])
    )
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].moved).toBeDefined()
  })

  it('calls a cue that changed group and content both edited and moved', () => {
    const diff = diffWorkspaces(
      workspace([cue({ id: 'g', type: 'group' } as unknown as Partial<AudioCue> & { id: string }), cue({ id: 'a', name: 'One' })]),
      workspace([
        cue({ id: 'g', type: 'group' } as unknown as Partial<AudioCue> & { id: string }),
        cue({ id: 'a', name: 'Two', parentId: 'g' })
      ])
    )
    expect(diff.changed).toHaveLength(1)
    const child = diff.changed[0]
    expect(child.fields).toEqual([{ field: 'name', from: 'One', to: 'Two' }])
    expect(child.moved?.from.parent).toBeNull()
    expect(child.moved?.to.parent).toEqual({ id: 'g', label: 'g Cue g' })
    // The group's own place is the same in both files, so nothing is said about it.
    expect(diff.unchanged).toBe(1)
  })

  it('does not read a measured region or a media route as an edit', () => {
    const before = workspace([
      stored(cue({ id: 'a', filePath: '/shows/walk-in.wav', soundRegion: { startMs: 120, endMs: 900, durationMs: 1000, silent: false } }), 'walk-in.wav')
    ])
    const after = workspace([
      stored(
        cue({ id: 'a', filePath: '/other/place/walk-in.wav', soundRegion: { startMs: 0, endMs: 4200, durationMs: 5000, silent: false } }),
        'walk-in.wav',
        '/other/place/walk-in.wav'
      )
    ])
    expect(diffWorkspaces(before, after).empty).toBe(true)
  })

  it('reads a cue that only names its file as the same cue once it is saved', () => {
    // An older file says where the file was; a save writes the route and the absolute
    // path as well. The cue plays the same file either way, so nothing changed.
    const older = workspace([cue({ id: 'a', filePath: 'walk-in.wav' })])
    const saved = workspace([stored(cue({ id: 'a', filePath: '/shows/walk-in.wav' }), 'walk-in.wav')])
    expect(diffWorkspaces(older, saved).empty).toBe(true)
  })

  it('reports a cue pointed at another file in a file this build has never saved', () => {
    // No `media` block on either side: an older file names its file under `filePath`, and
    // the cue plays something else now. Reading that as unchanged would hide a relink.
    const diff = diffWorkspaces(
      workspace([cue({ id: 'a', filePath: 'walk-in.wav' })]),
      workspace([cue({ id: 'a', filePath: 'bows.wav' })])
    )
    expect(diff.changed[0].fields).toEqual([
      { field: 'media', from: 'walk-in.wav', to: 'bows.wav' }
    ])
  })

  it('reports a cue pointed at a different file', () => {
    const diff = diffWorkspaces(
      workspace([stored(cue({ id: 'a' }), 'walk-in.wav')]),
      workspace([stored(cue({ id: 'a' }), 'bows.wav')])
    )
    expect(diff.changed[0].fields).toEqual([
      { field: 'media', from: 'walk-in.wav', to: 'bows.wav' }
    ])
  })

  it('is not fooled by key order, and treats an absent field and a null one alike', () => {
    const missing = workspace([{ ...cue({ id: 'a' }), refire: undefined } as unknown as Cue])
    const explicitNull = workspace([{ ...cue({ id: 'a' }), refire: null } as unknown as Cue])
    expect(diffWorkspaces(explicitNull, missing).empty).toBe(true)
    expect(diffWorkspaces(workspace([cue({ id: 'a', refire: 'ignore' })]), missing).changed[0].fields).toEqual([
      { field: 'refire', from: 'ignore', to: null }
    ])

    // The same setting, written by two versions that did not agree on key order.
    const keys = (...order: string[]): Workspace['audioSettings'] =>
      Object.fromEntries(order.map(key => [key, key === 'sampleRate' ? 48000 : 'default'])) as unknown as Workspace['audioSettings']
    expect(
      diffWorkspaces(
        workspace([], { audioSettings: keys('outputDeviceId', 'sampleRate') }),
        workspace([], { audioSettings: keys('sampleRate', 'outputDeviceId') })
      ).empty
    ).toBe(true)
  })

  it('names settings by their route, no deeper than a person reads', () => {
    const diff = diffWorkspaces(
      workspace([], {
        name: 'Hamlet',
        audioSettings: { outputDeviceId: 'default', sampleRate: 48000 },
        midiSettings: { outputPortName: 'Desk' },
        showSettings: { rf: { plot: ['a', 'b'] } } as unknown as Workspace['showSettings'],
        triggerGuard: { windowMs: 300 }
      }),
      workspace([], {
        name: 'Hamlet — press',
        audioSettings: { outputDeviceId: 'default', sampleRate: 44100 },
        midiSettings: { outputPortName: 'Keys' },
        showSettings: { rf: { plot: ['a', 'b', 'c'] } } as unknown as Workspace['showSettings'],
        triggerGuard: { windowMs: 500 }
      })
    )
    // Every section is reported in the saved form's own order — the declaration's, which
    // is the order the file's keys are written — not alphabetically and not in any list a
    // reader keeps.
    expect(diff.settings.map(setting => setting.path)).toEqual([
      'name',
      'audio.sampleRate',
      'midi.outputPortName',
      'show.rf.plot',
      'guard.windowMs'
    ])
    const rate = diff.settings.find(setting => setting.path === 'audio.sampleRate')
    expect(rate).toMatchObject({ from: 48000, to: 44100 })
    // An array is one change however many entries moved, and the value is the array.
    expect(diff.settings.find(setting => setting.path === 'show.rf.plot')).toMatchObject({
      from: ['a', 'b'],
      to: ['a', 'b', 'c']
    })
  })

  it('says whether the two files are the same show', () => {
    const other = workspace([], { id: 'show-2', name: 'Macbeth' })
    expect(diffWorkspaces(workspace([]), workspace([])).sameShow).toBe(true)
    const diff = diffWorkspaces(workspace([]), other)
    expect(diff.sameShow).toBe(false)
    expect(diff.empty).toBe(false)
    expect(diff.to.name).toBe('Macbeth')
    expect(diff.from.cues).toBe(0)
  })
})

/**
 * What counts as an edit is asked of a pair — this field, on this cue's type — because
 * the same name means different things on different cues: `duration` is the length a
 * scan measured on an audio cue and the time a person typed on a wait or a fade. Both
 * sides are pinned here: the measurement stays silent, and the typed number does not,
 * because silencing that is the same bug seen from the other end.
 */
describe('what counts as an edit, per cue type and field', () => {
  it('does not read the length the app measured as an edit', () => {
    const before = workspace([cue({ id: 'a', duration: 0 })])
    const after = workspace([cue({ id: 'a', duration: 3000 })])
    const diff = diffWorkspaces(before, after)
    expect(diff.empty).toBe(true)
    expect(diff.changed).toEqual([])
    // A save whose only difference is the measurement has nothing to record.
    expect(historyEntry(diff, '2026-09-16T10:00:00.000Z', 'adam')).toBeNull()
  })

  it('reads a duration a person typed on a wait or a fade as an edit', () => {
    const before = workspace([
      cueOf('wait', { id: 'w', duration: 1000 }),
      cueOf('fade', { id: 'f', duration: 500 })
    ])
    const after = workspace([
      cueOf('wait', { id: 'w', duration: 2500 }),
      cueOf('fade', { id: 'f', duration: 1500 })
    ])
    const diff = diffWorkspaces(before, after)
    expect(diff.changed.map(change => [change.id, change.fields])).toEqual([
      ['w', [{ field: 'duration', from: 1000, to: 2500 }]],
      ['f', [{ field: 'duration', from: 500, to: 1500 }]]
    ])
    expect(historyEntry(diff, '2026-09-16T10:00:00.000Z', 'adam')?.cues).toEqual([
      { kind: 'edited', id: 'w', label: 'w Cue w', fields: ['duration'] },
      { kind: 'edited', id: 'f', label: 'f Cue f', fields: ['duration'] }
    ])
  })

  it('reads duration as an edit on every cue type but audio', () => {
    for (const type of CUE_TYPES) {
      const diff = diffWorkspaces(
        workspace([cueOf(type, { id: 'c', duration: 100 })]),
        workspace([cueOf(type, { id: 'c', duration: 200 })])
      )
      const fields = diff.changed.flatMap(change => change.fields?.map(field => field.field) ?? [])
      expect(fields, `duration on a ${type} cue`).toEqual(type === 'audio' ? [] : ['duration'])
    }
  })

  it('never reads a route, an identity or a measured region as an edit', () => {
    // A cue is matched by its id, so an id that changed is an arrival and a departure:
    // the name is never a field somebody edited.
    const reidentified = diffWorkspaces(workspace([cue({ id: 'a' })]), workspace([cue({ id: 'b' })]))
    expect(reidentified.added.map(entry => entry.id)).toEqual(['b'])
    expect(reidentified.removed.map(entry => entry.id)).toEqual(['a'])
    expect(reidentified.changed).toEqual([])

    // `filePath` is this machine's route to the file, and the comparison reads neither it
    // nor `media`'s absolute `originalPath`: what it compares is the file's own name,
    // which is the same on both sides.
    const relinked = diffWorkspaces(
      workspace([stored(cue({ id: 'a', filePath: '/shows/walk-in.wav' }), 'walk-in.wav')]),
      workspace([
        stored(cue({ id: 'a', filePath: '/elsewhere/walk-in.wav' }), 'walk-in.wav', '/elsewhere/walk-in.wav')
      ])
    )
    expect(relinked.empty).toBe(true)

    // A region a scan measured is excluded on the type that carries one...
    const rescanned = diffWorkspaces(
      workspace([
        stored(cue({ id: 'a', soundRegion: { startMs: 120, endMs: 900, durationMs: 1000, silent: false } }), 'walk-in.wav')
      ]),
      workspace([
        stored(cue({ id: 'a', soundRegion: { startMs: 0, endMs: 4200, durationMs: 5000, silent: false } }), 'walk-in.wav')
      ])
    )
    expect(rescanned.empty).toBe(true)

    // ...and on a type that has no such field at all: the walk is the union of both
    // sides' keys, so a `soundRegion` only one side carries still arrives, and the
    // exclusion is by name on every type.
    const regionOnAWait = diffWorkspaces(
      workspace([cueOf('wait', { id: 'w', soundRegion: null })]),
      workspace([cueOf('wait', { id: 'w', soundRegion: { startMs: 0, endMs: 1, durationMs: 2, silent: false } })])
    )
    expect(regionOnAWait.empty).toBe(true)
  })

  it('reports a reparent as a move and never as an edited parentId', () => {
    const diff = diffWorkspaces(
      workspace([cueOf('group', { id: 'g' }), cue({ id: 'a' })]),
      workspace([cueOf('group', { id: 'g' }), cue({ id: 'a', parentId: 'g' })])
    )
    expect(diff.changed).toHaveLength(1)
    expect(diff.changed[0].fields).toBeUndefined()
    expect(diff.changed[0].moved?.from.parent).toBeNull()
    expect(diff.changed[0].moved?.to.parent).toEqual({ id: 'g', label: 'g Cue g' })
  })

  it('still reads a field it has never heard of as an edit', () => {
    const after = workspace([{ ...cue({ id: 'a' }), followspot: 'warm' } as unknown as Cue])
    const diff = diffWorkspaces(workspace([cue({ id: 'a' })]), after)
    expect(diff.changed[0].fields).toEqual([{ field: 'followspot', from: null, to: 'warm' }])
  })
})

describe('a save written into the file history', () => {
  const diff = diffWorkspaces(
    workspace([cue({ id: 'a', name: 'One' }), cue({ id: 'gone' })]),
    workspace([cue({ id: 'a', name: 'Two' }), cue({ id: 'new' }), cue({ id: 'b' })])
  )

  it('names what changed without storing what it was', () => {
    const entry = historyEntry(diff, '2026-09-16T10:00:00.000Z', 'adam', 'ubox')
    expect(entry).toMatchObject({ at: '2026-09-16T10:00:00.000Z', by: 'adam', machine: 'ubox' })
    expect(entry?.cues).toEqual([
      { kind: 'added', id: 'new', label: 'new Cue new' },
      { kind: 'added', id: 'b', label: 'b Cue b' },
      { kind: 'removed', id: 'gone', label: 'gone Cue gone' },
      { kind: 'edited', id: 'a', label: 'a Two', fields: ['name'] }
    ])
    expect(JSON.stringify(entry)).not.toContain('"from"')
  })

  it('has nothing to say about a save that changed nothing', () => {
    const same = diffWorkspaces(workspace([]), workspace([]))
    expect(historyEntry(same, '2026-09-16T10:00:00.000Z', 'adam')).toBeNull()
  })

  it('leaves out the machine when the system would not give one', () => {
    expect(historyEntry(diff, '2026-09-16T10:00:00.000Z', 'adam')?.machine).toBeUndefined()
  })

  it('keeps a very large change from becoming a very large entry', () => {
    const many = workspace(Array.from({ length: MAX_LOGGED_CUES + 25 }, (_, index) => cue({ id: `c${index}` })))
    const entry = historyEntry(diffWorkspaces(workspace([]), many), '2026-09-16T10:00:00.000Z', 'adam')
    expect(entry?.cues).toHaveLength(MAX_LOGGED_CUES)
    expect(entry?.omitted).toEqual({ cues: 25 })
  })

  it('drops the oldest entries rather than growing without a bound', () => {
    let history = appendHistory(undefined, { at: '0', by: 'adam', cues: [], settings: [] })
    for (let index = 0; index < MAX_HISTORY_ENTRIES + 5; index++) {
      history = appendHistory(history, { at: String(index), by: 'adam', cues: [], settings: [] })
    }
    expect(history).toHaveLength(MAX_HISTORY_ENTRIES)
    expect(history[history.length - 1].at).toBe(String(MAX_HISTORY_ENTRIES + 4))
    expect(history[0].at).not.toBe('0')
  })
})

describe('reading a change out loud', () => {
  it('summarises an entry in one line', () => {
    expect(
      describeEntry({
        at: '2026-09-16T10:00:00.000Z',
        by: 'adam',
        cues: [
          { kind: 'added', id: 'a', label: 'a' },
          { kind: 'added', id: 'b', label: 'b' },
          { kind: 'edited', id: 'c', label: 'c', fields: ['name'] }
        ],
        settings: ['audio.sampleRate']
      })
    ).toBe('2 added · 1 edited · audio.sampleRate')
  })

  it('says an entry with nothing in it is a save', () => {
    expect(describeEntry({ at: '0', by: 'adam', cues: [], settings: [] })).toBe('saved')
  })

  it('renders a changed field as the two values it went between', () => {
    expect(describeField({ field: 'volume', from: 0.6, to: 0.75 })).toBe('volume 0.6 → 0.75')
    expect(describeField({ field: 'name', from: 'One', to: 'Two' })).toBe('name “One” → “Two”')
    expect(describeField({ field: 'outputs', from: null, to: [{}, {}] })).toBe('outputs — → 2 entries')
  })

  it('does not let one long value take the line over', () => {
    const long = describeValue('x'.repeat(500))
    expect(long.length).toBeLessThanOrEqual(62)
    expect(long.endsWith('…”')).toBe(true)
  })
})
