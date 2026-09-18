// A cancelled merge dialog merges nothing: the handler must answer "no merge", not a
// merge with no file in it — the report dialog reads path and notes unconditionally,
// and the window would replace itself with an ErrorBoundary instead.
//
// Electron is not available here, so it is stubbed the way recovery.test.ts stubs it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workspace } from '../../shared/workspace'

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const userData = mkdtempSync(join(tmpdir(), 'cuerunner-userdata-'))
  return {
    app: { getPath: () => userData },
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn()
    },
    BrowserWindow: {}
  }
})

const { dialog } = await import('electron')
const { mergeShow } = await import('./WorkspaceManager')

const showSaveDialog = vi.mocked(dialog.showSaveDialog)

function writeShow(dir: string, name: string, cues: unknown[] = []): string {
  const file = join(dir, name)
  writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      id: 'w1',
      name: 'Show',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues
    }),
    'utf-8'
  )
  return file
}

function show(): Workspace {
  return {
    version: 1,
    id: 'w1',
    name: 'Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }
}

beforeEach(() => {
  showSaveDialog.mockReset()
})

describe('mergeShow', () => {
  it('answers null when the save dialog is cancelled, merging nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-merge-'))
    const theirs = writeShow(dir, 'theirs.cuerunner')
    const ancestor = writeShow(dir, 'ancestor.cuerunner')
    showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })

    const merged = await mergeShow({} as never, {
      version: 1,
      id: 'w1',
      name: 'Show',
      createdAt: '2026-01-01T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' },
      midiSettings: { outputPortName: '' },
      cues: []
    }, null, 'ours', { theirs, ancestor })

    expect(merged).toBeNull()
  })

  it('names the grouping repairs its input files needed, and writes them into the merged show', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-merge-repair-'))
    // The other person's copy is damaged two ways: a cue naming a group that is not in
    // the file, and two groups inside each other. The migration repairs both as the merge
    // reads it, and the merge report must say so rather than go quiet about the move.
    const theirs = writeShow(dir, 'theirs.cuerunner', [
      { id: 'o1', type: 'wait', duration: 1000, number: '3', name: 'Walk-in', parentId: 'gone' },
      { id: 'g1', type: 'group', mode: 'sequence', number: '4', name: 'Band', parentId: 'g2' },
      { id: 'g2', type: 'group', mode: 'sequence', number: '5', name: 'Vamp', parentId: 'g1' },
      { id: 'c1', type: 'wait', duration: 1000, number: '6', name: 'Under', parentId: 'g2' }
    ])
    const ancestor = writeShow(dir, 'ancestor.cuerunner')
    const mergedPath = join(dir, 'merged.cuerunner')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: mergedPath })

    const merged = await mergeShow({} as never, show(), null, 'ours', { theirs, ancestor })

    expect(merged).not.toBeNull()
    expect(merged?.notes.map(note => [note.subject, note.detail, note.conflict])).toEqual([
      ['3 Walk-in', 'its group is not in “theirs.cuerunner”: placed at the top level', false],
      ['4 Band', 'its group led back to it in “theirs.cuerunner”: placed at the top level', false],
      ['5 Vamp', 'its group led back to it in “theirs.cuerunner”: placed at the top level', false]
    ])

    // The written file holds the repaired cues: each cue the repair moved is at the top
    // level, and the cue under a loop member keeps its parent.
    const written = JSON.parse(readFileSync(mergedPath, 'utf-8')) as {
      cues: Array<{ id: string; parentId: string | null }>
    }
    const parents = new Map(written.cues.map(cue => [cue.id, cue.parentId]))
    expect(parents.get('o1')).toBeNull()
    expect(parents.get('g1')).toBeNull()
    expect(parents.get('g2')).toBeNull()
    expect(parents.get('c1')).toBe('g2')
  })

  it('names which input file each repair came from when both needed the same repairs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-merge-sources-'))
    // The two inputs carry identical damage — a dangling parent and a loop of groups —
    // so a row that only said "the file it came from" would read the same for both and
    // the operator could not tell which file needed what.
    const damaged = [
      { id: 'o1', type: 'wait', duration: 1000, number: '3', name: 'Walk-in', parentId: 'gone' },
      { id: 'g1', type: 'group', mode: 'sequence', number: '4', name: 'Band', parentId: 'g2' },
      { id: 'g2', type: 'group', mode: 'sequence', number: '5', name: 'Vamp', parentId: 'g1' }
    ]
    const theirs = writeShow(dir, 'theirs.cuerunner', damaged)
    const ancestor = writeShow(dir, 'ancestor.cuerunner', damaged)
    const mergedPath = join(dir, 'merged.cuerunner')
    showSaveDialog.mockResolvedValue({ canceled: false, filePath: mergedPath })

    const merged = await mergeShow({} as never, show(), null, 'ours', { theirs, ancestor })

    // Each input's rows in the order the reads happened — theirs, then ancestor — with
    // the source file named so the two sets are told apart.
    expect(merged?.notes.map(note => note.detail)).toEqual([
      'its group is not in “theirs.cuerunner”: placed at the top level',
      'its group led back to it in “theirs.cuerunner”: placed at the top level',
      'its group led back to it in “theirs.cuerunner”: placed at the top level',
      'its group is not in “ancestor.cuerunner”: placed at the top level',
      'its group led back to it in “ancestor.cuerunner”: placed at the top level',
      'its group led back to it in “ancestor.cuerunner”: placed at the top level'
    ])
  })
})
