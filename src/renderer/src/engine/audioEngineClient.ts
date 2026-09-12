// The renderer's only way to the audio engine. Every call is an execution verb on the
// native service in the main process — nothing here decodes, streams or holds media:
// the renderer schedules commands on the native sample clock and reads back positions.
//
// The shapes are the shared contract's (src/shared/audio.ts), so main, preload and this
// client cannot drift apart.
//
// `nowMs()` is the sample clock, projected from the last reading so a scheduler can use
// it synchronously. Commands carry absolute times on that clock, so a command issued
// early still starts precisely when it was meant to.

import type {
  AudioDeviceInfo,
  AudioEngineBridge,
  AudioEngineEvent,
  AudioEngineInfo,
  AudioFadeParam,
  AudioMetadata,
  AudioProbe,
  AudioProgress,
  AudioSeekResult,
  AudioStartOptions,
  AudioStartResult,
  AudioWaveform,
  DeviceOptions
} from '../../../shared/audio'

export type {
  AudioDeviceInfo,
  AudioEngineEvent,
  AudioEngineInfo,
  AudioFadeParam,
  AudioMetadata,
  AudioProbe,
  AudioProgress,
  AudioSeekResult,
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

const bridge = (): AudioEngineBridge => {
  // The engine lives on the existing `audio` namespace, beside the file dialog.
  const engine = window.winslab.audio
  if (!engine) throw new Error('The audio engine bridge is not available.')
  return engine
}

export class AudioEngineClient {
  // Sample-clock anchor: a reading, plus the local clock at the moment it arrived.
  private anchor: { sampleMs: number; perfMs: number } | null = null
  private ticker: number | null = null
  private clockInFlight = false
  private progressInFlight = new Set<string>()
  private subscribers = new Set<() => void>()
  private eventSubscribers = new Set<(event: AudioEngineEvent) => void>()
  private unwatchBridge: (() => void) | null = null
  private watched = new Set<string>()
  private progressCache = new Map<string, AudioProgress | null>()
  private probeCache = new Map<string, AudioProbe>()

  /** Sample-clock now, ms. Monotonic; before the first reading, 0 (start immediately). */
  nowMs(): number {
    if (!this.anchor) return 0
    return this.anchor.sampleMs + (performance.now() - this.anchor.perfMs)
  }

  /** Reads the clock once so `nowMs()` has an anchor before the first command. */
  async syncClock(): Promise<void> {
    const sampleMs = await bridge().clock()
    this.adoptClock(sampleMs, performance.now())
  }

  /**
   * Takes a reading into the projection, unless it would move the show's clock
   * backwards. Readings that run ahead are always taken — that is the normal case, and
   * it is how the projection is kept honest — while one that only repeats, or that
   * falls back, is the sound of an engine that is not keeping time. The show carries on
   * from where it was instead of stalling with it.
   */
  private adoptClock(sampleMs: number, perfMs: number): void {
    if (this.anchor) {
      const projected = this.anchor.sampleMs + (perfMs - this.anchor.perfMs)
      if (sampleMs < projected - CLOCK_REWIND_TOLERANCE_MS) return
    }
    this.anchor = { sampleMs, perfMs }
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
    if (event.type === 'ended') {
      this.watched.delete(event.cueId)
      this.progressCache.delete(event.cueId)
    } else if (event.type === 'error' && event.cueId) {
      this.watched.delete(event.cueId)
      this.progressCache.delete(event.cueId)
    } else if (event.type === 'state' && event.cueId && !event.playing) {
      this.watched.delete(event.cueId)
      this.progressCache.delete(event.cueId)
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
      .then(sampleMs => this.adoptClock(sampleMs, performance.now()))
      .catch(() => {
        // No answer: the projection carries the show on the last reading it had.
      })
      .finally(() => { this.clockInFlight = false })
  }

  private pollProgress(): void {
    for (const cueId of this.watched) {
      if (this.progressInFlight.has(cueId)) continue
      this.progressInFlight.add(cueId)
      void bridge().progress(cueId)
        .then(snapshot => {
          if (snapshot) this.progressCache.set(cueId, snapshot)
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
    const result = await bridge().start(cueId, whenMs, options)
    this.watched.add(cueId)
    return result
  }

  async stop(cueId: string, fadeMs = 0, whenMs?: number): Promise<void> {
    await bridge().stop(cueId, fadeMs, whenMs)
    this.watched.delete(cueId)
    this.progressCache.delete(cueId)
  }

  async stopAll(fadeMs = 0): Promise<void> {
    await bridge().stopAll(fadeMs)
    this.watched.clear()
    this.progressCache.clear()
  }

  /** Moves a running cue's playhead without touching its envelope. */
  seek(cueId: string, positionMs: number, whenMs?: number): Promise<AudioSeekResult> {
    return bridge().seek(cueId, positionMs, whenMs)
  }

  /** Drops a cue's future-dated verbs — a start or a stop that has not fired yet. */
  cancel(cueId: string, whenMs?: number): Promise<void> {
    return bridge().cancel(cueId, whenMs).then(() => undefined)
  }

  fade(
    cueId: string,
    param: AudioFadeParam,
    value: number,
    durationMs = 0,
    curve: 'linear' | 'sCurve' | 'logarithmic' = 'linear',
    whenMs?: number
  ): Promise<void> {
    return bridge().fade(cueId, param, value, durationMs, curve, whenMs).then(() => undefined)
  }

  async panic(fadeMs: number): Promise<void> {
    await bridge().panic(fadeMs)
    this.watched.clear()
    this.progressCache.clear()
  }

  clock(): Promise<number> {
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

  waveform(filePath: string, points: number): Promise<AudioWaveform> {
    return bridge().waveform(filePath, points)
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
