import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { TimecodeHub } from '../timecode/hub'
import type { ShowSettings } from '../../shared/show'

/**
 * Follows the clock the show is driven by: MTC on a MIDI input, LTC on an audio input, or
 * ArtTimeCode on the network.
 *
 * Pro, like the other services that run the show for the operator rather than listen for
 * them. Its settings are the machine's — which port the clock arrives on and which input
 * the LTC cable is in belong to this rack — so it declares no section of the show's, and
 * the hub restarts it when they change.
 */
export class TimecodeService implements ShowService {
  readonly id = 'timecode'
  readonly label = 'Timecode'
  readonly pro = true as const
  readonly settingsSections = [] as const

  constructor(private readonly hub: () => TimecodeHub) {}

  async start(context: ServiceContext, _settings: ShowSettings): Promise<void> {
    await this.hub().startReceiving(context)
  }

  async stop(): Promise<void> {
    await this.hub().stopReceiving()
  }
}
