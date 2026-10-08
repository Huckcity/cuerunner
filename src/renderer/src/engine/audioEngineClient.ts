// The renderer's only way to the audio engine. Every call is an execution verb on the
// native service in the main process — nothing here decodes, streams or holds media:
// the renderer schedules commands on the native sample clock and reads back positions.
//
// The shapes are the shared contract's (src/shared/audio.ts), so main, preload and this
// client cannot drift apart.
//
// `nowMs()` is the show clock: the engine's sample clock plus an epoch this client
// keeps, projected from the last reading so a scheduler can use it synchronously. Until
// an engine has answered it runs on the window's own clock, so a show is never waiting on
// an engine to tell it the time.
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
  AudioCrosspoint,
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
  AudioLoudness,
  AudioInputDevice,
  AudioInputOpenOptions,
  AudioInputStatus,
  AudioMeters,
  AudioOutputDevice,
  AudioOutputOpenOptions,
  AudioOutputStatus,
  AudioPatchResult,
  AudioProgress,
  AudioSeekResult,
  AudioRegion,
  AudioStartOptions,
  AudioStartResult,
  AudioWaveform,
  DeviceOptions
} from '../../../shared/audio'
import { audioEngineError } from '../../../shared/audioResult'

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

/**
 * How often the engine is asked for the time while nothing is sounding.
 *
 * Every beat still runs the show — the subscribers are called each tick, on a clock this
 * client projects from its last reading — so what this spaces out is only the asking: a
 * round trip to the main process and on to the engine, which at one per beat was forty a
 * second for the life of the window, most of it spent with a show standing by. The
 * projection runs on the window's own clock between readings, and that clock and a sound
 * card's drift apart by fractions of a millisecond a second, well inside the lookahead a
 * command is sent with. While a voice is playing the clock is read every beat, as before.
 */
export const IDLE_CLOCK_REFRESH_MS = 1000

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

/**
 * The engine's verbs, with a refusal arriving as the exception it is.
 *
 * The preload rejects with the refusal as a plain value, because that is the only form in
 * which its `code` survives the context bridge; this is the one place the window reaches
 * the engine through, so it is the one place that value becomes an `AudioEngineError`
 * again. Read through to `window.cuerunner.audio` on every call rather than wrapped once:
 * the object the bridge exposes is frozen, which a proxy over it may not contradict, and a
 * test replaces it between cases.
 */
const engineBridge = new Proxy({} as AudioEngineBridge, {
  get(_target, verb) {
    // The engine lives on the existing `audio` namespace, beside the file dialog.
    const engine = window.cuerunner.audio
    if (!engine) throw new Error('The audio engine bridge is not available.')
    const member: unknown = Reflect.get(engine, verb)
    if (typeof member !== 'function') return member
    return (...args: unknown[]): unknown => {
      const answer: unknown = Reflect.apply(member, engine, args)
      // Only a verb answers with a promise: a subscription hands back its unsubscribe.
      return answer instanceof Promise
        ? answer.catch((thrown: unknown) => { throw audioEngineError(thrown) })
        : answer
    }
  }
})

const bridge = (): AudioEngineBridge => engineBridge

export class AudioEngineClient {
  // Engine-clock anchor: a reading, plus the local clock at the moment it arrived.
  private anchor: { engineMs: number; perfMs: number } | null = null
  // The local-clock moment the show clock began counting without an engine, or null when
  // it was never asked for the time before a reading arrived.
  private unanchoredSincePerfMs: number | null = null
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
  /** The window-clock moment the engine was last asked for the time. */
  private clockAskedAtPerfMs = Number.NEGATIVE_INFINITY
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

  /**
   * Show-clock now, ms. Monotonic.
   *
   * Before any engine has answered, the clock runs on this window's own: it starts at 0
   * the first time it is asked and counts from there. It used to stand at 0 until a
   * reading arrived, which was a stopped clock for as long as the engine was not there —
   * an engine that never started held every wait, every pre-wait and every advance in the
   * show for ever, though none of them needs a device to count. The first reading takes
   * over from wherever this had got to (`adoptClock`), so nothing scheduled meanwhile moves.
   */
  nowMs(): number {
    // A held show stands still: nothing scheduled on this clock comes due while it is held.
    if (this.heldAtMs !== null) return this.heldAtMs
    if (!this.anchor) {
      const perfMs = performance.now()
      if (this.unanchoredSincePerfMs === null) this.unanchoredSincePerfMs = perfMs
      return perfMs - this.unanchoredSincePerfMs
    }
    return this.anchor.engineMs + (performance.now() - this.anchor.perfMs) + this.currentEpoch()
  }

  /** The show-clock moment the show was held at, or null while it runs. */
  private heldAtMs: number | null = null

  /**
   * Holds the show clock where it stands: `nowMs()` reads the same until it is released, so
   * no wait, pre-wait, handover or planned end comes due. The engine's own clock goes on —
   * the voices the show is holding are held in the engine, by the runner.
   */
  holdClock(): void {
    if (this.heldAtMs !== null) return
    this.heldAtMs = this.nowMs()
  }

  /** Whether the show clock is held. */
  clockHeld(): boolean {
    return this.heldAtMs !== null
  }

  /**
   * Lets the show clock go on from where it was held. The engine's clock kept running, so
   * the projection absorbs the time held — the same way it absorbs an engine that was
   * replaced — and a time on the show clock maps to an engine time that is that much later.
   */
  releaseClock(): void {
    const heldAt = this.heldAtMs
    if (heldAt === null) return
    this.heldAtMs = null
    const live = this.nowMs()
    const gap = live - heldAt
    if (gap <= 0) return
    if (!this.anchor) {
      if (this.unanchoredSincePerfMs !== null) this.unanchoredSincePerfMs += gap
      return
    }
    if (this.sessionId !== null) this.epochs.set(this.sessionId, this.currentEpoch() - gap)
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
      // The first engine to answer takes the show clock over where the window's own had
      // got to, the same way a replacement engine takes over from the one before it: the
      // epoch absorbs the difference. A clock nobody had read yet has nowhere to carry on
      // from, and show time is simply the engine's.
      const ranForMs = this.unanchoredSincePerfMs === null ? null : perfMs - this.unanchoredSincePerfMs
      this.recordSession(reading.sessionId, ranForMs === null ? 0 : ranForMs - engineMs)
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
      this.dropWatchesForOtherSessions()
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

  /**
   * A run this client is watching belonged to the engine that has gone: the replacement
   * never heard of it, so nothing will ever answer for it — and the watch would go on
   * asking, every tick for the rest of the session, for a cue that will never play.
   */
  private dropWatchesForOtherSessions(): void {
    for (const [cueId, watch] of [...this.watched]) {
      if (watch.sessionId === this.sessionId) continue
      this.watched.delete(cueId)
      this.progressCache.delete(cueId)
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

  /**
   * A show-clock time as the engine's own clock reads it. Public for the one other process
   * that has to place things on the engine's clock — a video output, which keeps its
   * pictures on the clock the sound of them is scheduled on (src/renderer/src/output).
   */
  engineTime(showMs: number): number {
    return this.toEngineMs(showMs)
  }

  /** An engine-clock time, as show time: the inverse of `engineTime`, for what an output reports. */
  showTime(engineMs: number): number {
    return this.toShowMs(engineMs)
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
    if (this.clockIsDue()) this.refreshClock()
    this.pollProgress()
    for (const cb of this.subscribers) cb()
  }

  /**
   * Whether this beat asks the engine for the time. Every beat until there is a reading
   * to project from, and every beat while a voice is playing; otherwise once per
   * `IDLE_CLOCK_REFRESH_MS`, which is also how soon a replaced engine is noticed by a
   * show that is standing by.
   */
  private clockIsDue(): boolean {
    if (this.anchor === null || this.watched.size > 0) return true
    return performance.now() - this.clockAskedAtPerfMs >= IDLE_CLOCK_REFRESH_MS
  }

  /** Asks the engine for the time; the answer updates the projection when it lands. */
  private refreshClock(): void {
    // A wedged engine must not accumulate a queue of reads it will never serve.
    if (this.clockInFlight) return
    this.clockInFlight = true
    this.clockAskedAtPerfMs = performance.now()
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
    // The watch, though, belongs to whatever engine is current now: the command was sent
    // before the await and an engine replaced in between is the one that owns the run.
    // Pinned to the session from before it, no line about the run could ever match it,
    // and the polling would never stop.
    this.watched.set(cueId, { sessionId: this.sessionId ?? '', runId: result.runId })
    return { ...result, startAtMs: result.startAtMs + this.epochFor(sessionId) }
  }

  /**
   * Starts a live voice: `channels` of the input `device` as the voice's own channels, at
   * show time `whenMs`. Watched like a file voice, so its end and its progress come back the
   * same way.
   */
  async startInput(
    cueId: string,
    whenMs: number,
    device: string,
    channels: number[],
    options: Partial<AudioStartOptions>
  ): Promise<AudioStartResult> {
    const sessionId = this.sessionId ?? ''
    const result = await bridge().startInput(cueId, this.toEngineMs(whenMs), device, channels, options)
    this.watched.set(cueId, { sessionId: this.sessionId ?? '', runId: result.runId })
    return { ...result, startAtMs: result.startAtMs + this.epochFor(sessionId) }
  }

  /** The capture devices a live input can be taken from. */
  inputs(): Promise<AudioInputDevice[]> {
    return bridge().inputs()
  }

  /** Opens a live input ahead of its cue, so GO is instant. */
  inputOpen(options: AudioInputOpenOptions): Promise<AudioInputStatus> {
    return bridge().inputOpen(options)
  }

  inputClose(device: string): Promise<{ closed: boolean }> {
    return bridge().inputClose(device)
  }

  /** Every open live input: its latency, drift correction, counters and meter. */
  inputStatus(): Promise<AudioInputStatus[]> {
    return bridge().inputStatus()
  }

  /**
   * Defines output patch `slot` on `device` ('' is the main device), or clears it with null.
   * The answer says which device it plays on, and why when that is not the one it named.
   */
  async patch(slot: number, outputs: number[] | null, gain: number, device = ''): Promise<AudioPatchResult> {
    const result = await bridge().patch(slot, outputs, gain, device)
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** The output devices a patch can name. */
  outputs(): Promise<AudioOutputDevice[]> {
    return bridge().outputs()
  }

  /** Opens an extra output device — or again, after it was lost: the reconnect. */
  outputOpen(options: AudioOutputOpenOptions): Promise<AudioOutputStatus> {
    return bridge().outputOpen(options)
  }

  outputClose(device: string): Promise<{ closed: boolean }> {
    return bridge().outputClose(device)
  }

  /** Every extra output device: whether it plays, its clock against the main one, its buffer. */
  outputStatus(): Promise<AudioOutputStatus[]> {
    return bridge().outputStatus()
  }

  /** Every device output's own fader, linear. */
  async outputGains(gains: number[]): Promise<AudioCommandResult> {
    const result = await bridge().outputGains(gains)
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** A file's integrated loudness and true peak. */
  loudness(filePath: string): Promise<AudioLoudness> {
    return bridge().loudness(filePath)
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
   * Replaces a running voice's routing matrix where it stands — from the engine's next
   * rendered sample, with no restart, no re-seek and no envelope of its own. `null` is
   * automatic routing, `[]` is silent, a list is the new matrix.
   */
  async routing(cueId: string, outputs: AudioCrosspoint[] | null): Promise<AudioCommandResult> {
    const result = await bridge().routing(cueId, outputs)
    return { ...result, at: this.toShowMs(result.at) }
  }

  /**
   * Ends a running voice's loop and plays it out to the end of the file — or to `endMs`
   * when the cue is trimmed of its trailing silence, which is where its sound stops.
   * The verb a devamp cue sends; `applied` says whether there was a loop to release.
   */
  async release(cueId: string, whenMs?: number, endMs?: number, stopAtSliceEnd?: boolean): Promise<AudioCommandResult> {
    const at = whenMs === undefined ? undefined : this.toEngineMs(whenMs)
    const result = stopAtSliceEnd === true
      ? await bridge().release(cueId, at, endMs, true)
      : await bridge().release(cueId, at, endMs)
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** Holds a cue's voice where it stands; its timed things wait with it. */
  async pause(cueId: string, whenMs?: number): Promise<AudioCommandResult> {
    const result = await bridge().pause(cueId, whenMs === undefined ? undefined : this.toEngineMs(whenMs))
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** Lets a held voice go on. */
  async resume(cueId: string, whenMs?: number): Promise<AudioCommandResult> {
    const result = await bridge().resume(cueId, whenMs === undefined ? undefined : this.toEngineMs(whenMs))
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** Sets the level everything leaves the engine at. */
  async master(gain: number): Promise<AudioCommandResult> {
    const result = await bridge().master(gain)
    return { ...result, at: this.toShowMs(result.at) }
  }

  /** Reads the output's meter: each channel's peak over the last block, after the master. */
  meters(): Promise<AudioMeters> {
    return bridge().meters()
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
    curve: 'linear' | 'sCurve' | 'logarithmic' | 'custom' = 'linear',
    whenMs?: number,
    shape?: number[] | null
  ): Promise<AudioCommandResult> {
    const at = whenMs === undefined ? undefined : this.toEngineMs(whenMs)
    // A fade with no drawn shape is the call it always was.
    const result = shape
      ? await bridge().fade(cueId, param, value, durationMs, 'custom', at, shape)
      : await bridge().fade(cueId, param, value, durationMs, curve, at)
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
