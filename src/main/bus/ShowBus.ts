import type { AlertLevel, DeviceState, ShowAlert, ShowEvent } from '../../shared/show'

export interface ShowBusOptions {
  /** Coalescing window: everything published inside one window leaves as one batch. */
  flushMs?: number
  /** Recent events kept so a renderer that just reloaded can fill its monitor. */
  historyLimit?: number
  /** Shortest gap between two device events for the same device. */
  deviceIntervalMs?: number
  now?: () => number
}

// 20 batches per second is well past what an operator can read, and it keeps a
// 50-device poller from turning into 50 IPC messages per poll.
const DEFAULT_FLUSH_MS = 50
const DEFAULT_HISTORY_LIMIT = 500
// RSSI drifts by a decibel every poll. At 2 Hz the bar still looks live, and the
// battery and mute readings that matter arrive at the same rate.
const DEFAULT_DEVICE_INTERVAL_MS = 500
const ALERT_LIMIT = 200

interface Deferred {
  event: ShowEvent
  /** Earliest the device may be reported again, unless its online state changed. */
  readyAt: number
}

/**
 * The single channel every show service reports through.
 *
 * Services publish as often as it suits them — a poller can hand over a fresh device
 * state on every pass — and the bus decides what the renderer actually sees: device
 * readings are deduplicated and rate-limited, everything else is batched by time.
 * Events also accumulate in a bounded history, so a renderer that reloads mid-show
 * comes back to the alarms that were already up rather than an empty panel.
 */
export class ShowBus {
  private queue: ShowEvent[] = []
  private deferred = new Map<string, Deferred>()
  private lastEmitted = new Map<string, number>()
  private devices = new Map<string, DeviceState>()
  private history: ShowEvent[] = []
  private alerts: ShowAlert[] = []
  private listeners = new Set<(events: ShowEvent[]) => void>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private alertSeq = 0

  constructor(private readonly options: ShowBusOptions = {}) {}

  /** Registers a batch listener; the returned function unregisters it. */
  subscribe(listener: (events: ShowEvent[]) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  publish(event: ShowEvent): void {
    if (event.kind === 'device') {
      this.publishDevice(event)
      return
    }
    if (event.kind === 'alert') {
      this.alerts = [...this.alerts, event.alert].slice(-ALERT_LIMIT)
    }
    this.record(event)
    this.queue.push(event)
    this.schedule()
  }

  /** Convenience: the device's current state is the registry, the event is the news. */
  device(state: DeviceState): void {
    this.publish({ kind: 'device', at: state.lastSeen, device: state })
  }

  alert(level: AlertLevel, source: string, message: string, deviceId?: string): ShowAlert {
    const alert: ShowAlert = {
      id: ++this.alertSeq,
      at: this.now(),
      level,
      source,
      message,
      ...(deviceId === undefined ? {} : { deviceId })
    }
    this.publish({ kind: 'alert', at: alert.at, alert })
    return alert
  }

  /** The current world: what is on stage, what is wrong, and what just happened. */
  snapshot(): { events: ShowEvent[]; devices: DeviceState[]; alerts: ShowAlert[] } {
    return {
      events: [...this.history],
      devices: [...this.devices.values()],
      alerts: [...this.alerts]
    }
  }

  close(): void {
    clearTimeout(this.timer ?? undefined)
    this.timer = null
    this.queue = []
    this.deferred.clear()
    this.listeners.clear()
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }

  private publishDevice(event: Extract<ShowEvent, { kind: 'device' }>): void {
    const previous = this.devices.get(event.device.id)
    this.devices.set(event.device.id, event.device)

    // `lastSeen` moves on every poll, so it cannot take part in the comparison: a
    // device that reports the same numbers twice has nothing new to say.
    if (previous && sameReading(previous, event.device)) return

    const now = this.now()
    const interval = this.options.deviceIntervalMs ?? DEFAULT_DEVICE_INTERVAL_MS
    const last = this.lastEmitted.get(event.device.id)
    // Coming back from offline, and dropping off it, are the two readings an operator
    // has to see immediately — everything else can wait for the interval.
    const urgent = previous !== undefined && previous.online !== event.device.online
    if (last !== undefined && !urgent && now - last < interval) {
      this.deferred.set(event.device.id, { event, readyAt: last + interval })
      this.schedule()
      return
    }

    this.lastEmitted.set(event.device.id, now)
    this.record(event)
    this.queue.push(event)
    this.schedule()
  }

  private record(event: ShowEvent): void {
    const limit = this.options.historyLimit ?? DEFAULT_HISTORY_LIMIT
    this.history.push(event)
    if (this.history.length > limit) this.history.splice(0, this.history.length - limit)
  }

  private schedule(): void {
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, this.options.flushMs ?? DEFAULT_FLUSH_MS)
    // Nothing should hold the process open for a batch of meter readings.
    this.timer.unref?.()
  }

  private flush(): void {
    const now = this.now()
    for (const [id, entry] of [...this.deferred]) {
      if (entry.readyAt > now) continue
      this.deferred.delete(id)
      this.lastEmitted.set(id, now)
      this.record(entry.event)
      this.queue.push(entry.event)
    }

    if (this.queue.length > 0) {
      const batch = this.queue
      this.queue = []
      for (const listener of this.listeners) {
        try {
          listener(batch)
        } catch {
          // A sink that throws (a window dying mid-send) must not take the bus, or
          // the services publishing through it, down with it.
        }
      }
    }

    // A device sitting inside its interval still has a batch to deliver.
    if (this.deferred.size > 0) this.schedule()
  }
}

function sameReading(a: DeviceState, b: DeviceState): boolean {
  return (
    a.online === b.online &&
    a.name === b.name &&
    a.model === b.model &&
    a.frequency === b.frequency &&
    sameBattery(a, b) &&
    sameRf(a, b) &&
    sameAudio(a, b) &&
    sameWarnings(a, b) &&
    sameDetail(a, b)
  )
}

function sameBattery(a: DeviceState, b: DeviceState): boolean {
  if (!a.battery || !b.battery) return !a.battery === !b.battery
  return (
    a.battery.percent === b.battery.percent &&
    a.battery.minutes === b.battery.minutes &&
    a.battery.charging === b.battery.charging
  )
}

function sameRf(a: DeviceState, b: DeviceState): boolean {
  if (!a.rf || !b.rf) return !a.rf === !b.rf
  return a.rf.level === b.rf.level && a.rf.unit === b.rf.unit && a.rf.weak === b.rf.weak
}

function sameAudio(a: DeviceState, b: DeviceState): boolean {
  if (!a.audio || !b.audio) return !a.audio === !b.audio
  return a.audio.level === b.audio.level && a.audio.muted === b.audio.muted
}

function sameWarnings(a: DeviceState, b: DeviceState): boolean {
  const mine = a.warnings ?? []
  const theirs = b.warnings ?? []
  return mine.length === theirs.length && mine.every((warning, i) => warning.text === theirs[i].text && !!warning.critical === !!theirs[i].critical)
}

function sameDetail(a: DeviceState, b: DeviceState): boolean {
  if (!a.detail || !b.detail) return !a.detail === !b.detail
  const keys = Object.keys(a.detail)
  if (keys.length !== Object.keys(b.detail).length) return false
  return keys.every(key => a.detail?.[key] === b.detail?.[key])
}
