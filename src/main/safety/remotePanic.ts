import type { ShowEvent, OscInSettings } from '../../shared/show'
import type { PanicBinding } from './panicBindings'
import { PANIC_OSC_ADDRESS } from './panicBindings'
import { parseRemote, remoteEnabled } from '../../shared/oscRemote'

// The remote's panic, decided beside the two bindings the show already had. `/cuerunner/panic`
// is one of those, and it is answered whatever the remote setting says — it was a binding
// before the remote existed, and a show that turned the remote off did not turn off its
// emergency stop. The other spellings are the remote's (`/panic`, and the same under a QLab
// `/workspace/{id}` prefix or Cuerunner's own), so they answer only where the remote does.
//
// Main acts on them itself, for the same reason it acts on the first two: the engine is here,
// and a panic that had to wait for the window would be no use in the case it exists for.

export function remotePanicFromEvent(event: ShowEvent, oscIn: OscInSettings): PanicBinding | null {
  if (event.kind !== 'osc') return null
  // The existing binding has already answered this one.
  if (event.address === PANIC_OSC_ADDRESS) return null
  if (!remoteEnabled(oscIn)) return null
  const command = parseRemote(event.address, event.args)
  if (command?.kind !== 'panic') return null
  return { source: 'osc', reason: `OSC ${event.address} from ${event.from}` }
}
