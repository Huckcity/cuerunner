// The file's own history: what each save changed, written by the save, read back by the
// window. Two properties hold it up. A save that changed nothing writes the same bytes
// back and adds no entry — a history that grows on every save is a file that cannot be
// diffed. And a save that did change something names it, because a file that describes a
// change nobody made, or forgets one that happened, is a history nobody can trust.
//
// Electron is stubbed with a real temporary directory: these tests exercise the actual
// filesystem.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-history-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: {},
    BrowserWindow: {}
  }
})

const { compareWithFile, openWorkspaceFromPath, saveWorkspace } = await import('./WorkspaceManager')
import type { AudioCue, Cue, WaitCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

/** A show as an old build wrote it: no show-services section, no per-cue triggers. */
const LEGACY_SHOW = `{
  "version": 1,
  "id": "w-legacy",
  "name": "Press Night",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "audioSettings": { "outputDeviceId": "default" },
  "midiSettings": { "outputPortName": "" },
  "cues": [
    {
      "id": "a1",
      "number": "1",
      "name": "Walk-in",
      "type": "audio",
      "colorLabel": "none",
      "parentId": null,
      "preWait": 0,
      "postWait": 0,
      "timelineOffset": 0,
      "duration": 0,
      "advance": "none",
      "isArmed": true,
      "notes": "",
      "filePath": "walk-in.wav",
      "startTime": 0,
      "endTime": null,
      "fadeInDuration": 0,
      "volume": 1,
      "pan": 0,
      "outputs": null,
      "loopCount": 1,
      "playbackRate": 1,
      "trim": 0
    }
  ]
}`

function cue(id: string, name: string): Cue {
  return {
    type: 'audio',
    id,
    number: id,
    name,
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
    // The shape this build writes: a file missing these is an old one, and the
    // migration fills them in — which is a change to the file, but not to the show.
    triggers: [],
    refire: 'ignore',
    trimSilence: false
  } as AudioCue as Cue
}

/**
 * A cue nobody measures: a wait's length is what the operator typed, which is the other
 * half of the rule the save's history follows.
 */
function waitCue(id: string, name: string, duration: number): Cue {
  return {
    type: 'wait',
    id,
    number: id,
    name,
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration,
    advance: 'none',
    isArmed: true,
    notes: '',
    triggers: [],
    refire: 'ignore'
  } as WaitCue
}

function workspace(cues: Cue[], over: Partial<Workspace> = {}): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Hamlet',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues,
    ...over
  }
}

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-history-'))
  file = join(dir, 'Hamlet.cuerunner')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function historyOnDisk(path = file): unknown {
  return JSON.parse(readFileSync(path, 'utf-8')).history
}

describe('a save writes what it changed into the file', () => {
  it('names the cues it added, edited and removed', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in'), cue('b', 'Interval')])))

    const { workspace: opened } = await openWorkspaceFromPath(file)
    await saveWorkspace({} as never, {
      ...opened,
      cues: [cue('a', 'Walk-in music'), cue('c', 'Bows')]
    }, file)

    const history = historyOnDisk() as Array<{
      at: string
      by: string
      cues: Array<{ kind: string; id: string; label: string; fields?: string[] }>
    }>
    expect(history).toHaveLength(1)
    expect(history[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(history[0].by).not.toBe('')
    expect(history[0].cues).toEqual([
      { kind: 'added', id: 'c', label: 'c Bows' },
      { kind: 'removed', id: 'b', label: 'b Interval' },
      { kind: 'edited', id: 'a', label: 'a Walk-in music', fields: ['name'] }
    ])
  })

  it('writes the same bytes back, entry count included, when nothing changed', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in')])))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    await saveWorkspace({} as never, { ...opened, cues: [cue('a', 'Walk-in music')] }, file)
    const settled = readFileSync(file, 'utf-8')

    const { workspace: again } = await openWorkspaceFromPath(file)
    await saveWorkspace({} as never, again, file)

    expect(readFileSync(file, 'utf-8')).toBe(settled)
  })

  it('keeps the history in the file when the caller never read what was written', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in')])))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // A caller that ignores the returned history — the same object saved twice, which is
    // what a window that dropped the answer would do.
    const changed = { ...opened, cues: [cue('a', 'Walk-in music')] }
    await saveWorkspace({} as never, changed, file)
    const first = historyOnDisk()
    await saveWorkspace({} as never, changed, file)

    expect(first).toHaveLength(1)
    expect(historyOnDisk()).toEqual(first)
  })

  it('does not report an upgrade of the format as an edit', async () => {
    writeFileSync(file, LEGACY_SHOW)
    writeFileSync(join(dir, 'walk-in.wav'), Buffer.alloc(44))

    const { workspace: opened } = await openWorkspaceFromPath(file)
    await saveWorkspace({} as never, opened, file)

    // The file really did change — the show-services section and the per-cue triggers
    // arrived — but nobody edited the show, and the history says nothing happened.
    expect(JSON.parse(readFileSync(file, 'utf-8')).showSettings).toBeDefined()
    expect(historyOnDisk()).toBeUndefined()
  })

  it('carries the show’s own history into a file it is saved as', async () => {
    const other = join(dir, 'Hamlet — press.cuerunner')
    const entry = { at: '2026-02-01T00:00:00.000Z', by: 'associate', cues: [], settings: ['name'] }

    await saveWorkspace({} as never, workspace([cue('a', 'Walk-in')], { history: [entry] }), other)

    expect(historyOnDisk(other)).toEqual([entry])
  })

  it('does not record the length the measurement pass wrote', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in'), waitCue('w', 'Bows', 1000)])))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // What the window holds once the pass has answered: the audio cue carries the length
    // of its file, and nobody typed anything.
    const measured = {
      ...opened,
      cues: opened.cues.map(entry => (entry.id === 'a' ? { ...entry, duration: 3000 } : entry))
    }
    await saveWorkspace({} as never, measured, file)

    // The file really did change — it carries the measured length now — but the history
    // must not claim a person made that change.
    const onDisk = JSON.parse(readFileSync(file, 'utf-8')) as { cues: Array<{ id: string; duration: number }> }
    expect(onDisk.cues.find(entry => entry.id === 'a')?.duration).toBe(3000)
    expect(historyOnDisk()).toBeUndefined()
  })

  it('records a duration the operator typed on a wait cue as an edit', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in'), waitCue('w', 'Bows', 1000)])))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    const typed = {
      ...opened,
      cues: opened.cues.map(entry => (entry.id === 'w' ? { ...entry, duration: 2500 } : entry))
    }
    await saveWorkspace({} as never, typed, file)

    expect(historyOnDisk()).toEqual([
      expect.objectContaining({
        cues: [{ kind: 'edited', id: 'w', label: 'w Bows', fields: ['duration'] }]
      })
    ])
  })

  it('records the typed edit and not the measurement when both arrive in one save', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in'), waitCue('w', 'Bows', 1000)])))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // The pass measured the audio file while the operator typed a new wait length: one
    // save carries both, and only the one a person made is the save's business.
    const durations: Record<string, number> = { a: 3000, w: 2500 }
    const changed = {
      ...opened,
      cues: opened.cues.map(entry => ({ ...entry, duration: durations[entry.id] ?? entry.duration }))
    }
    await saveWorkspace({} as never, changed, file)

    expect(historyOnDisk()).toEqual([
      expect.objectContaining({
        cues: [{ kind: 'edited', id: 'w', label: 'w Bows', fields: ['duration'] }]
      })
    ])
  })

  it('does not record one show’s difference from another', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in')])))

    // Save As onto a name that is taken: the file at this path is another show, and the
    // difference between two shows is not a change to either of them.
    const mine = workspace([cue('z', 'Overture')], { id: 'w2', name: 'Macbeth' })
    await saveWorkspace({} as never, mine, file)

    expect(historyOnDisk()).toBeUndefined()
    expect(JSON.parse(readFileSync(file, 'utf-8')).id).toBe('w2')
  })
})

describe('a comparison against a file', () => {
  it('reports nothing for a show whose only difference is a measured length', async () => {
    writeFileSync(file, JSON.stringify(workspace([cue('a', 'Walk-in'), waitCue('w', 'Bows', 1000)])))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // The window's show once the pass has answered, against the file it was loaded from.
    // The comparison puts the window through the same serialiser and migration a save
    // does, so this is the whole way round — and nothing about the show changed.
    const measured = {
      ...opened,
      cues: opened.cues.map(entry => (entry.id === 'a' ? { ...entry, duration: 3000 } : entry))
    }
    const { diff } = await compareWithFile(measured, file)
    expect(diff.empty).toBe(true)
    expect(diff.changed).toEqual([])

    // The same call with a typed edit beside the measurement does report it, so the empty
    // answer above is the rule at work rather than one side compared with itself.
    const typed = {
      ...measured,
      cues: measured.cues.map(entry => (entry.id === 'w' ? { ...entry, duration: 2500 } : entry))
    }
    expect((await compareWithFile(typed, file)).diff.changed.map(change => change.id)).toEqual(['w'])
  })
})
