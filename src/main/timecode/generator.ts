/**
 * The clocks a timecode cue runs: one per cue, each writing MTC to a MIDI port, LTC to an
 * engine output channel and ArtTimeCode to the network, in any mix, all from one position.
 *
 * A generator's position is an anchor — a frame and the moment it was true — carried on at
 * the rate while it runs, so pausing, locating and resuming are all "move the anchor", and
 * every output reads the same number. MTC is paced here, quarter frame by quarter frame on a
 * short timer; LTC is paced by the engine's sample clock, so it is told where to be and left
 * to it; ArtTimeCode goes out once a frame from the same timer as MTC.
 *
 * A jam-synced generator starts from the clock being received and keeps to it, and when that
 * clock drops out it carries on alone: what a jam sync is for is a show that does not stop
 * because a cable did.
 */
import { MtcClock, encodeFullFrame } from './mtc'
import { encodeArtTimecode } from './artnet'
import type { LtcClient } from './ltc'
import {
  convertFrames,
  framesToTimecode,
  positionAt,
  rateInfo,
  wrapFrames,
  type TimecodeGenerateRequest,
  type TimecodeGeneratorAction,
  type TimecodeGeneratorStatus,
  type TimecodeRate,
  type TimecodeReceiverStatus
} from '../../shared/timecode'

export interface GeneratorDeps {
  now(): number
  /** MTC bytes to a MIDI output port. */
  sendMidi(port: string, messages: number[][]): { ok: boolean; error?: string }
  /** The engine's LTC voices, or null where there is no engine. */
  ltc: LtcClient | null
  /** One ArtTimeCode datagram to an address. */
  sendArtnet(host: string, packet: Buffer): void
  /** The clock being received, for a jam sync. */
  incoming(): TimecodeReceiverStatus
  /** A generator reached its end on its own. */
  ended?(cueId: string): void
  /** How often the MTC timer runs, ms; tests drive `tick` themselves and pass 0. */
  tickMs?: number
}

export type GeneratorResult = { ok: true; startFrames: number } | { ok: false; error: string }

interface Running {
  request: TimecodeGenerateRequest
  rate: TimecodeRate
  anchorFrames: number
  anchorAt: number
  running: boolean
  mtc: MtcClock | null
  lastArtnetFrame: number | null
  /** An output that failed once is reported once, not on every quarter frame. */
  failed: Set<string>
}

/** A jam sync relocates when the clock it follows is this many frames away from it. */
const JAM_TOLERANCE_FRAMES = 1.5
const DEFAULT_TICK_MS = 2

export class TimecodeGenerators {
  private generators = new Map<string, Running>()
  private timer: ReturnType<typeof setInterval> | null = null
  /** The last error a generator met, for the status the window shows. */
  private problems = new Map<string, string>()

  constructor(private readonly deps: GeneratorDeps) {}

  private position(gen: Running, now: number): number {
    if (!gen.running) return gen.anchorFrames
    return gen.anchorFrames + ((now - gen.anchorAt) * rateInfo(gen.rate).fps) / 1000
  }

  /** Where the clock being received is, at this generator's rate, when it is running. */
  private jamTarget(rate: TimecodeRate, now: number): number | null {
    const incoming = this.deps.incoming()
    if (incoming.state !== 'locked') return null
    const at = positionAt(incoming, now)
    if (at === null) return null
    return convertFrames(at, incoming.rate, rate)
  }

  async start(request: TimecodeGenerateRequest): Promise<GeneratorResult> {
    if (request.mtcPort === null && request.ltcChannel === null && request.artnetHost === null) {
      return { ok: false, error: 'the cue has no output to send timecode to' }
    }
    // A cue started again replaces its own clock rather than running two.
    if (this.generators.has(request.cueId)) await this.stop(request.cueId)
    const now = this.deps.now()
    let startFrames = request.startFrames
    if (request.jam) {
      const target = this.jamTarget(request.rate, now)
      if (target === null) return { ok: false, error: 'jam sync has no incoming timecode to start from' }
      startFrames = target
    }
    const gen: Running = {
      request,
      rate: request.rate,
      anchorFrames: startFrames,
      anchorAt: now,
      running: true,
      mtc: null,
      lastArtnetFrame: null,
      failed: new Set()
    }
    this.generators.set(request.cueId, gen)
    this.problems.delete(request.cueId)

    if (request.ltcChannel !== null) {
      if (this.deps.ltc === null) {
        this.generators.delete(request.cueId)
        return { ok: false, error: 'the audio engine is not running, so LTC cannot be sent' }
      }
      try {
        await this.deps.ltc.start(request.cueId, request.ltcChannel, request.rate, startFrames, request.ltcLevelDb)
      } catch (error) {
        this.generators.delete(request.cueId)
        return { ok: false, error: `LTC: ${describe(error)}` }
      }
    }
    if (request.mtcPort !== null) {
      const sent = this.deps.sendMidi(request.mtcPort, [encodeFullFrame(framesToTimecode(startFrames, request.rate), request.rate)])
      if (!sent.ok) {
        await this.stop(request.cueId)
        return { ok: false, error: sent.error ?? 'MTC could not be sent' }
      }
      gen.mtc = new MtcClock(request.rate, startFrames, now)
    }
    this.tick(now)
    this.ensureTimer()
    return { ok: true, startFrames }
  }

  async control(cueId: string, action: TimecodeGeneratorAction): Promise<boolean> {
    const gen = this.generators.get(cueId)
    if (!gen) return false
    const now = this.deps.now()
    switch (action.action) {
      case 'stop':
        await this.stop(cueId)
        return true
      case 'pause': {
        if (!gen.running) return true
        gen.anchorFrames = this.position(gen, now)
        gen.anchorAt = now
        gen.running = false
        gen.mtc = null
        // A full frame where it stopped, so a receiver stands on the right frame.
        if (gen.request.mtcPort !== null) this.sendMtc(gen, [encodeFullFrame(framesToTimecode(gen.anchorFrames, gen.rate), gen.rate)])
        await this.ltcControl(gen, 'pause')
        return true
      }
      case 'resume': {
        if (gen.running) return true
        gen.anchorAt = now
        gen.running = true
        if (gen.request.mtcPort !== null) gen.mtc = new MtcClock(gen.rate, gen.anchorFrames, now)
        await this.ltcControl(gen, 'locate', gen.anchorFrames)
        await this.ltcControl(gen, 'resume')
        this.ensureTimer()
        return true
      }
      case 'locate':
        await this.locate(gen, action.frames, now)
        return true
    }
  }

  private async locate(gen: Running, frames: number, now: number): Promise<void> {
    gen.anchorFrames = wrapFrames(frames, gen.rate) + (frames - Math.floor(frames))
    gen.anchorAt = now
    gen.lastArtnetFrame = null
    if (gen.request.mtcPort !== null) {
      this.sendMtc(gen, [encodeFullFrame(framesToTimecode(gen.anchorFrames, gen.rate), gen.rate)])
      gen.mtc = gen.running ? new MtcClock(gen.rate, gen.anchorFrames, now) : null
    }
    await this.ltcControl(gen, 'locate', gen.anchorFrames)
    this.tick(now)
  }

  private async ltcControl(gen: Running, action: 'stop' | 'pause' | 'resume' | 'locate', frame = 0): Promise<void> {
    if (gen.request.ltcChannel === null || this.deps.ltc === null) return
    try {
      await this.deps.ltc.control(gen.request.cueId, action, frame)
    } catch (error) {
      this.problems.set(gen.request.cueId, `LTC: ${describe(error)}`)
    }
  }

  async stop(cueId: string): Promise<void> {
    const gen = this.generators.get(cueId)
    if (!gen) return
    this.generators.delete(cueId)
    await this.ltcControl(gen, 'stop')
    if (this.generators.size === 0) this.clearTimer()
  }

  async stopAll(): Promise<void> {
    for (const cueId of [...this.generators.keys()]) await this.stop(cueId)
  }

  /** Sends whatever has come due on every running generator. */
  tick(now = this.deps.now()): void {
    for (const gen of [...this.generators.values()]) {
      if (!gen.running) continue

      if (gen.request.jam) {
        const target = this.jamTarget(gen.rate, now)
        if (target !== null && Math.abs(target - this.position(gen, now)) > JAM_TOLERANCE_FRAMES) {
          void this.locate(gen, target, now)
          continue
        }
      }

      const position = this.position(gen, now)
      const end = gen.request.endFrames
      if (end !== null && position >= end) {
        void this.stop(gen.request.cueId).then(() => this.deps.ended?.(gen.request.cueId))
        continue
      }

      if (gen.mtc !== null) {
        const due = gen.mtc.due(now)
        if (due.length > 0) this.sendMtc(gen, due)
      }
      if (gen.request.artnetHost !== null) {
        const frame = Math.floor(position)
        if (gen.lastArtnetFrame !== frame) {
          gen.lastArtnetFrame = frame
          try {
            this.deps.sendArtnet(gen.request.artnetHost, encodeArtTimecode(framesToTimecode(frame, gen.rate), gen.rate))
          } catch (error) {
            this.problems.set(gen.request.cueId, `Art-Net: ${describe(error)}`)
          }
        }
      }
    }
  }

  private sendMtc(gen: Running, messages: number[][]): void {
    const port = gen.request.mtcPort
    if (port === null) return
    const sent = this.deps.sendMidi(port, messages)
    if (!sent.ok && !gen.failed.has('mtc')) {
      gen.failed.add('mtc')
      this.problems.set(gen.request.cueId, sent.error ?? 'MTC could not be sent')
    }
  }

  status(now = this.deps.now()): TimecodeGeneratorStatus[] {
    return [...this.generators.values()].map(gen => ({
      cueId: gen.request.cueId,
      rate: gen.rate,
      frames: this.position(gen, now),
      at: now,
      running: gen.running,
      outputs: [
        ...(gen.request.mtcPort !== null ? [`MTC "${gen.request.mtcPort}"`] : []),
        ...(gen.request.ltcChannel !== null ? [`LTC output ${gen.request.ltcChannel + 1}`] : []),
        ...(gen.request.artnetHost !== null ? [`Art-Net ${gen.request.artnetHost}`] : [])
      ]
    }))
  }

  /** What went wrong with a generator since it started, if anything did. */
  problem(cueId: string): string | null {
    return this.problems.get(cueId) ?? null
  }

  running(): boolean {
    return this.generators.size > 0
  }

  private ensureTimer(): void {
    const tickMs = this.deps.tickMs ?? DEFAULT_TICK_MS
    if (this.timer !== null || tickMs <= 0) return
    this.timer = setInterval(() => this.tick(), tickMs)
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  dispose(): void {
    this.clearTimer()
    this.generators.clear()
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
