import type {
  ServiceState,
  ServiceStatus,
  ShowSettings
} from '../../renderer/src/types/show'
import type { ShowBus } from './ShowBus'

/**
 * What a service is handed when it starts. Services report their own state through
 * `setState` — they know whether they are listening, disabled or waiting on a device —
 * while the host owns the record and the timestamps.
 */
export interface ServiceContext {
  bus: ShowBus
  setState(state: ServiceState, detail: string, error?: string): void
}

/**
 * One thing the show needs to know about: a listener, a poller, a bridge to a device.
 *
 * Services run beside playback and never block it. A service that throws on start is
 * recorded as failed and the rest of the show carries on, because a wireless poller
 * that cannot reach its receiver must not be able to stop a cue from firing.
 */
export interface ShowService {
  readonly id: string
  readonly label: string
  start(context: ServiceContext, settings: ShowSettings): Promise<void> | void
  stop(): Promise<void> | void
  /** Operator-initiated action, e.g. reconnecting or rescanning. */
  command?(action: string, payload?: unknown): Promise<unknown> | unknown
}

export interface CommandResult {
  ok: boolean
  result?: unknown
  error?: string
}

interface Entry {
  service: ShowService
  status: ServiceStatus
}

export class ServiceHost {
  private entries = new Map<string, Entry>()
  private settings: ShowSettings | null = null

  constructor(private readonly bus: ShowBus) {}

  register(service: ShowService): void {
    this.entries.set(service.id, {
      service,
      status: {
        id: service.id,
        label: service.label,
        state: 'stopped',
        detail: 'not started',
        since: Date.now()
      }
    })
  }

  /** Starts every registered service. One failing service does not stop the others. */
  async startAll(settings: ShowSettings): Promise<void> {
    this.settings = settings
    for (const entry of this.entries.values()) {
      await this.bringUp(entry, settings)
    }
  }

  /**
   * Restarts only the services whose slice of the settings changed: every settings
   * edit otherwise drops every listener. A service declares its slice by id; an
   * unknown id restarts everywhere, because a setting nobody reads is not a reason
   * to keep a stale listener.
   */
  async startChanged(settings: ShowSettings): Promise<void> {
    const before = this.settings
    this.settings = settings
    for (const entry of this.entries.values()) {
      if (before !== null && !serviceSettingsChanged(entry.service.id, before, settings)) continue
      await this.bringUp(entry, settings)
    }
  }

  async stopAll(): Promise<void> {
    for (const entry of this.entries.values()) {
      const stopped = await this.guard(entry, 'stop', () => entry.service.stop())
      // The host owns the record, and a service stopped on somebody else's instruction
      // does not report it — a snapshot taken after a suspension has to say stopped
      // rather than repeat the port it was listening on. A service that already said so
      // itself, or whose stop threw (it may still be up), is left as it is.
      if (stopped && entry.status.state !== 'stopped') {
        this.setState(entry, 'stopped', 'not started')
      }
    }
  }

  /** Restarts one service, e.g. after the operator changes its port. */
  async restart(id: string): Promise<CommandResult> {
    const entry = this.entries.get(id)
    if (!entry || !this.settings) return { ok: false, error: `Unknown service "${id}"` }
    await this.bringUp(entry, this.settings)
    return entry.status.state === 'failed'
      ? { ok: false, error: entry.status.error ?? 'Service failed to restart' }
      : { ok: true }
  }

  async command(id: string, action: string, payload?: unknown): Promise<CommandResult> {
    const entry = this.entries.get(id)
    if (!entry) return { ok: false, error: `Unknown service "${id}"` }
    if (!entry.service.command) {
      return { ok: false, error: `Service "${id}" takes no commands` }
    }
    if (entry.status.state === 'failed') {
      // A failed service has no sockets and no loop running, so a command would look
      // accepted and do nothing. Restarting is what the operator actually wants.
      return { ok: false, error: `Service "${id}" is not running` }
    }
    try {
      return { ok: true, result: await entry.service.command(action, payload) }
    } catch (error) {
      const message = describe(error)
      this.bus.alert('warning', id, `Command "${action}" failed: ${message}`)
      return { ok: false, error: message }
    }
  }

  statuses(): ServiceStatus[] {
    return [...this.entries.values()].map(entry => entry.status)
  }

  status(id: string): ServiceStatus | undefined {
    return this.entries.get(id)?.status
  }

  /**
   * Brings a service up from stopped: close whatever the old settings opened, then
   * start it with the new ones. A reconfigure is a restart, and one implementation of
   * that keeps the closing from being the service's job to remember.
   */
  private async bringUp(entry: Entry, settings: ShowSettings): Promise<void> {
    // Nothing to close when the service never came up; after that, a reconfigure has
    // to close the old settings before the new ones are applied.
    if (entry.status.state !== 'stopped') {
      await this.guard(entry, 'stop', () => entry.service.stop())
    }
    await this.start(entry, settings)
  }

  private async start(entry: Entry, settings: ShowSettings): Promise<void> {
    this.setState(entry, 'starting', '')
    const context: ServiceContext = {
      bus: this.bus,
      setState: (state, detail, error) => this.setState(entry, state, detail, error)
    }
    try {
      await entry.service.start(context, settings)
    } catch (error) {
      const message = describe(error)
      this.setState(entry, 'failed', message, message)
      // Playback is untouched by this, so it is not a show-stopping alarm — but the
      // operator needs to know the service they enabled is not doing anything.
      this.bus.alert('warning', entry.service.id, `${entry.service.label} failed: ${message}`)
    }
  }

  private async guard(
    entry: Entry,
    phase: string,
    action: () => Promise<void> | void
  ): Promise<boolean> {
    try {
      await action()
      return true
    } catch (error) {
      const message = describe(error)
      this.bus.alert('warning', entry.service.id, `${entry.service.label} failed to ${phase}: ${message}`)
      return false
    }
  }

  private setState(entry: Entry, state: ServiceState, detail: string, error?: string): void {
    entry.status = {
      id: entry.service.id,
      label: entry.service.label,
      state,
      detail,
      since: Date.now(),
      ...(error === undefined ? {} : { error })
    }
    this.bus.publish({ kind: 'service', at: entry.status.since, service: entry.status })
  }
}

/**
 * Whether this service reads anything that changed between two settings. The slices
 * are the sections each service's start() reads; desk-adjacent services also read the
 * desk section they send through.
 */
function serviceSettingsChanged(id: string, before: ShowSettings, after: ShowSettings): boolean {
  switch (id) {
    case 'osc-in':
      return JSON.stringify(before.oscIn) !== JSON.stringify(after.oscIn)
    case 'midi-in':
      return JSON.stringify(before.midiIn) !== JSON.stringify(after.midiIn)
    case 'midi-tcp':
      return JSON.stringify(before.desk) !== JSON.stringify(after.desk)
    case 'rf':
      return JSON.stringify(before.rf) !== JSON.stringify(after.rf) ||
        JSON.stringify(before.cast) !== JSON.stringify(after.cast)
    case 'presence':
      return JSON.stringify(before.presence) !== JSON.stringify(after.presence)
    case 'companion':
      return JSON.stringify(before.companion) !== JSON.stringify(after.companion) ||
        JSON.stringify(before.script) !== JSON.stringify(after.script)
    case 'redundancy':
      // Machine settings, not show settings: the service reads its own file.
      return false
    default:
      return JSON.stringify(before) !== JSON.stringify(after)
  }
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
