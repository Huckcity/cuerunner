import { readFileSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { replaceFile } from '../replaceFile'
import { basename, dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

// What a pack's battery did in the sessions before this one, kept on this machine.
//
// The question it answers is the one asked at the half: this pack starts at 61% — is that enough?
// It cannot be answered from the pack's reading alone, and it cannot be answered by extrapolating
// one session's gauge, which on AA cells is noisy and flat and then falls. It can be answered by
// what the same pack used the last time it did a show.
//
// A session is a stretch of continuous reporting. A pack that goes quiet for a while was switched
// off, and a jump up means fresh cells: either way what came before is a finished session and
// what follows is a new one. It belongs to the machine and not to the showfile, because it is a
// fact about a pack in a case rather than about a show, and a show is copied between machines.

export interface Session {
  /** The first reading of the session, and the lowest it reached: what it used is the gap. */
  start: number
  floor: number
  startedAt: number
  endedAt: number
}

export interface BatteryLogOptions {
  filePath: string
  now?: () => number
  /** Silence this long ends a session: the pack was switched off. */
  gapMs?: number
  /** A reading this far above the floor is new cells, and ends a session. */
  riseMargin?: number
  /** Test seam for a file that is not there. */
  readFile?: (path: string) => string
}

/** A pack that was quiet this long was off, not between lines. */
const GAP_MS = 20 * 60_000
/** Gauge noise on AA cells is a few points; ten is somebody opening the pack. */
const RISE_MARGIN = 10
/** A session this short is a bench check, not a show, and says nothing about one. */
const MIN_SESSION_MS = 20 * 60_000
/** A session that used less than this is inside the gauge's own noise. */
const MIN_USED = 3
/** How many finished sessions a pack keeps, and how many packs are kept: the file stays small. */
const MAX_SESSIONS = 10
const MAX_PACKS = 64
/** The most recent finished sessions a prediction reads: the worst of them, not the best. */
const RECENT = 3
const WRITE_EVERY_MS = 10_000

interface Stored {
  version: 1
  packs: Record<string, { finished: Session[]; current?: Session }>
}

function isSession(value: unknown): value is Session {
  if (typeof value !== 'object' || value === null) return false
  const s = value as Record<string, unknown>
  return ['start', 'floor', 'startedAt', 'endedAt'].every(key => typeof s[key] === 'number' && Number.isFinite(s[key] as number))
}

export class BatteryLog {
  private readonly packs = new Map<string, { finished: Session[]; current?: Session }>()
  private dirty = false
  private timer: ReturnType<typeof setTimeout> | null = null
  private writing: Promise<void> = Promise.resolve()
  private readonly options: Required<Omit<BatteryLogOptions, 'readFile'>>

  constructor(options: BatteryLogOptions) {
    this.options = {
      filePath: options.filePath,
      now: options.now ?? Date.now,
      gapMs: options.gapMs ?? GAP_MS,
      riseMargin: options.riseMargin ?? RISE_MARGIN
    }
    try {
      const parsed: unknown = JSON.parse((options.readFile ?? ((path: string) => readFileSync(path, 'utf8')))(options.filePath))
      const packs = (parsed as { packs?: unknown } | null)?.packs
      if (typeof packs === 'object' && packs !== null) {
        for (const [id, entry] of Object.entries(packs).slice(0, MAX_PACKS)) {
          const { finished, current } = (entry ?? {}) as { finished?: unknown; current?: unknown }
          this.packs.set(id, {
            finished: Array.isArray(finished) ? finished.filter(isSession).slice(-MAX_SESSIONS) : [],
            ...(isSession(current) ? { current } : {})
          })
        }
      }
    } catch {
      // Missing, unreadable or corrupt: a pack's past is a convenience, and a show must still open.
    }
  }

  /** One reading of a pack's battery. Called as often as the pack is polled; it writes only when something moved. */
  observe(channelId: string, percent: number): void {
    const at = this.options.now()
    let pack = this.packs.get(channelId)
    if (!pack) {
      // Bounded: a rack that renames its channels must not grow the file for ever.
      if (this.packs.size >= MAX_PACKS) this.packs.delete(this.packs.keys().next().value as string)
      pack = { finished: [] }
      this.packs.set(channelId, pack)
    }
    const run = pack.current
    const ended = run !== undefined && (at - run.endedAt >= this.options.gapMs || percent >= run.floor + this.options.riseMargin)
    if (run !== undefined && ended) {
      pack.finished = [...pack.finished, run].slice(-MAX_SESSIONS)
      pack.current = undefined
    }
    if (pack.current === undefined) {
      pack.current = { start: percent, floor: percent, startedAt: at, endedAt: at }
      this.markDirty()
      return
    }
    const before = pack.current.floor
    pack.current.floor = Math.min(pack.current.floor, percent)
    pack.current.endedAt = at
    // Written when the floor moves, and otherwise left to the next write: a pack that sits at 80%
    // for an hour has nothing new to say.
    if (pack.current.floor !== before) this.markDirty()
  }

  /**
   * The most a pack used in a recent finished session — the worst, because the question is
   * whether it will last — or nothing when it has no past that says anything: no session long
   * enough to be a show, or none that used more than the gauge's own noise.
   */
  lastUsed(channelId: string): number | undefined {
    const finished = this.packs.get(channelId)?.finished ?? []
    const used = finished
      .filter(session => session.endedAt - session.startedAt >= MIN_SESSION_MS)
      .slice(-RECENT)
      .map(session => session.start - session.floor)
      .filter(amount => amount >= MIN_USED)
    return used.length === 0 ? undefined : Math.max(...used)
  }

  /** Writes what has changed now: on a service stopping, so a quit does not lose the last ten seconds. */
  flush(): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    return this.write()
  }

  private markDirty(): void {
    this.dirty = true
    if (this.timer !== null) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.write()
    }, WRITE_EVERY_MS)
    this.timer.unref?.()
  }

  private write(): Promise<void> {
    if (!this.dirty) return this.writing
    this.dirty = false
    const file: Stored = { version: 1, packs: Object.fromEntries(this.packs) }
    const text = JSON.stringify(file)
    const next = this.writing.then(async () => {
      const temp = join(dirname(this.options.filePath), `.${basename(this.options.filePath)}.${randomUUID()}.tmp`)
      await writeFile(temp, text, 'utf-8')
      try {
        await replaceFile(temp, this.options.filePath)
      } catch (error) {
        await rm(temp, { force: true })
        throw error
      }
    })
    // A write that fails is not a show's problem: the next change tries again.
    this.writing = next.catch(() => {
      this.dirty = true
    })
    return this.writing
  }
}
