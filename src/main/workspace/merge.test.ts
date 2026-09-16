// A cancelled merge dialog merges nothing: the handler must answer "no merge", not a
// merge with no file in it — the report dialog reads path and notes unconditionally,
// and the window would replace itself with an ErrorBoundary instead.
//
// Electron is not available here, so it is stubbed the way recovery.test.ts stubs it.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

function writeShow(dir: string, name: string): string {
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
      cues: []
    }),
    'utf-8'
  )
  return file
}

beforeEach(() => {
  showSaveDialog.mockReset()
})

describe('mergeShow', () => {
  it('answers null when the save dialog is cancelled, merging nothing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-merge-'))
    const theirs = writeShow(dir, 'theirs.wlab')
    const ancestor = writeShow(dir, 'ancestor.wlab')
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
})
