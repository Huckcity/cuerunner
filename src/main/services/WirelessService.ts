import { readFile } from 'fs/promises'
import { defaultRfThresholds } from '../../shared/show'
import type {
  DeviceHistory,
  DeviceState,
  Performer,
  RfPlot,
  RfThresholds,
  ShowSettings,
  TelemetryChannel,
  TelemetryDocument,
  TelemetrySource
} from '../../shared/show'
import type { ServiceContext, ShowService } from '../bus/ServiceHost'
import type { EwDxCredentials } from '../ewdx/credentials'
import { EwDxClient } from '../ewdx/EwDxClient'
import type { BatteryLog } from './BatteryLog'
import { EwDxReceiver } from '../ewdx/EwDxReceiver'
import { discoverEwDx } from '../ewdx/discovery'
import type { DiscoverResult } from '../ewdx/discovery'
import { demoRack, isWorse, parseTelemetry, settledBatteryBand, settledRfWeak } from './telemetry'
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
  /**
   * A live session with one EW-DX receiver. Optional because only a show that has such a
   * source needs it; a service built without it reports the source as unavailable.
   */
  ewDx?(source: TelemetrySource): EwDxSession
}

/**
 * A receiver kept live, as the service sees it: started with the service, asked for its
 * channels on every poll, and stopped with it. It is its own thing rather than a fetch
 * because the receiver pushes — the poll reads what the session has already heard.
 */
export interface EwDxSession {
  start(): void
  stop(): void
  snapshot(waitMs: number): Promise<TelemetryChannel[]>
  /** The serial of the receiver behind it, once this machine has reached it: how a command finds the right one. */
  serial?(): string | undefined
  /** Mutes or unmutes a channel's output at the receiver. Optional: a session that cannot be reached cannot. */
  setMute?(channel: number, mute: boolean): Promise<void>
}

/**
 * A source that is not finished: no address yet, no password yet. It is a state of the
 * settings and not a fault of the rack, so it is said where the operator is looking — the
 * status beside the source — and is never raised as an alarm in the show. An alarm is for a
 * receiver that was asked to be watched and is not answering.
 */
export class NotConfiguredError extends Error {}

/** A session that can never connect, which says why on every poll instead of failing silently. */
function unavailable(reason: string, unfinished = false): EwDxSession {
  return {
    start: () => undefined,
    stop: () => undefined,
    snapshot: () => Promise.reject(unfinished ? new NotConfiguredError(reason) : new Error(reason))
  }
}

/**
 * The address an operator typed, as an origin a receiver can be reached at: a bare host is
 * `https://host`. An `http://` address is refused rather than honoured — a receiver's password
 * goes in the request, and a receiver speaks TLS.
 */
export function ewDxOrigin(target: string): { origin: string } | { error: string } {
  const typed = target.trim()
  if (typed === '') return { error: 'no address' }
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`)
    if (url.protocol !== 'https:') return { error: 'EW-DX receivers use https' }
    return { origin: url.origin }
  } catch {
    return { error: 'not a valid address' }
  }
}

/**
 * The service's ports as the app wires them. The credentials are the machine's own — a
 * receiver's password never travels with the showfile — and are read when a source starts.
 */
export function telemetryPorts(
  credentials?: EwDxCredentials,
  /** How a receiver that has left its address is looked for by serial. */
  discover: () => Promise<DiscoverResult> = () => discoverEwDx()
): TelemetryPorts {
  return {
    fetchJson: (url, signal) => fetch(url, { signal }),
    // A bridge is free to rewrite the file between two reads; utf-8 is the only encoding
    // every JSON writer in the wild agrees on.
    readText: path => readFile(path, 'utf-8'),
    ewDx: source => {
      const address = ewDxOrigin(source.target)
      if ('error' in address) return unavailable(address.error, true)
      const stored = credentials?.get(source.id)
      if (!stored) return unavailable('no password set — add it in Settings › Wireless', true)
      const store = credentials!
      return new EwDxReceiver({
        sourceId: source.id,
        target: source.target.trim(),
        origin: address.origin,
        credentials: store,
        discover,
        // Made afresh for each address the receiver is followed to, and read from the store each
        // time: what is trusted about it is the machine's, and it changes as it is learned.
        makeClient: parts => {
          const held = store.get(source.id) ?? stored
          return new EwDxClient({
            origin: parts.origin,
            password: held.password,
            pinnedFingerprint: held.fingerprint,
            // The first certificate a receiver shows is the one trusted from then on.
            // The pin is kept in memory first; a write that fails is retried by the next change.
            onFingerprint: fingerprint => { store.pin(source.id, fingerprint).catch(() => undefined) },
            expectedSerial: parts.expectedSerial,
            onSerial: parts.onSerial
          })
        }
      })
    }
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
  offline: boolean
}

/**
 * How soon a receiver's own weak-signal verdict may be announced again for the same channel. It is
 * a boolean that flips as a pack moves, and there is no margin to give a boolean the way there is
 * to a dB or a percent: a pack that flips back and forth is told once a minute at most. Readings
 * with a number have the margin instead, so a pack that really recovers is told straight away.
 */
const REANNOUNCE_MS = 60_000

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
  /**
   * What the pack has already been announced as, and when. It lives here because a settings change
   * stops the service and starts it again, and a pack that was told to the operator as dying a
   * moment ago is not dying afresh: a restart must not say it a second time.
   */
  battery: Band
  rf: Band
  /** When a receiver's own weak-signal verdict was last announced, for `REANNOUNCE_MS`. */
  rfVerdictAt?: number
  /** The complaints standing against the channel as last read, so only a new one is announced. */
  warnings: Set<string>
  /** When each complaint was last announced, for `REANNOUNCE_MS`: clipping comes and goes. */
  warnedAt: Map<string, number>
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
  readonly pro = true
  /** The rack and its sources, and the cast the plot's alarms are named after. */
  readonly settingsSections = ['rf', 'cast'] as const

  private context: ServiceContext | null = null
  private sources: TelemetrySource[] = []
  private plot: RfPlot = { packs: [] }
  private performers: Performer[] = []
  private thresholds: RfThresholds = defaultRfThresholds()
  private timers: Timer[] = []
  private inFlight = new Set<AbortController>()
  private channels = new Map<string, ChannelState>()
  /** The live receivers this run's EW-DX sources hold open, by source id. */
  private sessions = new Map<string, EwDxSession>()
  /** The night's facts per channel, keyed the same way and kept across a restart. */
  private history = new Map<string, ChannelHistory>()
  /** Source ids whose last poll failed, mapped to the reason they gave. */
  private failed = new Map<string, string>()
  /** Source ids that are not finished, mapped to what they are waiting for: not failures. */
  private waiting = new Map<string, string>()

  constructor(
    private readonly ports: TelemetryPorts = telemetryPorts(),
    /** What each pack used in the shows before this one: the machine's, and optional. */
    private readonly log?: BatteryLog
  ) {}

  start(context: ServiceContext, settings: ShowSettings): void {
    this.stop()
    const { plot, sources, thresholds } = settings.rf
    this.context = context
    this.sources = sources
    this.plot = plot
    this.performers = settings.cast.performers
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
        offline: false
      })
    }

    context.setState('running', this.detail())
    for (const source of sources) {
      // A session is opened before the first poll asks it anything, and lives exactly as
      // long as this run: a settings change stops it with the timers.
      if (source.kind === 'ew-dx') {
        const session = this.ports.ewDx?.(source) ?? unavailable('EW-DX is not available')
        this.sessions.set(source.id, session)
        session.start()
      }
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
    for (const session of this.sessions.values()) session.stop()
    this.sessions.clear()
    // The history is deliberately left alone: stop() is what a settings change does to
    // every service, and the floor and the dropout count are the show's record rather
    // than the stopped service's.
    this.failed.clear()
    this.waiting.clear()
    // A quit stops the services, and the last ten seconds of a pack's battery is worth keeping.
    void this.log?.flush()
  }

  /**
   * Poll every source now rather than waiting out its interval, and answer with what the
   * pass published — the operator asking again wants a reading, not a promise.
   */
  command(action: string, payload?: unknown): unknown {
    if (action === 'mute') return this.mute(payload)
    if (action !== 'repoll') throw new Error(`Unknown action "${action}"`)
    const context = this.context
    if (!context) return { channels: 0 }
    return Promise.all(this.sources.map(source => this.poll(source, context))).then(counts => ({
      channels: counts.reduce((total, count) => total + count, 0)
    }))
  }

  /**
   * Mutes or unmutes one channel, found by the serial its id carries. It is the one thing this
   * service writes, so it is as narrow as it can be: a channel of a receiver this show has set up
   * and this machine has reached, one boolean, and an answer only once the receiver is in the
   * state asked for. Anything else is an error the cue says, never a mic left open in silence.
   */
  private async mute(payload: unknown): Promise<{ channelId: string; mute: boolean }> {
    const { channelId, mute } = (payload ?? {}) as { channelId?: unknown; mute?: unknown }
    if (typeof channelId !== 'string' || typeof mute !== 'boolean') throw new Error('a mute needs a channel and on or off')
    const match = /^ew-dx:([^:]+):(\d+)$/.exec(channelId)
    if (match === null) throw new Error('that channel is not one this can mute: only EW-DX receivers take it')
    const [, serial, index] = match
    const session = [...this.sessions.values()].find(candidate => candidate.serial?.() === serial)
    if (session?.setMute === undefined) {
      throw new Error(`no EW-DX receiver with serial ${serial} is set up here and reachable`)
    }
    await session.setMute(Number(index), mute)
    return { channelId, mute }
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
      if (this.waiting.delete(source.id)) this.refresh(context)
      for (const channel of document.channels) this.report(channel, context)
      return document.channels.length
    } catch (error) {
      if (this.context !== context) return 0
      const reason = error instanceof Error ? error.message : String(error)
      if (error instanceof NotConfiguredError) {
        // Said once, in the status, and no alarm: see NotConfiguredError.
        const changed = this.waiting.get(source.id) !== reason
        this.waiting.set(source.id, reason)
        this.failed.delete(source.id)
        if (changed) this.refresh(context)
        return 0
      }
      this.waiting.delete(source.id)
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
    if (source.kind === 'ew-dx') {
      const session = this.sessions.get(source.id)
      if (!session) throw new Error('EW-DX is not available')
      return { channels: await session.snapshot(source.timeoutMs) }
    }
    // A source just added has no address, and asking for nothing is not a failure of anyone.
    if (source.target.trim() === '') {
      throw new NotConfiguredError(source.kind === 'file' ? 'no file chosen' : 'no address')
    }
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
    // A request to a rack that has left the network must not be what keeps the app
    // alive on quit, any more than the polls that made it.
    timer.unref?.()
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
      this.log?.observe(channel.id, percent)
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
    if (channel.rfDbm !== undefined) {
      device.rf = {
        level: channel.rfDbm,
        unit: 'dBm',
        ...(channel.rfWeak === undefined ? {} : { weak: channel.rfWeak })
      }
    }
    if (channel.audioLevel !== undefined) {
      device.audio = {
        level: channel.audioLevel,
        ...(channel.muted === undefined ? {} : { muted: channel.muted })
      }
    }
    if (channel.frequencyMhz !== undefined) device.frequency = channel.frequencyMhz
    if (channel.warnings !== undefined && channel.warnings.length > 0) device.warnings = channel.warnings

    context.bus.device(device)
    const who = this.plotName(channel.id, channel.name ?? state.name)

    // A band is only worth an alarm on the way in: a pack that sits at 8% for an hour says so
    // once. It re-arms when it has really come back up — with room, see `settledBatteryBand` —
    // and not when a noisy gauge brushes the line, and a restart does not forget what was said.
    if (percent !== undefined) {
      const band = settledBatteryBand(percent, history.battery, this.thresholds)
      if (isWorse(band, history.battery)) {
        const left = `${Math.round(percent)}% left`
        context.bus.alert(
          band === 'critical' ? 'critical' : 'warning',
          this.id,
          band === 'critical' ? `${who} battery critical — ${left}` : `${who} battery low — ${left}`,
          device.id
        )
      }
      history.battery = band
    }
    // What the device itself says is wrong: announced when it appears, not while it stands, and
    // not again within a minute of the last time — a pack that clips comes and goes by the second.
    for (const warning of channel.warnings ?? []) {
      if (history.warnings.has(warning.text)) continue
      if (!this.mayAnnounce(history.warnedAt.get(warning.text), now)) continue
      context.bus.alert(warning.critical ? 'critical' : 'warning', this.id, `${who} ${warning.text}`, device.id)
      history.warnedAt.set(warning.text, now)
    }
    history.warnings = new Set((channel.warnings ?? []).map(warning => warning.text))

    // A receiver that judges its own link has the last word on whether it is weak; the show's
    // dBm line is for sources that only report a number. The verdict rides with the number it
    // is about, so the panel and the alarm always have the same thing to read.
    if (channel.rfDbm !== undefined) {
      const weak = channel.rfWeak ?? settledRfWeak(channel.rfDbm, history.rf === 'warning', this.thresholds)
      const band: Band = weak ? 'warning' : 'ok'
      // Only a verdict is held to the cooldown: a dBm reading has its margin and is told at once.
      const verdict = channel.rfWeak !== undefined
      if (isWorse(band, history.rf) && (!verdict || this.mayAnnounce(history.rfVerdictAt, now))) {
        context.bus.alert('warning', this.id, `${who} RF low — ${Math.round(channel.rfDbm)} dBm`, device.id)
        if (verdict) history.rfVerdictAt = now
      }
      history.rf = band
    }
  }

  /** Whether trouble of one kind may be said again for a channel, or was said a moment ago. */
  private mayAnnounce(lastAt: number | undefined, now: number): boolean {
    return lastAt === undefined || now - lastAt >= REANNOUNCE_MS
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
      history = { dropouts: 0, battery: 'ok', rf: 'ok', warnings: new Set(), warnedAt: new Map() }
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
    const lastUsed = this.log?.lastUsed(channelId)
    if (floor === undefined && history.dropouts === 0 && lastUsed === undefined) return undefined
    return {
      ...(floor === undefined ? {} : { lowestPercent: floor.percent, lowestAt: floor.at }),
      dropouts: history.dropouts,
      ...(lastUsed === undefined ? {} : { lastUsedPercent: lastUsed })
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
      ? this.performers.find(candidate => candidate.id === pack.performerId)
      : undefined
    return performer ? `${name} (${performer.name})` : name
  }

  private detail(): string {
    const polling = this.sources.filter(source => !this.waiting.has(source.id)).map(source => source.label)
    const waiting = this.sources
      .filter(source => this.waiting.has(source.id))
      .map(source => `${source.label}: ${this.waiting.get(source.id)}`)
    return [...(polling.length === 0 ? [] : [`polling ${polling.join(', ')}`]), ...waiting].join('; ')
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
