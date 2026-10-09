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

/**
 * Applies a change to this machine's settings. The window shows the change at once and then
 * keeps what main accepted: main writes the file and restarts the receiver before it answers,
 * which on a slow disk is long enough for a control bound to the answer to snap back under
 * the hand that changed it. A change main refuses puts the settings back as they were.
 */
export async function configureTimecode(patch: Partial<TimecodeSettings>): Promise<TimecodeSettings> {
  const before = settings
  if (before !== null) setTimecodeSettings({ ...before, ...patch })
  try {
    const accepted = await window.cuerunner.timecode.configure(patch)
    setTimecodeSettings(accepted)
    return accepted
  } catch (error) {
    if (before !== null) setTimecodeSettings(before)
    throw error
  }
}
