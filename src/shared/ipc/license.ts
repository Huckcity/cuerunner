// The licence this machine holds: read the status, ask for a key to be checked, and hear
// when it changes — including the change that was just asked for, because the panels and
// the services both follow the same fact.

import type { ActivationResult, LicenseStatus } from '../license'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const LICENSE_CHANNELS = {
  status: 'license:status',
  activate: 'license:activate',
  deactivate: 'license:deactivate',
  /** The status moved — a key entered, a key removed, a key that ran out. */
  changed: 'license:changed'
} as const

/** The licence, as the renderer reads it (`window.cuerunner.license`). */
export interface LicenseBridge {
  status(): Promise<LicenseStatus>
  /** The key as the operator pasted it; the answer says whether it was taken. */
  activate(text: string): Promise<ActivationResult>
  deactivate(): Promise<LicenseStatus>
  onChanged(callback: (status: LicenseStatus) => void): () => void
}
