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
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { AUDIO_LIMITS, AUDIO_MAX_SLICES, AUDIO_PROTOCOL_VERSION, AUDIO_WIRE } from '../../shared/audio'
import type { AudioEngineEvent } from '../../shared/audio'
import { drainMainErrors } from '../errors'
import { AudioEngineError, NativeAudioEngine, type SpawnAudioEngine } from './AudioEngine'

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

/**
 * The spawner these cases hand the client, so the child it talks past is the inert one above
 * rather than a second engine that would answer for itself. Handed to the constructor, not
 * mocked on `node:child_process`: the module mock these cases used never reached the client
 * (zero calls), so every case spawned the real engine on the test's own socket, and whether
 * the client met the test's server or that engine first was a race — the engine winning is
 * the "expected null to be an instance of AudioEngineError" the CI lanes reported.
 */
const inert: SpawnAudioEngine = () => inertEngineProcess() as unknown as ReturnType<SpawnAudioEngine>

/** Restores an environment variable to what it was, or removes it. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('the slices a start carries', () => {
  it('are as many as the engine’s fixed arrays hold, so nothing the window allows is refused at GO', () => {
    // An engine size rather than a declared bound, so `--protocol` does not print it: the
    // header that sizes the arrays is read instead.
    const header = readFileSync(join(repoRoot, 'native', 'audio', 'src', 'wsaudio.h'), 'utf-8')
    expect(Number(/constexpr int kMaxSlices = (\d+);/.exec(header)?.[1])).toBe(AUDIO_MAX_SLICES)
    // A real rehearsal-track show cut one cue at 41 slices.
    expect(AUDIO_MAX_SLICES).toBeGreaterThanOrEqual(128)
  })
})

describe('the wire declaration', () => {
  it('is the one the built engine carries', () => {
    const output = execFileSync(ensureBinary(), ['--protocol'], { encoding: 'utf8' })
    // The printed declaration is the protocol, the verbs with their fields, the event
    // set and the bounds both ends share — compared whole, in both directions: a name,
    // value or regime edited at either end alone fails here, and the diff names the entry.
    expect(JSON.parse(output)).toEqual({ ...AUDIO_WIRE, limits: AUDIO_LIMITS })
  })

  it('declares the slice a voice is in on the progress reply, in protocol 4', () => {
    // The UI reads a sliced voice's place from here: `{ index, pass }`, or null without
    // slices. Part of protocol 4's table, which had not shipped when it joined.
    expect(AUDIO_PROTOCOL_VERSION).toBe(4)
    expect(AUDIO_WIRE.replies.progress.slice).toEqual({ type: 'object', nullable: true })
    const output = JSON.parse(execFileSync(ensureBinary(), ['--protocol'], { encoding: 'utf8' }))
    expect(output.replies.progress.slice).toEqual({ type: 'object', nullable: true })
  })

  it('refuses a connection that declares another protocol, before a verb is written', async () => {
    // An engine whose declaration is not this build's speaks another meaning of the
    // number, and it is refused while the connection is still empty — no `info`, no verb —
    // with both versions named. The connection is the test's own: a process that declared
    // another protocol needed a flag in the shipped engine to do it, and a socket answers
    // the same question without one.
    const binary = ensureBinary()
    const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-wire-stale-'))
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cuerunner-wire-stale-${process.pid}`
        : join(workDir, 'engine.sock')
    let received = 0
    const sockets: Socket[] = []
    const server: Server = createServer((socket) => {
      sockets.push(socket)
      socket.on('data', (chunk: Buffer) => {
        received += chunk.length
      })
      // The line the engine opens with, before any request is read.
      socket.write(
        `${JSON.stringify({
          greeting: true,
          name: 'stale-engine',
          version: '0.0.0',
          protocol: AUDIO_PROTOCOL_VERSION + 1
        })}\n`
      )
    })
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(socketPath, resolveListen)
    })

    const previousBin = process.env.CUERUNNER_AUDIO_BIN
    const previousSocket = process.env.CUERUNNER_AUDIO_SOCKET
    const previousBackend = process.env.CUERUNNER_AUDIO_BACKEND
    process.env.CUERUNNER_AUDIO_BIN = binary
    process.env.CUERUNNER_AUDIO_SOCKET = socketPath
    // What is being refused is a *declaration*, not a device: the silent backend is the one
    // that starts on a machine with no output endpoint at all, which is what a headless
    // Windows runner is. Without it the client reports the machine instead of the protocol.
    process.env.CUERUNNER_AUDIO_BACKEND = 'silent'
    const stale = new NativeAudioEngine(inert)
    try {
      const failure = await stale.ensureStarted().then(
        () => null,
        (error: unknown) => error
      )
      expect(failure).toBeInstanceOf(AudioEngineError)
      expect((failure as AudioEngineError).code).toBe('engine')
      expect((failure as Error).message).toContain(`protocol ${AUDIO_PROTOCOL_VERSION + 1}`)
      expect((failure as Error).message).toContain(`(${AUDIO_PROTOCOL_VERSION})`)
      expect((failure as Error).message).toContain('(stale-engine 0.0.0)')
      // `snapshot()` is filled by `info()`, the first verb this client writes once a
      // connection is verified: a refusal that had written anything would have left one.
      expect(stale.snapshot()).toBeNull()
      expect(stale.status().connected).toBe(false)
      expect(stale.status().started).toBe(false)
      expect(received).toBe(0)
    } finally {
      restoreEnv('CUERUNNER_AUDIO_BIN', previousBin)
      restoreEnv('CUERUNNER_AUDIO_SOCKET', previousSocket)
      restoreEnv('CUERUNNER_AUDIO_BACKEND', previousBackend)
      await stale.shutdown()
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolveClosed) => server.close(() => resolveClosed()))
      rmSync(workDir, { recursive: true, force: true })
    }
  }, 15_000)

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
    const previousBackend = process.env.CUERUNNER_AUDIO_BACKEND
    process.env.CUERUNNER_AUDIO_BIN = binary
    process.env.CUERUNNER_AUDIO_SOCKET = socketPath
    // The same as the case above: a machine with no output endpoint still has to reach the
    // handshake before it can be refused for what it says in it.
    process.env.CUERUNNER_AUDIO_BACKEND = 'silent'
    const silent = new NativeAudioEngine(inert)
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
      restoreEnv('CUERUNNER_AUDIO_BACKEND', previousBackend)
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
    const engine = new NativeAudioEngine(inert)
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
          // A declared field carrying another kind. `normalizeEvent` reads it as absent — the
          // same answer the interface's own default gives — and the line goes on; what was
          // missing is the report, because a `reason: null` on an `ended` used to arrive as
          // `'complete'`, a natural finish the engine never sent.
          JSON.stringify({ event: { type: 'panic', at: 6, fadeMs: '0', sessionId: 'feed-session' } }),
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
      expect(events).toEqual([
        { type: 'panic', at: 3, fadeMs: 0, sessionId: 'feed-session' },
        // The second panic: delivered, with the wrong-kind field read as absent.
        { type: 'panic', at: 6, fadeMs: 0, sessionId: 'feed-session' }
      ])
      // The repeated type is one entry whose count climbed; the field is its own report,
      // written as the caller wrote it since it has not repeated; and each line whose type
      // is not a name is named by what arrived.
      expect(drainMainErrors()).toEqual([
        "[main] audio engine sent an unrecognised event type 'fly' (×2)",
        "[main] audio engine sent an unrecognised field 'why' on event type 'panic'",
        "[main] audio engine sent 'fadeMs' on event type 'panic' as string, where the declaration writes number",
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

  it('reports a declared field the engine left out, and delivers the event with its default', async () => {
    // The other half of the declaration's rule: a field the declaration names for a type
    // is required. `normalizeEvent` fills a default in for an absent one, so without this
    // a line would read as a fact it never carried — an `ended` with no reason as a
    // natural completion, a `state` with no active as nothing playing. The event is
    // reported and still delivered, and a repeat raises the one report's count.
    const workDir = mkdtempSync(join(tmpdir(), 'cuerunner-wire-short-'))
    const socketPath =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\cuerunner-wire-short-${process.pid}`
        : join(workDir, 'engine.sock')
    const sockets: Socket[] = []
    const server: Server = createServer((socket) => {
      sockets.push(socket)
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
    const engine = new NativeAudioEngine(inert)
    const events: AudioEngineEvent[] = []
    // The complete line is the last of the four, and the client reads a socket's lines in
    // order: its arrival is the signal that the three before it have been read.
    const { promise: delivered, resolve: onDelivered } = Promise.withResolvers<void>()
    const off = engine.subscribe(event => {
      events.push(event)
      if (event.type === 'panic') onDelivered()
    })
    try {
      await engine.ensureStarted()
      // Only what this test feeds is its subject.
      drainMainErrors()

      sockets[0].write(
        [
          // Two of `ended`'s seven fields are missing, twice over: the field is one fact
          // per type, so the second line raises the count rather than adding a report.
          JSON.stringify({ event: { type: 'ended', cueId: 'c1', runId: 'r1', at: 1, sessionId: 'feed-session' } }),
          JSON.stringify({ event: { type: 'ended', cueId: 'c1', runId: 'r1', at: 2, sessionId: 'feed-session' } }),
          // The engine-wide flag `state` is read for: a line without it is not "nothing
          // playing", which is what the default would make it.
          JSON.stringify({ event: { type: 'state', at: 3, cueId: null, runId: null, playing: false, state: null, sessionId: 'feed-session' } }),
          JSON.stringify({ event: { type: 'panic', at: 4, fadeMs: 0, sessionId: 'feed-session' } })
        ].join('\n') + '\n'
      )
      await delivered

      // Every event is delivered, carrying the default its absent field would have been
      // read as — nothing is dropped for being short.
      expect(events).toEqual([
        { type: 'ended', cueId: 'c1', runId: 'r1', at: 1, reason: 'complete', loopsCompleted: 0, sessionId: 'feed-session' },
        { type: 'ended', cueId: 'c1', runId: 'r1', at: 2, reason: 'complete', loopsCompleted: 0, sessionId: 'feed-session' },
        { type: 'state', at: 3, active: false, cueId: null, runId: null, playing: false, state: null, sessionId: 'feed-session' },
        { type: 'panic', at: 4, fadeMs: 0, sessionId: 'feed-session' }
      ])
      // One report per type and field, in the declaration's own order; the complete line
      // reports nothing.
      expect(drainMainErrors()).toEqual([
        "[main] audio engine sent an event of type 'ended' with no 'reason' (×2)",
        "[main] audio engine sent an event of type 'ended' with no 'loopsCompleted' (×2)",
        "[main] audio engine sent an event of type 'state' with no 'active'"
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
