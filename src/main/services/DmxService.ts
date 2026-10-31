import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { ShowSettings } from '../../shared/show'
import {
  DMX_SERVICE_ID,
  readDmxBlackout,
  readDmxConfig,
  readDmxCueId,
  readDmxGo,
  readDmxIdentify,
  readDmxInterfaceChoice,
  readDmxLevel,
  readDmxMonitorRequest,
  readDmxProgram,
  readDmxRelease
} from '../../shared/dmxWire'
import { sharedLighting, type DmxLighting } from '../dmx/lighting'
import { gdtfFallbackName, importGdtfFile, readGdtfRequest } from '../dmx/gdtf'

/**
 * The show's lights over the network: sACN and Art-Net out of this machine, and the consoles
 * it listens to.
 *
 * It is the show's own state held and sent on its behalf — a persistent stream the show keeps
 * up whoever is at the desk. It reads no show settings: the window
 * resolves the rig and hands over where each universe goes as a command, so a patch edited
 * mid-show reconfigures the sockets and never restarts the stream — a restart would end every
 * universe's stream and put the rig dark for a frame.
 */
export class DmxService implements ShowService {
  readonly id = DMX_SERVICE_ID
  readonly label = 'Lighting (sACN / Art-Net)'
  readonly settingsSections = [] as const

  constructor(private readonly lighting: DmxLighting = sharedLighting()) {}

  start(context: ServiceContext, _settings: ShowSettings): void {
    this.lighting.start({
      state: (state, detail, error) => context.setState(state, detail, error),
      alert: message => context.bus.alert('warning', this.id, message)
    })
  }

  stop(): void {
    this.lighting.stop()
  }

  async command(action: string, payload?: unknown): Promise<unknown> {
    // Every payload is read through its validator before anything acts on it: it is the one
    // input main did not write, and a refusal names what was wrong with it.
    const lighting = this.lighting
    switch (action) {
      case 'configure':
        lighting.configure(readDmxConfig(payload))
        return null
      case 'go':
        lighting.go(readDmxGo(payload))
        return null
      case 'stop':
        lighting.stopCue(readDmxCueId(payload))
        return null
      case 'release': {
        const release = readDmxRelease(payload)
        lighting.release(release.cueId, release.fadeMs, release.curve)
        return null
      }
      case 'level': {
        const level = readDmxLevel(payload)
        lighting.level(level.cueId, level.level, level.fadeMs, level.curve, level.shape ?? null)
        return null
      }
      case 'program':
        lighting.program(readDmxProgram(payload))
        return null
      case 'clearProgrammer':
        lighting.clearProgrammer()
        return null
      case 'identify': {
        const identify = readDmxIdentify(payload)
        lighting.identify(identify.values, identify.ms)
        return null
      }
      case 'blackout':
        lighting.setBlackout(readDmxBlackout(payload))
        return null
      case 'panic':
        lighting.panic()
        return null
      case 'monitor':
        return lighting.monitor(readDmxMonitorRequest(payload))
      case 'interfaces':
        return lighting.interfaces()
      case 'setInterface':
        return lighting.setInterface(readDmxInterfaceChoice(payload))
      case 'discover':
        return lighting.discover()
      case 'importGdtf': {
        // A fixture type read from a GDTF file. A file that cannot be one is an answer — the
        // refusal arm of the result — not a failed command, so it raises no alarm.
        const request = readGdtfRequest(payload)
        return importGdtfFile(request.path, gdtfFallbackName(request.path))
      }
      default:
        throw new Error(`the lighting has no action "${action}"`)
    }
  }
}
