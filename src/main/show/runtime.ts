import { ShowBus } from '../bus/ShowBus'
import { ServiceHost, type CommandResult, type ShowService } from '../bus/ServiceHost'
import { OscInputService } from '../services/OscInputService'
import { MidiInputService } from '../services/MidiInputService'
import { MidiTcpService } from '../services/MidiTcpService'
import { WirelessService } from '../services/WirelessService'
import { PresenceService } from '../services/PresenceService'
import { CompanionService } from '../services/CompanionService'
import { RedundancyService } from '../services/RedundancyService'
import type { RedundancySettings } from '../../shared/redundancy'
import type { ShowEvent, ShowSettings, ShowSnapshot } from '../../renderer/src/types/show'

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
  /**
   * Stops every service and forgets the settings. The next configure brings them back
   * up, so this is how the show is told that the app is no longer licensed to run it.
   */
  suspend(): Promise<void>
  snapshot(): ShowSnapshot
  command(serviceId: string, action: string, payload?: unknown): Promise<CommandResult>
  restart(serviceId: string): Promise<CommandResult>
  subscribe(listener: (events: ShowEvent[]) => void): () => void
  close(): void
}

/**
 * Everything between the show services and the rest of the app.
 *
 * One runtime owns the bus and the host, so the IPC layer never has to know which
 * services exist: it configures them, reads a snapshot, and subscribes to the batch.
 * That is what lets a service be added without touching the window plumbing.
 */
export function createShowRuntime(services: ShowService[] = defaultServices()): ShowRuntime {
  const bus = new ShowBus()
  const host = new ServiceHost(bus)
  for (const service of services) host.register(service)

  let current: string | null = null

  return {
    async configure(settings: ShowSettings): Promise<void> {
      const serialized = JSON.stringify(settings)
      // The renderer re-sends its settings whenever a workspace loads or autosaves;
      // rebinding a UDP port each time would drop whatever is mid-flight.
      if (serialized === current) return
      if (current !== null) {
        // A restart here means the service is turned off or pointed somewhere else.
        // Say so once, at the level of the thing that changed.
        const before = JSON.parse(current) as ShowSettings
        announceChange(bus, before, settings)
      }
      current = serialized
      await host.startAll(settings)
    },

    async suspend(): Promise<void> {
      // Forgetting the settings matters as much as stopping the services: the dedupe
      // above compares against them, and a key entered later has to bring the same
      // settings back up.
      current = null
      await host.stopAll()
    },

    snapshot(): ShowSnapshot {
      // The stamp is taken before the bus is read, so a renderer that is applying
      // batches while this is in flight can tell which of them the snapshot already
      // contains.
      const at = Date.now()
      return { at, services: host.statuses(), ...bus.snapshot() }
    },

    command: (serviceId, action, payload) => host.command(serviceId, action, payload),

    restart: (serviceId) => host.restart(serviceId),

    subscribe: (listener) => bus.subscribe(listener),

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
