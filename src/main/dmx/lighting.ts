// The lighting engine as main runs it: the state, the frame loop that renders it, and the
// sockets that send and hear it.
//
// The loop runs at DMX512's own ceiling — a full universe takes about 22.7 ms on the cable, so
// nothing downstream refreshes faster than 44 times a second — and does a bounded amount of
// work each time: at most `DMX_LIMITS.universes` universes rendered, each compared with what
// was last sent, and sent again only when it changed or the keep-alive is due. A frame is a
// few hundred microseconds of arithmetic; nothing in it waits, reads a file or allocates more
// than the frames themselves, so main's event loop is never held by the lights.
//
// The state outlives the loop. A licence that lapses stops the sending (the service is Pro)
// but not the record of what each cue holds, so a key entered again puts the same look back.

import { performance } from 'node:perf_hooks'
import type { RemoteInfo } from 'node:dgram'
import type { FadeCurve } from '../../shared/cue'
import type { FadeShape } from '../../shared/fadeShape'
import { DMX_LIMITS, defaultLightingSettings } from '../../shared/dmx'
import type {
  ArtNetNode,
  DmxConfig,
  DmxGo,
  DmxInterfaces,
  DmxMonitor,
  DmxMonitorUniverse,
  DmxProgrammerValue
} from '../../shared/dmxWire'
import type { DmxValue } from '../../shared/dmx'
import { DmxEngine } from './engine'
import { createMachineDmx, type MachineDmx } from './machine'
import {
  DmxReceiver,
  DmxTransmitter,
  KEEP_ALIVE_MS,
  listInterfaces,
  resolveBinding,
  type DmxBinding,
  type ReceiverOptions,
  type TransmitterOptions
} from './network'
import { cidFromUuid } from './packets'
import type { DmxInterface } from '../../shared/dmxWire'

/** One frame of the loop: DMX512's 44 Hz ceiling, rounded to the millisecond above. */
export const DMX_FRAME_MS = 23

export interface DmxLightingOptions {
  engine?: DmxEngine
  transmitter?: Omit<TransmitterOptions, 'onError'>
  receiver?: Omit<ReceiverOptions, 'onError' | 'isOwn' | 'now'>
  machine?: MachineDmx
  interfaces?: () => DmxInterface[]
  /** A monotonic clock in milliseconds. */
  now?: () => number
}

/** What the lighting tells its service: running, or what went wrong. */
export interface DmxReport {
  state(state: 'running' | 'degraded', detail: string, error?: string): void
  alert(message: string): void
}

function defaultConfig(): DmxConfig {
  const lighting = defaultLightingSettings()
  return {
    outputs: lighting.outputs,
    inputs: lighting.inputs,
    sync: lighting.sync,
    syncUniverse: lighting.syncUniverse,
    panic: lighting.panic
  }
}

function sameFrame(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let at = 0; at < a.length; at++) if (a[at] !== b[at]) return false
  return true
}

export class DmxLighting {
  readonly engine: DmxEngine
  private readonly transmitter: DmxTransmitter
  private readonly receiver: DmxReceiver
  private readonly machine: MachineDmx
  private readonly readInterfaces: () => DmxInterface[]
  private readonly now: () => number
  private config: DmxConfig = defaultConfig()
  private binding: DmxBinding = { address: null, broadcast: null }
  private bindingMissing = false
  private timer: NodeJS.Timeout | null = null
  private report: DmxReport | null = null
  private readonly lastSent = new Map<number, { frame: Uint8Array; at: number }>()

  constructor(options: DmxLightingOptions = {}) {
    this.engine = options.engine ?? new DmxEngine()
    this.now = options.now ?? (() => performance.now())
    this.machine = options.machine ?? createMachineDmx()
    this.readInterfaces = options.interfaces ?? (() => listInterfaces())
    this.transmitter = new DmxTransmitter({ ...options.transmitter, onError: message => this.fault(message) })
    this.receiver = new DmxReceiver({
      ...options.receiver,
      now: this.now,
      onError: message => this.fault(message),
      isOwn: (remote, cid) => this.isOwn(remote, cid)
    })
  }

  get running(): boolean {
    return this.timer !== null
  }

  /** Starts sending, with the configuration last handed over. */
  start(report: DmxReport): void {
    this.report = report
    void this.machine.remember().catch(() => {
      // A machine whose settings cannot be written still sends; it just mints a new CID on
      // the next run, which receivers handle as a new source.
    })
    this.rebind()
    this.apply()
    if (this.timer === null) {
      this.timer = setInterval(() => this.frame(), DMX_FRAME_MS)
      this.timer.unref?.()
    }
    this.describe()
  }

  /** Stops sending: the streams are ended as E1.31 asks, and the state is kept. */
  stop(): void {
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    const frames = new Map<number, Uint8Array>()
    for (const universe of this.transmitter.universes()) frames.set(universe, this.render(universe, this.now()))
    this.transmitter.terminate(frames)
    this.receiver.close()
    this.lastSent.clear()
    this.report = null
  }

  configure(config: DmxConfig): void {
    this.config = config
    if (this.running) {
      this.apply()
      this.describe()
    }
  }

  go(command: DmxGo): void {
    this.engine.go(command, this.now())
  }

  stopCue(cueId: string): void {
    this.engine.stop(cueId, this.now())
  }

  release(cueId: string | null, fadeMs: number, curve: FadeCurve): void {
    this.engine.release(cueId, fadeMs, curve, this.now())
  }

  level(cueId: string, level: number, fadeMs: number, curve: FadeCurve, shape: FadeShape | null = null): void {
    this.engine.level(cueId, level, fadeMs, curve, this.now(), shape)
  }

  program(values: DmxProgrammerValue[]): void {
    this.engine.program(values)
  }

  clearProgrammer(): void {
    this.engine.clearProgrammer()
  }

  identify(values: DmxValue[], ms: number): void {
    this.engine.identify(values, ms, this.now())
  }

  setBlackout(on: boolean): void {
    this.engine.setBlackout(on)
  }

  /**
   * The show's panic, by the show's own rule — and only on a machine that is sending: an
   * unlicensed one has no lights of its own to panic.
   */
  panic(): void {
    if (!this.running) return
    this.engine.panic(this.config.panic, this.now())
  }

  monitor(universes: readonly number[]): DmxMonitor {
    const now = this.now()
    const known = new Set<number>([
      ...this.engine.universes(),
      ...this.transmitter.universes(),
      ...this.receiver.universes()
    ])
    const sending = new Set(this.transmitter.universes())
    const frames: DmxMonitorUniverse[] = universes.map(universe => {
      const heard = this.receiver.frame(universe)
      return {
        universe,
        output: [...this.render(universe, now)],
        input: heard === null ? null : [...heard.data],
        inputSource: heard?.source ?? null,
        sent: sending.has(universe)
      }
    })
    return {
      at: Date.now(),
      blackout: this.engine.blackout,
      universes: [...known].sort((a, b) => a - b).slice(0, DMX_LIMITS.universes * 2),
      frames,
      programmer: this.engine.programmerValues(),
      holding: this.engine.holding(),
      packets: this.transmitter.packets,
      error: this.transmitter.error
    }
  }

  interfaces(): DmxInterfaces {
    const interfaces = this.readInterfaces()
    const machine = this.machine.current()
    const { missing } = resolveBinding(
      { name: machine.interfaceName, address: machine.interfaceAddress },
      interfaces
    )
    return { interfaces, selected: machine.interfaceName, missing }
  }

  async setInterface(name: string | null): Promise<DmxInterfaces> {
    const found = name === null ? undefined : this.readInterfaces().find(entry => entry.name === name)
    if (name !== null && found === undefined) throw new Error(`this machine has no interface called ${name}`)
    await this.machine.update({ interfaceName: name, interfaceAddress: found?.address ?? null })
    if (this.running) {
      this.rebind()
      this.apply()
      this.describe()
    }
    return this.interfaces()
  }

  discover(target?: string, waitMs?: number): Promise<ArtNetNode[]> {
    return this.receiver.discover(target, waitMs)
  }

  /** The ports this machine listens on, for a test that sends to them. */
  listeningPorts(): { sacn: number | null; artnet: number | null } {
    return { sacn: this.receiver.sacnLocalPort(), artnet: this.receiver.artnetLocalPort() }
  }

  /** The frame loop's one turn. */
  frame(): void {
    const now = this.now()
    this.engine.tick(now)
    let sent = 0
    for (const universe of this.transmitter.universes()) {
      const frame = this.render(universe, now)
      const last = this.lastSent.get(universe)
      if (last !== undefined && now - last.at < KEEP_ALIVE_MS && sameFrame(last.frame, frame)) continue
      if (!this.transmitter.send(universe, frame)) continue
      this.lastSent.set(universe, { frame, at: now })
      sent++
    }
    if (sent > 0) this.transmitter.sync()
  }

  private render(universe: number, now: number): Uint8Array {
    return this.engine.render(universe, now, this.receiver.frame(universe))
  }

  private rebind(): void {
    const machine = this.machine.current()
    const resolved = resolveBinding(
      { name: machine.interfaceName, address: machine.interfaceAddress },
      this.readInterfaces()
    )
    this.binding = resolved.binding
    this.bindingMissing = resolved.missing
  }

  private apply(): void {
    const machine = this.machine.current()
    this.transmitter.configure(
      this.config,
      { cid: cidFromUuid(machine.cid), sourceName: machine.sourceName },
      this.binding
    )
    this.receiver.configure(this.config.inputs, this.binding)
    // A configuration that changed what goes where sends everything again at once.
    this.lastSent.clear()
  }

  private describe(): void {
    if (this.report === null) return
    const machine = this.machine.current()
    if (this.bindingMissing) {
      this.report.state(
        'degraded',
        `${machine.interfaceName ?? 'the chosen interface'} is not on this machine: sending unpinned`
      )
      return
    }
    const universes = this.transmitter.universes().length
    this.report.state(
      'running',
      universes === 0 ? 'no universe has an output' : `sending ${universes} universe${universes === 1 ? '' : 's'}`
    )
  }

  private fault(message: string): void {
    if (this.report === null) return
    this.report.state('degraded', message, message)
    this.report.alert(`Lighting: ${message}`)
  }

  private isOwn(remote: RemoteInfo, cid: string | null): boolean {
    if (cid !== null) return cid === this.machine.current().cid.replace(/-/g, '').toLowerCase()
    return remote.port === this.transmitter.localPort()
  }
}

/** The one lighting engine main runs: the service sends it, and the panic path reaches it. */
let shared: DmxLighting | null = null

export function sharedLighting(options?: DmxLightingOptions): DmxLighting {
  if (shared === null) shared = new DmxLighting(options)
  return shared
}

/**
 * The panic path's way in: the lighting's own rule applied, on the engine the service runs.
 * Nothing is created here — a panic before any lighting exists has no lights to act on.
 */
export function panicLighting(): void {
  shared?.panic()
}
