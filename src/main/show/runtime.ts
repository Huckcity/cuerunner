import { ShowBus } from '../bus/ShowBus'
import { ServiceHost, type CommandResult, type ShowService } from '../bus/ServiceHost'
import { stableJson } from '../../shared/showfile'
import { OscInputService } from '../services/OscInputService'
import { MidiInputService } from '../services/MidiInputService'
import { MidiTcpService } from '../services/MidiTcpService'
import { WirelessService } from '../services/WirelessService'
import { PresenceService } from '../services/PresenceService'
import { CompanionService } from '../services/CompanionService'
import { RedundancyService } from '../services/RedundancyService'
import type { RedundancySettings } from '../../shared/redundancy'
import type { AlertLevel, ShowEvent, ShowSettings, ShowSnapshot } from '../../shared/show'

/**
 * What the services need from the rest of the app that is not the show. The redundancy
 * pair's own settings are the one thing here: they are kept with the machine, because
 * both machines of a pair run the same workspace file and a role written into the show
 * would be read as the same answer by both of them.
 */
export interface ServiceOptions {
  redundancy?: () => RedundancySettings
}

export function defaultServices(options: ServiceOptions = {}): ShowService[] {
  return [
    // Hearing the room is free: the desk's own key, a footswitch, a tablet or another
    // program must not be behind a key, or the free half stops competing with free
    // software. What costs is the show of it — the desk link, the radios, the network
    // and the second machine — so those services carry `pro` and the host asks.
    new OscInputService(),
    new MidiInputService(),
    new MidiTcpService(),
    new WirelessService(),
    new PresenceService(),
    new CompanionService(),
    new RedundancyService({ settings: options.redundancy })
  ]
}

export interface ShowRuntime {
  /** Applies settings, restarting only the services whose settings changed. */
  configure(settings: ShowSettings): Promise<void>
  snapshot(): ShowSnapshot
  command(serviceId: string, action: string, payload?: unknown): Promise<CommandResult>
  restart(serviceId: string): Promise<CommandResult>
  subscribe(listener: (events: ShowEvent[]) => void): () => void
  /**
   * Raises an alarm the show's own machinery owes the operator rather than a service —
   * a device the engine lost — through the one alarm path that exists: the monitor's
   * strip, the transport chip, and the session log. `source` names what raised it, the
   * way a service's id does.
   */
  alert(level: AlertLevel, source: string, message: string): void
  close(): void
}

/**
 * Everything between the show services and the rest of the app.
 *
 * One runtime owns the bus and the host, so the IPC layer never has to know which
 * services exist: it configures them, reads a snapshot, and subscribes to the batch.
 * That is what lets a service be added without touching the window plumbing.
 */
export function createShowRuntime(
  services: ShowService[] = defaultServices(),
  entitled: () => boolean = () => true
): ShowRuntime {
  const bus = new ShowBus()
  const host = new ServiceHost(bus, entitled)
  for (const service of services) host.register(service)

  let current: string | null = null
  // The licence is not asked about here: this factory runs at module load, before the
  // manager that answers exists, and an eager call is a crash on the first launch. The
  // question belongs to configure, which is the only place the answer is used.
  let entitledNow: boolean | null = null

  // Settings application is serialised: a configure that arrives while another is
  // applying waits for it and is applied after, rather than racing it. Two applies in
  // flight interleave at every `await` on a service, and a service left on the older
  // settings while the memory records the newer ones is one no later configure
  // corrects — the memory says those settings are already in force. The callers that
  // move the services under settings — the renderer's settings effect, a licence change
  // and redundancy:configure's by-id restart — come through here; a command moves no
  // settings and does not wait, and teardown (`close`) deliberately does not either.
  let applying: Promise<void> = Promise.resolve()
  function serialised<T>(task: () => Promise<T>): Promise<T> {
    const run = applying.then(task, task)
    // A failing apply is the caller's to see, not the queue's to stop on.
    applying = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  return {
    configure: (settings: ShowSettings) =>
      serialised(async () => {
        // Read when the apply runs, not when it was asked for: what a queued configure
        // is compared against is the settings the services settled on before it. The
        // comparison is by value — `stableJson`, the equality the host's slice diff
        // uses — so a re-send that only reorders keys is the same settings.
        const serialized = stableJson(settings)
        const mayRunPro = entitled()
        // Whether the licence changed is a different question from whether the settings
        // did, and a settings diff cannot answer it: it re-decides every service,
        // including the ones whose settings have not moved (redundancy reads machine
        // settings, and nothing here compares those). The renderer re-sends settings
        // whenever a workspace loads or autosaves, which is why identical settings on an
        // unchanged licence are left alone rather than rebinding a UDP port mid-flight.
        const licenceChanged = entitledNow !== null && mayRunPro !== entitledNow
        if (serialized === current && !licenceChanged) return
        if (current !== null && serialized !== current) {
          // A restart here means the service is turned off or pointed somewhere else.
          // Say so once, at the level of the thing that changed.
          const before = JSON.parse(current) as ShowSettings
          announceChange(bus, before, settings)
        }
        if (licenceChanged) await host.startAll(settings, { entitlementOnly: true })
        else await host.startChanged(settings)
        // Committed once every service has settled — never before applying — so the
        // memory says what is running, and settings already in force are the only ones a
        // configure skips.
        current = serialized
        entitledNow = mayRunPro
      }),

    snapshot(): ShowSnapshot {
      // The stamp is taken before the bus is read, so a renderer that is applying
      // batches while this is in flight can tell which of them the snapshot already
      // contains.
      const at = Date.now()
      return { at, services: host.statuses(), ...bus.snapshot() }
    },

    command: (serviceId, action, payload) => host.command(serviceId, action, payload),

    restart: (serviceId) => serialised(() => host.restart(serviceId)),

    subscribe: (listener) => bus.subscribe(listener),

    alert(level: AlertLevel, source: string, message: string): void {
      bus.alert(level, source, message)
    },

    close(): void {
      // Stopping the services first lets them publish their last events; the bus then
      // drops the listeners so a quit does not wait on a flush timer.
      void host.stopAll().finally(() => bus.close())
    }
  }
}

/**
 * Ports and enable flags change between workspaces often enough that the operator
 * would otherwise have to guess why their OSC stopped arriving.
 */
function announceChange(bus: ShowBus, before: ShowSettings, after: ShowSettings): void {
  if (before.oscIn.enabled && after.oscIn.enabled && before.oscIn.port !== after.oscIn.port) {
    bus.alert('info', 'osc-in', `OSC input port changed: ${before.oscIn.port} → ${after.oscIn.port}`)
  }
  if (before.oscIn.enabled && !after.oscIn.enabled) {
    bus.alert('warning', 'osc-in', 'OSC input turned off')
  }
  const midiChanged =
    before.midiIn.enabled !== after.midiIn.enabled ||
    before.midiIn.portNames.join('\u0000') !== after.midiIn.portNames.join('\u0000')
  if (midiChanged) {
    const detail = after.midiIn.enabled
      ? after.midiIn.portNames.length > 0
        ? after.midiIn.portNames.map(name => `"${name}"`).join(', ')
        : 'every available port'
      : 'off'
    bus.alert('info', 'midi-in', `MIDI input: ${detail}`)
  }
}
