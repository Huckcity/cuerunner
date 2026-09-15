// What a diff has to get right, in the terms the app then relies on: the compare view
// draws it, a save writes it into the file's history, and a merge applies it. The cases
// below are therefore about *meaning* — an edit is something a person typed, a move is
// the smallest set of cues that explains a reordering, and neither the route to a media
// file nor the region a scan measured is an edit at all.
import { describe, it, expect } from 'vitest'
import type { AudioCue, Cue } from '../renderer/src/types/cue'
import type { Workspace } from '../renderer/src/types/workspace'
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
        showSettings: { rf: { plot: ['a', 'b'] } } as unknown as Workspace['showSettings']
      }),
      workspace([], {
        name: 'Hamlet — press',
        audioSettings: { outputDeviceId: 'default', sampleRate: 44100 },
        showSettings: { rf: { plot: ['a', 'b', 'c'] } } as unknown as Workspace['showSettings']
      })
    )
    // The sections are reported in the order a person reads them, not alphabetically.
    expect(diff.settings.map(setting => setting.path)).toEqual(['name', 'audio.sampleRate', 'show.rf.plot'])
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
