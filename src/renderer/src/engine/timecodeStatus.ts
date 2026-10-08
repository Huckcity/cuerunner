import { useSyncExternalStore } from 'react'
import {
  idleReceiverStatus,
  type TimecodeSettings,
  type TimecodeStatus
} from '../../../shared/timecode'

/**
 * What the window knows about timecode: the status main last pushed, and this machine's
 * timecode settings. Kept beside the store rather than in it — the status arrives up to
 * twenty-five times a second, and nothing that renders the cue list needs to hear it.
 */
let status: TimecodeStatus = { receiver: idleReceiverStatus(), generators: [] }
let settings: TimecodeSettings | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function subscribeTimecode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function timecodeStatus(): TimecodeStatus {
  return status
}

export function setTimecodeStatus(next: TimecodeStatus): void {
  status = next
  emit()
}

export function timecodeSettings(): TimecodeSettings | null {
  return settings
}

export function setTimecodeSettings(next: TimecodeSettings): void {
  settings = next
  emit()
}

export function useTimecodeStatus(): TimecodeStatus {
  return useSyncExternalStore(subscribeTimecode, timecodeStatus)
}

export function useTimecodeSettings(): TimecodeSettings | null {
  return useSyncExternalStore(subscribeTimecode, timecodeSettings)
}

/** Applies a change to this machine's settings, and keeps what main accepted. */
export async function configureTimecode(patch: Partial<TimecodeSettings>): Promise<TimecodeSettings> {
  const accepted = await window.cuerunner.timecode.configure(patch)
  setTimecodeSettings(accepted)
  return accepted
}
