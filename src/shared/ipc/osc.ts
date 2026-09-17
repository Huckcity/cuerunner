// An OSC packet to a host the operator typed. The desk link and an OSC cue both come
// through here, which is why the arguments are the cue's own typed form rather than the
// numbers a scene recall happens to carry.

import type { OscArg } from '../cue'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const OSC_CHANNELS = {
  send: 'osc:send'
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

/** OSC output, as the renderer reads it (`window.cuerunner.osc`). */
export interface OscBridge {
  send(cmd: OscSendPayload): Promise<OscSendResult>
}
