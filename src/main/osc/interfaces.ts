// Which interface each direction of OSC is on, as the window reads it and changes it.
//
// The machine's choice is `osc.json` (`machine.ts`); the interfaces are whatever the OS has now
// (`listInterfaces`, shared with the lighting's own choice); and a choice is resolved against
// them the lighting's way (`resolveBinding`) — by name, then by the address it had — so the
// listener and the senders bind the same address the Settings window shows.

import { listInterfaces, resolveBinding } from '../dmx/network'
import type { DmxInterface } from '../../shared/dmxWire'
import { Refusal } from '../ipc/refusal'
import type {
  OscDirection,
  OscInterfaceChoice,
  OscInterfaceState
} from '../../shared/ipc/osc'
import type { MachineOsc } from './machine'
import type { OscBinding } from '../services/OscInputService'

export interface OscInterfaces {
  state(): OscInterfaceState
  /** Pins a direction, or refuses a name this machine has not got. Rebinds what it moved. */
  set(direction: OscDirection, name: string | null): Promise<OscInterfaceState>
  /** Where the listener binds now. */
  input(): OscBinding
  /** The address OSC goes out of now, or null for any. */
  outputAddress(): string | null
}

export interface OscInterfaceOptions {
  machine: MachineOsc
  /** The interfaces the OS has now; a test hands in its own. */
  read?: () => DmxInterface[]
  /** Restarts the listener on its new address. */
  restartInput: () => Promise<void>
  /** Drops the senders' sockets, so the next send opens one on the new address. */
  rebindOutput: () => void
}

export function createOscInterfaces(options: OscInterfaceOptions): OscInterfaces {
  const read = options.read ?? (() => listInterfaces())

  const choice = (name: string | null, address: string | null, interfaces: DmxInterface[]): OscInterfaceChoice => {
    const resolved = resolveBinding({ name, address }, interfaces)
    return { selected: name, boundAddress: resolved.binding.address, missing: resolved.missing }
  }

  const state = (): OscInterfaceState => {
    const interfaces = read()
    const machine = options.machine.current()
    return {
      interfaces: interfaces.map(entry => ({ name: entry.name, address: entry.address, internal: entry.internal })),
      input: choice(machine.inputInterface, machine.inputAddress, interfaces),
      output: choice(machine.outputInterface, machine.outputAddress, interfaces)
    }
  }

  return {
    state,
    async set(direction, name) {
      const interfaces = read()
      const found = name === null ? null : interfaces.find(entry => entry.name === name)
      if (name !== null && found === undefined) {
        throw new Refusal(`there is no network interface called “${name}” on this machine`)
      }
      await options.machine.update(direction, name, found?.address ?? null)
      if (direction === 'in') await options.restartInput()
      else options.rebindOutput()
      return state()
    },
    input() {
      const machine = options.machine.current()
      const resolved = resolveBinding({ name: machine.inputInterface, address: machine.inputAddress }, read())
      return { address: resolved.binding.address, name: machine.inputInterface, missing: resolved.missing }
    },
    outputAddress() {
      const machine = options.machine.current()
      return resolveBinding({ name: machine.outputInterface, address: machine.outputAddress }, read()).binding.address
    }
  }
}
