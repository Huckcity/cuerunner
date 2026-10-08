import { readFileSync } from 'node:fs'
import { writeFileAtomically } from '../workspace/recovery'
import type { CameraDevice } from '../../shared/camera'

/**
 * Which capture device each camera cue opens on this machine, and the only place that is read
 * or written.
 *
 * Chromium's id for a device is this machine's: it is salted per install, so the same webcam has
 * another id on the venue machine than on the laptop the show was built on. The show carries the
 * device's name (`CameraCue.deviceName`), which the venue machine matches until the operator
 * picks the device there; the pick is kept here, by cue id, beside the outputs' placements
 * (spine AD-14) — never in the show.
 */
export interface MachineCameraChoices {
  choice(cueId: string): CameraDevice | null
  all(): Record<string, CameraDevice>
  choose(cueId: string, device: CameraDevice | null): Promise<void>
}

/** How many cues' choices are kept: a machine that has run many shows forgets the oldest. */
export const MAX_KEPT_CHOICES = 256

/** The longest id or name kept: Chromium's ids are 64 hex characters, names a line. */
const MAX_FIELD = 512

/** A stored device this build can use, or null for an entry it cannot. */
export function normalizeCameraDevice(value: unknown): CameraDevice | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Partial<CameraDevice>
  if (typeof raw.deviceId !== 'string' || raw.deviceId === '' || raw.deviceId.length > MAX_FIELD) return null
  return { deviceId: raw.deviceId, label: typeof raw.label === 'string' ? raw.label.slice(0, MAX_FIELD) : '' }
}

export interface MachineCameraChoicesOptions {
  filePath: string
  /** Test seam for a file that is not there or not readable. */
  readFile?: (path: string) => string
  /** Test seam for the write. */
  writeFile?: (path: string, text: string) => Promise<void>
}

export function createMachineCameraChoices(options: MachineCameraChoicesOptions): MachineCameraChoices {
  const read = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'))
  const write = options.writeFile ?? writeFileAtomically

  const choices = ((): Record<string, CameraDevice> => {
    try {
      const text = read(options.filePath)
      // Bounded: a few hundred short entries is all this file ever holds.
      if (text.length > 512 * 1024) return {}
      const parsed = JSON.parse(text) as { cues?: unknown } | null
      const out: Record<string, CameraDevice> = {}
      if (parsed && typeof parsed.cues === 'object' && parsed.cues !== null) {
        for (const [cueId, device] of Object.entries(parsed.cues).slice(-MAX_KEPT_CHOICES)) {
          const normalized = normalizeCameraDevice(device)
          if (normalized !== null) out[cueId] = normalized
        }
      }
      return out
    } catch {
      // Missing or unreadable: every camera cue finds its device by the name the show carries.
      return {}
    }
  })()

  return {
    choice: cueId => choices[cueId] ?? null,
    all: () => ({ ...choices }),
    async choose(cueId, device) {
      delete choices[cueId]
      const normalized = device === null ? null : normalizeCameraDevice(device)
      // Re-inserted, so the newest choice is the last to be forgotten.
      if (normalized !== null) choices[cueId] = normalized
      const ids = Object.keys(choices)
      for (const id of ids.slice(0, Math.max(0, ids.length - MAX_KEPT_CHOICES))) delete choices[id]
      await write(options.filePath, `${JSON.stringify({ cues: choices }, null, 2)}\n`)
    }
  }
}
