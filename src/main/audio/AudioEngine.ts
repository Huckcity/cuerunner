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
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, type Socket } from 'node:net'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AudioCancelResult,
  AudioClockReading,
  AudioErrorCode,
  AudioCommandResult,
  AudioCrosspoint,
  AudioDeviceInfo,
  AudioEndReason,
  AudioEngineEvent,
  AudioEngineInfo,
  AudioFadeCurve,
  AudioFadeParam,
  AudioMetadata,
  AudioPanicResult,
  AudioProbe,
  AudioProgress,
  AudioSeekResult,
  AudioStartOptions,
  AudioStartResult,
  AudioVoiceState,
  AudioWaveform,
  DeviceOptions
} from '../../shared/audio'
import { AUDIO_PROTOCOL_VERSION } from '../../shared/audio'

const REQUEST_TIMEOUT_MS = 15_000
const SLOW_REQUEST_TIMEOUT_MS = 60_000
const SPAWN_TIMEOUT_MS = 8_000
const SHUTDOWN_GRACE_MS = 1_000
const MAX_RESTARTS = 3
const RESTART_BACKOFF_MS = [250, 1000, 4000]

/** Verbs that touch the disk or the device list and get the longer deadline. */
const SLOW_VERBS: Record<string, number> = {
  prepare: SLOW_REQUEST_TIMEOUT_MS,
  probe: SLOW_REQUEST_TIMEOUT_MS,
  waveform: SLOW_REQUEST_TIMEOUT_MS,
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
  const override = readEnv('WINSLAB_AUDIO_BIN')
  if (override) return existsSync(override) ? override : null
  const name = process.platform === 'win32' ? 'winslab-audio.exe' : 'winslab-audio'
  const candidates = appIsPackaged()
    ? [join(process.resourcesPath, 'audio', name)]
    : [join(process.cwd(), 'native', 'audio', 'build', name)]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

function socketPath(): string {
  const override = readEnv('WINSLAB_AUDIO_SOCKET')
  if (override) return override
  const suffix = `${process.pid}-${Date.now().toString(36)}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\winslab-audio-${suffix}`
    : join(tmpdir(), `winslab-audio-${suffix}.sock`)
}

export class NativeAudioEngine {
  private child: ChildProcess | null = null
  private socket: Socket | null = null
  private startPromise: Promise<void> | null = null
  private buffer = ''
  private nextRequestId = 1
  private pending = new Map<number, PendingRequest>()
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

  cancel(cueId: string, whenMs?: number): Promise<AudioCancelResult> {
    return this.request('cancel', { cueId, whenMs }) as Promise<AudioCancelResult>
  }

  fade(
    cueId: string,
    param: AudioFadeParam,
    value: number,
    durationMs: number,
    curve: AudioFadeCurve,
    whenMs?: number
  ): Promise<AudioCommandResult> {
    return this.request('fade', { cueId, param, value, durationMs, curve, whenMs }) as Promise<AudioCommandResult>
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
    const result = (await this.request('configure', { options }, SLOW_VERBS.configure)) as AudioEngineInfo
    this.lastInfo = result
    return result
  }

  waveform(filePath: string, points: number): Promise<AudioWaveform> {
    // The requested point count goes over the wire unchanged: the engine clamps it to
    // its own bound and reports back whether it had to, which is what the caller shows.
    return this.request('waveform', { filePath, points }, SLOW_VERBS.waveform) as Promise<AudioWaveform>
  }

  private async spawnAndConnect(): Promise<void> {
    const binaryPath = resolveBinaryPath()
    this.lastStatus.binaryPath = binaryPath
    if (binaryPath === null) {
      const message = readEnv('WINSLAB_AUDIO_BIN')
        ? `audio engine not found at ${readEnv('WINSLAB_AUDIO_BIN')} (build it with: npm run build:native)`
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
    const args = ['--socket', path, '--backend', readEnv('WINSLAB_AUDIO_BACKEND') ?? 'auto']
    const capture = readEnv('WINSLAB_TEST_AUDIO_CAPTURE')
    if (capture !== undefined && !appIsPackaged()) args.push('--capture', capture)
    const deviceId = readEnv('WINSLAB_AUDIO_DEVICE')
    if (deviceId !== undefined) args.push('--device', deviceId)
    const exclusive = readEnv('WINSLAB_AUDIO_EXCLUSIVE')
    if (exclusive !== undefined) args.push('--exclusive', exclusive)
    const sampleRate = readEnv('WINSLAB_AUDIO_SAMPLE_RATE')
    if (sampleRate !== undefined) args.push('--sample-rate', sampleRate)

    const child = spawn(binaryPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
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
      process.stderr.write(text.startsWith('[winslab-audio]') ? `${text}\n` : `[winslab-audio] ${text}\n`)
    })
    child.on('exit', (code, signal) => this.handleExit(code, signal))

    try {
      await this.connectWithRetry(path, child)
      const info = await this.info()
      this.lastInfo = info
      if (info.protocol !== AUDIO_PROTOCOL_VERSION) {
        const mismatch = `audio engine protocol ${info.protocol} does not match this build (${AUDIO_PROTOCOL_VERSION})`
        this.lastStatus.lastError = mismatch
        throw new AudioEngineError('engine', mismatch)
      }
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

  private connectWithRetry(path: string, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + SPAWN_TIMEOUT_MS
    const { promise, resolve, reject } = Promise.withResolvers<void>()
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
          socket.on('data', (chunk: Buffer) => this.handleStdout(chunk))
          socket.on('error', (error) => this.handleSocketError(error))
          socket.on('close', () => this.handleSocketClose())
          resolve()
        })
    }
    attempt()
    return promise
  }

  private handleStdout(chunk: Buffer): void {
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
      if (line !== '') this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(line: string): void {
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      this.emitEngineError('engine', 'audio engine sent a malformed line')
      return
    }
    if (parsed === null || typeof parsed !== 'object') return
    const record = parsed as Record<string, unknown>
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
    const typed = this.normalizeEvent(event)
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
        return null
    }
  }

  private handleSocketError(error: Error): void {
    this.lastStatus.lastError = describeError(error)
  }

  private handleSocketClose(): void {
    this.socket = null
    this.failPending(new AudioEngineError('engine', 'audio engine connection closed'))
    if (this.shuttingDown) return
    if (this.child === null) return  // the exit handler owns that case
    this.scheduleRestart('audio engine connection closed')
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    const reason = `audio engine exited (${code ?? signal ?? 'unknown'})`
    this.child = null
    if (this.socket !== null) {
      this.socket.removeAllListeners('close')
      this.socket.destroy()
      this.socket = null
    }
    this.failPending(new AudioEngineError('engine', reason))
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

  private failPending(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }

  private request(verb: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
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
