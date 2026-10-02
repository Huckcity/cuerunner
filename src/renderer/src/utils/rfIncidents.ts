import type { DeviceState, RfThresholds, ShowEvent } from '../../../shared/show'

// What went wrong with a pack, and what the show was doing when it did.
//
// The service counts a dropout, and the report says "2 dropouts" — which is the beginning of the
// question the morning asks, and not the end: *when*, and what was on. The service cannot answer
// it, because it does not know what is playing. The window does, so the window notes it, at the
// moment a device event says a pack went quiet, its signal turned weak, or it began to complain.

export type IncidentKind = 'dropout' | 'weak' | 'warning'

export interface IncidentCue {
  number: string
  name: string
}

export interface RfIncident {
  at: number
  /** The channel the device reported, without the `rf:` that names the service. */
  channelId: string
  /** What the device was called when it happened: a rename later does not rewrite the night. */
  name: string
  kind: IncidentKind
  /** In words: "went quiet", "signal weak", "audio clipping". */
  text: string
  critical?: boolean
  /** What was playing, or null between cues — which is a fact, not a gap to fill with a guess. */
  cue: IncidentCue | null
}

/** A runaway guard: a session has a handful of incidents, and a flapping pack must not fill the store. */
export const MAX_INCIDENTS = 200

const RF_PREFIX = 'rf:'

function isWeak(device: DeviceState, thresholds: RfThresholds): boolean {
  const rf = device.rf
  return rf !== undefined && (rf.weak ?? rf.level <= thresholds.rfWarningDbm)
}

/**
 * The incidents a batch of events carries, given what the devices were before it.
 *
 * Only a *change* is an incident: a pack that is weak and stays weak was noted once, and a device
 * the window has never seen cannot be said to have changed — it may simply be new, or the window
 * may have just reloaded. Each complaint is its own incident, noted when it first appears.
 */
export function incidentsFrom(
  before: DeviceState[],
  events: ShowEvent[],
  thresholds: RfThresholds,
  cue: IncidentCue | null
): RfIncident[] {
  const known = new Map(before.map(device => [device.id, device]))
  const incidents: RfIncident[] = []

  for (const event of events) {
    if (event.kind !== 'device' || !event.device.id.startsWith(RF_PREFIX)) continue
    const device = event.device
    const previous = known.get(device.id)
    known.set(device.id, device)
    if (previous === undefined) continue

    const base = { at: event.at, channelId: device.id.slice(RF_PREFIX.length), name: device.name, cue }
    if (previous.online && !device.online) {
      incidents.push({ ...base, kind: 'dropout', text: 'went quiet' })
      continue
    }
    if (!device.online) continue

    if (!isWeak(previous, thresholds) && isWeak(device, thresholds)) {
      incidents.push({ ...base, kind: 'weak', text: 'signal weak' })
    }
    const had = new Set((previous.warnings ?? []).map(warning => warning.text))
    for (const warning of device.warnings ?? []) {
      if (had.has(warning.text)) continue
      incidents.push({
        ...base,
        kind: 'warning',
        text: warning.text,
        ...(warning.critical ? { critical: true } : {})
      })
    }
  }
  return incidents
}

/** "cue 47 Walk-in", or "between cues": how the report says what was playing. */
export function cueWords(cue: IncidentCue | null): string {
  if (cue === null) return 'between cues'
  const number = cue.number.trim()
  const name = cue.name.trim()
  if (number !== '' && name !== '') return `cue ${number} ${name}`
  return number !== '' ? `cue ${number}` : name !== '' ? `cue ${name}` : 'a cue with no name'
}
