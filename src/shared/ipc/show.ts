// The show services, over one channel each: the window never talks to a service
// directly, it configures the set, reads a snapshot, and sends a command to one by id —
// so a service can be added without a new channel, and every panel draws the same host's
// status record.

import type { ShowEvent, ShowSettings, ShowSnapshot } from '../show'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const SHOW_CHANNELS = {
  snapshot: 'show:snapshot',
  configure: 'show:configure',
  command: 'show:command',
  restart: 'show:restart',
  /** The host's own events, batched; preload subscribes with `onEvents`. */
  events: 'show:events'
} as const

/** One command to one service by id, with whatever that service's action reads. */
export interface ShowCommandPayload {
  service: string
  action: string
  payload?: unknown
}

/** What a service answered: `ok` false is a refusal or a fault, not a lost message. */
export interface ShowCommandResult {
  ok: boolean
  result?: unknown
  error?: string
}

/** The show services, as the renderer reads them (`window.cuerunner.show`). */
export interface ShowBridge {
  snapshot(): Promise<ShowSnapshot>
  configure(settings: ShowSettings): Promise<void>
  command(service: string, action: string, payload?: unknown): Promise<ShowCommandResult>
  restart(service: string): Promise<ShowCommandResult>
  onEvents(callback: (events: ShowEvent[]) => void): () => void
}
