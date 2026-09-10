import type { AudioCue, FadeCurve } from '../types/cue'

export interface AudioProgress {
  elapsedMs: number
  durationMs: number
  fraction: number  // 0–1 position inside the file — the waveform playhead
  runFraction: number  // 0–1 across the whole run including loop repeats — the row bar
}

const CURVE_POINTS = 64

// Decoded buffers are held for reuse until this much audio has accumulated (1 GiB), or
// until this many files have been decoded, whichever comes first.
const MAX_CACHE_BYTES = 1024 * 1024 * 1024
const MAX_CACHED_FILES = 100

/** Float32 samples: 4 bytes each, per channel. */
function decodedBytes(buffer: AudioBuffer): number {
  const samples = typeof buffer.length === 'number' ? buffer.length : 0
  const channels = typeof buffer.numberOfChannels === 'number' ? buffer.numberOfChannels : 0
  return samples * channels * 4
}

// A fade's 0→1 progression. `linear` is the identity; `sCurve` is a smoothstep
// (slow at both ends, fastest in the middle); `logarithmic` is the constant-dB
// style `(1 - e^-4t) / (1 - e^-4)`, which moves most of the way early and then
// spends the fade in the upper part of the range, as a constant-dB fade does.
function curveShape(t: number, curve: FadeCurve): number {
  switch (curve) {
    case 'sCurve':
      return t * t * (3 - 2 * t)
    case 'logarithmic':
      return (1 - Math.exp(-4 * t)) / (1 - Math.exp(-4))
    case 'linear':
      return t
  }
}

// Sample a fade from `from` to `to` into `points` values for
// AudioParam.setValueCurveAtTime. The endpoints are exact: the first value is
// `from` and the last is `to`, whatever the curve.
export function shapeCurve(from: number, to: number, curve: FadeCurve, points: number): Float32Array {
  const values = new Float32Array(points)
  const span = to - from
  for (let i = 0; i < points; i++) {
    const t = points > 1 ? i / (points - 1) : 0
    values[i] = from + span * curveShape(t, curve)
  }
  return values
}

interface ActiveNode {
  source: AudioBufferSourceNode
  gain: GainNode
  trimGain: GainNode
  panner: StereoPannerNode
  startContextTime: number  // AudioContext.currentTime when source.start() was called
  startOffset: number       // offset into file in seconds (cue.startTime / 1000)
  bufferDuration: number    // total file duration in seconds
  cue: AudioCue
  onEnd: (() => void) | undefined
}

class AudioPlayer {
  private ctx: AudioContext | null = null
  private cache = new Map<string, AudioBuffer>()
  private active = new Map<string, ActiveNode>()

  private getCtx(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext()
    return this.ctx
  }

  async load(filePath: string): Promise<AudioBuffer> {
    if (this.cache.has(filePath)) return this.cache.get(filePath)!
    const buffer = await window.winslab.audio.readFile(filePath)
    const decoded = await this.getCtx().decodeAudioData(buffer)
    this.cache.set(filePath, decoded)
    this.evictDecoded()
    return decoded
  }

  getBuffer(filePath: string): AudioBuffer | null {
    return this.cache.get(filePath) ?? null
  }

  // Decoded audio is the largest thing this app holds: a 5-minute stereo file at 48 kHz
  // is 115 MB of float samples. Counting entries alone would let a show with a few dozen
  // songs grow to gigabytes and take the renderer down with it, so the total is what is
  // bounded — oldest first, and never the last one, which is about to play.
  private evictDecoded(): void {
    let total = 0
    for (const buffer of this.cache.values()) total += decodedBytes(buffer)

    for (const filePath of [...this.cache.keys()]) {
      if (this.cache.size === 1) break
      if (this.cache.size <= MAX_CACHED_FILES && total <= MAX_CACHE_BYTES) break
      const buffer = this.cache.get(filePath)
      if (!buffer) break
      this.cache.delete(filePath)
      total -= decodedBytes(buffer)
    }
  }

  async play(cue: AudioCue, onEnd?: () => void, onDurationKnown?: (durationMs: number) => void): Promise<void> {
    if (!cue.filePath) { onEnd?.(); return }
    if (this.active.has(cue.id)) this.stop(cue.id)
    const ctx = this.getCtx()
    if (ctx.state === 'suspended') await ctx.resume()

    const buffer = await this.load(cue.filePath)
    onDurationKnown?.(Math.round(buffer.duration * 1000))
    const output = cue.outputs[0] ?? { volume: 1, pan: 0 }

    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.playbackRate.setValueAtTime(cue.playbackRate, ctx.currentTime)

    const gain = ctx.createGain()
    gain.gain.setValueAtTime(cue.fadeInDuration > 0 ? 0 : output.volume, ctx.currentTime)
    if (cue.fadeInDuration > 0) {
      gain.gain.linearRampToValueAtTime(output.volume, ctx.currentTime + cue.fadeInDuration / 1000)
    }

    const trimGain = ctx.createGain()
    trimGain.gain.setValueAtTime(cue.trim, ctx.currentTime)

    const panner = ctx.createStereoPanner()
    panner.pan.setValueAtTime(output.pan, ctx.currentTime)

    source.connect(gain).connect(trimGain).connect(panner).connect(ctx.destination)

    const startOffset = cue.startTime / 1000
    const playDuration = cue.endTime != null ? (cue.endTime - cue.startTime) / 1000 : undefined
    // The segment a loop repeats: the trimmed region, or the rest of the file.
    const segment = playDuration ?? (buffer.duration - startOffset)

    const startContextTime = ctx.currentTime

    if (cue.loopCount === 0) {
      source.start(0, startOffset, playDuration)
    } else {
      // loopCount is a count of *repeats*, so N loops means N + 1 plays. -1 loops forever.
      // The source loops the segment indefinitely and is stopped once every pass has elapsed.
      source.loop = true
      source.loopStart = startOffset
      source.loopEnd = Math.min(startOffset + segment, buffer.duration)
      const rate = cue.playbackRate > 0 ? cue.playbackRate : 1
      if (cue.loopCount > 0) {
        source.stop(startContextTime + (segment * (cue.loopCount + 1)) / rate)
      }
      source.start(0, startOffset)
    }

    const node: ActiveNode = {
      source, gain, trimGain, panner,
      startContextTime,
      startOffset,
      bufferDuration: buffer.duration,
      cue,
      onEnd
    }

    source.onended = () => {
      this.active.delete(cue.id)
      onEnd?.()
    }

    this.active.set(cue.id, node)
  }

  async seek(cueId: string, timeSeconds: number): Promise<void> {
    const node = this.active.get(cueId)
    if (!node || !this.ctx) return
    const { cue, onEnd } = node

    // Detach the onended callback so it doesn't fire as a natural end
    node.source.onended = null
    try { node.source.stop() } catch { /* already stopped */ }
    this.active.delete(cueId)

    const clampedTime = Math.max(0, Math.min(timeSeconds, node.bufferDuration))
    await this.play({ ...cue, startTime: clampedTime * 1000 }, onEnd)
  }

  getProgress(cueId: string): AudioProgress | null {
    const node = this.active.get(cueId)
    if (!node || !this.ctx) return null
    const elapsed = (this.ctx.currentTime - node.startContextTime) + node.startOffset
    const duration = node.bufferDuration
    const fraction = Math.min(elapsed / duration, 1)
    return {
      elapsedMs: elapsed * 1000,
      durationMs: duration * 1000,
      fraction,
      runFraction: this.runFraction(node, fraction, this.ctx.currentTime)
    }
  }

  // How far through the whole run the cue is, where a run may repeat its segment.
  // A one-shot cue is simply its in-file position; a finite loop counts down the
  // total time all passes take; a forever loop tracks the current pass instead of
  // pinning at 100% for the whole run.
  private runFraction(node: ActiveNode, fraction: number, now: number): number {
    const { cue, startOffset, bufferDuration } = node
    if (cue.loopCount === 0) return fraction

    const segment = cue.endTime != null
      ? (cue.endTime - cue.startTime) / 1000
      : bufferDuration - startOffset

    const runElapsed = now - node.startContextTime

    if (cue.loopCount < 0) {
      // A pass restarts at `startOffset`, so the offset into the current pass is the
      // time since playback began folded into the pass length. The double modulo keeps
      // a negative value (clock skew) positive.
      const pass = segment / (cue.playbackRate > 0 ? cue.playbackRate : 1)
      if (pass <= 0) return 0
      return (((runElapsed % pass) + pass) % pass) / pass
    }

    const rate = cue.playbackRate > 0 ? cue.playbackRate : 1
    const total = (segment * (cue.loopCount + 1)) / rate
    if (total <= 0) return 1
    return Math.min(Math.max(runElapsed / total, 0), 1)
  }

  stop(cueId: string, fadeMs = 0): void {
    const node = this.active.get(cueId)
    if (!node) return
    const ctx = this.getCtx()
    node.source.onended = null  // prevent spurious onEnd callbacks
    if (fadeMs > 0) {
      const gain = node.gain.gain
      gain.cancelScheduledValues(ctx.currentTime)
      gain.setValueAtTime(gain.value, ctx.currentTime)
      gain.linearRampToValueAtTime(0, ctx.currentTime + fadeMs / 1000)
      setTimeout(() => { try { node.source.stop() } catch { /* ok */ } }, fadeMs)
    } else {
      try { node.source.stop() } catch { /* ok */ }
    }
    this.active.delete(cueId)
  }

  stopAll(fadeMs = 0): void {
    for (const id of [...this.active.keys()]) this.stop(id, fadeMs)
  }

  // Web Audio rejects a second setValueCurveAtTime that overlaps an existing
  // curve on the same param, so every fade starts from a cancelled timeline.
  private applyFade(param: AudioParam, value: number, durationMs: number, curve: FadeCurve): void {
    const ctx = this.getCtx()
    const now = ctx.currentTime
    param.cancelScheduledValues(now)
    if (durationMs <= 0) {
      param.setValueAtTime(value, now)
      return
    }
    const current = param.value
    param.setValueAtTime(current, now)
    if (curve === 'linear') {
      param.linearRampToValueAtTime(value, now + durationMs / 1000)
      return
    }
    // The cancel above clears any in-flight envelope, so this curve starts cleanly.
    param.setValueCurveAtTime(shapeCurve(current, value, curve, CURVE_POINTS), now, durationMs / 1000)
  }

  setVolume(cueId: string, volume: number, durationMs = 0, curve: FadeCurve = 'linear'): void {
    const node = this.active.get(cueId)
    if (!node) return
    this.applyFade(node.gain.gain, volume, durationMs, curve)
  }

  setPan(cueId: string, pan: number, durationMs = 0, curve: FadeCurve = 'linear'): void {
    const node = this.active.get(cueId)
    if (!node) return
    this.applyFade(node.panner.pan, pan, durationMs, curve)
  }

  setPlaybackRate(cueId: string, rate: number, durationMs = 0): void {
    const node = this.active.get(cueId)
    if (!node) return
    const ctx = this.getCtx()
    const playbackRate = node.source.playbackRate
    if (durationMs > 0) {
      playbackRate.cancelScheduledValues(ctx.currentTime)
      playbackRate.setValueAtTime(playbackRate.value, ctx.currentTime)
      playbackRate.linearRampToValueAtTime(rate, ctx.currentTime + durationMs / 1000)
    } else {
      playbackRate.cancelScheduledValues(ctx.currentTime)
      playbackRate.setValueAtTime(rate, ctx.currentTime)
    }
  }

  setTrim(cueId: string, trim: number, durationMs = 0): void {
    const node = this.active.get(cueId)
    if (!node) return
    const ctx = this.getCtx()
    const trimGain = node.trimGain.gain
    if (durationMs > 0) {
      trimGain.cancelScheduledValues(ctx.currentTime)
      trimGain.setValueAtTime(trimGain.value, ctx.currentTime)
      trimGain.linearRampToValueAtTime(trim, ctx.currentTime + durationMs / 1000)
    } else {
      trimGain.cancelScheduledValues(ctx.currentTime)
      trimGain.setValueAtTime(trim, ctx.currentTime)
    }
  }

  // Engine parameters for the settings dialog. Uses the lazily created context,
  // so this reports the real device once playback has begun.
  getContextInfo(): { sampleRate: number; baseLatencyMs: number } {
    const ctx = this.getCtx()
    return {
      sampleRate: ctx.sampleRate,
      baseLatencyMs: Math.round(ctx.baseLatency * 1000 * 10) / 10
    }
  }

  async setOutputDevice(deviceId: string): Promise<void> {
    const ctx = this.getCtx()
    await (ctx as any).setSinkId(deviceId)
  }

  isPlaying(cueId: string): boolean {
    return this.active.has(cueId)
  }
}

export const audioPlayer = new AudioPlayer()
