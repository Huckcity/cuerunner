import type { TelemetryChannel } from '../../shared/show'

// The pure half of the EW-DX source: what a receiver's resources say, read as telemetry
// channels. Nothing here opens a socket or reads a clock, so "is this pack linked?" and
// "what does -83 dBm look like on the panel?" are answered by a test and not a receiver.

/** The receiver's resources by path, each the last JSON value it pushed for that path. */
export type Resources = ReadonlyMap<string, unknown>

/** The lowest audio level the panel's 0-100 scale distinguishes from silence. */
const AUDIO_FLOOR_DBFS = -60

/** Receiver channels are numbered from 0, and so are the transmitters their mates name. */
export const channelPath = (channel: number): string => `/api/channel/${channel}`
export const transmitterPath = (transmitter: number): string => `/api/transmitters/${transmitter}`

/**
 * The channel id a plot patches a pack to. It carries the receiver's serial rather than
 * its address, so a receiver that moves to a new IP is still the same channel and one
 * that is replaced is not.
 */
export function ewDxChannelId(serial: string, channel: number): string {
  return `ew-dx:${serial}:${channel}`
}

/**
 * Every path a source needs the receiver to push, for a receiver of this many channels.
 * Transmitters are subscribed whether or not one is linked: a resource with nothing
 * behind it is `{}`, and a pack linking later has to arrive as a change and not as a
 * subscription this session never made.
 */
export function subscriptionPaths(channels: number): string[] {
  const paths: string[] = []
  for (let channel = 0; channel < channels; channel += 1) {
    const base = channelPath(channel)
    paths.push(
      base,
      `${base}/level`,
      `${base}/signalStrengthIndicator`,
      `${base}/warnings`,
      `/api/rf/channels/${channel}`,
      transmitterPath(channel),
      `${transmitterPath(channel)}/battery`
    )
  }
  return paths
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** `{ "value": n }` is how a receiver spells a single measurement. */
function measurement(value: unknown): number | undefined {
  return finite(record(value)?.value)
}

/** dBfs onto the 0-100 the panel shows, clamped: silence is 0 and full scale is 100. */
export function audioPercent(dbfs: number): number {
  const scaled = ((dbfs - AUDIO_FLOOR_DBFS) / -AUDIO_FLOOR_DBFS) * 100
  return Math.round(Math.min(100, Math.max(0, scaled)))
}

/** "TX3" is the third transmitter, which the receiver numbers 2. Anything else names none. */
function transmitterOf(mates: unknown): number | undefined {
  if (!Array.isArray(mates)) return undefined
  const match = /^TX([1-9]\d*)$/.exec(String(mates[0]))
  return match ? Number(match[1]) - 1 : undefined
}

/**
 * One receiver's linked channels, as the contract's channels.
 *
 * A channel with no transmitter behind it is left out rather than reported at -107 dBm:
 * the service treats an absent channel as quiet, and a pack patched to it is exactly the
 * thing worth an alarm. Every field is present only when the receiver gave it — a pack on
 * AA cells has a gauge and no minutes, and that is a missing reading, not a zero.
 */
export function channelsFrom(serial: string, resources: Resources): TelemetryChannel[] {
  const channels: TelemetryChannel[] = []
  for (const path of resources.keys()) {
    const match = /^\/api\/channel\/(\d+)$/.exec(path)
    if (!match) continue
    const index = Number(match[1])
    const info = record(resources.get(path))
    if (!info) continue

    const transmitter = transmitterOf(info.mates)
    const warnings = resources.get(`${path}/warnings`)
    // The receiver says it twice: a mate on the channel, and a NoLink warning. Either
    // one is enough to say nobody is on it.
    if (transmitter === undefined || (Array.isArray(warnings) && warnings.includes('NoLink'))) continue

    const channel: TelemetryChannel = { id: ewDxChannelId(serial, index) }
    if (typeof info.name === 'string') channel.name = info.name

    const rf = measurement(resources.get(`${path}/signalStrengthIndicator`))
    if (rf !== undefined) channel.rfDbm = rf
    const level = measurement(resources.get(`${path}/level`))
    if (level !== undefined) channel.audioLevel = audioPercent(level)

    const tx = record(resources.get(transmitterPath(transmitter)))
    // Either end muting silences the pack, and the panel has one muted flag to say so.
    if (typeof info.mute === 'boolean') channel.muted = info.mute || tx?.mute === true

    const battery = record(resources.get(`${transmitterPath(transmitter)}/battery`))
    const gauge = finite(battery?.gauge)
    if (gauge !== undefined) channel.batteryPercent = gauge
    const lifetime = finite(battery?.lifetime)
    if (lifetime !== undefined) channel.batteryMinutes = lifetime

    const frequency = finite(record(resources.get(`/api/rf/channels/${index}`))?.frequency)
    // The receiver reports kilohertz; the contract is megahertz.
    if (frequency !== undefined) channel.frequencyMhz = frequency / 1000

    channels.push(channel)
  }
  return channels.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
}
