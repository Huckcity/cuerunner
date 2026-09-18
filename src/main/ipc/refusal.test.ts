// The pin under the refusal discipline: a refusal is an answer, and only a fault rejects.
//
// The regime is decided per channel and written where the channel is declared, so the one
// place that can hold it true is the registered handler: the real `registerIpcHandlers()`
// runs against a mocked `ipcMain` (the electron model `parity.test.ts` also uses), and the
// registered functions are called the way Electron calls them. Three cases:
//
//   - an audio verb whose engine call rejects resolves the `{ ok, code, message }` envelope
//     and never rejects (the regime the audio verbs already had, pinned so it cannot drift);
//   - a workspace or script channel's ordinary state — a show this build cannot draw, an
//     oversize file, a snapshot it cannot read, a missing include — resolves the declared
//     `{ ok: false, error }` arm;
//   - anything else rejects, because a fault is not an answer a caller can be handed.
//
// What each sentence says is pinned where it is written: the message assertions here are
// the ones that would change an operator's notice, and the archive and bundle refusals are
// pinned beside their modules.

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { rmSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dialog } from 'electron'
import { AUDIO_CHANNELS } from '../../shared/audio'
import { SCRIPT_CHANNELS } from '../../shared/ipc/script'
import { WORKSPACE_CHANNELS } from '../../shared/ipc/workspace'
import type { Workspace } from '../../shared/workspace'
import { registerIpcHandlers } from './handlers'

/** The 64 MiB ceiling `readWorkspaceFile` applies, written as the test's own number. */
const OVERSIZE_BYTES = 64 * 1024 * 1024 + 1

/**
 * What the mocked ends recorded. `vi.hoisted` because the electron factory below is
 * hoisted above these imports and has to close over the same recorders the test reads.
 */
const ends = vi.hoisted(() => {
  /** The channels main registered, as the real `ipcMain` holds them. */
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  /** Every app event main registered, so the quit's teardown can be replayed at the end. */
  const appOn: Array<{ event: string; listener: () => unknown }> = []
  /** Where `app.getPath('userData')` points; the factory fills it in. */
  const userData = { path: '' }
  return { handlers, appOn, userData }
})

/**
 * The Pro gate, held open for the one channel here that sits behind it. The gate itself is
 * not what this file pins (the licence suite covers it); the flag starts false so
 * registration starts the free services exactly as a launch does, and the import test is
 * what flips it.
 */
const licenseGate = vi.hoisted(() => ({ pro: false }))

vi.mock('../../shared/license', async importOriginal => ({
  ...(await importOriginal()) as Record<string, unknown>,
  isPro: () => licenseGate.pro
}))

// The factory is hoisted above this file's imports, so it cannot use them: node's own
// modules are pulled in here rather than imported statically, which is the only way the
// temporary directory and the recorder can exist before `handlers.ts` asks for electron.
vi.mock('electron', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  // A real directory: the workspace channels write the recent list and read the recovery
  // snapshot the way they do at launch, and a test that stubbed those would be pinning
  // the mock rather than the handler.
  ends.userData.path = mkdtempSync(join(tmpdir(), 'cuerunner-refusal-'))
  return {
    app: {
      getPath: () => ends.userData.path,
      isPackaged: false,
      on: (event: string, listener: () => unknown) => {
        ends.appOn.push({ event, listener })
      }
    },
    ipcMain: {
      handle: (channel: string, handler: unknown) => {
        ends.handlers.set(channel, handler as (...args: unknown[]) => unknown)
      },
      removeHandler: (channel: string) => ends.handlers.delete(channel)
    },
    // The dialogs are the handlers' one door to the operator's choices; a test that wants
    // a fault makes one of them fail. Nothing here is called unless a test says so.
    dialog: {
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
      showMessageBox: vi.fn()
    },
    net: { fetch: () => Promise.resolve(undefined) },
    BrowserWindow: { getAllWindows: () => [], fromWebContents: () => null }
  }
})

/** One registered handler, as Electron would call it. */
function handler(channel: string): (...args: unknown[]) => unknown {
  const registered = ends.handlers.get(channel)
  if (registered === undefined) throw new Error(`no handler registered for ${channel}`)
  return registered
}

/** A workspace file, with the cues the test wants it to hold. */
function writeShow(name: string, cues: Array<Record<string, unknown>>): string {
  const file = join(ends.userData.path, name)
  writeFileSync(file, JSON.stringify({
    version: 1,
    id: 'w1',
    name: 'Show',
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues
  }))
  return file
}

/** The show as the window sends it: what `workspace:merge`/`compare` take as a payload. */
function showPayload(name: string): Workspace {
  return {
    version: 1,
    id: 'w1',
    name,
    createdAt: '2026-01-01T00:00:00.000Z',
    audioSettings: { outputDeviceId: 'default' },
    midiSettings: { outputPortName: '' },
    cues: []
  }
}

beforeEach(() => {
  // Every test that opens a dialog says what it answers; one that leaves a queued answer
  // behind must not be able to decide the next test's dialog.
  vi.mocked(dialog.showOpenDialog).mockReset()
})

beforeAll(() => {
  registerIpcHandlers()
})

afterAll(async () => {
  // Registration opens the free show services the way a launch does, and a quit closes
  // them. `show.close()` is async and the real `app.on` discards its promise, so the
  // replay awaits each listener — that is what "no socket behind" actually waits on —
  // before the directory is removed.
  for (const { listener } of ends.appOn) await listener()
  rmSync(ends.userData.path, { recursive: true, force: true })
})

describe('a refusal is a value', () => {
  it('answers an audio verb whose engine call rejects with the envelope, never a rejection', async () => {
    // No engine is running in this process, which is one of the states the envelope exists
    // for: the clock is read while the engine is being restarted, and a rejected handler
    // would put a stack in main's log for it.
    const result = await handler(AUDIO_CHANNELS.clock)()

    expect(result).toMatchObject({ ok: false, code: 'engine' })
    expect((result as { message: string }).message).toMatch(/audio engine/)
  })

  it('answers a show this build cannot draw with its refusal arm', async () => {
    const file = writeShow('newer.cuerunner', [{ id: 'v1', type: 'hologram', name: 'Effect' }])

    const result = await handler(WORKSPACE_CHANNELS.openPath)('event', file) as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    // The sentence the throw carried, word for word: the window's notice must not change.
    expect(result.error).toBe(
      'that show has a cue this version of WinsLab does not know (hologram)' +
      ' — it was probably saved by a newer version'
    )
  })

  it('answers an oversize file with its refusal arm', async () => {
    const file = join(ends.userData.path, 'huge.cuerunner')
    writeFileSync(file, '')
    truncateSync(file, OVERSIZE_BYTES)

    const result = await handler(WORKSPACE_CHANNELS.openPath)('event', file)

    expect(result).toMatchObject({ ok: false, error: 'that workspace file is larger than this app will open' })
  })

  it('answers an oversize file chosen through the dialog with its refusal arm', async () => {
    // File→Open is the path most shows arrive by, so the dialog route refuses too.
    const file = join(ends.userData.path, 'huge-open.cuerunner')
    writeFileSync(file, '')
    truncateSync(file, OVERSIZE_BYTES)
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [file] })

    const result = await handler(WORKSPACE_CHANNELS.open)('event')

    expect(result).toMatchObject({ ok: false, error: 'that workspace file is larger than this app will open' })
  })

  it('answers a cancelled dialog as the null inside the success arm', async () => {
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] })

    await expect(handler(WORKSPACE_CHANNELS.open)('event')).resolves.toEqual({ ok: true, opened: null })
  })

  it('answers a snapshot it cannot read with its refusal arm', async () => {
    // The snapshot is a file like any other, and a session that died on a newer build
    // leaves one this build cannot bring forward.
    writeFileSync(join(ends.userData.path, 'recovery.cuerunner'), JSON.stringify({
      workspace: {
        version: 1,
        id: 'w1',
        name: 'Show',
        createdAt: '2026-01-01T00:00:00.000Z',
        audioSettings: { outputDeviceId: 'default' },
        midiSettings: { outputPortName: '' },
        cues: [{ id: 'v1', type: 'hologram', name: 'Effect' }]
      },
      savedAt: Date.now(),
      sourcePath: null
    }))

    const result = await handler(WORKSPACE_CHANNELS.recovery)() as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    expect(result.error).toContain('does not know (hologram)')
  })

  it('answers a missing include with its refusal arm, and leaves the sentence alone', async () => {
    const missing = join(ends.userData.path, 'not-there.js')

    const result = await handler(SCRIPT_CHANNELS.readFile)('event', {
      relativePath: missing,
      workspacePath: null
    }) as { ok: boolean; error?: string }

    expect(result.ok).toBe(false)
    // What the script's rpcError shows: the fs error's own sentence, which is what the
    // rejection carried before — only the transport stopped attaching a stack to it.
    expect(result.error).toContain('ENOENT')
    expect(result.error).toContain(missing)
  })

  it('answers a file that is not a bundle with its refusal arm, not a rejection', async () => {
    // The import channels are Pro-gated; the gate is not this file's subject, so it is
    // let through and the archive's own refusal — a file that is not a zip — is what must
    // come back, as the value the union declares.
    const notABundle = join(ends.userData.path, 'notes.cuerunnerx')
    writeFileSync(notABundle, 'this is not an archive')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [notABundle] })
    licenseGate.pro = true
    try {
      const result = await handler(WORKSPACE_CHANNELS.importBundle)('event') as { ok: boolean; error?: string }

      expect(result.ok).toBe(false)
      expect(result.error).toBe('that file is not a zip archive')
    } finally {
      licenseGate.pro = false
    }
  })

  it('keeps the success arm unchanged', async () => {
    const file = writeShow('plain.cuerunner', [])

    const result = await handler(WORKSPACE_CHANNELS.openPath)('event', file) as {
      ok: boolean
      opened?: { path: string; workspace: { name: string }; missingMedia: unknown[] }
    }

    expect(result.ok).toBe(true)
    expect(result.opened).toMatchObject({ path: file, workspace: { name: 'Show' }, missingMedia: [] })
  })
})

describe('the Pro channels refuse through the dialogs too', () => {
  it('answers a merge whose other side this build cannot draw', async () => {
    // Two dialogs — the other person's copy, then the version both sides started from —
    // and the refusal comes from reading the first of them.
    const theirs = writeShow('theirs.cuerunner', [{ id: 'v1', type: 'hologram', name: 'Effect' }])
    const ancestor = writeShow('ancestor.cuerunner', [])
    vi.mocked(dialog.showOpenDialog)
      .mockResolvedValueOnce({ canceled: false, filePaths: [theirs] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [ancestor] })
    licenseGate.pro = true
    try {
      const result = await handler(WORKSPACE_CHANNELS.merge)('event', {
        workspace: showPayload('Show'),
        workspacePath: null
      }) as { ok: boolean; error?: string }

      expect(result.ok).toBe(false)
      expect(result.error).toContain('does not know (hologram)')
    } finally {
      licenseGate.pro = false
    }
  })

  it('answers a comparison against a file this build cannot draw', async () => {
    const other = writeShow('compare-other.cuerunner', [{ id: 'v1', type: 'hologram', name: 'Effect' }])
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [other] })
    licenseGate.pro = true
    try {
      const result = await handler(WORKSPACE_CHANNELS.compare)('event', showPayload('Show')) as {
        ok: boolean
        error?: string
      }

      expect(result.ok).toBe(false)
      expect(result.error).toContain('does not know (hologram)')
    } finally {
      licenseGate.pro = false
    }
  })
})

describe('only a fault rejects', () => {
  it('lets an unexpected failure through as a rejection', async () => {
    vi.mocked(dialog.showOpenDialog).mockRejectedValueOnce(new Error('the dialog itself failed'))

    await expect(handler(WORKSPACE_CHANNELS.open)('event')).rejects.toThrow('the dialog itself failed')
  })

  it('lets a script read fail for a reason that is not the file', async () => {
    // `path` throws on a non-string before any file is touched: a bug at the boundary,
    // which must not be dressed up as an answer for the operator.
    await expect(handler(SCRIPT_CHANNELS.readFile)('event', {
      relativePath: undefined,
      workspacePath: null
    })).rejects.toThrow()
  })
})
