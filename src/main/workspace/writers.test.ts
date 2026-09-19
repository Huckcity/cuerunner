// The writers of saved artifacts, held to their declaration.
//
// `writers.ts` names the six flows that write a saved artifact, and the demo that reads
// one, together with what each may do. This file is its teeth: every row is driven
// through the entry its row names, against a real filesystem with Electron stubbed, and
// the guard below scans this directory's sources for content-writing calls and fails on
// any call site no row claims — the "a new writer is a row before it is code" gate.
//
// Electron is stubbed with a temp `userData` the way `history.test.ts` stubs it, and the
// dialog answers Abandon and records what it was asked, so the prompts and options each
// flow shows are part of what is asserted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import ts from 'typescript'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { SAVED_ARTIFACT_WRITERS } from './writers'
import type { SavedArtifactWriterEntry, SavedArtifactWriterId } from './writers'
import type { AudioCue, Cue, WaitCue } from '../../shared/cue'
import type { MediaReference } from '../../shared/media'
import type { ShowHistoryEntry } from '../../shared/showfile'
import type { Workspace } from '../../shared/workspace'

/**
 * What the dialog was asked and what it answered. A save dialog answers where the test
 * says; an open dialog answers the next list of paths it is given; the message box
 * answers Abandon and records its options, so a flow's prompts and defaults are asserted
 * rather than left to the real window.
 */
const gates = vi.hoisted(() => ({
  prompts: [] as Array<{
    message?: string
    detail?: string
    buttons?: string[]
    defaultId?: number
    cancelId?: number
  }>,
  saveDialogs: [] as Array<{ title?: string; defaultPath?: string }>,
  openDialogs: [] as Array<{ title?: string; properties?: string[]; buttonLabel?: string }>,
  saveTarget: '',
  openTargets: [] as string[][],
  userData: ''
}))

vi.mock('electron', async () => {
  const { mkdtempSync } = await import('fs')
  const { tmpdir } = await import('os')
  const { join } = await import('path')
  gates.userData = mkdtempSync(join(tmpdir(), 'cuerunner-writers-userdata-'))
  return {
    app: { getPath: () => gates.userData, isPackaged: true },
    dialog: {
      showMessageBox: async (_win: unknown, options: (typeof gates)['prompts'][number]) => {
        gates.prompts.push(options)
        // Enter and Escape abandon: whatever is at the path stays, and the show unsaved.
        return { response: 1, checkboxChecked: false }
      },
      showSaveDialog: async (_win: unknown, options: (typeof gates)['saveDialogs'][number]) => {
        gates.saveDialogs.push(options)
        return { canceled: false, filePath: gates.saveTarget }
      },
      showOpenDialog: async (_win: unknown, options: (typeof gates)['openDialogs'][number]) => {
        gates.openDialogs.push(options)
        const filePaths = gates.openTargets.shift() ?? []
        return { canceled: filePaths.length === 0, filePaths }
      }
    },
    BrowserWindow: {}
  }
})

// Loaded after the mock above: each module under test must be the one that gets the
// stubbed electron, not a copy loaded before it — which is why these are `await import`
// rather than static imports.
const WorkspaceManager = await import('./WorkspaceManager')
const Bundle = await import('./bundle')
const Recovery = await import('./recovery')
const Demo = await import('./demo')
const Zip = await import('./zip')
const { app } = await import('electron')

const userData = app.getPath('userData')

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** The app's own defaults for a new audio cue (`cueDefaults.ts` AUDIO_DEFAULTS). */
function audioCue(id: string, number: string, name: string, filePath: string): AudioCue {
  return {
    type: 'audio',
    id,
    number,
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
    triggers: [],
    refire: 'ignore',
    filePath,
    startTime: 0,
    endTime: null,
    fadeInDuration: 0,
    volume: 1,
    pan: 0,
    outputs: null,
    loopCount: 0,
    playbackRate: 1,
    trim: 1,
    trimSilence: false
  }
}

function waitCue(id: string, number: string, name: string, duration = 1000): WaitCue {
  return {
    type: 'wait',
    id,
    number,
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
  }
}

/** An audio cue as a showfile stores one: the route pair is a disk shape, not a runtime field. */
function stored(cue: AudioCue, path: string, originalPath: string): AudioCue & { media: MediaReference } {
  return { ...cue, filePath: path, media: { path, originalPath } }
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

const HISTORY_ENTRY: ShowHistoryEntry = {
  at: '2026-02-01T00:00:00.000Z',
  by: 'associate',
  cues: [],
  settings: ['name']
}

/** A showfile read back as the test needs it: its cues' routes, and its history. */
interface StoredShow {
  cues: Array<{ id: string; filePath: string; media?: MediaReference }>
  history?: ShowHistoryEntry[]
}

function readStored(path: string): StoredShow {
  return JSON.parse(readFileSync(path, 'utf-8')) as StoredShow
}

let dir: string

beforeEach(() => {
  gates.prompts = []
  gates.saveDialogs = []
  gates.openDialogs = []
  gates.saveTarget = ''
  gates.openTargets = []
  rmSync(gates.userData, { recursive: true, force: true })
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-writers-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(gates.userData, { recursive: true, force: true })
})

// ─── The rows, each driven through its entry ──────────────────────────────────

/** The exported function each entry name resolves to; the drivers call these. */
const ENTRY_FUNCTIONS = {
  saveWorkspace: WorkspaceManager.saveWorkspace,
  saveWorkspaceAs: WorkspaceManager.saveWorkspaceAs,
  mergeIntoNewFile: WorkspaceManager.mergeIntoNewFile,
  exportBundle: Bundle.exportBundle,
  importBundle: Bundle.importBundle,
  writeRecovery: Recovery.writeRecovery,
  openDemoWorkspace: Demo.openDemoWorkspace
} as const satisfies Record<SavedArtifactWriterEntry, unknown>

function rowFor(id: SavedArtifactWriterId): (typeof SAVED_ARTIFACT_WRITERS)[number] {
  const row = SAVED_ARTIFACT_WRITERS.find(candidate => candidate.id === id)
  if (!row) throw new Error(`writers.ts declares no row "${id}"`)
  return row
}

/**
 * The real function the row names as its entry, resolved through the row: a row that
 * names a symbol this directory does not export fails here, and the driver then calls
 * exactly that symbol.
 */
function driver<T>(id: SavedArtifactWriterId): T {
  const row = rowFor(id)
  const entry = ENTRY_FUNCTIONS[row.entry]
  expect(typeof entry, `row "${id}" names "${row.entry}"`).toBe('function')
  return entry as T
}

describe('save', () => {
  it('save — writes the destination’s routes, appends one entry to a non-empty diff, and asks before replacing a changed file', async () => {
    const save = driver<typeof WorkspaceManager.saveWorkspace>('save')

    const folder = join(dir, 'Press Night')
    const inside = join(folder, 'media', 'walk-in.wav')
    const outside = join(dir, 'sting.wav')
    mkdirSync(dirname(inside), { recursive: true })
    writeFileSync(inside, 'RIFF....WAVE')
    writeFileSync(outside, 'RIFF....WAVE')

    const show = workspace(
      [
        audioCue('a1', '1', 'Walk-in', inside),
        audioCue('a2', '2', 'Sting', outside),
        waitCue('w1', '3', 'Count')
      ],
      { name: 'Press Night' }
    )
    const file = join(folder, 'Press Night.cuerunner')

    // A first save has no file to diff against, so the window's history (none) is carried.
    expect(await save({} as never, show, file)).toMatchObject({ path: file })
    const first = readStored(file)
    expect(first.history).toBeUndefined()
    // Every audio route is written against the destination folder: a file inside it goes
    // relative, a file outside it keeps its absolute path — never a `..` route.
    expect(first.cues[0].filePath).toBe(join('media', 'walk-in.wav'))
    expect(first.cues[0].media).toEqual({
      path: join('media', 'walk-in.wav'),
      originalPath: inside
    })
    expect(first.cues[1].filePath).toBe(outside)
    expect(first.cues[1].filePath.includes('..')).toBe(false)

    // A save that changed something appends one entry naming the change.
    const edited = {
      ...show,
      cues: show.cues.map(cue => (cue.id === 'a1' ? { ...cue, name: 'Walk-in Music' } : cue))
    }
    await save({} as never, edited, file)
    expect(readStored(file).history).toEqual([
      expect.objectContaining({
        cues: [{ kind: 'edited', id: 'a1', label: '1 Walk-in Music', fields: ['name'] }]
      })
    ])

    // A save that changed nothing carries the history and writes the same bytes back.
    const settled = readFileSync(file, 'utf-8')
    await save({} as never, edited, file)
    expect(readFileSync(file, 'utf-8')).toBe(settled)
    expect(readStored(file).history).toHaveLength(1)

    // A file that changed on disk is not replaced without the operator: the check asks,
    // and Abandon leaves the file alone.
    writeFileSync(file, `${settled} `)
    expect(await save({} as never, edited, file)).toBeNull()
    expect(gates.prompts).toHaveLength(1)
    expect(gates.prompts[0].buttons).toEqual(['Overwrite', 'Abandon'])
    expect(readFileSync(file, 'utf-8')).toBe(`${settled} `)
  })
})

describe('save as', () => {
  it('save-as — saves to the path the dialog names, carrying the window’s history to a fresh name and diffing against a taken one', async () => {
    const saveAs = driver<typeof WorkspaceManager.saveWorkspaceAs>('save-as')

    const target = join(dir, 'press', 'Hamlet.cuerunner')
    const media = join(dir, 'press', 'media', 'walk-in.wav')
    const outside = join(dir, 'sting.wav')
    mkdirSync(dirname(media), { recursive: true })
    writeFileSync(media, 'RIFF....WAVE')
    writeFileSync(outside, 'RIFF....WAVE')
    const show = workspace(
      [
        audioCue('a1', '1', 'Walk-in', media),
        audioCue('a2', '2', 'Sting', outside),
        waitCue('w1', '3', 'Count')
      ],
      { history: [HISTORY_ENTRY] }
    )

    // A fresh name has nothing to diff against, so the window's history is carried. The
    // bytes are written for the picked file's folder: the cue inside it goes relative,
    // the cue outside it keeps its absolute path.
    gates.saveTarget = target
    expect(await saveAs({} as never, show)).toMatchObject({ path: target })
    expect(gates.saveDialogs[0].title).toBe('Save Workspace')
    expect(gates.saveDialogs[0].defaultPath).toBe('Hamlet.cuerunner')
    const opened = readStored(target)
    expect(opened.history).toEqual([HISTORY_ENTRY])
    expect(opened.cues[0].filePath).toBe(join('media', 'walk-in.wav'))
    expect(opened.cues[1].filePath).toBe(outside)
    expect(opened.cues[1].filePath.includes('..')).toBe(false)

    // Save As onto a name that holds this show: the picked file is the base, and the
    // difference becomes one entry on top of the file's own history.
    const taken = join(dir, 'taken', 'Hamlet.cuerunner')
    mkdirSync(dirname(taken), { recursive: true })
    writeFileSync(
      taken,
      WorkspaceManager.serialiseWorkspace(
        workspace([audioCue('a2', '2', 'Sting', outside), waitCue('w1', '3', 'Count')], {
          history: [HISTORY_ENTRY]
        }),
        dirname(taken)
      )
    )
    gates.saveTarget = taken
    await saveAs({} as never, show)

    const replaced = readStored(taken)
    expect(replaced.history).toHaveLength(2)
    expect(replaced.history?.[0]).toEqual(HISTORY_ENTRY)
    expect(replaced.history?.[1].cues).toEqual([expect.objectContaining({ kind: 'added', id: 'a1' })])
  })
})

describe('merge', () => {
  it('merge — writes a new path from the two inputs, carrying ours’ history and appending nothing', async () => {
    const merge = driver<typeof WorkspaceManager.mergeIntoNewFile>('merge')

    const folder = join(dir, 'merge')
    mkdirSync(folder, { recursive: true })
    const ancestorPath = join(folder, 'Ancestor.cuerunner')
    const theirsPath = join(folder, 'Theirs.cuerunner')
    const oursPath = join(folder, 'Ours.cuerunner')

    const base = workspace([waitCue('w1', '1', 'Count')])
    const ours = workspace([waitCue('w1', '1', 'Count'), waitCue('m1', '2', 'Mine')], {
      history: [HISTORY_ENTRY]
    })
    const theirs = workspace([waitCue('w1', '1', 'Count'), waitCue('t1', '3', 'Theirs'), waitCue('o1', '4', 'Orphan')])
    // The orphan names a group that is not in the file: the load repairs it, and the
    // merge's report must say which input needed it.
    theirs.cues[2].parentId = 'gone'

    writeFileSync(ancestorPath, JSON.stringify(base, null, 2))
    writeFileSync(theirsPath, JSON.stringify(theirs, null, 2))
    writeFileSync(oursPath, JSON.stringify(ours, null, 2))
    const before = new Map(
      [ancestorPath, theirsPath, oursPath].map(path => [path, readFileSync(path)] as const)
    )

    const destination = join(folder, 'Hamlet (merged).cuerunner')
    gates.saveTarget = destination
    const merged = await merge({} as never, ours, oursPath, theirsPath, ancestorPath)

    expect(merged?.path).toBe(destination)
    // The destination is offered beside ours, named after the show, and the dialog is the
    // one the merge flow uses.
    expect(gates.saveDialogs[0].title).toBe('Save the Merged Show')
    expect(gates.saveDialogs[0].defaultPath).toBe(join(dirname(oursPath), 'Hamlet (merged).cuerunner'))

    // All three inputs are exactly as they were: a merge is safe to try twice.
    for (const input of [ancestorPath, theirsPath, oursPath]) {
      expect(readFileSync(input), input).toEqual(before.get(input))
    }

    // The merged document carries each side's cue and the repaired orphan.
    const written = readStored(destination)
    expect(written.cues.map(cue => cue.id).sort()).toEqual(['m1', 'o1', 't1', 'w1'])
    // Ours' history travels verbatim; the merge appends nothing.
    expect(written.history).toEqual([HISTORY_ENTRY])
    // The repair the input read made comes back as a note naming its file.
    expect(merged?.notes).toContainEqual({
      subject: '4 Orphan',
      detail: `its group is not in “${basename(theirsPath)}”: placed at the top level`,
      conflict: false
    })

    // With no path of ours the default name is the bare suggested one.
    mkdirSync(join(folder, 'linked'), { recursive: true })
    gates.saveTarget = join(folder, 'linked', 'Hamlet (merged).cuerunner')
    expect(await merge({} as never, ours, null, theirsPath, ancestorPath)).not.toBeNull()
    expect(gates.saveDialogs[1].defaultPath).toBe('Hamlet (merged).cuerunner')

    // Nothing refuses a destination that is one of the inputs: the dialog's pick stands.
    gates.saveTarget = oursPath
    expect((await merge({} as never, ours, oursPath, theirsPath, ancestorPath))?.path).toBe(oursPath)
    expect(readFileSync(oursPath)).not.toEqual(before.get(oursPath))
  })
})

describe('bundle export', () => {
  it('bundle-export — writes the show entry the serialiser produces for the document and the bundle’s folder', async () => {
    const exportBundle = driver<typeof Bundle.exportBundle>('bundle-export')

    const showDir = join(dir, 'Press Night')
    const musicDir = join(showDir, 'music')
    mkdirSync(musicDir, { recursive: true })
    const walkIn = join(musicDir, 'walk-in.wav')
    const bows = join(musicDir, 'bows.wav')
    const gone = join(musicDir, 'gone.wav')
    writeFileSync(walkIn, Buffer.alloc(2048, 3))
    writeFileSync(bows, Buffer.alloc(512, 9))

    const show = workspace(
      [
        audioCue('a1', '1', 'Walk-in', walkIn),
        audioCue('a2', '2', 'Bows', bows),
        // The same file as cue 1: one entry, however many cues play it.
        audioCue('a3', '3', 'Walk-in again', walkIn),
        audioCue('a4', '4', 'Interval', gone)
      ],
      { history: [HISTORY_ENTRY], name: 'Press Night' }
    )
    const showPath = join(showDir, 'Press Night.cuerunner')
    writeFileSync(showPath, JSON.stringify(show, null, 2))
    const onDisk = readFileSync(showPath)

    const bundlePath = join(dir, 'Press Night.cuerunnerx')
    gates.saveTarget = bundlePath
    const exported = await exportBundle({} as never, show, showPath)

    expect(exported).toMatchObject({ path: bundlePath, missing: [gone] })
    expect(gates.saveDialogs[0].defaultPath).toBe('Press Night.cuerunnerx')

    const bundle = await Bundle.readBundle(bundlePath)
    expect(bundle.media.map(entry => entry.name)).toEqual(['media/bows.wav', 'media/walk-in.wav'])

    // The show entry is the serialiser's output for the document as the bundle carries it
    // — each cue routed at its entry, with where the file came from recorded — and the
    // bundle's own folder.
    const expected = WorkspaceManager.serialiseWorkspace(
      {
        ...show,
        cues: [
          stored(show.cues[0] as AudioCue, 'media/walk-in.wav', walkIn),
          stored(show.cues[1] as AudioCue, 'media/bows.wav', bows),
          stored(show.cues[2] as AudioCue, 'media/walk-in.wav', walkIn),
          // The file the machine does not have is left out of the archive and keeps its
          // route in the show.
          show.cues[3]
        ]
      },
      dirname(bundlePath)
    )
    expect(bundle.show.toString('utf8')).toBe(expected)

    const written = JSON.parse(bundle.show.toString('utf8')) as StoredShow
    expect(written.cues[2].filePath).toBe('media/walk-in.wav')
    expect(written.cues[1].media).toEqual({ path: 'media/bows.wav', originalPath: bows })
    // Export is not a save: the show's history is carried as it stands.
    expect(written.history).toEqual([HISTORY_ENTRY])
    // The showfile on disk is untouched by an export.
    expect(readFileSync(showPath)).toEqual(onDisk)
  })
})

describe('bundle import', () => {
  it('bundle-import — writes the bundle’s show bytes verbatim, appending nothing, and unpacks its media', async () => {
    const importBundle = driver<typeof Bundle.importBundle>('bundle-import')

    const source = join(dir, 'source', 'walk-in.wav')
    mkdirSync(dirname(source), { recursive: true })
    const audio = Buffer.alloc(2048, 7)
    writeFileSync(source, audio)

    // A showfile as another machine wrote it, hand-written so the test can hold the
    // written file to these very bytes; its history is the exporting machine's.
    const showBytes = Buffer.from(
      JSON.stringify(
        workspace(
          [stored(audioCue('a1', '1', 'Walk-in', 'media/walk-in.wav'), 'media/walk-in.wav', '/someone-else/shows/walk-in.wav')],
          { history: [HISTORY_ENTRY], name: 'Press Night' }
        ),
        null,
        2
      ),
      'utf8'
    )
    const bundled = join(dir, 'handover', 'Press Night.cuerunnerx')
    mkdirSync(dirname(bundled), { recursive: true })
    await Zip.writeZip(bundled, [
      { name: 'show.cuerunner', data: showBytes },
      { name: 'media/walk-in.wav', file: source }
    ])

    const destination = join(dir, 'unpacked')
    mkdirSync(destination, { recursive: true })
    gates.openTargets = [[bundled], [destination]]
    const imported = await importBundle({} as never)

    expect(imported?.path).toBe(join(destination, 'Press Night.cuerunner'))
    // The exporting machine's bytes land exactly as they are: no serialiser runs, and
    // nothing is appended to the history they carry.
    expect(readFileSync(imported!.path)).toEqual(showBytes)
    expect(readStored(imported!.path).history).toEqual([HISTORY_ENTRY])
    // The media came out of the archive beside the show.
    expect(readFileSync(join(destination, 'media', 'walk-in.wav'))).toEqual(audio)
    // Two picks, in order: the bundle, then the folder — each asking for what it needs.
    expect(gates.openDialogs.map(dialog => dialog.title)).toEqual([
      'Open Bundle',
      'Where to unpack “Press Night”'
    ])
    expect(gates.openDialogs[0].properties).toEqual(['openFile'])
    expect(gates.openDialogs[1].properties).toEqual(['openDirectory', 'createDirectory'])
    expect(gates.openDialogs[1].buttonLabel).toBe('Unpack Here')
  })
})

describe('recovery', () => {
  it('recovery — writes the snapshot as a machine file under userData, never the saved shape', async () => {
    const writeRecovery = driver<typeof Recovery.writeRecovery>('recovery')

    const show = workspace([waitCue('w1', '1', 'Count')], { history: [HISTORY_ENTRY] })
    const fingerprint = { size: 42, hash: 'a'.repeat(64) }
    await writeRecovery(show, '/shows/Hamlet.cuerunner', 'w1', fingerprint)

    const path = join(userData, 'recovery.cuerunner')
    expect(existsSync(path)).toBe(true)
    const raw = readFileSync(path, 'utf-8')
    const snapshot = JSON.parse(raw) as {
      workspace: Workspace
      savedAt?: number
      sourcePath?: string | null
      selectedCueId?: string | null
      sourceFingerprint?: typeof fingerprint
      version?: unknown
      cues?: unknown
    }

    expect(Object.keys(snapshot)).toEqual([
      'workspace',
      'savedAt',
      'sourcePath',
      'selectedCueId',
      'sourceFingerprint'
    ])
    // The workspace's history is carried inside the snapshot; nothing is appended.
    expect(snapshot.workspace.history).toEqual([HISTORY_ENTRY])
    expect(snapshot.workspace.name).toBe('Hamlet')
    expect(snapshot.sourcePath).toBe('/shows/Hamlet.cuerunner')
    expect(snapshot.selectedCueId).toBe('w1')
    expect(snapshot.sourceFingerprint).toEqual(fingerprint)
    expect(typeof snapshot.savedAt).toBe('number')
    // The machine file is compact `JSON.stringify` of the snapshot object, not the
    // pretty-printed saved shape the serialiser writes.
    expect(JSON.stringify(snapshot)).toBe(raw)
    expect(snapshot.version).toBeUndefined()
    expect(snapshot.cues).toBeUndefined()

    // The snapshot goes through the same atomic write every save uses: a second write
    // leaves the previous snapshot beside it as `<name>.bak`.
    await writeRecovery(show, null, null)
    expect(readFileSync(`${path}.bak`, 'utf-8')).toBe(raw)
    expect(JSON.parse(readFileSync(path, 'utf-8')).sourcePath).toBeNull()
  })
})

describe('demo', () => {
  it('demo — opens a workspace from the shipped file and writes no showfile', async () => {
    const openDemoWorkspace = driver<typeof Demo.openDemoWorkspace>('demo')

    // `demoSourceDir` reads the packaged build's extra-resource folder; the dev branch
    // resolves against this source tree and is not drivable under vitest, so the packaged
    // branch is the one exercised here, with `process.resourcesPath` put back as it was.
    // Electron declares it read-only, so the assignment goes through its runtime shape.
    const runtimePaths = process as unknown as { resourcesPath?: string }
    const hadResourcesPath = Object.prototype.hasOwnProperty.call(process, 'resourcesPath')
    const shipped = runtimePaths.resourcesPath
    const resources = join(dir, 'resources')
    const demoDir = join(resources, 'demo')
    mkdirSync(demoDir, { recursive: true })
    const shippedShow = join(demoDir, 'Demo Show.cuerunner')
    const audio = Buffer.from('RIFF....WAVE')
    writeFileSync(join(demoDir, 'walk-in.wav'), audio)
    const loaded = workspace(
      [audioCue('a1', '1', 'Walk-in', 'walk-in.wav'), waitCue('o1', '2', 'Orphan')],
      { name: 'Demo Show' }
    )
    // A cue naming a group that is not in the file: the demo is a load path, and the
    // migration's repair has to run on the way in.
    loaded.cues[1].parentId = 'gone'
    writeFileSync(shippedShow, JSON.stringify(loaded, null, 2))
    const before = readFileSync(shippedShow)

    runtimePaths.resourcesPath = resources
    try {
      const demo = await openDemoWorkspace()
      expect(demo.name).toBe('Demo Show')
      // The dangling parent was repaired on the way in, and the cue points at the copy
      // under userData rather than at the shipped file.
      expect(demo.cues[1].parentId).toBeNull()
      const copy = (demo.cues[0] as AudioCue).filePath
      expect(copy).toBe(join(userData, 'demo', 'walk-in.wav'))
      expect(readFileSync(copy)).toEqual(audio)
    } finally {
      if (hadResourcesPath) runtimePaths.resourcesPath = shipped
      else delete runtimePaths.resourcesPath
    }

    // The demo folder holds the copied assets and nothing else: no showfile is written,
    // at the top level or beside the assets.
    expect(readdirSync(join(userData, 'demo')).sort()).toEqual(['walk-in.wav'])
    expect(readdirSync(userData).sort()).toEqual(['demo'])
    // The shipped file is untouched.
    expect(readFileSync(shippedShow)).toEqual(before)
    // `process.resourcesPath` is back exactly as it was found.
    expect(Object.prototype.hasOwnProperty.call(process, 'resourcesPath')).toBe(hadResourcesPath)
    if (hadResourcesPath) expect(runtimePaths.resourcesPath).toBe(shipped)
  })
})

// ─── The enumeration ──────────────────────────────────────────────────────────

describe('the enumeration', () => {
  it('names the six writers of a saved artifact and the demo that reads one, with each entry', () => {
    expect(SAVED_ARTIFACT_WRITERS.map(row => [row.id, row.title, row.entry])).toEqual([
      ['save', 'Save', 'saveWorkspace'],
      ['save-as', 'Save As', 'saveWorkspaceAs'],
      ['merge', 'Merge into a new file', 'mergeIntoNewFile'],
      ['bundle-export', 'Bundle export', 'exportBundle'],
      ['bundle-import', 'Bundle import', 'importBundle'],
      ['recovery', 'Recovery snapshot', 'writeRecovery'],
      ['demo', 'Demo workspace', 'openDemoWorkspace']
    ])
  })

  it('gives every row a base, a history behaviour and a normalisation behaviour', () => {
    for (const row of SAVED_ARTIFACT_WRITERS) {
      for (const [field, value] of [
        ['base', row.base],
        ['history', row.history],
        ['normalisation', row.normalisation]
      ] as const) {
        expect(value.trim().length, `${row.id}.${field}`).toBeGreaterThan(0)
      }
    }
  })

  it('pins every row’s write symbols', () => {
    expect(SAVED_ARTIFACT_WRITERS.map(row => [row.id, row.writes])).toEqual([
      ['save', ['saveWorkspace']],
      ['save-as', ['saveWorkspace']],
      ['merge', ['mergeIntoNewFile']],
      ['bundle-export', ['writeBundle']],
      ['bundle-import', ['unpackBundle', 'extractZipEntry']],
      ['recovery', ['writeRecovery']],
      ['demo', ['materialiseDemoAssets']]
    ])
  })

  /**
   * Whether every row's driver really ran is deliberately not asserted: a filtered run
   * (`vitest -t …`) legitimately drives a subset, so a runtime completeness check would
   * fail for a reason that is not a defect. What is asserted instead is everything a
   * change to a row must edit here: the pinned tables above, and that each `entry`
   * resolves, through the same map every driver uses, to a function this directory
   * exports — so a row that names a symbol nobody exports, or retargets an entry, fails
   * here rather than silently driving the wrong code.
   */
  it('resolves every entry, through the drivers’ own map, to a function this directory exports', () => {
    const entries = SAVED_ARTIFACT_WRITERS.map(row => row.entry)
    expect(new Set(entries).size).toBe(entries.length)
    for (const row of SAVED_ARTIFACT_WRITERS) {
      expect(typeof ENTRY_FUNCTIONS[row.entry], row.id).toBe('function')
    }
  })
})

// ─── The guard ────────────────────────────────────────────────────────────────

/** A source the guard reads: its name as the failure report writes it, and its text. */
interface Source {
  name: string
  text: string
}

/** One content-writing call: where it is, which mechanism, and whose code it is. */
interface Hit {
  file: string
  line: number
  primitive: string
  /** The top-level declaration the call sits in, or null when nothing encloses it. */
  owner: string | null
}

/** The calls that write a saved artifact by name. */
const ARTIFACT_PRIMITIVES = ['writeFileAtomically', 'writeZip', 'extractZipEntry']

/** The plain fs mechanisms that put content at a path, or at a descriptor `open` gave out. */
const FS_WRITES = [
  'writeFile',
  'writeFileSync',
  'appendFile',
  'appendFileSync',
  'copyFile',
  'copyFileSync',
  'cp',
  'cpSync',
  'createWriteStream',
  'writeSync',
  'writevSync'
]

/** The `open` spellings, watched by their mode argument. */
const OPENERS = ['open', 'openSync']

/** The only modes that are not a write: Node's two read modes, and only as literals. */
const READ_MODES: Record<string, true> = { r: true, rs: true }

const WATCHED: Record<string, true> = Object.fromEntries(
  [...ARTIFACT_PRIMITIVES, ...FS_WRITES, ...OPENERS].map(name => [name, true])
)

/** The direction a call site is attributed in: the symbols a row claims, and the exemptions. */
const CLAIMED_OWNERS = new Set(SAVED_ARTIFACT_WRITERS.flatMap(row => row.writes))

/**
 * Call sites whose bytes are not a saved artifact, each with its reason. An exemption is
 * not a hole in the guard: its keys are pinned below, and each one must own a discovered
 * call site. Mutations that put no artifact bytes at a path — `mkdir`, `rm`, `truncate`,
 * and renames of temporaries inside claimed or exempt owners — are outside the watch set
 * by design; a writer that assembles bytes elsewhere and moves them in, or bypasses every
 * watched mechanism, is outside this tripwire too.
 */
const NON_ARTIFACT_WRITES: Record<string, string> = {
  writeFileAtomically:
    'the shared atomic write itself: its own temp write and the <name>.bak copy, both '
    + 'turned into the atomic replace by the rename that follows them',
  writeRecent: 'the recent-files list, a convenience under userData rather than a saved artifact',
  writeEntries:
    'the zip codec’s byte writer, reached only through writeZip/extractZipEntry, both claimed'
}

/**
 * What the file binds its local names to, so an alias a call goes through is resolved
 * back to the mechanism it names — `put` for `copyFile as put`, `fs.promises.writeFile`
 * by its final property, `(await import('fs/promises')).writeFile` the same way. The
 * primitives' own definitions are never hits: the scan matches calls, and a definition
 * is a declaration — `writeFileAtomically`'s internals are covered by the exemption
 * above instead.
 */
interface Bindings {
  /** Local names that stand for a mechanism by another name: import aliases, destructured properties. */
  named: Map<string, string>
  /** Local names bound by `const x = <expression>`: local → the expression it stands for. */
  aliases: Map<string, ts.Expression>
}

function bindingsOf(file: ts.SourceFile): Bindings {
  const named = new Map<string, string>()
  const aliases = new Map<string, ts.Expression>()
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
      const bindings = node.importClause.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) {
            named.set(element.name.text, (element.propertyName ?? element.name).text)
          }
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      // `const { writeFile: put } = fsp` takes a mechanism under another name, exactly as
      // an import alias does; `const put = fs.copyFile` is followed as an expression.
      if (ts.isObjectBindingPattern(node.name)) {
        for (const element of node.name.elements) {
          if (!ts.isIdentifier(element.name)) continue
          const property = element.propertyName
          named.set(element.name.text, property && ts.isIdentifier(property) ? property.text : element.name.text)
        }
      } else if (ts.isIdentifier(node.name)) {
        aliases.set(node.name.text, node.initializer)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return { named, aliases }
}

/**
 * The mechanism a callee name stands for, or null when it names no mechanism at all. A
 * property chain is read by its final property — `fs.promises.writeFile` and
 * `codec.writeZip` are the calls their last name says — and an identifier is followed
 * through the file's bindings, so an alias of an alias still lands on the mechanism; a
 * binding that resolves to nothing watched keeps the identifier's own name, which is the
 * loud direction.
 */
function calleeName(expression: ts.Expression, bindings: Bindings, hops = 0): string | null {
  let node = expression
  while (ts.isParenthesizedExpression(node)) node = node.expression
  if (ts.isPropertyAccessExpression(node)) return node.name.text
  if (!ts.isIdentifier(node)) return null
  const renamed = bindings.named.get(node.text)
  if (renamed !== undefined) return renamed
  const bound = hops < 8 ? bindings.aliases.get(node.text) : undefined
  if (bound === undefined) return node.text
  return calleeName(bound, bindings, hops + 1) ?? node.text
}

/**
 * The mechanism a call goes through, or null when the call writes nothing. The `open`
 * spellings are read by their mode and fail closed: only the literal read modes are not
 * a write, because a write mode this list has not heard of — or a mode held in a
 * variable — is still a write.
 */
function watchedName(call: ts.CallExpression, bindings: Bindings): string | null {
  const name = calleeName(call.expression, bindings)
  if (name === null || WATCHED[name] !== true) return null
  if (OPENERS.includes(name)) {
    const mode = call.arguments[1]
    if (mode !== undefined && ts.isStringLiteral(mode) && READ_MODES[mode.text] === true) return null
  }
  return name
}

/** The name a top-level `function` or `const … = (…) =>` declaration introduces. */
function declaredName(node: ts.Node): string | null {
  if (ts.isFunctionDeclaration(node)) return node.name?.text ?? null
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.initializer !== undefined &&
    (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
  ) {
    return node.name.text
  }
  return null
}

/** Whether a declaration is a statement of the source file itself, not of a nested block. */
function isTopLevel(node: ts.Node): boolean {
  let current: ts.Node = node
  while (!ts.isSourceFile(current.parent)) {
    if (!ts.isVariableDeclarationList(current.parent) || !ts.isVariableStatement(current.parent.parent)) {
      return false
    }
    current = current.parent.parent
  }
  return true
}

/**
 * The top-level declaration a call is inside, or null when none encloses it. The outer
 * declaration wins, so a call nested inside another function still belongs to the flow
 * whose body it sits in; a call no top-level declaration encloses is unattributed and
 * fails the guard.
 */
function ownerOf(call: ts.CallExpression, file: ts.SourceFile): string | null {
  let outermost: ts.Node | null = null
  for (let node: ts.Node = call.parent; node !== file; node = node.parent) {
    if (declaredName(node) !== null) outermost = node
  }
  if (outermost === null || !isTopLevel(outermost)) return null
  return declaredName(outermost)
}

/** Every watched call in one source. Comments and strings are not calls, so they are not hits. */
function scanSource(source: Source): Hit[] {
  const file = ts.createSourceFile(source.name, source.text, ts.ScriptTarget.Latest, true)
  const bindings = bindingsOf(file)
  const hits: Hit[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const primitive = watchedName(node, bindings)
      if (primitive !== null) {
        hits.push({
          file: source.name,
          line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
          primitive,
          owner: ownerOf(node, file)
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return hits
}

/** What the guard found: every hit, and the unclaimed ones as failure lines. */
interface GuardResult {
  hits: Hit[]
  unclaimed: string[]
}

function guard(sources: readonly Source[]): GuardResult {
  const hits = sources.flatMap(scanSource)
  const unclaimed = hits
    .filter(
      hit =>
        hit.owner === null ||
        !(
          CLAIMED_OWNERS.has(hit.owner) ||
          Object.prototype.hasOwnProperty.call(NON_ARTIFACT_WRITES, hit.owner)
        )
    )
    .map(hit => `${hit.file}:${hit.line} ${hit.primitive} — ${hit.owner ?? 'unattributed'}`)
  return { hits, unclaimed }
}

/** This directory's non-test sources, which is the guard's whole world. */
function workspaceSources(): Source[] {
  const here = dirname(fileURLToPath(import.meta.url))
  return readdirSync(here)
    .filter(name => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name))
    .sort()
    .map(name => ({ name, text: readFileSync(join(here, name), 'utf-8') }))
}

/**
 * The (owner, mechanism) pairs this directory's sources hold today. The guard must keep
 * discovering each of them: the floor fails if the scan goes blind to a mechanism a flow
 * already writes through, while a new writer that is enumerated in a row is free to add
 * pairs above it.
 */
const DETECTION_FLOOR: ReadonlyArray<readonly [string, string]> = [
  ['saveWorkspace', 'writeFileAtomically'],
  ['mergeIntoNewFile', 'writeFileAtomically'],
  ['writeRecovery', 'writeFileAtomically'],
  ['writeRecent', 'writeFile'],
  ['writeFileAtomically', 'writeFile'],
  ['writeFileAtomically', 'copyFile'],
  ['writeBundle', 'writeZip'],
  ['unpackBundle', 'extractZipEntry'],
  ['unpackBundle', 'writeFile'],
  ['extractZipEntry', 'writeFile'],
  ['extractZipEntry', 'createWriteStream'],
  ['writeEntries', 'open'],
  ['materialiseDemoAssets', 'copyFile']
]

describe('the guard', () => {
  it('accounts for every content-writing call site in this directory’s sources', () => {
    const { unclaimed } = guard(workspaceSources())

    expect(unclaimed).toEqual([])
  })

  it('keeps discovering the call sites the detection floor pins', () => {
    const { hits } = guard(workspaceSources())
    const found = hits.map(hit => `${hit.owner} ${hit.primitive}`)

    for (const [owner, primitive] of DETECTION_FLOOR) {
      expect(found, `${owner} ${primitive}`).toContain(`${owner} ${primitive}`)
    }
  })

  it('exempts exactly the calls that are not saved artifacts, each one real', () => {
    expect(Object.keys(NON_ARTIFACT_WRITES).sort()).toEqual([
      'writeEntries',
      'writeFileAtomically',
      'writeRecent'
    ])
    for (const [owner, reason] of Object.entries(NON_ARTIFACT_WRITES)) {
      expect(reason.trim().length, owner).toBeGreaterThan(0)
    }
    // An exemption that owns nothing is a hole waiting to be widened: each one must own
    // at least one call site the scan really found.
    const { hits } = guard(workspaceSources())
    for (const owner of Object.keys(NON_ARTIFACT_WRITES)) {
      expect(hits.filter(hit => hit.owner === owner).length, owner).toBeGreaterThan(0)
    }
  })

  it('does not count a call named in a comment or a string', () => {
    const hits = scanSource({
      name: 'synthetic-words.ts',
      text: [
        '// writeFile(target, bytes)',
        'const note = "copyFile(from, to)"',
        'async function writer(): Promise<void> {',
        "  await writeFile(target, 'x')",
        '}'
      ].join('\n')
    })

    expect(hits.map(hit => [hit.line, hit.primitive, hit.owner])).toEqual([[4, 'writeFile', 'writer']])
  })

  it('attributes a nested call to the top-level declaration that encloses it', () => {
    const hits = scanSource({
      name: 'synthetic-nested.ts',
      text: [
        'async function outer(): Promise<void> {',
        '  const inner = async (): Promise<void> => {',
        "    await writeFile(target, 'x')",
        '  }',
        '  await inner()',
        '}'
      ].join('\n')
    })

    expect(hits.map(hit => [hit.primitive, hit.owner])).toEqual([['writeFile', 'outer']])
  })

  it('watches every mechanism, through every spelling an alias takes', () => {
    const hits = scanSource({
      name: 'synthetic-mechanisms.ts',
      text: [
        "import { writeFileAtomically } from './recovery'",
        "import { writeZip, extractZipEntry } from './zip'",
        "import * as fsp from 'fs/promises'",
        'import {',
        '  appendFile, appendFileSync, copyFile, copyFileSync, cp, cpSync,',
        '  createWriteStream, open, openSync, writeFile, writeFileSync, writeSync, writevSync',
        "} from 'fs/promises'",
        "import { copyFile as put, open as openFile } from 'fs'",
        "import fs from 'fs'",
        '',
        'const { writeFile: destructured } = fsp',
        'const dup = fs.copyFile',
        '',
        'async function everything(): Promise<void> {',
        "  await writeFileAtomically(target, 'x')",
        '  await writeZip(target, [])',
        '  await extractZipEntry(target, entry, into)',
        "  await writeFile(target, 'x')",
        "  writeFileSync(target, 'x')",
        "  await appendFile(target, 'x')",
        "  appendFileSync(target, 'x')",
        '  await copyFile(from, to)',
        '  copyFileSync(from, to)',
        '  await cp(from, to)',
        '  cpSync(from, to)',
        '  createWriteStream(target)',
        "  writeSync(fd, 'x')",
        "  writevSync(fd, ['x'])",
        "  await open(target, 'w')",
        "  openSync(target, 'a')",
        '  await put(from, to)',
        "  await openFile(target, 'a')",
        "  await fsp.writeFile(target, 'x')",
        "  await fs.promises.writeFile(target, 'x')",
        "  await (await import('fs/promises')).writeFile(target, 'x')",
        "  await destructured(target, 'x')",
        '  await dup(from, to)',
        '}'
      ].join('\n')
    })

    expect(hits.map(hit => hit.primitive).sort()).toEqual([
      'appendFile',
      'appendFileSync',
      'copyFile',
      'copyFile',
      'copyFile',
      'copyFileSync',
      'cp',
      'cpSync',
      'createWriteStream',
      'extractZipEntry',
      'open',
      'open',
      'openSync',
      'writeFile',
      'writeFile',
      'writeFile',
      'writeFile',
      'writeFile',
      'writeFileAtomically',
      'writeFileSync',
      'writeSync',
      'writeZip',
      'writevSync'
    ])
    expect([...new Set(hits.map(hit => hit.owner))]).toEqual(['everything'])
  })

  it('reads the `open` spellings by their mode, and fails closed on every other mode', () => {
    const hits = scanSource({
      name: 'synthetic-open.ts',
      text: [
        "import { open, openSync } from 'fs/promises'",
        'async function writing(): Promise<void> {',
        "  await open(target, 'w')",
        '}',
        'async function reading(): Promise<void> {',
        "  await open(target, 'r')",
        '}',
        'async function syncReading(): Promise<void> {',
        "  openSync(target, 'rs')",
        '}',
        'async function appending(): Promise<void> {',
        "  await open(target, 'as')",
        "  openSync(target, 'as+')",
        '}',
        'async function variableMode(mode: string): Promise<void> {',
        '  await open(target, mode)',
        '}',
        'async function defaulted(): Promise<void> {',
        '  await open(target)',
        '}'
      ].join('\n')
    })

    expect(hits.map(hit => [hit.line, hit.primitive, hit.owner])).toEqual([
      [3, 'open', 'writing'],
      [12, 'open', 'appending'],
      [13, 'openSync', 'appending'],
      [16, 'open', 'variableMode'],
      [19, 'open', 'defaulted']
    ])
  })

  it('reports a call no top-level declaration encloses as unattributed and fails it', () => {
    const { unclaimed } = guard([{ name: 'synthetic-top.ts', text: "const pending = writeFile(target, 'x')" }])

    expect(unclaimed).toEqual(['synthetic-top.ts:1 writeFile — unattributed'])
  })

  it('names the call site, the mechanism and its owner in its failure report', () => {
    const rogue = {
      name: 'synthetic-rogue.ts',
      text: ['async function rogueWriter(): Promise<void> {', '  await copyFile(from, to)', '}'].join('\n')
    }

    expect(guard([rogue]).unclaimed).toEqual(['synthetic-rogue.ts:2 copyFile — rogueWriter'])
    // A call whose owner a row claims, or the test exempts, is not a failure.
    expect(
      guard([
        {
          name: 'synthetic-claimed.ts',
          text: 'async function saveWorkspace(): Promise<void> {\n  await writeFile(target, "x")\n}'
        },
        {
          name: 'synthetic-exempt.ts',
          text: 'async function writeRecent(): Promise<void> {\n  await writeFile(target, "x")\n}'
        }
      ]).unclaimed
    ).toEqual([])
  })})
