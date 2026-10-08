/**
 * The incoming clock: one source at a time — MTC on a MIDI input, LTC on an engine
 * capture channel, or ArtTimeCode on the network — decoded into positions and handed to
 * the follower that carries it between them and through dropouts.
 */
import { TimecodeFollower } from './follower'
import { MtcDecoder } from './mtc'
import { decodeArtTimecode } from './artnet'
import type { MidiTimecodeTap } from './midiTap'
import type { LtcClient, LtcReadFrame } from './ltc'
import {
  idleReceiverStatus,
  timecodeToFrames,
  type TimecodeRate,
  type TimecodeReceiverStatus,
  type TimecodeSettings
} from '../../shared/timecode'

/** A port or a socket the receiver opened, and the one thing to do with it afterwards. */
export interface Closable {
  close(): void
}

export interface ReceiverDeps {
  now(): number
  tap: MidiTimecodeTap
  /** MIDI input ports this machine has. */
  listMidiInputs(): string[]
  /** Opens a port of its own for MTC; throws when the port will not open. */
  openMidiInput(port: string, onMessage: (bytes: number[], at: number) => void): Closable
  /** The engine's LTC reader, or null where there is no engine to ask. */
  ltc: LtcClient | null
  /** Binds the Art-Net port; rejects when the port is taken. */
  bindUdp(port: number, onPacket: (packet: Buffer, at: number) => void): Promise<Closable>
  /** How often the engine's LTC reader is read, ms. */
  ltcPollMs?: number
}

/** What a start came to, for the service's status line. */
export interface ReceiverStart {
  state: 'running' | 'degraded' | 'stopped'
  detail: string
}

/** How often the engine is asked for the LTC frames it has read. */
const LTC_POLL_MS = 20
/** How often a reader that stopped listening (the engine restarted) is asked to listen again. */
const LTC_RELISTEN_MS = 2000

export class TimecodeReceiver {
  private follower: TimecodeFollower
  private settings: TimecodeSettings | null = null
  private closers: Array<() => void> = []
  private mtc: MtcDecoder
  // LTC carries no rate code: the label's highest frame says 24, 25 or 30, once a second
  // has wrapped, and the drop-frame flag says the rest.
  private ltcHighest = -1
  private ltcWrapped = false
  private ltcLastLabel = -1
  // ArtTimeCode repeated unchanged is a clock standing still.
  private artnetLast: number | null = null
  private artnetRepeats = 0

  constructor(private readonly deps: ReceiverDeps) {
    this.follower = new TimecodeFollower('none', { rate: 'auto', holdMs: 1000, offsetFrames: 0 })
    this.mtc = this.decoderFor()
  }

  private decoderFor(): MtcDecoder {
    return new MtcDecoder({
      running: (frames, rate, at, direction) => this.follower.running(frames, rate, at, direction),
      located: (frames, rate, at) => this.follower.located(frames, rate, at),
      alive: at => this.follower.alive(at)
    })
  }

  async start(settings: TimecodeSettings): Promise<ReceiverStart> {
    await this.stop()
    this.settings = settings
    this.follower = new TimecodeFollower(settings.source, {
      rate: settings.rate,
      holdMs: settings.holdMs,
      offsetFrames: settings.offsetFrames
    })
    this.mtc = this.decoderFor()
    this.ltcHighest = -1
    this.ltcWrapped = false
    this.ltcLastLabel = -1
    this.artnetLast = null
    this.artnetRepeats = 0

    switch (settings.source) {
      case 'none':
        return { state: 'stopped', detail: 'no timecode source chosen' }
      case 'mtc':
        return this.startMtc(settings.mtcPort)
      case 'ltc':
        return this.startLtc(settings.ltcDevice, settings.ltcChannel)
      case 'artnet':
        return this.startArtnet(settings.artnetPort)
    }
  }

  private startMtc(wanted: string): ReceiverStart {
    const ports = [...new Set([...this.deps.listMidiInputs(), ...this.deps.tap.heldPorts()])]
    const port = wanted !== '' ? wanted : (ports[0] ?? '')
    if (port === '') return this.waiting('no MIDI input port to hear MTC on')
    if (!ports.includes(port)) return this.waiting(`no MIDI input port named "${port}"`)
    const detail = `MTC on "${port}"`
    this.follower.describe(detail)
    if (this.deps.tap.holds(port)) {
      // The show's MIDI input already has the port open: listen through it.
      this.closers.push(this.deps.tap.listen(port, (bytes, at) => this.mtc.message(bytes, at)))
      return { state: 'running', detail }
    }
    try {
      const input = this.deps.openMidiInput(port, (bytes, at) => this.mtc.message(bytes, at))
      this.closers.push(() => input.close())
      return { state: 'running', detail }
    } catch (error) {
      return this.waiting(`could not open "${port}": ${describe(error)}`)
    }
  }

  private async startLtc(device: string, channel: number): Promise<ReceiverStart> {
    const ltc = this.deps.ltc
    if (ltc === null) return this.waiting('the audio engine is not running, so LTC cannot be read')
    let detail: string
    try {
      detail = `LTC on ${await ltc.listen(device, channel)}`
    } catch (error) {
      return this.waiting(`LTC: ${describe(error)}`)
    }
    this.follower.describe(detail)
    let reading = false
    let relistenAt = 0
    const timer = setInterval(() => {
      if (reading) return
      reading = true
      ltc.read()
        .then(result => {
          const here = this.deps.now()
          for (const frame of result.frames) this.ltcFrame(frame, here - (result.nowMs - frame.atMs))
          // An engine that was restarted under the show is a reader that is not listening any
          // more: ask again, every couple of seconds, until the input is back.
          if (!result.listening && here >= relistenAt) {
            relistenAt = here + LTC_RELISTEN_MS
            void ltc.listen(device, channel).catch(() => {})
          }
        })
        .catch(() => {
          // An engine between restarts answers nothing; the follower freewheels and then
          // says lost, which is what the operator needs to see.
        })
        .finally(() => {
          reading = false
        })
    }, this.deps.ltcPollMs ?? LTC_POLL_MS)
    timer.unref?.()
    this.closers.push(() => {
      clearInterval(timer)
      void ltc.unlisten().catch(() => {})
    })
    return { state: 'running', detail }
  }

  private async startArtnet(port: number): Promise<ReceiverStart> {
    const detail = `ArtTimeCode on UDP ${port}`
    this.follower.describe(detail)
    try {
      const socket = await this.deps.bindUdp(port, (packet, at) => this.artnet(packet, at))
      this.closers.push(() => socket.close())
      return { state: 'running', detail }
    } catch (error) {
      return this.waiting(`could not listen on UDP ${port}: ${describe(error)}`)
    }
  }

  private waiting(detail: string): ReceiverStart {
    this.follower.describe(detail)
    return { state: 'degraded', detail }
  }

  /** Bytes of MIDI from wherever MTC arrived: a port, the tap, or a test. */
  mtcMessage(bytes: number[], at = this.deps.now()): boolean {
    return this.mtc.message(bytes, at)
  }

  /** One frame the engine read, on this process's clock. */
  ltcFrame(frame: LtcReadFrame, at: number): void {
    if (this.ltcLastLabel >= 0 && frame.frames < this.ltcLastLabel && !frame.reverse) this.ltcWrapped = true
    this.ltcLastLabel = frame.frames
    this.ltcHighest = Math.max(this.ltcHighest, frame.frames)
    const rate: TimecodeRate = frame.dropFrame
      ? '29.97df'
      : this.ltcHighest >= 25 ? '30'
        : this.ltcHighest === 24 ? '25'
          : this.ltcWrapped ? '24' : '25'
    const label = { hours: frame.hours, minutes: frame.minutes, seconds: frame.seconds, frames: frame.frames }
    const count = timecodeToFrames(label, rate)
    // A frame read forwards has just ended: the clock is at the start of the next one.
    // Read backwards, its end is where it began.
    this.follower.running(frame.reverse ? count : count + 1, rate, at, frame.reverse ? -1 : 1)
  }

  /** One Art-Net datagram. */
  artnet(packet: Uint8Array, at = this.deps.now()): boolean {
    const decoded = decodeArtTimecode(packet)
    if (decoded === null) return false
    const frames = timecodeToFrames(decoded.tc, decoded.rate)
    if (this.artnetLast === frames) {
      this.artnetRepeats++
      // Sent again and again unchanged: a console holding a frame, not a clock running.
      if (this.artnetRepeats >= 3) this.follower.located(frames, decoded.rate, at)
      else this.follower.alive(at)
      return true
    }
    const direction = this.artnetLast !== null && frames < this.artnetLast && this.artnetLast - frames < 10 ? -1 : 1
    this.artnetLast = frames
    this.artnetRepeats = 0
    // Each datagram goes out as its frame begins.
    this.follower.running(frames, decoded.rate, at, direction)
    return true
  }

  status(): TimecodeReceiverStatus {
    if (this.settings === null) return idleReceiverStatus('none')
    return this.follower.status(this.deps.now())
  }

  async stop(): Promise<void> {
    const closers = this.closers
    this.closers = []
    for (const close of closers) {
      try {
        close()
      } catch {
        // A port the OS already took away is closed either way.
      }
    }
    this.settings = null
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
