// The saved shape is one declaration, and this file walks it.
//
// `src/shared/workspaceSections.ts` names the shape's sections in the order the file's
// keys are written, the route the settings diff reports each one under, and what a merge
// does with it. Everything below is driven by that list: the serialiser writes it in
// order, every settings-bearing section is moved and has to be reported under its route,
// and every section is moved again to see the merge take the change or keep this show's.
// A section that reaches disk but is never compared or blended — the bug this shape's one
// declaration exists to prevent — fails here, and so does a workspace key the declaration
// does not carry.
//
// The fixture is hand-written on purpose. Fixtures are input, not writers: the rule the
// declaration holds is about the app's own writers, and the fixture is what they are held
// to.
import { describe, it, expect, vi } from 'vitest'
import { serialiseWorkspace } from './WorkspaceManager'
import { defaultShowSettings } from '../../shared/show'
import { diffWorkspaces } from '../../shared/showfile'
import { mergeWorkspaces } from '../../shared/showfileMerge'
import { WORKSPACE_SECTIONS, type WorkspaceKey } from '../../shared/workspaceSections'
import type { AudioCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

vi.mock('electron', () => ({
  // Nothing here touches the user-data folder; the serialiser needs no Electron at all.
  app: { getPath: () => '/tmp' },
  dialog: {},
  BrowserWindow: {}
}))

/** Where the fixture's files would live; no cue names a file, so nothing is resolved. */
const SHOWS = '/shows/press-night'

function cue(id: string, name: string): AudioCue {
  return {
    id,
    number: id,
    name,
    type: 'audio',
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
    trim: 0
  }
}

/**
 * The whole shape, every optional section set: the walk needs a value it can move in every
 * section, including the ones a file need not carry, and `Required` keeps the fixture
 * honest if the `Workspace` type gains a key.
 */
const fixture: Required<Workspace> = {
  version: 1,
  id: 'w-press-night',
  name: 'Press Night',
  createdAt: '2026-09-01T00:00:00.000Z',
  history: [{ at: '2026-09-02T00:00:00.000Z', by: 'adam', cues: [], settings: ['name'] }],
  audioSettings: { outputDeviceId: 'default', sampleRate: 48000 },
  midiSettings: { outputPortName: 'Desk' },
  showSettings: defaultShowSettings(),
  triggerGuard: { windowMs: 300 },
  cues: [cue('a1', 'Walk-in'), cue('a2', 'Interval')]
}

/**
 * A value with something about it moved: the first field of an object, the first entry of
 * an array, a string with a suffix. Enough for a diff or a merge to see the section is
 * not what it was, whatever kind of value the section holds.
 */
function movedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.length > 0 ? [movedValue(value[0]), ...value.slice(1)] : ['moved']
  if (value !== null && typeof value === 'object') {
    const fields = Object.keys(value)
    if (fields.length === 0) return { moved: true }
    return { ...(value as Record<string, unknown>), [fields[0]]: movedValue((value as Record<string, unknown>)[fields[0]]) }
  }
  if (typeof value === 'string') return `${value} — moved`
  if (typeof value === 'number') return value + 1
  if (typeof value === 'boolean') return !value
  return 'moved'
}

/**
 * The fixture with one section moved, as another writer would have left it. The cues move
 * by renaming the first cue — an edit the cue merge blends — rather than by moving a
 * field the walk happens to find first, because a cue's identity is not an edit.
 */
function moved(section: WorkspaceKey): Workspace {
  const value = section === 'cues'
    ? fixture.cues.map(entry => ({ ...entry, name: `${entry.name} — moved` }))
    : movedValue(fixture[section])
  return { ...fixture, [section]: value } as Workspace
}

/**
 * The file's keys, in the order its bytes carry them. The declaration is the one edit
 * point for that order — which is exactly why the test pins it here: a reorder there
 * would silently rewrite every showfile this machine has written, and a test that only
 * compared the serialiser with the declaration would compare the new order with itself.
 * The type ties each name back to the declaration, so a dropped section fails to compile
 * before it fails below.
 */
const declared: readonly WorkspaceKey[] = [
  'version',
  'id',
  'name',
  'createdAt',
  'history',
  'audioSettings',
  'midiSettings',
  'showSettings',
  'triggerGuard',
  'cues'
]

describe('the saved shape', () => {
  it('writes every declared section, in the declared order, and nothing else', () => {
    const onDisk = JSON.parse(serialiseWorkspace(fixture, SHOWS)) as Record<string, unknown>

    // The file carries the pinned keys, in the pinned order — which is the declaration's
    // order, unless the declaration was reordered, and then this is the only place that
    // says so.
    expect(Object.keys(onDisk)).toEqual(declared)
    // The declaration carries the whole shape: a key the workspace holds but the
    // declaration never learned would be written by nobody and compared by nothing.
    expect(Object.keys(fixture)).toEqual(declared)
  })

  it('leaves an unset section out of the file rather than writing an empty one', () => {
    const bare = serialiseWorkspace(
      { ...fixture, history: undefined, showSettings: undefined, triggerGuard: undefined },
      SHOWS
    )

    expect(Object.keys(JSON.parse(bare))).toEqual(
      declared.filter(key => key !== 'history' && key !== 'showSettings' && key !== 'triggerGuard')
    )
  })

  it('compares every settings-bearing section under its declared route, and nothing else', () => {
    for (const section of WORKSPACE_SECTIONS) {
      const paths = diffWorkspaces(fixture, moved(section.key)).settings.map(setting => setting.path)
      if (section.route === null) {
        expect(paths, `${section.key} is not a setting`).toEqual([])
        continue
      }
      expect(paths.length, `${section.key} is not compared`).toBeGreaterThan(0)
      for (const path of paths) {
        expect(
          path === section.route || path.startsWith(`${section.route}.`),
          `${section.key} reported under ${path}`
        ).toBe(true)
      }
    }

    // The same show on both sides of a compare: the settings have nothing to say.
    expect(diffWorkspaces(fixture, fixture).settings).toEqual([])
  })

  it('blends every declared section the way the declaration says', () => {
    for (const section of WORKSPACE_SECTIONS) {
      const theirs = moved(section.key)
      const merged = mergeWorkspaces(fixture, fixture, theirs, { onConflict: 'ours' }).workspace

      // A one-sided change is taken by every blending behaviour — the section, the key
      // inside it, the cue — and refused by `ours`, whose value is the destination's.
      const expected = section.merge === 'ours' ? fixture[section.key] : theirs[section.key]
      expect(merged[section.key], section.key).toEqual(expected)
    }
  })
})
