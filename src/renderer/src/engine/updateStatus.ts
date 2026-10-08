import { useSyncExternalStore } from 'react'
import type { UpdateSettings, UpdateStatus } from '../../../shared/update'

/**
 * What the window knows about updates: the status main last pushed. Kept beside the store
 * rather than in it — nothing that draws the cue list needs to hear a download's progress —
 * the way the timecode status is.
 */
let status: UpdateStatus | null = null
/** The version whose bar the operator put away with Later, for this session. */
let dismissed: string | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeUpdates(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function updateStatus(): UpdateStatus | null {
  return status
}

export function setUpdateStatus(next: UpdateStatus): void {
  status = next
  emit()
}

export function useUpdateStatus(): UpdateStatus | null {
  return useSyncExternalStore(subscribeUpdates, updateStatus)
}

export function dismissedUpdate(): string | null {
  return dismissed
}

/** Later: the bar for this version stays away until the app is next started. */
export function dismissUpdate(version: string): void {
  dismissed = version
  emit()
}

export function useDismissedUpdate(): string | null {
  return useSyncExternalStore(subscribeUpdates, dismissedUpdate)
}

/**
 * Changes the machine's update settings. The window shows the change at once and then keeps
 * what main accepted: a checkbox bound to the answer alone would spring back under the hand
 * that ticked it for as long as the file takes to write. A change main refuses puts the
 * settings back as they were.
 */
export async function configureUpdates(patch: Partial<UpdateSettings>): Promise<void> {
  const before = status
  if (before !== null) {
    setUpdateStatus({
      ...before,
      settings: { ...before.settings, ...patch, lockout: { ...before.settings.lockout, ...(patch.lockout ?? {}) } }
    })
  }
  try {
    setUpdateStatus(await window.cuerunner.update.configure(patch))
  } catch (error) {
    if (before !== null) setUpdateStatus(before)
    throw error
  }
}

/** A fault's own words, without the sentence Electron wraps a rejected call in. */
export function faultReason(fault: unknown): string {
  const message = fault instanceof Error ? fault.message : String(fault)
  return message.replace(/^Error invoking remote method '[^']*':\s*/, '').replace(/^Error:\s*/, '')
}

/** Starts the download; the sentence it was refused with, or null when it started. */
export async function downloadUpdate(): Promise<string | null> {
  try {
    const result = await window.cuerunner.update.download()
    return result.ok ? null : result.error
  } catch (fault) {
    return `The download could not be started: ${faultReason(fault)}`
  }
}

/** The operator's restart; the sentence it was refused with, or null when it is under way. */
export async function installUpdate(): Promise<string | null> {
  try {
    const result = await window.cuerunner.update.install()
    return result.ok ? null : result.error
  } catch (fault) {
    return `The update could not be installed: ${faultReason(fault)}`
  }
}

/** Check now; the sentence it was refused with, or null when it ran. */
export async function checkForUpdate(): Promise<string | null> {
  try {
    const result = await window.cuerunner.update.check()
    if (!result.ok) return result.error
    setUpdateStatus(result.status)
    return null
  } catch (fault) {
    return `The check could not run: ${faultReason(fault)}`
  }
}
