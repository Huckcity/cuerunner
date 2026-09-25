// A save replaces the file at the path it is handed, and the operator is the only one who
// can say whether that file is still the one this session was built from. Main holds the
// answer: the size and hash of the bytes it last read from or wrote to the path, taken
// where a session was established over the file and checked against the disk before every
// save. What these tests drive is when the question is asked at all — and, just as much,
// what must never be able to answer it: the mtime, a read that only reports on a file, or
// a name this app has never seen.
//
// Electron is stubbed with a real temporary directory, the filesystem is real, and the
// prompt is recorded rather than shown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, truncateSync, utimesSync, writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, sep } from 'path'

/** What the save's prompt was asked, and what the operator answered: 0 overwrites, 1 abandons. */
const gates = vi.hoisted(() => ({
  prompts: [] as Array<{
    message?: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }>,
  answer: 1,
  /** Where a Save As is told to put the file. */
  saveTarget: '',
  /** The user-data directory the stubbed app reads and writes, removed after every test. */
  userData: ''
}))

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  gates.userData = mkdtempSync(join(tmpdir(), 'cuerunner-saveguard-userdata-'))
  return {
    app: { getPath: () => gates.userData },
    dialog: {
      showMessageBox: async (_win: unknown, options: (typeof gates)['prompts'][number]) => {
        gates.prompts.push(options)
        return { response: gates.answer, checkboxChecked: false }
      },
      showSaveDialog: async () => ({ canceled: false, filePath: gates.saveTarget })
    },
    BrowserWindow: {}
  }
})

const {
  compareWithFile,
  knownFingerprint,
  mergeIntoNewFile,
  openRecovery,
  openWorkspaceFromPath,
  rememberFile,
  saveWorkspace,
  saveWorkspaceAs
} = await import('./WorkspaceManager')
const { clearRecovery, writeRecovery } = await import('./recovery')
const { readBundle, unpackBundle, writeBundle } = await import('./bundle')
// Loaded after the mock above: the module under test must be the one that gets the
// stubbed electron, not a copy loaded before it.
import type { Cue, WaitCue } from '../../shared/cue'
import type { Workspace } from '../../shared/workspace'

function waitCue(id: string, name: string, duration = 1000): Cue {
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

/** A showfile as it would be on disk, for a test that writes one behind the app's back. */
function showFile(cues: Cue[], over: Partial<Workspace> = {}): string {
  return JSON.stringify(workspace(cues, over), null, 2)
}

let dir: string
let file: string

beforeEach(async () => {
  gates.prompts = []
  gates.answer = 1
  gates.saveTarget = ''
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-saveguard-'))
  file = join(dir, 'Hamlet.cuerunner')
  await clearRecovery()
})

afterEach(() => {
  chmodSync(dir, 0o700)
  rmSync(dir, { recursive: true, force: true })
  rmSync(gates.userData, { recursive: true, force: true })
})

describe('a save against the file it is about to replace', () => {
  it('writes a file this session just read, and asks nothing', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    expect(await saveWorkspace({} as never, opened, file)).toMatchObject({ path: file })

    expect(gates.prompts).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf-8')).cues).toHaveLength(1)
  })

  it('offers Overwrite or Abandon when the file changed on disk, and Abandon writes nothing', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // Somebody else's save, while this session holds the show.
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()

    expect(gates.prompts).toHaveLength(1)
    // The prompt names the file, so an operator holding two shows knows which one is
    // about to be replaced, and asks the two questions the save can act on.
    expect(gates.prompts[0].message).toContain('Hamlet.cuerunner')
    expect(gates.prompts[0].buttons).toEqual(['Overwrite', 'Abandon'])
    // Enter and Escape are the Abandon answer: a keypress that was not meant for this
    // dialog leaves the file alone rather than replacing what is at it.
    expect(gates.prompts[0].defaultId).toBe(1)
    expect(gates.prompts[0].cancelId).toBe(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })

  it('Overwrite replaces the file with this show, and the save after it asks nothing', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    writeFileSync(file, showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')]))
    gates.answer = 0

    const mine = { ...opened, cues: [waitCue('w', 'Bows'), waitCue('m', 'Mine')] }
    expect(await saveWorkspace({} as never, mine, file)).toMatchObject({ path: file })

    expect(gates.prompts).toHaveLength(1)
    const written = JSON.parse(readFileSync(file, 'utf-8')) as { cues: Array<{ name: string }> }
    expect(written.cues.map(cue => cue.name)).toEqual(['Bows', 'Mine'])

    // The bytes this save put there are the baseline from then on.
    gates.prompts = []
    expect(await saveWorkspace({} as never, mine, file)).toMatchObject({ path: file })
    expect(gates.prompts).toEqual([])
  })

  it('settles two files of the same length by the bytes', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows', 1000)]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // A one-digit edit: the size can say nothing here, which is what the read is for.
    const before = readFileSync(file, 'utf-8')
    const theirs = before.replace('"duration": 1000', '"duration": 2000')
    expect(theirs).not.toBe(before)
    expect(theirs.length).toBe(before.length)
    writeFileSync(file, theirs)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()

    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })

  it('recognises the file through another spelling of its path', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    // The same file, spelled the way a dialog, a recent list or a share can hand it over.
    // The check is not something a spelling difference in the path can walk around: it
    // would replace the very file it exists to ask about.
    const respelled = `${dir}${sep}.${sep}Hamlet.cuerunner`
    expect(respelled).not.toBe(file)

    expect(await saveWorkspace({} as never, opened, respelled)).toBeNull()

    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })

  it('does not consult the modification time', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // A share with a coarse clock, or a copy that arrived preserving its timestamps: the
    // file is not the one this session read, and nothing about it says which of the two is
    // newer. The bytes are the same, so there is nothing to ask.
    utimesSync(file, new Date('2020-01-01T00:00:00.000Z'), new Date('2020-01-01T00:00:00.000Z'))
    expect(statSync(file).mtimeMs).toBe(new Date('2020-01-01T00:00:00.000Z').getTime())

    expect(await saveWorkspace({} as never, opened, file)).toMatchObject({ path: file })

    expect(gates.prompts).toEqual([])
  })

  it('asks about a file that is gone, and Overwrite puts it back', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    rmSync(file)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(existsSync(file)).toBe(false)

    gates.answer = 0
    expect(await saveWorkspace({} as never, opened, file)).toMatchObject({ path: file })
    expect(gates.prompts).toHaveLength(2)
    expect(JSON.parse(readFileSync(file, 'utf-8')).cues).toHaveLength(1)
  })

  it('asks about a file past the ceiling', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // A sparse file over the ceiling this app reads: it is answered for like any other
    // file that is not the one the session was built from, and never silently replaced.
    writeFileSync(file, '')
    truncateSync(file, 64 * 1024 * 1024 + 1)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()

    expect(gates.prompts).toHaveLength(1)
    expect(statSync(file).size).toBe(64 * 1024 * 1024 + 1)
  })

  it('asks about a file past the ceiling when the sizes match', async () => {
    // The one way an over-ceiling size can meet a recorded one: the save that recorded it
    // wrote bytes that large. Nothing about the pair is readable, so the ceiling is what
    // decides it — the body is never read to answer.
    writeFileSync(file, '')
    truncateSync(file, 64 * 1024 * 1024 + 1)
    rememberFile(file, Buffer.alloc(64 * 1024 * 1024 + 1))

    expect(await saveWorkspace({} as never, workspace([waitCue('w', 'Bows')]), file)).toBeNull()

    expect(gates.prompts).toHaveLength(1)
  })

  // A file made unreadable by its mode: POSIX only, and the two cases that produce the
  // state without a mode are here for every platform (a file gone, a file past the ceiling).
  it.skipIf(process.platform === 'win32')('asks about a file it cannot read', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // Unverifiable rather than changed: the size still matches, and the read that would
    // settle it cannot be made. A file this app cannot answer for is not one it replaces
    // without being told to.
    chmodSync(file, 0o000)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()

    expect(gates.prompts).toHaveLength(1)

    chmodSync(file, 0o600)
    expect(readFileSync(file, 'utf-8')).toBe(showFile([waitCue('w', 'Bows')]))
  })

  it('asks nothing about a name this session has no identity for', async () => {
    const mine = workspace([waitCue('w', 'Bows')], { id: 'w2', name: 'Macbeth' })

    // A fresh name: the OS dialog was the choice, and the choice stands.
    const fresh = join(dir, 'Macbeth.cuerunner')
    gates.saveTarget = fresh
    expect(await saveWorkspaceAs({} as never, mine)).toMatchObject({ path: fresh })
    expect(gates.prompts).toEqual([])

    // A name that is taken: the file there is another show, and replacing it is what
    // naming it in the save dialog asked for.
    const taken = join(dir, 'Taken.cuerunner')
    writeFileSync(taken, showFile([waitCue('z', 'Theirs')]))
    gates.saveTarget = taken
    expect(await saveWorkspaceAs({} as never, mine)).toMatchObject({ path: taken })
    expect(gates.prompts).toEqual([])
    expect(JSON.parse(readFileSync(taken, 'utf-8')).id).toBe('w2')
  })

  it('does not let a comparison become the baseline', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    // A comparison reads the file to report on it. The session's own file has not
    // changed, and the save that follows still has to say so.
    await compareWithFile(opened, file)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })

  it('does not let a merge become the baseline', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    // The merge reads the file the other person saved — the same path here, which is the
    // case that matters: an input read leaves this session's baseline alone.
    const ancestor = join(dir, 'Ancestor.cuerunner')
    writeFileSync(ancestor, showFile([waitCue('w', 'Bows')]))
    gates.saveTarget = join(dir, 'Merged.cuerunner')
    await mergeIntoNewFile({} as never, opened, file, file, ancestor)

    expect(await saveWorkspace({} as never, opened, file)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })

  // A file made unreadable by its mode: POSIX only, and the two cases that produce the
  // state without a mode are here for every platform (a file gone, a file past the ceiling).
  it.skipIf(process.platform === 'win32')('does not let the save’s own history pass become the baseline', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    // The save reads the file for its history after the check, and then cannot write it:
    // the folder will not take the temporary file. A read that only reports on a file must
    // leave the identity where it was, or the next save would call a file it never wrote
    // unchanged.
    gates.answer = 0
    chmodSync(dir, 0o500)
    await expect(saveWorkspace({} as never, opened, file)).rejects.toThrow()
    chmodSync(dir, 0o700)

    gates.prompts = []
    gates.answer = 1
    expect(await saveWorkspace({} as never, opened, file)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })
})

describe('a session that came back to a file', () => {
  it('reports a file that changed while the app was dead', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)

    // Autosave records the fingerprint main already holds — this is the call the handler
    // makes — and then the session dies.
    await writeRecovery(opened, file, null, knownFingerprint(file))

    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    const recovered = await openRecovery()
    expect(recovered?.workspace.cues).toHaveLength(1)

    expect(await saveWorkspace({} as never, recovered!.workspace, file)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(file, 'utf-8')).toBe(theirs)
  })

  it('records the file as it is at recovery when the snapshot carries no fingerprint', async () => {
    writeFileSync(file, showFile([waitCue('w', 'Bows')]))
    const { workspace: opened } = await openWorkspaceFromPath(file)
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(file, theirs)

    // A snapshot from a build that recorded no fingerprint: the session comes back to the
    // file as it is, so its own save is not a report of a change nobody can attribute.
    await writeRecovery(opened, file)

    const recovered = await openRecovery()

    expect(await saveWorkspace({} as never, recovered!.workspace, file)).toMatchObject({ path: file })
    expect(gates.prompts).toEqual([])
  })

  it('takes no identity from a file past the ceiling', async () => {
    const huge = join(dir, 'Huge.cuerunner')
    writeFileSync(huge, '')
    truncateSync(huge, 64 * 1024 * 1024 + 1)

    // A snapshot from a build that recorded no fingerprint, naming a file over the ceiling
    // this app reads: the session comes back, and the identity cannot be taken from a body
    // the app will not read. So what is at that path is not something the session ever saw
    // — the next save replaces nothing it has a record of, exactly as for a name this app
    // has never read at all.
    await writeRecovery(workspace([waitCue('w', 'Bows')]), huge)
    const recovered = await openRecovery()

    writeFileSync(huge, showFile([waitCue('w', 'Bows')]))
    expect(await saveWorkspace({} as never, recovered!.workspace, huge)).toMatchObject({ path: huge })
    expect(gates.prompts).toEqual([])
  })

  it('checks the showfile an import wrote', async () => {
    const bundled = join(dir, 'Hamlet.cuerunnerx')
    await writeBundle(workspace([waitCue('w', 'Bows')]), null, bundled)
    const unpacked = await unpackBundle(bundled, join(dir, 'handover'), await readBundle(bundled))

    // The import wrote the showfile and never read it back; the identity comes from the
    // bytes it wrote, so somebody editing the unpacked show is reported by the next save.
    const theirs = showFile([waitCue('w', 'Bows'), waitCue('x', 'Their Encore')])
    writeFileSync(unpacked.path, theirs)

    expect(await saveWorkspace({} as never, unpacked.workspace, unpacked.path)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(readFileSync(unpacked.path, 'utf-8')).toBe(theirs)
  })
})
