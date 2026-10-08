// The show's OSC feedback, as main keeps it: the last snapshot the window published, the
// remotes that asked to be told, and the pushes — rate-limited — that tell them.
//
// What is said, and in which words, is `shared/oscFeedback.ts`. This is the timing and the
// bookkeeping: a change is pushed at most once per `MIN_PUSH_MS` however fast the window
// publishes, a running cue's progress at the show's rate and no faster than
// `MAX_FEEDBACK_RATE_HZ`, and the remotes that subscribed are bounded — past the cap the one
// that asked longest ago is dropped, so a remote that reconnects all night cannot grow a list.
// Everything is sent from the input socket, so a reply comes from the port the remote talked
// to — which is where a QLab remote listens for it.

import {
  cueListMessages,
  feedbackChanges,
  MAX_FEEDBACK_RATE_HZ,
  parseFeedbackRequest,
  playheadMessages,
  progressMessages,
  qlabCueUpdate,
  qlabPlayheadUpdate,
  qlabReply,
  runningMessages,
  type FeedbackMessage,
  type OscFeedbackSettings,
  type OscFeedbackSnapshot
} from '../../shared/oscFeedback'
import type { OscArg } from '../../shared/cue'
import { encodeMessage } from './codec'

/** The fastest a change is pushed, ms: a burst of publishes is one push. */
export const MIN_PUSH_MS = 50
/** How many remotes may subscribe to each namespace at once. */
export const MAX_SUBSCRIBERS = 16

export interface FeedbackPorts {
  send(host: string, port: number, packet: Buffer): void
  now(): number
  setTimer(callback: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /** What `/version` answers, read when it is asked. */
  appVersion: () => string
}

interface Destination {
  host: string
  port: number
}

const key = (destination: Destination): string => `${destination.host}:${destination.port}`

export class OscFeedback {
  private snapshot: OscFeedbackSnapshot | null = null
  /** When the snapshot was published, on `ports.now()`, so progress can be carried on from it. */
  private publishedAt = 0
  private settings: OscFeedbackSettings | null = null
  private subscribers = new Map<string, Destination>()
  private qlabSubscribers = new Map<string, Destination>()
  private owed = { playhead: false, running: false, cues: false, cueIds: new Set<string>() }
  private lastPush = Number.NEGATIVE_INFINITY
  private pushTimer: unknown = null
  private progressTimer: unknown = null
  /** How many slots the last running and progress pushes filled, for the zeroing pulse. */
  private runningSlots = 0
  private progressSlots = 0

  constructor(private readonly ports: FeedbackPorts) {}

  /** The show's settings for feedback, or null for none: the configured destination and rate. */
  configure(settings: OscFeedbackSettings | null): void {
    this.settings = settings
    this.armProgress()
  }

  /** The window's latest snapshot. What changed is owed to every destination. */
  publish(snapshot: OscFeedbackSnapshot): void {
    const changes = feedbackChanges(this.snapshot, snapshot)
    this.snapshot = snapshot
    this.publishedAt = this.ports.now()
    this.owed.playhead ||= changes.playhead
    this.owed.running ||= changes.running
    this.owed.cues ||= changes.cues
    for (const id of changes.changedCueIds) this.owed.cueIds.add(id)
    if (changes.playhead || changes.running || changes.cues || changes.changedCueIds.length > 0) this.schedulePush()
    this.armProgress()
  }

  /**
   * A message from a remote, answered if it is the feedback's: a QLab query, a subscribe or
   * an unsubscribe, a request for the whole state. Answers whether it was — a message that was
   * is not the show's to fire anything with.
   */
  handle(address: string, args: readonly OscArg[], from: Destination): boolean {
    const request = parseFeedbackRequest(address, args)
    if (request !== null) {
      switch (request.kind) {
        case 'request':
          this.sendAll([from, ...this.destinations()], this.wholeState())
          return true
        case 'cues':
          if (this.snapshot !== null) this.sendAll([from], cueListMessages(this.snapshot))
          return true
        case 'subscribe': {
          const destination = { host: from.host, port: request.port ?? from.port }
          this.remember(this.subscribers, destination)
          // A remote that has just subscribed is told where the show stands now.
          this.sendAll([destination], this.wholeState())
          return true
        }
        case 'unsubscribe':
          for (const [id, destination] of this.subscribers) if (destination.host === from.host) this.subscribers.delete(id)
          return true
        case 'qlab-updates':
          if (request.on) this.remember(this.qlabSubscribers, from)
          else this.qlabSubscribers.delete(key(from))
          return true
      }
    }
    const reply = qlabReply(address, args, this.snapshot, this.ports.appVersion())
    if (reply === null) return false
    this.ports.send(from.host, from.port, encodeMessage(reply.address, [{ type: 's', value: JSON.stringify(reply.body) }]))
    return true
  }

  /** Stops every timer and forgets the remotes: the socket they were reached by is gone. */
  close(): void {
    if (this.pushTimer !== null) this.ports.clearTimer(this.pushTimer)
    if (this.progressTimer !== null) this.ports.clearTimer(this.progressTimer)
    this.pushTimer = null
    this.progressTimer = null
    this.subscribers.clear()
    this.qlabSubscribers.clear()
  }

  /** Who the Cuerunner namespace is pushed to: the show's destination and the subscribers. */
  private destinations(): Destination[] {
    const out = [...this.subscribers.values()]
    const settings = this.settings
    if (settings?.enabled === true && settings.host.trim() !== '' && settings.port >= 1 && settings.port <= 65535) {
      if (!out.some(destination => destination.host === settings.host && destination.port === settings.port)) {
        out.unshift({ host: settings.host.trim(), port: settings.port })
      }
    }
    return out
  }

  private remember(table: Map<string, Destination>, destination: Destination): void {
    table.delete(key(destination))
    table.set(key(destination), destination)
    while (table.size > MAX_SUBSCRIBERS) table.delete(table.keys().next().value as string)
  }

  private wholeState(): FeedbackMessage[] {
    if (this.snapshot === null) return []
    const messages = [
      ...playheadMessages(this.snapshot),
      ...runningMessages(this.snapshot, this.runningSlots),
      ...progressMessages(this.snapshot, this.progressSlots)
    ]
    return messages
  }

  private schedulePush(): void {
    if (this.pushTimer !== null) return
    const wait = Math.max(0, this.lastPush + MIN_PUSH_MS - this.ports.now())
    this.pushTimer = this.ports.setTimer(() => {
      this.pushTimer = null
      this.push()
    }, wait)
  }

  private push(): void {
    const snapshot = this.snapshot
    if (snapshot === null) return
    this.lastPush = this.ports.now()
    const owed = this.owed
    this.owed = { playhead: false, running: false, cues: false, cueIds: new Set() }
    const messages: FeedbackMessage[] = []
    if (owed.playhead) messages.push(...playheadMessages(snapshot))
    if (owed.running) {
      messages.push(...runningMessages(snapshot, this.runningSlots))
      this.runningSlots = Math.min(snapshot.running.length, 8)
    }
    if (owed.cues) messages.push(...cueListMessages(snapshot))
    this.sendAll(this.destinations(), messages)

    // QLab's remotes are told what moved and ask again for what they show.
    const qlab: FeedbackMessage[] = []
    if (owed.playhead) qlab.push(qlabPlayheadUpdate(snapshot))
    for (const id of owed.cueIds) qlab.push(qlabCueUpdate(snapshot.workspaceId, id))
    this.sendAll([...this.qlabSubscribers.values()], qlab)
  }

  /** Progress is pushed while something runs, and once more after, to zero the gauges. */
  private armProgress(): void {
    const rate = Math.min(MAX_FEEDBACK_RATE_HZ, Math.max(0, this.settings?.rateHz ?? 0))
    const wanted = rate > 0 && this.snapshot !== null &&
      (this.snapshot.running.length > 0 || this.progressSlots > 0) &&
      (this.destinations().length > 0)
    if (!wanted) {
      if (this.progressTimer !== null) this.ports.clearTimer(this.progressTimer)
      this.progressTimer = null
      return
    }
    if (this.progressTimer !== null) return
    this.progressTimer = this.ports.setTimer(() => {
      this.progressTimer = null
      this.pulse()
      this.armProgress()
    }, 1000 / rate)
  }

  private pulse(): void {
    const snapshot = this.snapshot
    if (snapshot === null) return
    // The elapsed time is the window's at its last publish, carried on by the time since for a
    // cue that is playing: a remote's gauge moves smoothly between publishes.
    const since = Math.max(0, this.ports.now() - this.publishedAt)
    const now: OscFeedbackSnapshot = {
      ...snapshot,
      running: snapshot.running.map(run => run.state === 'playing' ? { ...run, elapsedMs: run.elapsedMs + since } : run)
    }
    this.sendAll(this.destinations(), progressMessages(now, this.progressSlots))
    this.progressSlots = Math.min(snapshot.running.length, 8)
  }

  private sendAll(destinations: readonly Destination[], messages: readonly FeedbackMessage[]): void {
    if (messages.length === 0) return
    const packets = messages.map(message => encodeMessage(message.address, message.args))
    for (const destination of destinations) {
      for (const packet of packets) this.ports.send(destination.host, destination.port, packet)
    }
  }
}
