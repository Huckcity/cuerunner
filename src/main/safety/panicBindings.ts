import type { ShowEvent } from '../../renderer/src/types/show'
import type { PanicSource } from '../../renderer/src/types/playback'

// The two bindings a show already has for panicking. A desk, a tablet or a keyboard
// sends them over the licensed inputs the show services are already listening on, and
// the main process acts on them itself — the engine is here, and a panic that had to
// wait for the window would be no use in the case it exists for.
//
// Keeping the decision pure means the binding can be tested without a socket, a port or
// a MIDI interface, and the IPC layer only has to apply the answer.

/** The address a console sends to silence the show. */
export const PANIC_OSC_ADDRESS = '/winslab/panic'

/** CC 120 is All Sound Off. It is only meaningful at zero. */
export const MIDI_ALL_SOUND_OFF = 120

export interface PanicBinding {
  source: PanicSource
  reason: string
}

/** What a show input asked for, or null when it asked for something else. */
export function panicFromShowEvent(event: ShowEvent): PanicBinding | null {
  if (event.kind === 'osc' && event.address === PANIC_OSC_ADDRESS) {
    return { source: 'osc', reason: `OSC ${PANIC_OSC_ADDRESS} from ${event.from}` }
  }
  if (
    event.kind === 'midi' &&
    event.message.kind === 'cc' &&
    event.message.controller === MIDI_ALL_SOUND_OFF &&
    event.message.value === 0
  ) {
    return { source: 'midi', reason: `MIDI all-sound-off on ${event.device}` }
  }
  return null
}
