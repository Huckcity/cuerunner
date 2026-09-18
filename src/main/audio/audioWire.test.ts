/**
 * The wire declaration, held against the engine that has to honour it.
 *
 * The native engine cannot import src/shared, so it carries the same tables as data and
 * prints them for `--protocol`; this file is the comparison. A verb, event or field
 * edited at either end alone fails here — and so does a bound's name, value or regime,
 * which the same JSON carries beside them. That is this file's whole job.
 *
 * The engine is resolved the way the client resolves it and built through the same
 * idempotent check every command runs (`scripts/ensure-native.mjs`), so a source edited
 * after the last build is compared against itself rather than against a stale binary.
 */
import { execFileSync, spawn } from 'node:child_process'
import type * as ChildProcessModule from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AUDIO_LIMITS, AUDIO_PROTOCOL_VERSION, AUDIO_WIRE } from '../../shared/audio'
import type { AudioEngineEvent } from '../../shared/audio'
import { drainMainErrors } from '../errors'
import { AudioEngineError, NativeAudioEngine } from './AudioEngine'

// The client spawns its engine through node:child_process. The one test that has to
// connect to something which never declares itself keeps every real function and replaces
// only `spawn`, so the child it talks past is an inert process rather than a second
// engine that would answer for itself.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof ChildProcessModule>()
  return { ...actual, spawn: vi.fn(actual.spawn) }
})

const repoRoot = resolve(__dirname, '..', '..', '..')
const binaryName = process.platform === 'win32' ? 'cuerunner-audio.exe' : 'cuerunner-audio'

/** The binary the client would use: its own override first, then the build directory. */
function resolveBinary(): string {
  const override = process.env.CUERUNNER_AUDIO_BIN
  if (override !== undefined && override !== '' && existsSync(override)) return override
  return join(repoRoot, 'native', 'audio', 'build', binaryName)
}

function ensureBinary(): string {
  // ensure-native is the same check the pretest hook and every dev command run: it is a
  // stat() when the engine is current, and a build when a source is newer than it.
  execFileSync('node', [join(repoRoot, 'scripts', 'ensure-native.mjs')], { stdio: 'inherit', timeout: 600_000 })
  const binary = resolveBinary()
  if (!existsSync(binary)) throw new Error(`audio engine did not build; expected ${binary}`)
  return binary
}

/** A child that stays alive and says nothing, for the connection that declares nothing. */
function inertEngineProcess(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null,
    signalCode: null,
    kill: () => true
  }) as unknown as ChildProcess
}

/** Restores an environment variable to what it was, or removes it. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('the wire declaration', () => {
  it('is the one the built engine carries', () => {
    const output = execFileSync(ensureBinary(), ['--protocol'], { encoding: 'utf8' })
    // The printed declaration is the protocol, the verbs with their fields, the event
    // set and the bounds both ends share — compared whole, in both directions: a name,
    // value or regime edited at either end alone fails here, and the diff names the entry.
    expect(JSON.parse(output)).toEqual({ ...AUDIO_WIRE, limits: AUDIO_LIMITS })
  })

  it('refuses an engine that declares another protocol, before a verb is written', async () => {
    // An engine whose declaration is not this build's is refused while the connection is
    // still empty — no `info`, no verb — and the refusal names both versions. The engine
    // is the real one, declaring another protocol on request: only the greeting differs.
    const binary = ensureBinary()
    const previousBin = process.env.CUERUNNER_AUDIO_BIN
    const previousDeclared = process.env.CUERUNNER_TEST_AUDIO_PROTOCOL
    process.env.CUERUNNER_AUDIO_BIN = binary
    process.env.CUERUNNER_TEST_AUDIO_PROTOCOL = String(AUDIO_PROTOCOL_VERSION + 1)
    const stale = new NativeAudioEngine()
    try {
      const failure = await stale.ensureStarted().then(
        () => null,
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(AudioEngineError)
      expect((failure as AudioEngineError).code).toBe('engine')
      expect((failure as Error).message).toContain(`protocol ${AUDIO_PROTOCOL_VERSION + 1}`)
      expect((failure as Error).message).toContain(`(${AUDIO_PROTOCOL_VERSION})`)
      // `snapshot()` is filled by `info()`, the first verb the client writes once a
      // connection is verified: a refusal that had written anything would have left one.
      expect(stale.snapshot()).toBeNull()
      expect(stale.status().connected).toBe(false)
      expect(stale.status().started).toBe(false)
    } finally {
      restoreEnv('CUERUNNER_AUDIO_BIN', previousBin)
      restoreEnv('CUERUNNER_TEST_AUDIO_PROTOCOL', previousDeclared)
      await stale.shutdown()
    }
  })

  it('refuses a connection that never declares itself, before a verb is written', async () => {
    // An engine built before the greeting exists accepts the connection and says nothing.
    // The client refuses it on the declaration it never made, and writes nothing while it
    // waits: this socket is the whole of what the client talked to.
    const binary = ensureBinary()
    const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-wire-silent-'))
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cuerunner-wire-silent-${process.pid}`
        : join(workDir, 'engine.sock')
    let received = 0
    const sockets: Socket[] = []
    const server: Server = createServer((socket) => {
      sockets.push(socket)
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length
      })
    })
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(socketPath, resolveListen)
    })

    const previousBin = process.env.CUERUNNER_AUDIO_BIN
    const previousSocket = process.env.CUERUNNER_AUDIO_SOCKET
    process.env.CUERUNNER_AUDIO_BIN = binary
    process.env.CUERUNNER_AUDIO_SOCKET = socketPath
    vi.mocked(spawn).mockImplementationOnce((() => inertEngineProcess()) as typeof spawn)
    const silent = new NativeAudioEngine()
    try {
      const failure = await silent.ensureStarted().then(
        () => null,
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(AudioEngineError)
      expect((failure as AudioEngineError).code).toBe('engine')
      expect((failure as Error).message).toContain('did not declare its protocol')
      expect((failure as Error).message).toContain(`this build speaks ${AUDIO_PROTOCOL_VERSION}`)
      expect(silent.snapshot()).toBeNull()
      expect(silent.status().connected).toBe(false)
      expect(silent.status().started).toBe(false)
      // The connection was refused while it was still empty.
      expect(received).toBe(0)
    } finally {
      restoreEnv('CUERUNNER_AUDIO_BIN', previousBin)
      restoreEnv('CUERUNNER_AUDIO_SOCKET', previousSocket)
      await silent.shutdown()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
      rmSync(workDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('reports an event type and a field the declaration does not carry, counted', async () => {
    // The engine a reader can be handed is not always the engine this build was written
    // for: a line whose type or field the declaration does not name must be surfaced, and
    // a repeat must raise one count rather than add another report. The socket is this
    // test's own, so the lines are the only ones the client will ever see.
    const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-wire-unrecognised-'))
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cuerunner-wire-unrecognised-${process.pid}`
        : join(workDir, 'engine.sock')
    const sockets: Socket[] = []
    const server: Server = createServer((socket) => {
      sockets.push(socket)
      // Declare this build's protocol, or the client refuses the connection before any
      // event could be read.
      socket.write(
        `${JSON.stringify({
          greeting: true,
          name: 'cuerunner-audio',
          version: 'test',
          protocol: AUDIO_PROTOCOL_VERSION
        })}\n`
      )
      socket.on('data', (chunk: Buffer) => {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (line.trim() === '') continue
          const request = JSON.parse(line) as { id?: number; verb?: string }
          if (typeof request.id !== 'number') continue
          const result = request.verb === 'info' ? { sessionId: 'feed-session' } : { ok: true, at: 0 }
          socket.write(`${JSON.stringify({ id: request.id, ok: true, result })}\n`)
        }
      })
    })
    const { promise: listening, resolve: onListening, reject: onListenError } = Promise.withResolvers<void>()
    server.once('error', onListenError)
    server.listen(socketPath, onListening)
    await listening

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const previousBin = process.env.CUERUNNER_AUDIO_BIN
    const previousSocket = process.env.CUERUNNER_AUDIO_SOCKET
    process.env.CUERUNNER_AUDIO_BIN = ensureBinary()
    process.env.CUERUNNER_AUDIO_SOCKET = socketPath
    vi.mocked(spawn).mockImplementationOnce((() => inertEngineProcess()) as typeof spawn)
    const engine = new NativeAudioEngine()
    const events: AudioEngineEvent[] = []
    // The panic line is the last of the three, and the client reads a socket's lines in
    // order: its arrival is the signal that both lines before it have been read. No
    // sleep guesses at when that has happened.
    const { promise: delivered, resolve: onDelivered } = Promise.withResolvers<void>()
    const off = engine.subscribe(event => {
      events.push(event)
      onDelivered()
    })
    try {
      await engine.ensureStarted()
      // Only what this test feeds is its subject.
      drainMainErrors()

      sockets[0].write(
        [
          JSON.stringify({ event: { type: 'fly', sessionId: 'feed-session', at: 1 } }),
          JSON.stringify({ event: { type: 'fly', sessionId: 'feed-session', at: 2 } }),
          // A declared type carrying a field the declaration does not name must still be
          // delivered exactly as before.
          JSON.stringify({ event: { type: 'panic', at: 3, fadeMs: 0, why: 'because', sessionId: 'feed-session' } }),
          // A type that is present but not a name is named as the value that arrived, and
          // an event with no type at all is its own report — neither reads as the other.
          JSON.stringify({ event: { type: 7, sessionId: 'feed-session', at: 4 } }),
          JSON.stringify({ event: { sessionId: 'feed-session', at: 5 } })
        ].join('\n') + '\n'
      )
      await delivered

      // Nothing reaches a listener for a type the declaration does not name, and the
      // declared event goes through exactly as it does today — its declared fields, the
      // undeclared one reported rather than carried.
      expect(events).toEqual([{ type: 'panic', at: 3, fadeMs: 0, sessionId: 'feed-session' }])
      // The repeated type is one entry whose count climbed; the field is its own report,
      // written as the caller wrote it since it has not repeated; and each line whose type
      // is not a name is named by what arrived.
      expect(drainMainErrors()).toEqual([
        "[main] audio engine sent an unrecognised event type 'fly' (×2)",
        "[main] audio engine sent an unrecognised field 'why' on event type 'panic'",
        '[main] audio engine sent an unrecognised event type 7',
        '[main] audio engine sent an event with no type'
      ])
    } finally {
      off()
      await engine.shutdown()
      consoleError.mockRestore()
      restoreEnv('CUERUNNER_AUDIO_BIN', previousBin)
      restoreEnv('CUERUNNER_AUDIO_SOCKET', previousSocket)
      for (const socket of sockets) socket.destroy()
      const { promise: closed, resolve: onClosed } = Promise.withResolvers<void>()
      server.close(() => onClosed())
      await closed
      rmSync(workDir, { recursive: true, force: true })
    }
  }, 15_000)
})
