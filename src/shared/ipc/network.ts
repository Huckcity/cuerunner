// A network cue's request, made by main rather than by the page: a console on the LAN has
// no reason to send CORS headers, and a cue has to keep working when the window is busy
// or has been reloaded. The request and its result are the payloads already declared in
// src/shared/network.ts, so this file names only the channels and the bridge over them.

import type { NetworkRequest, NetworkResult } from '../network'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const NETWORK_CHANNELS = {
  request: 'network:request',
  /** Abandons a request that is still in flight. False means it had already finished. */
  cancel: 'network:cancel'
} as const

/** Network cues, as the renderer reads them (`window.cuerunner.network`). */
export interface NetworkBridge {
  request(request: NetworkRequest): Promise<NetworkResult>
  cancel(requestId: string): Promise<boolean>
}
