// The show services, over one channel each: the window never talks to a service
// directly, it configures the set, reads a snapshot, and sends a command to one by id —
// so a service can be added without a new channel, and every panel draws the same host's
// status record.

import type { ShowEvent, ShowSettings, ShowSnapshot } from '../show'
import type { Refusal } from './refusal'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const SHOW_CHANNELS = {
  snapshot: 'show:snapshot',
  configure: 'show:configure',
  command: 'show:command',
  restart: 'show:restart',
  /** What this machine holds for an EW-DX receiver: read-only, and open to a locked app. */
  ewDxCredentials: 'show:ewdx-credentials',
  ewDxSetPassword: 'show:ewdx-set-password',
  ewDxTrustAgain: 'show:ewdx-trust-again',
  ewDxForget: 'show:ewdx-forget',
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

/**
 * What this machine knows about one EW-DX receiver, and nothing it could be used to log in
 * with: whether a password is held and how it is kept, and the fingerprint of the
 * certificate it was first seen with — the thing an operator compares to the one on the
 * receiver's own screen. The password itself never travels back to the window.
 */
export interface EwDxCredentialStatus {
  hasPassword: boolean
  /** False when the platform has no keychain and the password is on disk as written. */
  encrypted: boolean
  /** SHA-256, colon-separated; null until the first connection has seen a certificate. */
  fingerprint: string | null
}

export interface EwDxSetPasswordPayload {
  sourceId: string
  password: string
}

/**
 * A change to what is held for a receiver: the new status, or the sentence saying why not.
 * The refusals are ordinary — no Pro licence, an empty password — and are an arm of the
 * answer, not a rejection.
 */
export type EwDxCredentialResult = ({ ok: true } & EwDxCredentialStatus) | Refusal

/** The show services, as the renderer reads them (`window.cuerunner.show`). */
export interface ShowBridge {
  snapshot(): Promise<ShowSnapshot>
  configure(settings: ShowSettings): Promise<void>
  command(service: string, action: string, payload?: unknown): Promise<ShowCommandResult>
  restart(service: string): Promise<ShowCommandResult>
  ewDxCredentials(sourceId: string): Promise<EwDxCredentialStatus>
  /** Keeps a receiver's password on this machine and reconnects with it. */
  ewDxSetPassword(sourceId: string, password: string): Promise<EwDxCredentialResult>
  /** Forgets the trusted certificate, so the next connection trusts whatever it is shown. */
  ewDxTrustAgain(sourceId: string): Promise<EwDxCredentialResult>
  /** Forgets everything held for a receiver, for a source that has been removed. */
  ewDxForget(sourceId: string): Promise<EwDxCredentialStatus>
  onEvents(callback: (events: ShowEvent[]) => void): () => void
}
