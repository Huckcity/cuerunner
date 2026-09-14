import { readFile } from 'fs/promises'
import { defaultRfThresholds } from '../../renderer/src/types/show'
import type {
  DeviceHistory,
  DeviceState,
  RfPlot,
  RfThresholds,
  ShowSettings,
  TelemetryChannel,
  TelemetryDocument,
  TelemetrySource
} from '../../renderer/src/types/show'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import { batteryBand, demoRack, isWorse, parseTelemetry, rfBand } from './telemetry'
import type { Band } from './telemetry'

// A response reduced to what a telemetry source actually has to provide. fetch's real
// Response satisfies it, and a test's stand-in needs no headers, URL or body stream.
interface TelemetryResponse {
  readonly ok: boolean
  readonly status: number
  json(): Promise<unknown>
}

/**
 * The two things a poller does to the outside world. Both are injected so that a test —
 * and a machine with no receiver on the network — never waits on a socket or a file.
 */
export interface TelemetryPorts {
  fetchJson(url: string, signal: AbortSignal): Promise<TelemetryResponse>
  readText(path: string): Promise<string>
}

function defaultPorts(): TelemetryPorts {
  return {
    fetchJson: (url, signal) => fetch(url, { signal }),
    // A bridge is free to rewrite the file between two reads; utf-8 is the only encoding
    // every JSON writer in the wild agrees on.
    readText: path => readFile(path, 'utf-8')
  }
}

/** A source that answered with something other than the document contract. */
const MALFORMED = 'malformed telemetry document'

/** The longest gap between two looks for a channel that has gone quiet. */
const SWEEP_MS = 1000

/** One of the service's repeat timers, as the runtime hands it back. */
type Timer = ReturnType<typeof setInterval>

/** What the service believes about one channel, keyed by the channel id it reports. */
interface ChannelState {
  name: string
  lastSeen: number
  battery: Band
  rf: Band
  offline: boolean
}

/**
 * What a channel did over the whole night rather than in its last poll: the floor its
 * battery reached, when it got there, and how often the channel went quiet. A settings
 * change restarts the service and the show report is read the morning after, so these
 * outlive stop() — only a new service instance, which is what an app restart makes,
 * starts a channel over.
 */
interface ChannelHistory {
  /** The lowest reading the pack has shown, and when it arrived. Absent until it reports one. */
  floor?: { percent: number; at: number }
  dropouts: number
}

/**
 * Watches the show's transmitters.
 *
 * A wireless rack is polled rather than listened to, and every source stands on its own:
 * one unreachable receiver must not silence the rest, and a pack that stops answering
 * has to be noticed even though silence is the only evidence it leaves. Alarms are
 * raised against the mic plot, so the news is "Aldonza's pack is dying" rather than
 * "channel 12 is at 6%".
 */
export class WirelessService implements ShowService {
  readonly id = 'rf'
  readonly label = 'Wireless'

  private context: ServiceContext | null = null
  private sources: TelemetrySource[] = []
  private plot: RfPlot = { performers: [], packs: [] }
  private thresholds: RfThresholds = defaultRfThresholds()
  private timers: Timer[] = []
  private inFlight = new Set<AbortController>()
  private channels = new Map<string, ChannelState>()
  /** The night's facts per channel, keyed the same way and kept across a restart. */
  private history = new Map<string, ChannelHistory>()
  /** Source ids whose last poll failed, mapped to the reason they gave. */
  private failed = new Map<string, string>()

  constructor(private readonly ports: TelemetryPorts = defaultPorts()) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    this.stop()
    const { plot, sources, thresholds } = settings.rf
    this.context = context
    this.sources = sources
    this.plot = plot
    this.thresholds = thresholds

    if (sources.length === 0) {
      context.setState('stopped', 'no telemetry sources')
      return
    }

    // The plot is what the show expects rather than what the rack has managed to say: a
    // pack patched to a channel that never answers is the case most worth an alarm, so
    // the offline clock starts now. A pack with no channel is unpatched, not offline,
    // and is left out of it entirely.
    const now = Date.now()
    for (const pack of plot.packs) {
      if (!pack.channelId || this.channels.has(pack.channelId)) continue
      this.channels.set(pack.channelId, {
        name: pack.label,
        lastSeen: now,
        battery: 'ok',
        rf: 'ok',
        offline: false
      })
    }

    context.setState('running', this.detail())
    for (const source of sources) {
      void this.poll(source, context)
      const timer = setInterval(() => void this.poll(source, context), source.pollMs)
      // A poll of a rack must not be what keeps the app alive on quit.
      timer.unref?.()
      this.timers.push(timer)
    }

    // The sweep is only how often a long window is checked; half the window keeps the
    // alarm within a second of the moment it became due.
    const sweep = setInterval(
      () => this.age(context),
      Math.max(SWEEP_MS / 10, Math.min(SWEEP_MS, (thresholds.offlineAfterSeconds * 1000) / 2))
    )
    sweep.unref?.()
    this.timers.push(sweep)
  }

  stop(): void {
    for (const timer of this.timers) clearInterval(timer)
    this.timers = []
    // A request the old settings asked for has no one left to answer to.
    for (const controller of this.inFlight) controller.abort(new Error('stopped'))
    this.inFlight.clear()
    this.context = null
    this.sources = []
    this.channels.clear()
    // The history is deliberately left alone: stop() is what a settings change does to
    // every service, and the floor and the dropout count are the show's record rather
    // than the stopped service's.
    this.failed.clear()
  }

  /**
   * Poll every source now rather than waiting out its interval, and answer with what the
   * pass published — the operator asking again wants a reading, not a promise.
   */
  command(action: string): unknown {
    if (action !== 'repoll') throw new Error(`Unknown action "${action}"`)
    const context = this.context
    if (!context) return { channels: 0 }
    return Promise.all(this.sources.map(source => this.poll(source, context))).then(counts => ({
      channels: counts.reduce((total, count) => total + count, 0)
    }))
  }

  private async poll(source: TelemetrySource, context: ServiceContext): Promise<number> {
    try {
      // The demo rack is generated here, so it needs nothing awaited: its reading lands
      // on the bus before start() returns, and a panel that opens with the app shows
      // packs rather than an empty rack.
      const document = source.kind === 'demo' ? demoRack(Date.now()) : await this.read(source)
      // A poll that lands after stop() or a reconfigure has nobody left to tell.
      if (this.context !== context) return 0

      this.recover(source.id, context)
      for (const channel of document.channels) this.report(channel, context)
      return document.channels.length
    } catch (error) {
      if (this.context !== context) return 0
      const reason = error instanceof Error ? error.message : String(error)
      const wasFailing = this.failed.has(source.id)
      this.failed.set(source.id, reason)
      // One alarm per outage: a receiver that is down is not news every poll, and the
      // operator can read the current state off the panel.
      if (!wasFailing) {
        context.bus.alert('warning', this.id, `${source.label}: ${reason}`)
        this.refresh(context)
      }
      return 0
    }
  }

  private async read(source: TelemetrySource): Promise<TelemetryDocument> {
    if (source.kind === 'file') {
      const text = await this.ports.readText(source.target)
      let value: unknown = null
      try {
        value = JSON.parse(text)
      } catch {
        // A bridge caught mid-write is a source failure like any other.
      }
      return documentFrom(value)
    }

    const controller = new AbortController()
    this.inFlight.add(controller)
    // The timeout is ours rather than AbortSignal.timeout's so that it and stop() share
    // one signal: a request to a receiver that has left the network cannot outlive the
    // settings that asked for it.
    const timer = setTimeout(() => controller.abort(new Error('timed out')), source.timeoutMs)
    try {
      const response = await this.ports.fetchJson(source.target, controller.signal)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return documentFrom(await response.json().catch(() => null))
    } finally {
      clearTimeout(timer)
      this.inFlight.delete(controller)
    }
  }

  /** One channel's reading: a device on the bus, and any alarm its bands have crossed. */
  private report(channel: TelemetryChannel, context: ServiceContext): void {
    const now = Date.now()
    let state = this.channels.get(channel.id)
    if (!state) {
      state = {
        name: channel.name ?? channel.id,
        lastSeen: now,
        battery: 'ok',
        rf: 'ok',
        offline: false
      }
      this.channels.set(channel.id, state)
    }
    if (channel.name !== undefined) state.name = channel.name
    state.lastSeen = now
    state.offline = false

    const percent = channel.batteryPercent
    const history = this.historyOf(channel.id)
    const device: DeviceState = {
      id: `rf:${channel.id}`,
      service: this.id,
      name: channel.name ?? state.name,
      online: true,
      lastSeen: now
    }
    // Each group is present only when the channel reported it: a wired pack has no RF
    // line, and a receiver with telemetry off has no battery rather than a zero.
    if (percent !== undefined) {
      // The floor belongs to the pack rather than the poll: a reading above it leaves it
      // where it was, and it keeps the time the lowest reading arrived, not the time of
      // the poll that followed. A recovered battery does not un-drain.
      const floor = history.floor
      if (floor === undefined || percent < floor.percent) history.floor = { percent, at: now }
      device.battery = {
        percent,
        ...(channel.batteryMinutes === undefined ? {} : { minutes: channel.batteryMinutes }),
        ...(channel.charging === undefined ? {} : { charging: channel.charging })
      }
    }
    // The night goes on every reading, including the one a pack sends after a silence.
    const night = this.nightOf(channel.id)
    if (night) device.history = night
    if (channel.rfDbm !== undefined) device.rf = { level: channel.rfDbm, unit: 'dBm' }
    if (channel.audioLevel !== undefined) {
      device.audio = {
        level: channel.audioLevel,
        ...(channel.muted === undefined ? {} : { muted: channel.muted })
      }
    }
    if (channel.frequencyMhz !== undefined) device.frequency = channel.frequencyMhz

    context.bus.device(device)
    const who = this.plotName(channel.id, channel.name ?? state.name)

    // A band is only worth an alarm on the way in: a pack that sits at 8% for an hour
    // says so once, and re-arms when it comes back up.
    if (percent !== undefined) {
      const band = batteryBand(percent, this.thresholds)
      if (isWorse(band, state.battery)) {
        const left = `${Math.round(percent)}% left`
        context.bus.alert(
          band === 'critical' ? 'critical' : 'warning',
          this.id,
          band === 'critical' ? `${who} battery critical — ${left}` : `${who} battery low — ${left}`,
          device.id
        )
      }
      state.battery = band
    }
    if (channel.rfDbm !== undefined) {
      const band = rfBand(channel.rfDbm, this.thresholds)
      if (isWorse(band, state.rf)) {
        context.bus.alert(
          'warning',
          this.id,
          `${who} RF low — ${Math.round(channel.rfDbm)} dBm`,
          device.id
        )
      }
      state.rf = band
    }
  }

  /**
   * The silence rule: a channel the rack has stopped naming — or never named — is
   * offline, once, until it reports again.
   */
  private age(context: ServiceContext): void {
    if (this.context !== context) return
    const now = Date.now()
    const after = this.thresholds.offlineAfterSeconds * 1000
    for (const [id, state] of this.channels) {
      if (state.offline || now - state.lastSeen < after) continue
      state.offline = true
      // The count moves at the same moment the alarm does: a dropout is the offline
      // transition, not the number of polls that noticed the silence after it.
      const history = this.historyOf(id)
      history.dropouts += 1
      const deviceId = `rf:${id}`
      const device: DeviceState = {
        id: deviceId,
        service: this.id,
        name: state.name,
        online: false,
        lastSeen: state.lastSeen
      }
      // The whole point of the history group: the pack is quiet, so there is no reading
      // to publish, but the night it had is still the thing the morning asks about.
      const night = this.nightOf(id)
      if (night) device.history = night
      context.bus.device(device)
      // A warning, not a critical: a pack is switched off between scenes all night long,
      // and what an operator needs is to notice the silence, not to be told the show has
      // failed. The row's own colour says the same thing on the panel.
      context.bus.alert('warning', this.id, `${this.plotName(id, state.name)} went quiet`, deviceId)
    }
  }

  /** The night's record for a channel, begun the first time it is heard from or ages out. */
  private historyOf(channelId: string): ChannelHistory {
    let history = this.history.get(channelId)
    if (!history) {
      history = { dropouts: 0 }
      this.history.set(channelId, history)
    }
    return history
  }

  /**
   * The night as a device carries it, or nothing when there is nothing to carry. A floor
   * on its own is a night; so is a dropout on a pack nobody ever got a reading from, and
   * that one has to be published without a floor rather than dressed up with one — the
   * report would otherwise call a pack that went quiet uneventful.
   */
  private nightOf(channelId: string): DeviceHistory | undefined {
    const history = this.history.get(channelId)
    if (!history) return undefined
    const { floor } = history
    if (floor === undefined && history.dropouts === 0) return undefined
    return {
      ...(floor === undefined ? {} : { lowestPercent: floor.percent, lowestAt: floor.at }),
      dropouts: history.dropouts
    }
  }

  /**
   * What the plot calls a channel: the pack's label, then the rack's own name for it,
   * then the raw id. The performer is what makes the alarm actionable — "Pack 12" is a
   * number, "Aldonza" is a person about to walk on.
   */
  private plotName(channelId: string, rackName: string | undefined): string {
    const pack = this.plot.packs.find(candidate => candidate.channelId === channelId)
    const name = pack?.label || rackName || channelId
    const performer = pack?.performerId
      ? this.plot.performers.find(candidate => candidate.id === pack.performerId)
      : undefined
    return performer ? `${name} (${performer.name})` : name
  }

  private detail(): string {
    return `polling ${this.sources.map(source => source.label).join(', ')}`
  }

  /** A source that answered again has nothing more to report about its outage. */
  private recover(sourceId: string, context: ServiceContext): void {
    if (!this.failed.delete(sourceId)) return
    this.refresh(context)
  }

  /** The service has one state, so it reports the worst thing any source is doing. */
  private refresh(context: ServiceContext): void {
    const down = this.sources.find(source => this.failed.has(source.id))
    if (down) {
      context.setState('degraded', `${down.label}: ${this.failed.get(down.id)}`)
      return
    }
    context.setState('running', this.detail())
  }
}

/** The document contract, or a source failure; nothing else may reach a channel. */
function documentFrom(value: unknown): TelemetryDocument {
  const document = parseTelemetry(value)
  if (!document) throw new Error(MALFORMED)
  return document
}
