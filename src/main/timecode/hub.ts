/**
 * Everything timecode in the main process, behind one object: the machine's settings, the
 * receiver that follows an incoming clock, the generators the timecode cues run, and the
 * status the window draws from both.
 *
 * The receiver runs as a show service (`TimecodeService` below), so it comes and goes with
 * the licence and shows in the monitor beside the other listeners, and its lock and its loss
 * are alarms on the same strip. Its settings are the machine's: which port the clock is on
 * and which input the LTC cable is in are facts about this rack, so they are kept beside the
 * licence rather than in the show.
 */
import { readFileSync, statSync } from 'node:fs'
import { writeFileAtomically } from '../workspace/recovery'
import { TimecodeReceiver, type ReceiverDeps } from './receiver'
import { TimecodeGenerators, type GeneratorDeps } from './generator'
import type { ServiceContext } from '../bus/ServiceHost'
import {
  formatFrames,
  normalizeTimecodeSettings,
  type TimecodeGenerateRequest,
  type TimecodeGeneratorAction,
  type TimecodeLockState,
  type TimecodeSettings,
  type TimecodeStatus
} from '../../shared/timecode'

/** The machine's timecode settings file is small; anything past this is not one. */
const SETTINGS_MAX_BYTES = 64 * 1024
/** How often the window is told where the clock is, while there is a clock. */
const PUSH_MS = 40

export interface HubOptions {
  filePath: string
  receiver: ReceiverDeps
  generators: Omit<GeneratorDeps, 'incoming' | 'ended'>
  /** Where the status goes: every window. */
  broadcast(status: TimecodeStatus): void
  /** Asks the show host to bring the receiver up again on new settings. */
  restartReceiver(): Promise<void>
  readFile?: (path: string) => string
}

export class TimecodeHub {
  readonly receiver: TimecodeReceiver
  readonly generators: TimecodeGenerators
  private settings: TimecodeSettings
  private context: ServiceContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private lastState: TimecodeLockState = 'off'
  private lastPushed = ''

  constructor(private readonly options: HubOptions) {
    this.settings = normalizeTimecodeSettings(readSettings(options.filePath, options.readFile))
    this.receiver = new TimecodeReceiver(options.receiver)
    this.generators = new TimecodeGenerators({
      ...options.generators,
      incoming: () => this.receiver.status(),
      ended: () => this.push(true)
    })
  }

  current(): TimecodeSettings {
    return this.settings
  }

  async update(patch: Partial<TimecodeSettings>): Promise<TimecodeSettings> {
    this.settings = normalizeTimecodeSettings({ ...this.settings, ...patch })
    await writeFileAtomically(this.options.filePath, `${JSON.stringify(this.settings, null, 2)}\n`)
    await this.options.restartReceiver()
    this.push(true)
    return this.settings
  }

  /** The capture devices LTC can be read from, by name. */
  async ltcInputs(): Promise<string[]> {
    const ltc = this.options.receiver.ltc
    if (ltc === null) return []
    return (await ltc.inputs()).map(input => input.name)
  }

  status(): TimecodeStatus {
    return { receiver: this.receiver.status(), generators: this.generators.status() }
  }

  async generate(request: TimecodeGenerateRequest) {
    const result = await this.generators.start(request)
    this.ensurePush()
    this.push(true)
    return result
  }

  async control(cueId: string, action: TimecodeGeneratorAction): Promise<boolean> {
    const applied = await this.generators.control(cueId, action)
    this.push(true)
    return applied
  }

  /** The receiver's half of the show service. */
  async startReceiving(context: ServiceContext): Promise<void> {
    this.context = context
    const started = await this.receiver.start(this.settings)
    context.setState(started.state, started.detail)
    this.lastState = this.receiver.status().state
    this.ensurePush()
    this.push(true)
  }

  async stopReceiving(): Promise<void> {
    await this.receiver.stop()
    this.context = null
    this.lastState = 'off'
    this.push(true)
    // Nothing left to tell the window about until a cue or a receiver starts again.
    if (!this.generators.running()) this.idle()
  }

  private ensurePush(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.push(false), PUSH_MS)
    this.timer.unref?.()
  }

  /**
   * Tells the window where the clock is. A clock that is not moving is only told about
   * when something changed; a moving one every push, because the window's own
   * interpolation is re-anchored by each of them.
   */
  private push(force: boolean): void {
    const status = this.status()
    const receiver = status.receiver
    this.noteTransition(receiver.state, receiver.frames, receiver.rate, receiver.detail)
    const moving = receiver.state === 'locked' || receiver.state === 'freewheel' ||
      status.generators.some(gen => gen.running)
    const key = JSON.stringify([receiver.state, receiver.rate, receiver.rateDetected, receiver.detail,
      receiver.frames === null ? null : Math.round(receiver.frames), status.generators.map(g => [g.cueId, g.running, Math.round(g.frames)])])
    if (!force && !moving && key === this.lastPushed) {
      if (this.context === null && !this.generators.running()) this.idle()
      return
    }
    if (!force && this.context === null && !this.generators.running()) this.idle()
    this.lastPushed = key
    this.options.broadcast(status)
  }

  private idle(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
  }

  /** Lock and loss are news: the monitor's strip and the session log hear about both. */
  private noteTransition(state: TimecodeLockState, frames: number | null, rate: TimecodeStatus['receiver']['rate'], detail: string): void {
    const previous = this.lastState
    if (state === previous) return
    this.lastState = state
    const context = this.context
    if (context === null) return
    const where = frames === null ? '' : ` at ${formatFrames(Math.floor(frames), rate)}`
    if (state === 'locked') {
      context.bus.alert('info', 'timecode', `Timecode locked${where} (${detail})`)
      context.setState('running', `locked — ${detail}`)
    } else if (state === 'lost' && (previous === 'locked' || previous === 'freewheel')) {
      context.bus.alert('warning', 'timecode', `Timecode lost${where} (${detail})`)
      context.setState('degraded', `lost — ${detail}`)
    } else if (state === 'freewheel') {
      context.setState('running', `freewheeling — ${detail}`)
    } else if (state === 'stopped') {
      context.setState('running', `stopped${where} — ${detail}`)
    }
  }

  dispose(): void {
    this.idle()
    this.generators.dispose()
    void this.receiver.stop()
  }
}

function readSettings(filePath: string, readFile?: (path: string) => string): unknown {
  try {
    if (readFile === undefined && statSync(filePath).size > SETTINGS_MAX_BYTES) return null
    const text = (readFile ?? (path => readFileSync(path, 'utf8')))(filePath)
    return text.trim() === '' ? null : JSON.parse(text)
  } catch {
    // Missing or unreadable: the machine starts on the defaults, which listen to nothing.
    return null
  }
}
