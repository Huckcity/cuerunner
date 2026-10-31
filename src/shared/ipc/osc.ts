// An OSC packet to a host the operator typed. The desk link and an OSC cue both come
// through here, which is why the arguments are the cue's own typed form rather than the
// numbers a scene recall happens to carry.
//
// And which network interface this machine's OSC listens and sends on: a fact about the
// machine, kept in its own `osc.json` in the user-data folder, chosen in Settings.

import type { OscArg } from '../cue'
import type { Refusal } from './refusal'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const OSC_CHANNELS = {
  send: 'osc:send',
  /** The interfaces this machine has, and which one each direction of OSC is pinned to. */
  interfaces: 'osc:interfaces',
  /** Pins one direction to an interface, or unpins it; the listener rebinds at once. */
  setInterface: 'osc:set-interface'
} as const

export interface OscSendPayload {
  host: string
  port: number
  address: string
  args: OscArg[]
}

/** What the socket did: false with a reason is a packet that never left. */
export interface OscSendResult {
  ok: boolean
  error?: string
}

/** Which way the traffic goes: what the show hears, or what its cues send. */
export type OscDirection = 'in' | 'out'

/** What `osc.json` holds: each direction's interface by name, and its address when chosen. */
export interface OscMachineSettings {
  inputInterface: string | null
  inputAddress: string | null
  outputInterface: string | null
  outputAddress: string | null
}

/** One IPv4 interface this machine has, as the settings list offers it. */
export interface OscInterface {
  name: string
  address: string
  internal: boolean
}

/** One direction's choice as it stands on this machine now. */
export interface OscInterfaceChoice {
  /** The interface chosen, by name, or null for "any" — whatever the OS routes by. */
  selected: string | null
  /** The address the socket binds now: the interface's, or null for any. */
  boundAddress: string | null
  /** The chosen interface is not on this machine now: the socket is unpinned until it is. */
  missing: boolean
}

export interface OscInterfaceState {
  interfaces: OscInterface[]
  input: OscInterfaceChoice
  output: OscInterfaceChoice
}

export interface OscSetInterfacePayload {
  direction: OscDirection
  /** An interface's name, or null to unpin. */
  name: string | null
}

/** The state after the change, or the sentence saying why not: a name this machine has not got. */
export type OscSetInterfaceResult = ({ ok: true } & OscInterfaceState) | Refusal

/** OSC, as the renderer reads it (`window.cuerunner.osc`). */
export interface OscBridge {
  send(cmd: OscSendPayload): Promise<OscSendResult>
  interfaces(): Promise<OscInterfaceState>
  setInterface(payload: OscSetInterfacePayload): Promise<OscSetInterfaceResult>
}
