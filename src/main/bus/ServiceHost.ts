import { sameValue } from '../../shared/showfile'
import type {
  ServiceState,
  ServiceStatus,
  ShowSettings
} from '../../shared/show'
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
  /**
   * Which half of the app this service belongs to. A Pro service is not started on a
   * machine with no licence, and says so in its status rather than failing: hearing the
   * room is free, and the show of it — the desk link, the radios, the network, the
   * second machine — is what the key turns on.
   */
  readonly pro?: true
  /**
   * The `ShowSettings` sections this service's `start()` reads — whole sections, not
   * paths into one. The host restarts the service when one of them moved and leaves it
   * alone otherwise, so this declaration is the only record of the slice: nothing in the
   * host maps a service to its settings. A service configured from the machine rather
   * than the show declares none, and a configure never restarts it.
   */
  readonly settingsSections: readonly (keyof ShowSettings)[]
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

  constructor(
    private readonly bus: ShowBus,
    /**
     * Whether this machine may run the Pro services. Asked afresh every time services
     * are brought up, because a key can be entered or removed while the window is open.
     */
    private readonly entitled: () => boolean = () => true
  ) {}

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
  async startAll(settings: ShowSettings, options: { entitlementOnly?: boolean } = {}): Promise<void> {
    this.settings = settings
    for (const entry of this.entries.values()) {
      await this.apply(entry, settings, options.entitlementOnly === true)
    }
  }

  /**
   * Restarts only the services whose declared slice of the settings changed: every
   * settings edit otherwise drops every listener. Each service says which sections its
   * start() reads; one that declares none — its settings are the machine's — is left
   * exactly where it is.
   */
  async startChanged(settings: ShowSettings): Promise<void> {
    const before = this.settings
    this.settings = settings
    for (const entry of this.entries.values()) {
      if (before !== null && !serviceSettingsChanged(entry.service, before, settings)) continue
      await this.apply(entry, settings)
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
    const refusal = this.refusal(entry)
    if (refusal !== null) return { ok: false, error: refusal }
    await this.bringUp(entry, this.settings)
    return entry.status.state === 'failed'
      ? { ok: false, error: entry.status.error ?? 'Service failed to restart' }
      : { ok: true }
  }

  async command(id: string, action: string, payload?: unknown): Promise<CommandResult> {
    const entry = this.entries.get(id)
    if (!entry) return { ok: false, error: `Unknown service "${id}"` }
    const refusal = this.refusal(entry)
    if (refusal !== null) return { ok: false, error: refusal }
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

  /**
   * Brings a service to the state the settings and the licence say it should be in.
   *
   * A Pro service on an unlicensed machine is stopped, with the reason in its status:
   * that is a fact about the key rather than a fault, so it is not a failure and does
   * not raise an alert. Everything else is brought up as the settings ask. This is
   * called for *every* service when the licence changes — the one case the settings
   * diff cannot express — so a key entered mid-session starts what the operator had
   * configured and a lapsed key leaves the free listeners running.
   */
  private async apply(entry: Entry, settings: ShowSettings, entitlementOnly = false): Promise<void> {
    const refusal = this.refusal(entry)
    if (refusal !== null) {
      if (entry.status.state !== 'stopped') {
        await this.guard(entry, 'stop', () => entry.service.stop())
      }
      this.setState(entry, 'stopped', refusal)
      return
    }
    // On a licence change — the one case a settings diff cannot express — a service
    // that is already up stays up. Re-binding the OSC port because a key was entered
    // would drop whatever is in flight, and a key gets entered during a show.
    if (entitlementOnly && entry.status.state !== 'stopped') return
    await this.bringUp(entry, settings)
  }

  /** Why this service may not run on this machine, or null when it may. */
  private refusal(entry: Entry): string | null {
    if (entry.service.pro !== true || this.entitled()) return null
    return `${entry.service.label} is part of Cuerunner Pro`
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
 * Whether this service reads anything that changed between two settings. A service
 * declares the whole sections its start() reads, so a section that moved restarts it
 * and a section it never declared cannot: the declaration is the only record of the
 * slice, and a service that declares none is never restarted by a configure.
 *
 * A section is compared by value, not by bytes: `sameValue` reads the plain data the
 * section carries, so key order folds away and `undefined` reads as absent, while array
 * order — the ports opened first, the scene order — stays content. Two settings that say
 * the same thing in another key order are the same settings, and a live service must not
 * be dropped for it.
 */
function serviceSettingsChanged(service: ShowService, before: ShowSettings, after: ShowSettings): boolean {
  return service.settingsSections.some(section => !sameValue(before[section], after[section]))
}

export function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
