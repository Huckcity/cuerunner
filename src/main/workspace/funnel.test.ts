// One funnel, every entry point: bytes this build does not know are refused wherever they
// arrive — by a path a recent entry names, by the dialog, as a recovery snapshot, inside a
// bundle, as the other side of a comparison, as the demo, and as the file a save is about
// to replace. A path that skipped the funnel would load a show nobody wrote, so each case
// drives the same refused bytes through one entry point and holds the answer: a `Refusal`
// naming the source and the fact, never a fault and never a loaded show.
//
// The last two cases hold what surrounds the sentences: the file a save is about to
// replace is a refused one, and the save still succeeds with no history entry taken from
// it; and no entry point touches the bytes it refused, mtime included.
//
// Electron is stubbed with a real temporary directory and the filesystem is real.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { dialog } from 'electron'
import { defaultShowSettings } from '../../shared/show'
import type { Workspace } from '../../shared/workspace'
import { Refusal } from '../ipc/refusal'
import { readBundle } from './bundle'
import { openDemoWorkspace } from './demo'
import { writeRecovery } from './recovery'
import {
  compareWithFile, openRecovery, openWorkspace, openWorkspaceFromPath, saveWorkspace
} from './WorkspaceManager'
import { writeZip } from './zip'

const ends = vi.hoisted(() => ({ userData: { path: '' } }))

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  ends.userData.path = mkdtempSync(join(tmpdir(), 'cuerunner-funnel-userdata-'))
  return {
    app: { getPath: () => ends.userData.path, isPackaged: false },
    dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
    BrowserWindow: {}
  }
})

/** A show this build writes: the base every refused fixture is one change away from. */
function show(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    id: 'w1',
    name: 'Press Night',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: [],
    ...over
  }
}

interface Refused {
  /** What the file is, for the failure message. */
  what: string
  /** The document on disk. */
  show: Record<string, unknown>
  /** The fact the sentence has to name — the half of it that is not the source. */
  fact: string
}

/**
 * The shapes this build refuses: a cue type, a section at either level, a settings section
 * that is missing, and a version literal. Every entry point below drives all of them, so
 * the funnel is held to the same answer wherever the bytes come from.
 */
const REFUSED: readonly Refused[] = [
  {
    what: 'a cue type this build does not know',
    show: show({ cues: [{ id: 'v1', type: 'video', name: 'Clip' }] }),
    fact: 'does not know (video)'
  },
  {
    what: 'a top-level section this build does not declare',
    show: show({ futureSection: { cues: [] } }),
    fact: 'has a section this version of WinsLab does not know (futureSection)'
  },
  {
    what: 'a settings section this build does not declare',
    show: show({ showSettings: { ...defaultShowSettings(), plot: {} } }),
    fact: 'settings have a section this version of WinsLab does not know (plot)'
  },
  {
    what: 'settings missing a section this build writes',
    show: show({
      showSettings: {
        oscIn: { enabled: true, port: 53000 },
        midiIn: { enabled: false, portNames: [] }
      }
    }),
    fact: 'settings have no desk section, which this version of WinsLab writes'
  },
  {
    what: 'a version literal other than the one this build writes',
    show: show({ version: 2 }),
    fact: 'says version 2 and this build writes version 1'
  }
]

/**
 * Drives one entry point with one refused file and holds the answer. The thrown value has
 * to be the marked refusal — a fault would reach the window as a stack rather than a
 * sentence — and the sentence has to name the source the bytes came from and the fact.
 */
async function refusedFrom(
  entry: Refused,
  source: string,
  run: () => Promise<unknown>
): Promise<void> {
  const thrown = await run().then(() => undefined, (error: unknown) => error)

  if (!(thrown instanceof Refusal)) {
    throw new Error(`${entry.what} was not refused from ${source}: ${String(thrown)}`)
  }
  expect(thrown.message).toContain(entry.fact)
  expect(thrown.message).toContain(source)
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-funnel-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Each refused shape on disk under a name of its own, so the disk check has one per shape. */
function onDisk(): Map<Refused, string> {
  const paths = new Map<Refused, string>()
  REFUSED.forEach((entry, index) => {
    const path = join(dir, `Refused ${index + 1}.cuerunner`)
    writeFileSync(path, JSON.stringify(entry.show, null, 2))
    paths.set(entry, path)
  })
  return paths
}

describe('the funnel, through every entry point', () => {
  it('refuses a file a recent entry names, and names that file', async () => {
    for (const [entry, path] of onDisk()) {
      await refusedFrom(entry, path, () => openWorkspaceFromPath(path))
    }
  })

  it('refuses the same bytes chosen through the dialog', async () => {
    for (const [entry, path] of onDisk()) {
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [path] })
      await refusedFrom(entry, path, () => openWorkspace({} as never))
    }
  })

  it('refuses a snapshot this build cannot bring back, naming the snapshot', async () => {
    for (const entry of REFUSED) {
      await writeRecovery(entry.show as unknown as Workspace, null)
      const snapshot = join(ends.userData.path, 'recovery.cuerunner')
      await refusedFrom(entry, snapshot, () => openRecovery())
    }
  })

  it('refuses the showfile a bundle carries, naming the entry it came out of', async () => {
    for (const entry of REFUSED) {
      const bundle = join(dir, 'Handover.cuerunnerx')
      await writeZip(bundle, [{
        name: 'show.cuerunner',
        data: Buffer.from(JSON.stringify(entry.show), 'utf8')
      }])
      await refusedFrom(entry, `${bundle}’s show.cuerunner entry`, () => readBundle(bundle))
    }
  })

  it('refuses the other side of a comparison, naming that file', async () => {
    const ourShow = show() as unknown as Workspace
    for (const [entry, path] of onDisk()) {
      await refusedFrom(entry, path, () => compareWithFile(ourShow, path))
    }
  })

  it('refuses the demo when the file it ships as is not this shape, naming that file', async () => {
    for (const [entry, path] of onDisk()) {
      await refusedFrom(entry, path, () => openDemoWorkspace(path))
    }
  })

  it('saves over a refused file, and takes no history entry from it', async () => {
    // The save's own history pass reads the file it is about to replace, through the same
    // funnel. A refused file has nothing to compare against, and a history entry is not
    // worth failing a save for — so the save runs, the show lands, and the file's contents
    // leave no trace in the history.
    const target = join(dir, 'Taken.cuerunner')
    writeFileSync(target, JSON.stringify(REFUSED[4].show, null, 2))
    const ourShow = show({ name: 'Hamlet', history: undefined }) as unknown as Workspace

    const saved = await saveWorkspace({} as never, ourShow, target)

    expect(saved?.path).toBe(target)
    expect(saved?.history).toEqual([])
    const written = JSON.parse(readFileSync(target, 'utf-8'))
    expect(written.name).toBe('Hamlet')
    expect(written.history).toBeUndefined()
  })

  it('leaves every refused file exactly as it was found', async () => {
    // Loading never writes: the refusal is a value the window shows, and what the operator
    // picked is theirs — bytes and mtime both. Each shape is driven through every loading
    // entry point before the file is read back.
    for (const [entry, path] of onDisk()) {
      const before = readFileSync(path)
      const beforeStat = statSync(path)

      await refusedFrom(entry, path, () => openWorkspaceFromPath(path))
      vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [path] })
      await refusedFrom(entry, path, () => openWorkspace({} as never))
      await writeRecovery(entry.show as unknown as Workspace, null)
      await refusedFrom(entry, join(ends.userData.path, 'recovery.cuerunner'), () => openRecovery())
      const bundle = join(dir, 'Handover.cuerunnerx')
      await writeZip(bundle, [{
        name: 'show.cuerunner',
        data: Buffer.from(JSON.stringify(entry.show), 'utf8')
      }])
      await refusedFrom(entry, `${bundle}’s show.cuerunner entry`, () => readBundle(bundle))
      await refusedFrom(entry, path, () => compareWithFile(show() as unknown as Workspace, path))
      await refusedFrom(entry, path, () => openDemoWorkspace(path))

      expect(readFileSync(path).equals(before)).toBe(true)
      expect(statSync(path).mtimeMs).toBe(beforeStat.mtimeMs)
    }
  })
})
