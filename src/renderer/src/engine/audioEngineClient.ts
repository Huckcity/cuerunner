// The renderer's only way to the audio engine. Every call is an execution verb on the
// native service in the main process — nothing here decodes, streams or holds media:
// the renderer schedules commands on the native sample clock and reads back positions.
//
// The shapes are the shared contract's (src/shared/audio.ts), so main, preload and this
// client cannot drift apart.
//
// `nowMs()` is the show clock: the engine's sample clock plus an epoch this client
// keeps, projected from the last reading so a scheduler can use it synchronously.
// Commands carry absolute times on that clock, so a command issued early still starts
// precisely when it was meant to.
//
// The epoch is what makes the show clock survive an engine restart. A respawned engine
// counts from zero again, and it says so with a new session id; when the id changes,
// the epoch is adjusted so `nowMs()` is continuous across the change and every time the
// show holds — a wait mid-count, a cue scheduled for later — is still the time it was.
// Both translations between show time and engine time live here and nowhere else: the
// runner schedules in show time, and this module is the only thing that speaks engine
// time.

import type {
  AudioCancelResult,
  AudioClockReading,
  AudioCommandResult,
  AudioDeviceInfo,
  AudioEngineBridge,
  AudioEngineEvent,
  AudioEngineInfo,
  AudioFadeParam,
  AudioMetadata,
  AudioPanicResult,
  AudioProbe,
  AudioOnsets,
  AudioSilence,
  AudioProgress,
  AudioSeekResult,
  AudioRegion,
  AudioStartOptions,
  AudioStartResult,
  AudioWaveform,
  DeviceOptions
} from '../../../shared/audio'

export type {
  AudioCancelResult,
  AudioClockReading,
  AudioCommandResult,
  AudioDeviceInfo,
  AudioEngineEvent,
  AudioEngineInfo,
  AudioFadeParam,
  AudioMetadata,
  AudioPanicResult,
  AudioProbe,
  AudioProgress,
  AudioSeekResult,
  AudioSilence,
  AudioStartOptions,
  AudioStartResult,
  AudioWaveform,
  DeviceOptions
}

/** How often the renderer looks at the clock and at what is playing. */
export const TICK_MS = 25

/** File measurements kept for the workspace estimate; a show has far fewer files. */
const MAX_PROBES = 256

/**
 * How far behind the show's clock a reading may fall before it is refused. Every phase
 * transition in the show runs on this projection, so an engine that stops answering —
 * a stopped device, a wedged service — must not be able to stop the show with it.
 */
const CLOCK_REWIND_TOLERANCE_MS = 250

/** Restart notices kept for the warnings bar; a show with more than this has bigger
 *  problems than the bar can hold. */
const MAX_SESSION_WARNINGS = 4

/** Sessions whose epochs are kept: current, plus any whose events may still be in flight. */
const MAX_SESSION_EPOCHS = 4

/**
 * The engine was replaced. The show clock is continuous across this — `showMs` is the
 * same instant on both sides of it — so what a listener needs to do is tell the
 * operator and stop trusting anything the old engine was doing.
 */
export interface AudioEngineSessionChange {
  /** The session that ended; null on the first reading of the window's life. */
  previousSessionId: string | null
  sessionId: string
  /** Show-clock ms at the moment of the change. */
  showMs: number
}

/** What the warnings bar says when an engine was replaced under a running show. */
function sessionWarning(change: AudioEngineSessionChange): string {
  return `audio engine restarted (session ${change.sessionId}); the show clock carried on`
}

const bridge = (): AudioEngineBridge => {
  // The engine lives on the existing `audio` namespace, beside the file dialog.
  const engine = window.cuerunner.audio
  if (!engine) throw new Error('The audio engine bridge is not available.')
  return engine
}

export class AudioEngineClient {
  // Engine-clock anchor: a reading, plus the local clock at the moment it arrived.
  private anchor: { engineMs: number; perfMs: number } | null = null
  // Engine time -> show time, one entry per session. The show clock is what the
  // renderer schedules on, so it is the one that has to stay continuous; keeping an
  // entry per session is also what lets a line from the engine that was replaced still
  // be translated on the clock it was written on when it arrives late.
  private epochs = new Map<string, number>()
  /** The session the anchor and every outbound command belong to. */
  private sessionId: string | null = null
  private sessionSubscribers = new Set<(change: AudioEngineSessionChange) => void>()
  private sessionWarningsCache: string[] = []
  private ticker: number | null = null
  private clockInFlight = false
  private progressInFlight = new Set<string>()
  private subscribers = new Set<() => void>()
  private eventSubscribers = new Set<(event: AudioEngineEvent) => void>()
  private unwatchBridge: (() => void) | null = null
  // Cue id -> the run being watched for it. A run is identified by session *and* run
  // id: the engine's run counter starts over with the engine, so `run-1` in a new
  // session is a different run — and a line about an older run of the same cue must
  // not stop the polling for the one playing now.
  private watched = new Map<string, { sessionId: string; runId: string }>()
  private progressCache = new Map<string, AudioProgress | null>()
  private probeCache = new Map<string, AudioProbe>()

  /** Show-clock now, ms. Monotonic; before the first reading, 0 (start immediately). */
  nowMs(): number {
    if (!this.anchor) return 0
    return this.anchor.engineMs + (performance.now() - this.anchor.perfMs) + this.currentEpoch()
  }

  /** The epoch of the session the show is currently running on. */
  private currentEpoch(): number {
    return this.sessionId === null ? 0 : this.epochs.get(this.sessionId) ?? 0
  }

  /**
   * The epoch a time from `sessionId` belongs to. A session that is not known — a line
   * from an engine this client never read a clock from — falls back to the current one:
   * the best guess available, and the right answer for a fault the main process itself
   * raised about the engine that is live now.
   */
  private epochFor(sessionId: string | null): number {
    if (sessionId !== null && sessionId !== '') {
      const known = this.epochs.get(sessionId)
      if (known !== undefined) return known
    }
    return this.currentEpoch()
  }

  /** Reads the clock once so `nowMs()` has an anchor before the first command. */
  async syncClock(): Promise<void> {
    const reading = await bridge().clock()
    this.adoptClock(reading, performance.now())
  }

  /**
   * Subscribes to the engine being replaced. Fires only when the session id changes —
   * not on the first reading of this window's life, which is just the engine this
   * window found running.
   */
  onSessionChange(cb: (change: AudioEngineSessionChange) => void): () => void {
    this.sessionSubscribers.add(cb)
    return () => {
      this.sessionSubscribers.delete(cb)
    }
  }

  /**
   * One line per engine restart this window has seen, newest last. The same lines the
   * warnings bar shows: an engine replaced under a running show is something the
   * operator is told about, not something that happened quietly.
   */
  sessionWarnings(): string[] {
    return this.sessionWarningsCache
  }

  /**
   * Takes a reading into the projection.
   *
   * A reading from a new session is always taken, in either direction: the engine was
   * replaced and counts from zero again, and that reading is the truth about the new
   * one. The epoch absorbs the difference, so the show's clock stays continuous across
   * the change — a wait cue mid-count keeps the rest of its time, and anything
   * scheduled for later is still due at the time it named. The change is announced so
   * the runner and the operator can hear about it.
   *
   * Within one session the guard is the old one: a reading that would move the show's
   * clock backwards is the sound of an engine that is not keeping time, and the show
   * carries on from where it was instead of stalling with it. Readings that run ahead
   * are always taken, which is how the projection is kept honest.
   */
  private adoptClock(reading: AudioClockReading, perfMs: number): void {
    const engineMs = reading.clockMs
    if (this.anchor === null) {
      this.anchor = { engineMs, perfMs }
      this.recordSession(reading.sessionId, 0)
      return
    }

    const projectedEngineMs = this.anchor.engineMs + (perfMs - this.anchor.perfMs)
    if (reading.sessionId !== this.sessionId) {
      const previousEpoch = this.currentEpoch()
      const change: AudioEngineSessionChange = {
        previousSessionId: this.sessionId,
        sessionId: reading.sessionId,
        showMs: projectedEngineMs + previousEpoch
      }
      // The new epoch is chosen so the show clock reads the same instant after the
      // change as it did before it: showNow = engineNow + epoch, both at `perfMs`.
      this.anchor = { engineMs, perfMs }
      this.recordSession(reading.sessionId, previousEpoch + (projectedEngineMs - engineMs))
      this.announceSessionChange(change)
      return
    }

    if (engineMs < projectedEngineMs - CLOCK_REWIND_TOLERANCE_MS) return
    this.anchor = { engineMs, perfMs }
  }

  /**
   * Makes `sessionId` the session the show is running on, keeping its epoch for as long
   * as a line from it could still arrive. Events are batched on the way here, so an
   * event that the previous engine sent before it died can land after its replacement
   * has been adopted; this is what that line is translated with.
   */
  private recordSession(sessionId: string, epoch: number): void {
    this.epochs.set(sessionId, epoch)
    this.sessionId = sessionId
    while (this.epochs.size > MAX_SESSION_EPOCHS) {
      const oldest = this.epochs.keys().next().value
      if (oldest === undefined || oldest === sessionId) break
      this.epochs.delete(oldest)
    }
  }

  private announceSessionChange(change: AudioEngineSessionChange): void {
    const next = [...this.sessionWarningsCache, sessionWarning(change)]
    this.sessionWarningsCache = next.length > MAX_SESSION_WARNINGS ? next.slice(-MAX_SESSION_WARNINGS) : next
    for (const cb of this.sessionSubscribers) {
      try {
        cb(change)
      } catch {
        // A listener must not be able to stop the show clock with it.
      }
    }
  }

  /** Show-clock ms as the engine's own clock measures it. Every outbound time. */
  private toEngineMs(showMs: number): number {
    return showMs - this.currentEpoch()
  }

  /** The live engine's clock in show time. Every inbound time from it. */
  private toShowMs(engineMs: number): number {
    return engineMs + this.currentEpoch()
  }

  /**
   * Runs `cb` on each 25 ms tick while there is a subscriber or something to track.
   * The callback reads `nowMs()` rather than being handed a time: the clock is shared.
   */
  onTick(cb: () => void): () => void {
    this.subscribers.add(cb)
    this.ensureTicker()
    return () => {
      this.subscribers.delete(cb)
      this.ensureTicker()
    }
  }

  onEvent(cb: (event: AudioEngineEvent) => void): () => void {
    this.eventSubscribers.add(cb)
    if (!this.unwatchBridge) {
      this.unwatchBridge = bridge().onEvents(events => {
        for (const event of events) this.handleEvent(event)
      })
    }
    return () => {
      this.eventSubscribers.delete(cb)
      // The engine subscription stays for the life of the window: the next subscriber
      // should not race a fresh IPC listener against events already in flight.
    }
  }

  private handleEvent(event: AudioEngineEvent): void {
    // Engine time in, show time out — and on the clock of the session that wrote the
    // line, which is not necessarily the one running now: a batch can carry the last
    // words of an engine that has already been replaced.
    event = { ...event, at: event.at + this.epochFor(event.sessionId) }

    const cueId = 'cueId' in event ? event.cueId : null
    if (cueId !== null) {
      const runEnded =
        event.type === 'ended' ||
        event.type === 'error' ||
        (event.type === 'state' && !event.playing)
      const eventRunId = 'runId' in event ? event.runId : null
      const watchedRun = this.watched.get(cueId)
      // A line about a run this client is not watching is not about the run it is
      // watching: only the watched run's own end stops the polling. A line that names
      // no run at all cannot be told apart from one, so it is taken at its word.
      const isWatchedRun = eventRunId === null ||
        (watchedRun !== undefined &&
          eventRunId === watchedRun.runId &&
          // An empty session on either side is an engine this client never read a clock
          // from, so there is nothing to compare and the run id decides.
          (event.sessionId === '' || watchedRun.sessionId === '' || event.sessionId === watchedRun.sessionId))
      if (runEnded && (watchedRun === undefined || isWatchedRun)) {
        this.watched.delete(cueId)
        this.progressCache.delete(cueId)
      }
    }

    for (const cb of this.eventSubscribers) cb(event)
  }

  private ensureTicker(): void {
    const wanted = this.subscribers.size > 0
    if (wanted && this.ticker === null) {
      this.refreshClock()
      this.tick()
      this.ticker = setInterval(() => this.tick(), TICK_MS)
    } else if (!wanted && this.ticker !== null) {
      clearInterval(this.ticker)
      this.ticker = null
    }
  }

  /**
   * One beat. The subscribers run whatever the engine is doing: every phase transition
   * in the show — a pre-wait ending, a cue completing, a post-wait expiring, the next
   * cue's handover — is driven from here, and none of it may wait on a reply that may
   * never come. The clock and progress reads are refreshes, not gates.
   */
  private tick(): void {
    this.refreshClock()
    this.pollProgress()
    for (const cb of this.subscribers) cb()
  }

  /** Asks the engine for the time; the answer updates the projection when it lands. */
  private refreshClock(): void {
    // A wedged engine must not accumulate a queue of reads it will never serve.
    if (this.clockInFlight) return
    this.clockInFlight = true
    void bridge().clock()
      .then(reading => this.adoptClock(reading, performance.now()))
      .catch(() => {
        // No answer: the projection carries the show on the last reading it had.
      })
      .finally(() => { this.clockInFlight = false })
  }

  private pollProgress(): void {
    for (const cueId of this.watched.keys()) {
      if (this.progressInFlight.has(cueId)) continue
      this.progressInFlight.add(cueId)
      void bridge().progress(cueId)
        .then(snapshot => {
          // `startedAtMs` is a clock time like any other; the media positions in the
          // snapshot are positions in the file and are left alone.
          if (snapshot) this.progressCache.set(cueId, { ...snapshot, startedAtMs: this.toShowMs(snapshot.startedAtMs) })
          // Null means the engine no longer knows the cue (it ended between ticks).
          else this.progressCache.delete(cueId)
        })
        .catch(() => {
          // The engine could not answer this time; the last position stands.
        })
        .finally(() => { this.progressInFlight.delete(cueId) })
    }
  }

  /** The last progress reading, synchronously — row bars and playheads read this. */
  getProgress(cueId: string): AudioProgress | null {
    return this.progressCache.get(cueId) ?? null
  }

  // ── verbs ─────────────────────────────────────────────────────────────────────

  prepare(cueId: string, filePath: string): Promise<AudioMetadata> {
    return bridge().prepare(cueId, filePath)
  }

  async start(cueId: string, whenMs: number, options: AudioStartOptions): Promise<AudioStartResult> {
    // The session the command was sent to, captured before the await: the reply's
    // engine time belongs to the session that answered, not to whatever session is
    // current by the time it lands. Empty means no clock has been read yet — the run
    // is watched without a session to compare against.
    const sessionId = this.sessionId ?? ''
    const result = await bridge().start(cueId, this.toEngineMs(whenMs), options)
    this.watched.set(cueId, { sessionId, runId: result.runId })
    return { ...result, startAtMs: result.startAtMs + this.epochFor(sessionId) }
  }

  async stop(cueId: string, fadeMs = 0, whenMs?: number): Promise<AudioCommandResult> {
    const result = await bridge().stop(cueId, fadeMs, whenMs === undefined ? undefined : this.toEngineMs(whenMs))
    this.watched.delete(cueId)
    this.progressCache.delete(cueId)
    return { ...result, at: this.toShowMs(result.at) }
  }

  async stopAll(fadeMs = 0): Promise<AudioCommandResult> {
    const result = await bridge().stopAll(fadeMs)
    this.watched.clear()
    this.progressCache.clear()
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** Moves a running cue's playhead without touching its envelope. */
  async seek(cueId: string, positionMs: number, whenMs?: number): Promise<AudioSeekResult> {
    const result = await bridge().seek(cueId, positionMs, whenMs === undefined ? undefined : this.toEngineMs(whenMs))
    // `positionMs` is a place in the file, not a time on the clock.
    return { ...result, at: this.toShowMs(result.at) }
  }

  /**
   * Ends a running voice's loop and plays it out to the end of the file — or to `endMs`
   * when the cue is trimmed of its trailing silence, which is where its sound stops.
   * The verb a devamp cue sends; `applied` says whether there was a loop to release.
   */
  async release(cueId: string, whenMs?: number, endMs?: number): Promise<AudioCommandResult> {
    const result = await bridge().release(cueId, whenMs === undefined ? undefined : this.toEngineMs(whenMs), endMs)
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** Drops a cue's future-dated verbs — a start or a stop that has not fired yet. */
  async cancel(cueId: string, whenMs?: number): Promise<AudioCancelResult> {
    const result = await bridge().cancel(cueId, whenMs === undefined ? undefined : this.toEngineMs(whenMs))
    return { ...result, at: this.toShowMs(result.at) }
  }

  async fade(
    cueId: string,
    param: AudioFadeParam,
    value: number,
    durationMs = 0,
    curve: 'linear' | 'sCurve' | 'logarithmic' = 'linear',
    whenMs?: number
  ): Promise<AudioCommandResult> {
    const result = await bridge().fade(
      cueId, param, value, durationMs, curve, whenMs === undefined ? undefined : this.toEngineMs(whenMs)
    )
    return { ...result, at: this.toShowMs(result.at) }
  }

  async panic(fadeMs: number): Promise<AudioPanicResult> {
    const result = await bridge().panic(fadeMs)
    this.watched.clear()
    this.progressCache.clear()
    return { ...result, at: this.toShowMs(result.at) }
  }

  /**
   * One raw reading of the engine's own clock, in engine time — the show clock the rest
   * of the renderer uses is `nowMs()`. A session change here is what the projection
   * would absorb on its next tick; this is the unmapped number.
   */
  clock(): Promise<AudioClockReading> {
    return bridge().clock()
  }

  info(): Promise<AudioEngineInfo> {
    return bridge().info()
  }

  devices(): Promise<AudioDeviceInfo[]> {
    return bridge().devices()
  }

  configure(options: DeviceOptions): Promise<AudioEngineInfo> {
    return bridge().configure(options)
  }

  /** Where the notes and hits begin, for placing slice boundaries. */
  onsets(filePath: string, sensitivity = 1, maxOnsets = 2000, region?: AudioRegion): Promise<AudioOnsets> {
    return bridge().onsets(filePath, sensitivity, maxOnsets, region)
  }

  /** Where a file's sound starts and stops, for trimming the silence at its edges. */
  silence(filePath: string, thresholdDb?: number): Promise<AudioSilence> {
    return bridge().silence(filePath, thresholdDb)
  }

  waveform(filePath: string, points: number, region?: AudioRegion): Promise<AudioWaveform> {
    return bridge().waveform(filePath, points, region)
  }

  /**
   * Metadata for one file, measured without decoding it and without touching the cache:
   * the engine reads the container's header and nothing else. Kept per path, so a
   * workspace's files are measured once rather than once per render.
   */
  async probe(filePath: string): Promise<AudioProbe> {
    const measured = this.probeCache.get(filePath)
    if (measured) return measured

    const probe = await bridge().probe(filePath)
    if (this.probeCache.size >= MAX_PROBES) {
      const oldest = this.probeCache.keys().next().value
      if (oldest !== undefined) this.probeCache.delete(oldest)
    }
    this.probeCache.set(filePath, probe)
    return probe
  }

  /** The engine's own file dialog for a cue's media. */
  pickFile(): Promise<string | null> {
    return bridge().pickFile()
  }
}

export const audioEngine = new AudioEngineClient()
