/**
 * The main-process side of the native audio engine.
 *
 * The engine is a separate executable that owns the device, the decoders and the
 * mixer. This module owns its lifecycle: it spawns it, speaks the newline-delimited
 * JSON protocol over a local socket (Unix domain socket on Unix, named pipe on
 * Windows), correlates concurrent requests by id, forwards the engine's events, and
 * makes sure the child never outlives the app.
 *
 * No audio bytes cross this boundary — file paths do — and every verb is an execution
 * verb: the engine schedules it on its own sample clock.
 */
import { spawn, type ChildProcess, type ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { connect, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AudioCancelResult,
  AudioClockReading,
  AudioErrorCode,
  AudioCommandResult,
  AudioMeters,
  AudioCrosspoint,
  AudioDeviceInfo,
  AudioEndReason,
  AudioEngineEvent,
  AudioEngineInfo,
  AudioFadeCurve,
  AudioFadeParam,
  AudioMetadata,
  AudioPanicResult,
  AudioRegion,
  AudioProbe,
  AudioOnsets,
  AudioSilence,
  AudioLoudness,
  AudioInputDevice,
  AudioInputOpenOptions,
  AudioInputStatus,
  AudioProgress,
  AudioSeekResult,
  AudioStartOptions,
  AudioStartResult,
  AudioVoiceState,
  AudioWaveform,
  AudioWireVerb,
  DeviceOptions
} from '../../shared/audio'
import { admitsWireKind, AUDIO_PROTOCOL_VERSION, declaredEventFields } from '../../shared/audio'
import { reportMainError } from '../errors'

const REQUEST_TIMEOUT_MS = 15_000
const SLOW_REQUEST_TIMEOUT_MS = 60_000
const SPAWN_TIMEOUT_MS = 8_000
const SHUTDOWN_GRACE_MS = 1_000
const MAX_RESTARTS = 3
const RESTART_BACKOFF_MS = [250, 1000, 4000]

/**
 * How long a connected engine has to declare itself. The greeting is written as the
 * connection is accepted, so a declaration that has not arrived in this long never will —
 * and a stale engine is refused promptly rather than after the whole startup budget.
 */
const GREETING_TIMEOUT_MS = 2_000

/** Verbs that touch the disk or the device list and get the longer deadline. */
const SLOW_VERBS: Partial<Record<AudioWireVerb, number>> = {
  prepare: SLOW_REQUEST_TIMEOUT_MS,
  probe: SLOW_REQUEST_TIMEOUT_MS,
  waveform: SLOW_REQUEST_TIMEOUT_MS,
  // A silence scan always reads the whole file, and the files this is for are the long
  // ones — an hour of it is a pass over a gigabyte, which the default deadline would cut
  // off mid-read.
  silence: SLOW_REQUEST_TIMEOUT_MS,
  // The same whole-file pass as `silence`, and the same files: a room-tone bed is
  // analysed frame by frame to its last one, which the default deadline cuts off —
  // silently, because the waveform panel treats a failed onsets request as "no ticks".
  onsets: SLOW_REQUEST_TIMEOUT_MS,
  // A loudness scan is the same whole-file pass, through a four-times oversampler.
  loudness: SLOW_REQUEST_TIMEOUT_MS,
  // Opening a capture device is the device's own business and can take as long as a configure.
  inputs: SLOW_REQUEST_TIMEOUT_MS,
  inputOpen: SLOW_REQUEST_TIMEOUT_MS,
  startInput: SLOW_REQUEST_TIMEOUT_MS,
  configure: SLOW_REQUEST_TIMEOUT_MS,
  devices: SLOW_REQUEST_TIMEOUT_MS
}

interface WireReply {
  id: number
  ok: boolean
  result?: unknown
  error?: { code?: string; message?: string }
}

interface WireEventLine {
  event: Record<string, unknown>
}

/**
 * What the engine declares as a connection opens, before it will read a request: the
 * protocol it speaks. It is checked as part of connecting, so a build from another
 * meaning of the number is refused while the connection is still empty.
 */
interface WireGreeting {
  /** The declared protocol, or null when the line carried no number. */
  protocol: number | null
  name: string
  version: string
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

export interface AudioEngineStatus {
  /** A live engine process is connected. */
  connected: boolean
  /** The executable this machine resolved. */
  binaryPath: string | null
  /** Restarts since launch (bounded; the engine is given up on after MAX_RESTARTS). */
  restarts: number
  lastError: string | null
  started: boolean
  /**
   * The engine's own last words. Kept because the app's stderr does not always reach
   * whoever needs the reason — on a Windows runner none of it does — and an engine that
   * dies at startup otherwise fails every test downstream without saying why.
   */
  stderrTail: string[]
}

/** How many of the engine's lines are kept, so a failure can explain itself. */
const STDERR_TAIL_LINES = 12

export class AudioEngineError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'AudioEngineError'
    this.code = code
  }
}

/** The last frame we forward to the renderer, when the engine dies mid-request. */
function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * What the client says when the engine's declaration is not this build's. `greeting` is
 * what arrived, null when the connection never declared anything. The engine's own name
 * and build version are named with it when the greeting carried them: an operator
 * otherwise cannot tell a pre-greeting build from a line that was cut short.
 */
function protocolMismatch(greeting: WireGreeting | null): string {
  if (greeting === null) {
    // An engine built before the greeting existed declares nothing and cannot: the
    // absence is the mismatch, and there is no second protocol number to name for it.
    return `audio engine did not declare its protocol (this build speaks ${AUDIO_PROTOCOL_VERSION})`
  }
  const engine =
    greeting.name !== '' && greeting.version !== '' ? ` (${greeting.name} ${greeting.version})` : ''
  return greeting.protocol === null
    ? `audio engine declared no protocol${engine} (this build speaks ${AUDIO_PROTOCOL_VERSION})`
    : `audio engine protocol ${greeting.protocol}${engine} does not match this build (${AUDIO_PROTOCOL_VERSION})`
}

function readEnv(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * `app.isPackaged` without importing electron at module scope, so this module stays
 * unit-testable: the packaged build is the only place the capture tee must be refused.
 */
function appIsPackaged(): boolean {
  try {
    const electron = require('electron') as { app?: { isPackaged?: boolean } }
    return Boolean(electron?.app?.isPackaged)
  } catch {
    return false
  }
}

function resolveBinaryPath(): string | null {
  const override = readEnv('CUERUNNER_AUDIO_BIN')
  if (override) return existsSync(override) ? override : null
  const name = process.platform === 'win32' ? 'cuerunner-audio.exe' : 'cuerunner-audio'
  const candidates = appIsPackaged()
    ? [join(process.resourcesPath, 'audio', name)]
    : [join(process.cwd(), 'native', 'audio', 'build', name)]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function socketPath(): string {
  const override = readEnv('CUERUNNER_AUDIO_SOCKET')
  if (override) return override
  const suffix = `${process.pid}-${Date.now().toString(36)}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\cuerunner-audio-${suffix}`
    : join(tmpdir(), `cuerunner-audio-${suffix}.sock`)
}

/**
 * Starts the engine executable, with the pipes this client reads it through. Injectable
 * so a test can put a connection of its own on the other end — one that never declares
 * itself, or one that declares another protocol — without a real process behind it; the
 * app always spawns.
 */
export type SpawnAudioEngine = (
  binaryPath: string,
  args: string[],
  options: { stdio: ['ignore', 'pipe', 'pipe'] }
) => ChildProcessByStdio<null, Readable, Readable>

export class NativeAudioEngine {
  constructor(private readonly spawnEngine: SpawnAudioEngine = spawn) {}

  private child: ChildProcess | null = null
  private socket: Socket | null = null
  private startPromise: Promise<void> | null = null
  private buffer = ''
  private nextRequestId = 1
  private pending = new Map<number, PendingRequest>()
  /** The declaration the live connection opened with; null until a greeting arrives. */
  private greeting: WireGreeting | null = null
  /** Whoever is connecting and waiting on that greeting, if anyone is. */
  private greetingWaiter: { resolve: (greeting: WireGreeting) => void; reject: (error: Error) => void } | null = null
  private listeners = new Set<(event: AudioEngineEvent) => void>()
  private lastInfo: AudioEngineInfo | null = null
  /**
   * The engine session last heard from. Every clock reply, info read and event carries
   * it, and what this process synthesizes itself — a restart reason, a spawn failure —
   * is tagged with it so a listener can tell which engine actually said what.
   */
  private lastSessionId: string | null = null
  private lastStatus: AudioEngineStatus = {
    connected: false,
    binaryPath: null,
    restarts: 0,
    lastError: null,
    started: false,
    stderrTail: []
  }
  private shuttingDown = false
  /** The engine's stderr, bounded: what it said before it stopped being there. */
  private stderrTail: string[] = []
  private restartTimer: NodeJS.Timeout | null = null
  private exitHookInstalled = false

  subscribe(listener: (event: AudioEngineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Last engine state we saw. Synchronous on purpose: the watchdogs read it at heartbeat time. */
  snapshot(): AudioEngineInfo | null {
    return this.lastInfo
  }

  status(): AudioEngineStatus {
    return {
      ...this.lastStatus,
      connected: this.socket !== null && !this.socket.destroyed,
      stderrTail: [...this.stderrTail]
    }
  }

  /** `message` with the engine's own last words under it, when it had any. */
  private withStderrTail(message: string): string {
    if (this.stderrTail.length === 0) return message
    return `${message}\n${this.stderrTail.join('\n')}`
  }

  async ensureStarted(): Promise<void> {
    if (this.socket !== null && !this.socket.destroyed) return
    if (this.startPromise !== null) return this.startPromise
    this.startPromise = this.spawnAndConnect().finally(() => {
      this.startPromise = null
    })
    return this.startPromise
  }

  /**
   * Quit teardown: runs in `will-quit`, past the point a quit can still be cancelled.
   * Synchronous — Electron will not wait for async work that late — so the child is
   * signalled rather than asked: SIGTERM drives the engine's own signal handler
   * (`requestStop`/`serve`/`stop`), which is the graceful path, and the kill guarantees
   * no orphan holds the device. Nothing runs in `before-quit`: even a graceful verb
   * exits the engine (`stopping_` + client drop; `serve()` returns and `stop()` runs),
   * so a cancelled unsaved-changes prompt would still stop the show.
   */
  forceShutdown(): void {
    this.shuttingDown = true
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    this.failPending(new AudioEngineError('engine', 'audio engine stopped'))
    this.killChild()
    this.teardown()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const child = this.child
    const socket = this.socket
    if (child === null) {
      this.failPending(new AudioEngineError('engine', 'audio engine stopped'))
      return
    }
    try {
      if (socket !== null && !socket.destroyed) {
        await this.request('shutdown', {}, SHUTDOWN_GRACE_MS).catch(() => undefined)
      }
    } finally {
      this.teardown()
      if (child.exitCode === null && child.signalCode === null) {
        child.kill()
      }
    }
  }

  prepare(cueId: string, filePath: string): Promise<AudioMetadata> {
    return this.request('prepare', { cueId, filePath }, SLOW_VERBS.prepare) as Promise<AudioMetadata>
  }

  /** Metadata only: no decode, no cache entry, no counters. */
  probe(filePath: string): Promise<AudioProbe> {
    return this.request('probe', { filePath }, SLOW_VERBS.probe) as Promise<AudioProbe>
  }

  start(cueId: string, whenMs: number, options: AudioStartOptions): Promise<AudioStartResult> {
    return this.request('start', { cueId, whenMs, options }) as Promise<AudioStartResult>
  }

  stop(cueId: string, fadeMs: number, whenMs?: number): Promise<AudioCommandResult> {
    return this.request('stop', { cueId, fadeMs, whenMs }) as Promise<AudioCommandResult>
  }

  stopAll(fadeMs: number): Promise<AudioCommandResult> {
    return this.request('stopAll', { fadeMs }) as Promise<AudioCommandResult>
  }

  seek(cueId: string, positionMs: number, whenMs?: number): Promise<AudioSeekResult> {
    return this.request('seek', { cueId, positionMs, whenMs }) as Promise<AudioSeekResult>
  }

  release(cueId: string, whenMs?: number, endMs?: number, stopAtSliceEnd?: boolean): Promise<AudioCommandResult> {
    return this.request('release', { cueId, whenMs, endMs, stopAtSliceEnd }) as Promise<AudioCommandResult>
  }

  cancel(cueId: string, whenMs?: number): Promise<AudioCancelResult> {
    return this.request('cancel', { cueId, whenMs }) as Promise<AudioCancelResult>
  }

  pause(cueId: string, whenMs?: number): Promise<AudioCommandResult> {
    return this.request('pause', { cueId, whenMs }) as Promise<AudioCommandResult>
  }

  resume(cueId: string, whenMs?: number): Promise<AudioCommandResult> {
    return this.request('resume', { cueId, whenMs }) as Promise<AudioCommandResult>
  }

  master(gain: number): Promise<AudioCommandResult> {
    return this.request('master', { gain }) as Promise<AudioCommandResult>
  }

  meters(): Promise<AudioMeters> {
    return this.request('meters', {}) as Promise<AudioMeters>
  }

  fade(
    cueId: string,
    param: AudioFadeParam,
    value: number,
    durationMs: number,
    curve: AudioFadeCurve,
    whenMs?: number,
    shape?: number[] | null
  ): Promise<AudioCommandResult> {
    return this.request('fade', {
      cueId, param, value, durationMs, curve, whenMs, shape: shape ?? undefined
    }) as Promise<AudioCommandResult>
  }

  routing(cueId: string, outputs: AudioCrosspoint[] | null): Promise<AudioCommandResult> {
    return this.request('routing', { cueId, outputs }) as Promise<AudioCommandResult>
  }

  async progress(cueId: string): Promise<AudioProgress | null> {
    const result = (await this.request('progress', { cueId })) as AudioProgress | null
    return result ?? null
  }

  panic(fadeMs: number): Promise<AudioPanicResult> {
    return this.request('panic', { fadeMs }) as Promise<AudioPanicResult>
  }

  async clock(): Promise<AudioClockReading> {
    const result = (await this.request('clock', {})) as AudioClockReading
    if (typeof result.sessionId === 'string' && result.sessionId !== '') this.lastSessionId = result.sessionId
    return result
  }

  async info(): Promise<AudioEngineInfo> {
    const result = (await this.request('info', {})) as AudioEngineInfo
    this.lastInfo = result
    if (typeof result.sessionId === 'string' && result.sessionId !== '') this.lastSessionId = result.sessionId
    return result
  }

  async devices(): Promise<AudioDeviceInfo[]> {
    const result = (await this.request('devices', {}, SLOW_VERBS.devices)) as { devices: AudioDeviceInfo[] }
    return result.devices
  }

  async configure(options: DeviceOptions): Promise<AudioEngineInfo> {
    // A configure verb is an operator's explicit action (or a show load asking for its
    // device); it is also the one lever that can revive an engine whose launch failed
    // and whose restart budget is spent — scheduleRestart gives up and nothing else
    // re-enters ensureStarted. So start the engine first if it is not running, and let
    // the configure itself refuse with the real reason if the launch fails again.
    await this.ensureStarted()
    const result = (await this.request('configure', { options }, SLOW_VERBS.configure)) as AudioEngineInfo
    this.lastInfo = result
    return result
  }

  onsets(
    filePath: string,
    sensitivity?: number,
    maxOnsets?: number,
    region?: AudioRegion
  ): Promise<AudioOnsets> {
    return this.request('onsets', {
      filePath, sensitivity, maxOnsets, startMs: region?.startMs, endMs: region?.endMs
    }) as Promise<AudioOnsets>
  }

  silence(filePath: string, thresholdDb?: number): Promise<AudioSilence> {
    return this.request('silence', { filePath, thresholdDb }, SLOW_VERBS.silence) as Promise<AudioSilence>
  }

  loudness(filePath: string): Promise<AudioLoudness> {
    return this.request('loudness', { filePath }, SLOW_VERBS.loudness) as Promise<AudioLoudness>
  }

  async inputs(): Promise<AudioInputDevice[]> {
    const result = (await this.request('inputs', {}, SLOW_VERBS.inputs)) as { inputs: AudioInputDevice[] }
    return result.inputs
  }

  inputOpen(options: AudioInputOpenOptions): Promise<AudioInputStatus> {
    return this.request('inputOpen', { ...options }, SLOW_VERBS.inputOpen) as Promise<AudioInputStatus>
  }

  inputClose(device: string): Promise<{ closed: boolean }> {
    return this.request('inputClose', { device }) as Promise<{ closed: boolean }>
  }

  async inputStatus(): Promise<AudioInputStatus[]> {
    const result = (await this.request('inputStatus', {})) as { feeds: AudioInputStatus[] }
    return result.feeds
  }

  startInput(
    cueId: string,
    whenMs: number,
    device: string,
    channels: number[],
    options: Partial<AudioStartOptions>
  ): Promise<AudioStartResult> {
    return this.request('startInput', { cueId, whenMs, device, channels, options }, SLOW_VERBS.startInput) as
      Promise<AudioStartResult>
  }

  patch(slot: number, outputs: number[] | null, gain: number): Promise<AudioCommandResult> {
    return this.request('patch', { slot, outputs, gain }) as Promise<AudioCommandResult>
  }

  outputGains(gains: number[]): Promise<AudioCommandResult> {
    return this.request('outputGains', { gains }) as Promise<AudioCommandResult>
  }

  waveform(filePath: string, points: number, region?: AudioRegion): Promise<AudioWaveform> {
    // The requested point count goes over the wire unchanged: the engine clamps it to
    // its own bound and reports back whether it had to, which is what the caller shows.
    return this.request(
      'waveform',
      { filePath, points, startMs: region?.startMs, endMs: region?.endMs },
      SLOW_VERBS.waveform
    ) as Promise<AudioWaveform>
  }

  private async spawnAndConnect(): Promise<void> {
    const binaryPath = resolveBinaryPath()
    this.lastStatus.binaryPath = binaryPath
    if (binaryPath === null) {
      const message = readEnv('CUERUNNER_AUDIO_BIN')
        ? `audio engine not found at ${readEnv('CUERUNNER_AUDIO_BIN')} (build it with: npm run build:native)`
        : 'audio engine executable is missing (build it with: npm run build:native)'
      this.lastStatus.lastError = message
      throw new AudioEngineError('engine', message)
    }
    if (this.exitHookInstalled === false) {
      this.exitHookInstalled = true
      // Last-resort guard: a child must never outlive the app even if a lifecycle hook
      // is missed on an unusual exit path.
      process.once('exit', () => this.killChild())
    }

    const path = socketPath()
    const args = ['--socket', path, '--backend', readEnv('CUERUNNER_AUDIO_BACKEND') ?? 'auto']
    const capture = readEnv('CUERUNNER_TEST_AUDIO_CAPTURE')
    if (capture !== undefined && !appIsPackaged()) args.push('--capture', capture)
    // The engine's synthetic live inputs, for a test run on a machine with no input device.
    if (readEnv('CUERUNNER_TEST_INPUTS') === '1' && !appIsPackaged()) args.push('--test-inputs')
    const deviceId = readEnv('CUERUNNER_AUDIO_DEVICE')
    if (deviceId !== undefined) args.push('--device', deviceId)
    const exclusive = readEnv('CUERUNNER_AUDIO_EXCLUSIVE')
    if (exclusive !== undefined) args.push('--exclusive', exclusive)
    const sampleRate = readEnv('CUERUNNER_AUDIO_SAMPLE_RATE')
    if (sampleRate !== undefined) args.push('--sample-rate', sampleRate)
    // How many outputs the engine opens with: what a test of routing across more than a pair
    // asks of the silent backend, which takes no device configuration once it is running.
    const channels = readEnv('CUERUNNER_AUDIO_CHANNELS')
    if (channels !== undefined && !appIsPackaged()) args.push('--channels', channels)

    const child = this.spawnEngine(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    this.child = child
    child.stdout.on('data', (chunk: Buffer) => this.handleStdout(chunk))
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trimEnd()
      if (text === '') return
      for (const line of text.split('\n')) this.stderrTail.push(line)
      if (this.stderrTail.length > STDERR_TAIL_LINES) {
        this.stderrTail.splice(0, this.stderrTail.length - STDERR_TAIL_LINES)
      }
      // The engine already prefixes its own diagnostics; do not stack a second tag.
      process.stderr.write(text.startsWith('[cuerunner-audio]') ? `${text}\n` : `[cuerunner-audio] ${text}\n`)
    })
    child.on('exit', (code, signal) => this.handleExit(child, code, signal))

    try {
      // connectWithRetry resolves only once the engine's greeting has been checked
      // against this build, so everything below is written to an engine this build speaks.
      await this.connectWithRetry(path, child)
      const info = await this.info()
      this.lastInfo = info
    } catch (error) {
      // A half-started engine must not be left running or half-connected.
      this.shuttingDown = true
      this.teardown()
      this.killChild()
      this.shuttingDown = false
      this.lastStatus.lastError = this.withStderrTail(describeError(error))
      throw error
    }
    this.lastStatus.started = true
    this.lastStatus.lastError = null
  }

  /**
   * Connects and reads the engine's declaration before anything is written: a socket
   * that accepts is not yet an engine this build speaks. A verb written before the check
   * would have been answered by a build whose events this process then interprets, which
   * is the refusal this ordering exists to make impossible.
   */
  private async connectWithRetry(path: string, child: ChildProcess): Promise<void> {
    this.greeting = null
    this.greetingWaiter = null
    const deadline = Date.now() + SPAWN_TIMEOUT_MS
    await new Promise<void>((resolve, reject) => {
      const attempt = (): void => {
        if (child.exitCode !== null || child.signalCode !== null) {
          reject(new AudioEngineError('engine', `audio engine exited during startup (code ${child.exitCode})`))
          return
        }
        const socket = connect(path)
        socket.once('error', (error) => {
          socket.destroy()
          if (Date.now() > deadline) {
            reject(new AudioEngineError('engine', `cannot connect to audio engine: ${describeError(error)}`))
            return
          }
          setTimeout(attempt, 50)
        })
        socket.once('connect', () => {
          this.socket = socket
          socket.setNoDelay(true)
          socket.on('data', (chunk: Buffer) => this.handleStdout(chunk, socket))
          socket.on('error', (error) => this.handleSocketError(error))
          socket.on('close', () => this.handleSocketClose(socket))
          resolve()
        })
      }
      attempt()
    })
    const greeting = await this.awaitGreeting(deadline)
    if (greeting.protocol !== AUDIO_PROTOCOL_VERSION) {
      throw new AudioEngineError('engine', protocolMismatch(greeting))
    }
  }

  /**
   * The greeting the connected engine opened with. The wait is bounded by what is left of
   * the startup budget the connect already ran on — one budget, not two — and by a shorter
   * window of its own, because the declaration is written as the connection is accepted: an
   * engine built before the greeting cannot send one, and neither can one that is wedged.
   */
  private awaitGreeting(deadlineMs: number): Promise<WireGreeting> {
    if (this.greeting !== null) return Promise.resolve(this.greeting)
    const { promise, resolve, reject } = Promise.withResolvers<WireGreeting>()
    const remaining = Math.max(0, Math.min(deadlineMs, Date.now() + GREETING_TIMEOUT_MS) - Date.now())
    const timer = setTimeout(() => {
      this.greetingWaiter = null
      reject(new AudioEngineError('engine', protocolMismatch(null)))
    }, remaining)
    if (typeof timer.unref === 'function') timer.unref()
    this.greetingWaiter = {
      resolve: (greeting) => {
        clearTimeout(timer)
        resolve(greeting)
      },
      reject: (error) => {
        clearTimeout(timer)
        reject(error)
      }
    }
    return promise
  }

  /** The declaration a connection opens with: the first line the engine sends. */
  private handleGreeting(record: Record<string, unknown>): void {
    const greeting: WireGreeting = {
      protocol: typeof record.protocol === 'number' ? record.protocol : null,
      name: typeof record.name === 'string' ? record.name : '',
      version: typeof record.version === 'string' ? record.version : ''
    }
    this.greeting = greeting
    const waiter = this.greetingWaiter
    this.greetingWaiter = null
    waiter?.resolve(greeting)
  }

  private handleStdout(chunk: Buffer, socket: Socket | null = null): void {
    this.buffer += chunk.toString('utf8')
    if (this.buffer.length > 8 * 1024 * 1024) {
      this.buffer = ''
      this.emitEngineError('engine', 'audio engine response exceeded the line budget')
      return
    }
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline).trim()
      this.buffer = this.buffer.slice(newline + 1)
      if (line !== '') this.handleLine(line, socket)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string, socket: Socket | null): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.emitEngineError('engine', 'audio engine sent a malformed line')
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    const record = parsed as Record<string, unknown>
    if (record.greeting === true) {
      // Only the connection's own declaration counts: a replaced engine's socket can
      // deliver a line after its replacement is connected, and a greeting that did not
      // arrive on the socket in use must not settle the check the first verb rests on.
      if (socket !== null && socket === this.socket) this.handleGreeting(record)
      return
    }
    if (typeof record.id === 'number') {
      this.handleReply(record as unknown as WireReply)
      return
    }
    if (record.event !== undefined && record.event !== null) {
      this.handleEvent((record as unknown as WireEventLine).event)
    }
  }

  private handleReply(reply: WireReply): void {
    const pending = this.pending.get(reply.id)
    if (pending === undefined) return
    this.pending.delete(reply.id)
    clearTimeout(pending.timer)
    if (reply.ok) {
      pending.resolve(reply.result)
      return
    }
    pending.reject(new AudioEngineError(reply.error?.code ?? 'engine', reply.error?.message ?? 'audio engine refused the request'))
  }

  private handleEvent(event: Record<string, unknown>): void {
    // Recognition is by declaration: a field is known when the declaration names it for
    // this event's type — and every field the declaration names for that type is
    // required. `normalizeEvent` below fills a default in for one that is absent, so a
    // line missing a field would otherwise read as a fact it never carried: an `ended`
    // with no reason reads as a natural completion, a `state` with no `active` as
    // nothing playing. Both directions are reported, and the event still goes on as it
    // is: neither a field this build does not carry nor one the engine left out must
    // cost the show a line the rest of which it does understand. The shared interfaces
    // are flat, so the top-level names are the whole check.
    const fields = declaredEventFields(event.type)
    if (fields !== null) {
      const type = event.type as string
      for (const field of Object.keys(event)) {
        if (Object.hasOwn(fields, field)) continue
        reportMainError(
          `[main] audio engine sent an unrecognised field '${field}' on event type '${type}'`,
          `audio-event-field:${type}.${field}`
        )
      }
      for (const [field, declared] of Object.entries(fields)) {
        if (!Object.hasOwn(event, field)) {
          reportMainError(
            `[main] audio engine sent an event of type '${type}' with no '${field}'`,
            `audio-event-field-missing:${type}.${field}`
          )
          continue
        }
        const value = event[field]
        // A `null` where the interface means one — an `error`'s ids, a `state`'s voice — is
        // the declaration's own, and the only null this arm admits.
        if (value === null && declared.nullable === true) continue
        if (admitsWireKind(declared.type, value)) continue
        // The third direction, and the one that used to read as a fact: a field present with
        // another kind passes both loops above, and `normalizeEvent` then invents the value —
        // `reason: null` on an `ended` became `'complete'`, a natural finish the engine never
        // reported. The event still goes on, as one with a field left out does.
        reportMainError(
          `[main] audio engine sent '${field}' on event type '${type}' as ` +
            `${value === null ? 'null' : typeof value}, where the declaration writes ${declared.type}`,
          `audio-event-field-kind:${type}.${field}`
        )
      }
    }
    const typed = this.normalizeEvent(event)
    // A line this build cannot read has been reported by normalizeEvent. Nothing reaches
    // a listener as an event with a shape the shared interfaces do not describe.
    if (typed === null) return
    // Keep the synchronous snapshot honest: the watchdog reads `active` at heartbeat
    // time, long before anyone would await info(). Only the live engine's lines may
    // move it — a dead engine's last `active: false`, arriving late behind a batch,
    // would otherwise disarm the safety net while the replacement is playing.
    const aboutLiveEngine =
      typed.sessionId === '' || this.lastInfo === null || this.lastInfo.sessionId === typed.sessionId
    if (typed.type === 'state' && this.lastInfo !== null && aboutLiveEngine) {
      this.lastInfo = { ...this.lastInfo, active: typed.active }
    }
    for (const listener of this.listeners) {
      try {
        listener(typed)
      } catch {
        // A listener must not take the audio engine down with it.
      }
    }
  }

  private normalizeEvent(event: Record<string, unknown>): AudioEngineEvent | null {
    const type = event.type
    const at = typeof event.at === 'number' ? event.at : 0
    // The engine tags everything it says with its session. The tag rides through
    // untouched: events are batched on their way here, so a dead engine's last words
    // can arrive after its replacement is live, and they must not overwrite which
    // session this process believes it is talking to — that is what `clock()` and
    // `info()` answers, from the engine that is answering now, are for.
    const sessionId = typeof event.sessionId === 'string' ? event.sessionId : ''
    switch (type) {
      case 'ended':
        return {
          type: 'ended',
          cueId: typeof event.cueId === 'string' ? event.cueId : '',
          runId: typeof event.runId === 'string' ? event.runId : '',
          at,
          reason: (event.reason as AudioEndReason) ?? 'complete',
          loopsCompleted: typeof event.loopsCompleted === 'number' ? event.loopsCompleted : 0,
          sessionId
        }
      case 'error':
        return {
          type: 'error',
          at,
          cueId: typeof event.cueId === 'string' ? event.cueId : null,
          runId: typeof event.runId === 'string' ? event.runId : null,
          code: typeof event.code === 'string' ? (event.code as AudioErrorCode) : 'engine',
          message: typeof event.message === 'string' ? event.message : 'audio engine error',
          sessionId
        }
      case 'panic':
        return { type: 'panic', at, fadeMs: typeof event.fadeMs === 'number' ? event.fadeMs : 0, sessionId }
      case 'state':
        return {
          type: 'state',
          at,
          active: event.active === true,
          cueId: typeof event.cueId === 'string' ? event.cueId : null,
          runId: typeof event.runId === 'string' ? event.runId : null,
          playing: event.playing === true,
          state: (event.state as AudioVoiceState | null) ?? null,
          sessionId
        }
      default:
        // A type the declaration does not name — or one this reader has no case for —
        // is not a line to guess at: it is reported, never dropped in silence, and it
        // stops here rather than reaching a listener.
        this.reportUnrecognisedEventType(type)
        return null
    }
  }

  /**
   * A line whose type cannot be looked up: named in main's report and counted there, so a
   * repetition raises one backlog entry's count rather than adding another. The key is the
   * value that arrived, JSON so that `7`, `'7'` and `null` are three different facts; an
   * event with no type at all is a fact of its own.
   */
  private reportUnrecognisedEventType(type: unknown): void {
    if (type === undefined) {
      reportMainError('[main] audio engine sent an event with no type', 'audio-event-type:none')
      return
    }
    const name = JSON.stringify(type) ?? String(type)
    reportMainError(
      `[main] audio engine sent an unrecognised event type ${typeof type === 'string' ? `'${type}'` : name}`,
      `audio-event-type:${name}`
    )
  }

  private handleSocketError(error: Error): void {
    this.lastStatus.lastError = describeError(error)
  }

  /**
   * A socket closing is only news if it is the socket this engine is talking on. A
   * replaced child's socket can close after its replacement is connected — the process
   * takes seconds to die under a wedged driver — and mistaking that for the current
   * connection would tear the replacement down with it.
   */
  private handleSocketClose(socket: Socket): void {
    if (socket !== this.socket) return
    this.socket = null
    this.failPending(new AudioEngineError('engine', 'audio engine connection closed'))
    this.failGreeting(new AudioEngineError('engine', 'audio engine connection closed'))
    if (this.shuttingDown) return
    if (this.child === null) return  // the exit handler owns that case
    this.scheduleRestart('audio engine connection closed')
  }

  /**
   * And an exit is only news if it is the child this engine spawned. One death arrives
   * twice — the socket closes and the child exits — and a handler that answered both
   * spent two of the three restart attempts and logged the fault twice for one crash.
   */
  private handleExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (child !== this.child) return
    const reason = `audio engine exited (${code ?? signal ?? 'unknown'})`
    this.child = null
    if (this.socket !== null) {
      this.socket.removeAllListeners('close')
      this.socket.destroy()
      this.socket = null
    }
    this.failPending(new AudioEngineError('engine', reason))
    this.failGreeting(new AudioEngineError('engine', reason))
    if (this.shuttingDown) return
    this.scheduleRestart(reason)
  }

  private scheduleRestart(reason: string): void {
    this.lastStatus.lastError = reason
    this.emitEngineError('engine', reason)
    if (this.lastStatus.restarts >= MAX_RESTARTS) return
    const delay = RESTART_BACKOFF_MS[Math.min(this.lastStatus.restarts, RESTART_BACKOFF_MS.length - 1)]
    this.lastStatus.restarts += 1
    if (this.restartTimer !== null) clearTimeout(this.restartTimer)
    // A retry replaces the child; the old one must not be left holding the device.
    this.killChild()
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.ensureStarted().catch((error) => {
        this.lastStatus.lastError = describeError(error)
      })
    }, delay)
  }

  private emitEngineError(code: 'engine' | 'device', message: string): void {
    const event: AudioEngineEvent = {
      type: 'error',
      at: 0,
      cueId: null,
      runId: null,
      code,
      message,
      // The session this process last heard from: the fault is about leaving it.
      sessionId: this.lastSessionId ?? ''
    }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore listener failures
      }
    }
  }

  private teardown(): void {
    this.child = null
    if (this.socket !== null) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
    this.buffer = ''
    // A connect waiting on a declaration that can no longer arrive must not sit out its
    // timeout: whatever tore the connection down is the reason it failed.
    this.greeting = null
    this.failGreeting(new AudioEngineError('engine', 'audio engine connection closed'))
  }

  /** Fails whoever is waiting on a greeting the connection that owed it can no longer send. */
  private failGreeting(error: Error): void {
    const waiter = this.greetingWaiter
    this.greetingWaiter = null
    waiter?.reject(error)
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    if (child !== null && child.exitCode === null && child.signalCode === null) child.kill()
  }

  /**
   * Kills the engine child outright, for the restart path's own acceptance test: what
   * the show must survive is the engine dying, not the engine being asked to stop, so
   * this is a hard kill and no shutdown verb goes out first. Reachable only through the
   * dev harness, which a packaged build never installs.
   */
  crashForTest(): void {
    const child = this.child
    if (child === null || child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGKILL')
  }

  /**
   * Asks the engine to lose its device, for the device-loss acceptance test. The engine
   * runs the same classification its backend callback runs and refuses the verb when a
   * real device is open, so this can neither stand in for nor mask a genuine event; only
   * the silent/offline backends — which is where the test suite runs — accept it.
   * Reachable only through the dev harness, which a packaged build never installs.
   */
  simulateDeviceLossForTest(): Promise<void> {
    return this.request('simulateDeviceNotification', { type: 'stopped', deliberate: false }).then(() => undefined)
  }

  /**
   * One linear-timecode verb (native/audio/src/ltc.h), answered as the engine answers it.
   * The timecode module owns the shapes on either side (src/main/timecode/ltc.ts); this is
   * only the door to the socket, so the LTC block of the wire has one caller.
   */
  ltc(verb: Extract<AudioWireVerb, `ltc${string}`>, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.request(verb, params)
  }

  private failPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private request(verb: AudioWireVerb, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const socket = this.socket
    if (socket === null || socket.destroyed) {
      return Promise.reject(new AudioEngineError('engine', 'audio engine is not running'))
    }
    const id = this.nextRequestId++
    const payload: Record<string, unknown> = { id, verb }
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) payload[key] = value
    }
    const { promise, resolve, reject } = Promise.withResolvers<unknown>()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      reject(new AudioEngineError('engine', `audio engine timed out on ${verb}`))
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()
    this.pending.set(id, { resolve, reject, timer })
    socket.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new AudioEngineError('engine', `audio engine send failed: ${describeError(error)}`))
      }
    })
    return promise
  }
}

export const audioEngine = new NativeAudioEngine()
