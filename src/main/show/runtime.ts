import { ShowBus } from '../bus/ShowBus'
import { ServiceHost, type CommandResult, type ShowService } from '../bus/ServiceHost'
import { stableJson } from '../../shared/showfile'
import { OscInputService, type OscBinding } from '../services/OscInputService'
import { MidiInputService } from '../services/MidiInputService'
import { MidiTcpService } from '../services/MidiTcpService'
import { SqNativeService } from '../services/SqNativeService'
import { WirelessService, telemetryPorts } from '../services/WirelessService'
import type { EwDxCredentials } from '../ewdx/credentials'
import type { DiscoverResult } from '../ewdx/discovery'
import type { BatteryLog } from '../services/BatteryLog'
import { PresenceService } from '../services/PresenceService'
import { CompanionService } from '../services/CompanionService'
import { RedundancyService } from '../services/RedundancyService'
import { DmxService } from '../services/DmxService'
import { sharedLighting, type DmxLightingOptions } from '../dmx/lighting'
import { TimecodeService } from '../services/TimecodeService'
import type { TimecodeHub } from '../timecode/hub'
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
  /** The receivers' passwords and pinned certificates, which are the machine's and not the show's. */
  ewDx?: EwDxCredentials
  /** How a receiver that has left its address is found by its serial. */
  discoverReceivers?: () => Promise<DiscoverResult>
  /** What each pack used in earlier shows, kept on this machine. */
  batteryLog?: BatteryLog
  /** The lighting's machine half — its interface and its sACN identity — and its seams. */
  dmx?: DmxLightingOptions
  /** The timecode hub, whose receiver the timecode service runs. */
  timecode?: () => TimecodeHub
  /** Where the OSC listener binds — this machine's chosen interface — and what `/version` says. */
  osc?: { binding: () => OscBinding; appVersion: () => string }
}

export function defaultServices(options: ServiceOptions = {}): ShowService[] {
  return [
    new OscInputService({ binding: options.osc?.binding, appVersion: options.osc?.appVersion }),
    new MidiInputService(),
    new MidiTcpService(),
    // The SQ's own control service, beside the desk link: the membership is written there
    // and the desk's mutes stay on the MIDI socket.
    new SqNativeService(),
    new WirelessService(telemetryPorts(options.ewDx, options.discoverReceivers), options.batteryLog),
    new PresenceService(),
    new CompanionService(),
    new RedundancyService({ settings: options.redundancy }),
    // The show's lights: a stream the show keeps up on its own behalf.
    new DmxService(sharedLighting(options.dmx)),
    new TimecodeService(options.timecode ?? noTimecodeHub)
  ]
}

/** A runtime built without the app's hub: the service then fails to start and says why. */
function noTimecodeHub(): TimecodeHub {
  throw new Error('timecode is not available in this build')
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
export function createShowRuntime(services: ShowService[] = defaultServices()): ShowRuntime {
  const bus = new ShowBus()
  const host = new ServiceHost(bus)
  for (const service of services) host.register(service)

  let current: string | null = null
  // Settings application is serialised: a configure that arrives while another is
  // applying waits for it and is applied after, rather than racing it. Two applies in
  // flight interleave at every `await` on a service, and a service left on the older
  // settings while the memory records the newer ones is one no later configure
  // corrects — the memory says those settings are already in force. The callers that
  // move the services under settings — the renderer's settings effect and
  // redundancy:configure's by-id restart — come through here; a command moves no
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
        // The renderer re-sends settings whenever a workspace loads or autosaves, which is
        // why identical settings are left alone rather than rebinding a UDP port mid-flight.
        if (serialized === current) return
        if (current !== null && serialized !== current) {
          // A restart here means the service is turned off or pointed somewhere else.
          // Say so once, at the level of the thing that changed.
          const before = JSON.parse(current) as ShowSettings
          announceChange(bus, before, settings)
        }
        await host.startChanged(settings)
        // Committed once every service has settled — never before applying — so the
        // memory says what is running, and settings already in force are the only ones a
        // configure skips.
        current = serialized
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
