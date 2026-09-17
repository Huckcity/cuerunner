import { DEMO_PACK_COUNT, demoChannelId } from '../../shared/show'
import type { RfThresholds, TelemetryChannel, TelemetryDocument } from '../../shared/show'

// The pure half of wireless telemetry: what a source is allowed to say, and how a
// reading maps onto the bands the service raises alarms from. The service owns the
// timers and the bus; keeping these functions separate is what lets the parts that
// decide "is this an alarm?" be tested without a clock or a socket.

export type Band = 'ok' | 'warning' | 'critical'

// Worst last, so "did this reading get worse?" is one comparison rather than a pair of
// ifs per measurement.
const RANK: Record<Band, number> = { ok: 0, warning: 1, critical: 2 }

/** True when a reading has moved into a band worse than the one before it. */
export function isWorse(band: Band, previous: Band): boolean {
  return RANK[band] > RANK[previous]
}

/**
 * At or below the critical line a pack has to come off its performer; at or below the
 * warning line it is worth a swap before the next entrance.
 */
export function batteryBand(percent: number, thresholds: RfThresholds): Band {
  if (percent <= thresholds.batteryCritical) return 'critical'
  if (percent <= thresholds.batteryWarning) return 'warning'
  return 'ok'
}

/**
 * RF has one line rather than two: below it the audio is on borrowed time, and above it
 * there is nothing to say — the transmitter is either heard or it is not.
 */
export function rfBand(dbm: number, thresholds: RfThresholds): Band {
  return dbm <= thresholds.rfWarningDbm ? 'warning' : 'ok'
}

/** The document as it arrives, before any of it has been checked or trusted. */
interface RawDocument {
  channels?: unknown
}

interface RawChannel {
  id?: unknown
  name?: unknown
  batteryPercent?: unknown
  batteryMinutes?: unknown
  charging?: unknown
  rfDbm?: unknown
  audioLevel?: unknown
  muted?: unknown
  frequencyMhz?: unknown
}

/**
 * A bridge is someone else's program, so a field that arrived as a string, a null or a
 * NaN is not a reading: it is dropped rather than shown as a measurement the pack never
 * made.
 */
function reading(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Reads a source's document against the channel contract.
 *
 * Null means the document is unusable as a whole: not an object, no `channels` array, or
 * a channel with no id to hang a device on. Everything else is a reading the source left
 * out, which is simply absent.
 */
export function parseTelemetry(value: unknown): TelemetryDocument | null {
  if (typeof value !== 'object' || value === null) return null
  // The cast is the parse boundary: everything read off it is checked below.
  const { channels } = value as RawDocument
  if (!Array.isArray(channels)) return null

  const parsed: TelemetryChannel[] = []
  for (const entry of channels) {
    if (typeof entry !== 'object' || entry === null) return null
    const raw = entry as RawChannel
    if (typeof raw.id !== 'string') return null

    const channel: TelemetryChannel = { id: raw.id }
    if (typeof raw.name === 'string') channel.name = raw.name

    const batteryPercent = reading(raw.batteryPercent)
    if (batteryPercent !== undefined) channel.batteryPercent = batteryPercent
    const batteryMinutes = reading(raw.batteryMinutes)
    if (batteryMinutes !== undefined) channel.batteryMinutes = batteryMinutes
    const rfDbm = reading(raw.rfDbm)
    if (rfDbm !== undefined) channel.rfDbm = rfDbm
    const audioLevel = reading(raw.audioLevel)
    if (audioLevel !== undefined) channel.audioLevel = audioLevel
    const frequencyMhz = reading(raw.frequencyMhz)
    if (frequencyMhz !== undefined) channel.frequencyMhz = frequencyMhz

    // A boolean is either reported or not: "yes", 1 and "false" are not mute states.
    if (typeof raw.charging === 'boolean') channel.charging = raw.charging
    if (typeof raw.muted === 'boolean') channel.muted = raw.muted

    parsed.push(channel)
  }
  return { channels: parsed }
}

// The battery each demo pack starts the show with. Packs 3 to 12 sit inside the healthy
// window with room for the drift below, so the demo never invents an alarm: pack 1 is
// the critical one and pack 2 the low one, on purpose.
const DEMO_BATTERY = [6, 19, 100, 97, 94, 91, 88, 85, 82, 79, 76, 73]
/** The rack does not report this channel at all: it is the pack that never answers. */
const DEMO_ABSENT_PACK = 7
/** Percent per minute the simulated packs lose, and the most they ever lose. The cap
 *  keeps a demo left open all evening from draining the cast to nothing — and keeps the
 *  numbers from reaching a threshold on their own. */
const DEMO_DRAIN_PER_MINUTE = 3
const DEMO_DRAIN_LIMIT = 6

// The readings drift with the clock rather than with the call count, so a caller that
// passes its own `now` — a test, or a clock the app controls — gets a repeatable rack.
// The first call is the epoch, and the drift is measured from there.
let demoEpoch: number | null = null

/**
 * The simulated rack: twelve channels generated in the main process, so the wireless
 * feature can be looked at with no receiver on the network.
 *
 * The batteries drift down from the first reading and the readings wander with the
 * second, because a panel showing the same numbers forever looks broken. Pack 7 is left
 * out of the document entirely — it is the channel the service ages out to offline
 * against the plot.
 */
export function demoRack(now: number = Date.now()): TelemetryDocument {
  if (demoEpoch === null) demoEpoch = now
  const minutes = Math.max(0, now - demoEpoch) / 60_000
  const drain = Math.min(minutes * DEMO_DRAIN_PER_MINUTE, DEMO_DRAIN_LIMIT)
  const second = Math.floor(now / 1000)

  const channels: TelemetryChannel[] = []
  for (let index = 1; index <= DEMO_PACK_COUNT; index++) {
    if (index === DEMO_ABSENT_PACK) continue
    // Drifting fractionally, so the reading moves on screen without the panel having to
    // wait for the next whole percent.
    const batteryPercent = Math.round(Math.max(0, DEMO_BATTERY[index - 1] - drain) * 10) / 10
    channels.push({
      id: demoChannelId(index),
      name: `Pack ${index}`,
      batteryPercent,
      batteryMinutes: Math.round(batteryPercent * 2.5),
      charging: false,
      // Every channel stays well inside the healthy window: RF trouble is something a
      // real receiver shows, not something the simulation invents. The clamp holds the
      // wander inside the range a healthy rack reports.
      rfDbm: Math.min(-50, Math.max(-70, -50 - (index - 1) * 1.5 + ((second + index * 7) % 5) - 2)),
      audioLevel: 40 + ((index * 13 + second) % 45),
      muted: false,
      frequencyMhz: 470 + (index - 1) * 2
    })
  }
  return { channels }
}
