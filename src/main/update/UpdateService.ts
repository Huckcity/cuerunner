// The rules a show tool updates by, in one object with every outside thing handed in: the
// updater that talks to the feed, the clock, the file the machine's choices are kept in, and
// what the show is doing. `src/main/update/main.ts` wires the real ones; the tests hand it a
// fake updater and a clock of their own, so every rule is exercised without a network.
//
// The rules, each one a branch below:
//
// - nothing is downloaded or installed while the show is not idle — a cue running, paused or
//   waiting in the window, or sound or a MIDI file playing in this process — and a download the
//   show starts under is stopped, not finished;
// - nothing restarts the app but the operator, and the install a quit was going to do anyway is
//   the one thing that happens on its own;
// - checks run at launch and once a day, the operator can turn them off, and a lockout window
//   or Show Mode with a show open stops them altogether;
// - a check that cannot reach the server is silent; a download whose checksum or signature does
//   not match is refused with a sentence, and the bytes are deleted by the updater before the
//   refusal arrives;
// - a copy that cannot replace itself — a .deb, a development build — is told so, and pointed
//   at the download page.

import { readFileSync, statSync } from 'node:fs'
import { writeFileAtomically } from '../workspace/recovery'
import { Refusal } from '../ipc/refusal'
import {
  HELD_FOR_SHOW,
  STOPPED_FOR_SHOW,
  UPDATE_DAILY_MS,
  UPDATE_LAUNCH_DELAY_MS,
  UPDATE_TICK_MS,
  boundedNotes,
  canSelfUpdate,
  classifyUpdateFailure,
  idleShowState,
  lockoutReason,
  normalizeUpdateSettings,
  selfUpdateRefusal,
  type AvailableUpdate,
  type UpdateInstall,
  type UpdatePhase,
  type UpdateSettings,
  type UpdateShowState,
  type UpdateStatus
} from '../../shared/update'
import { compareVersions, parseReleaseNotes, sectionsBetween } from '../../shared/releaseNotes'
import type { WhatsNew } from '../../shared/ipc/update'

/** What a check found: the newer version and what its release says about itself. */
export interface FoundUpdate {
  version: string
  notes: unknown
  releaseDate: string | null
}

/**
 * The updater, as the rules need it. The real one is electron-updater; a test's is a fake that
 * answers as the test says. A failure is thrown as the updater would throw it — an object with a
 * `code` and a `message` — and classified here.
 */
export interface UpdaterPort {
  /** Asks the feed; null when the running version is the newest. */
  check(): Promise<FoundUpdate | null>
  /**
   * Downloads the update the last check found and verifies it. Rejects when the signal aborts,
   * and when the bytes or their signature are not what the release published.
   */
  download(signal: AbortSignal, progress: (fraction: number | null) => void): Promise<void>
  /** Quits and installs, then starts the new version. Only ever the operator's press. */
  installNow(): void
}

export interface UpdateTimers {
  setTimeout(run: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
  setInterval(run: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface UpdateServiceOptions {
  /** The version running now. */
  current: string
  install: UpdateInstall
  /** The updater, made on first use; null where this install has none to make. */
  updater: () => Promise<UpdaterPort | null>
  /** Where this machine's update settings and memory are kept. */
  filePath: string
  /** The CHANGELOG this build ships with, already bounded; '' when there is none. */
  changelog: () => string
  /** Whether this process is playing anything: sound, a MIDI file. */
  engineBusy?: () => boolean
  push(status: UpdateStatus): void
  now?: () => Date
  timers?: UpdateTimers
  log?: (line: string) => void
  launchDelayMs?: number
}

/** The file is a handful of fields: anything larger is not one this machine wrote. */
const MAX_FILE_BYTES = 64 * 1024

/** What the file keeps: the operator's choices, and what the service remembers between runs. */
interface Stored {
  settings: UpdateSettings
  /** The version this machine last ran, for "What's new". */
  lastSeenVersion: string | null
  /** When the last check that reached the server finished, epoch ms. */
  lastCheckedAt: number | null
}

function readStored(filePath: string): Stored {
  let raw: Record<string, unknown> = {}
  try {
    if (statSync(filePath).size <= MAX_FILE_BYTES) {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) raw = parsed as Record<string, unknown>
    }
  } catch {
    // Missing or unreadable: the machine starts with the defaults, which check.
  }
  return {
    settings: normalizeUpdateSettings(raw.settings),
    lastSeenVersion:
      typeof raw.lastSeenVersion === 'string' && compareVersions(raw.lastSeenVersion, raw.lastSeenVersion) === 0
        ? raw.lastSeenVersion
        : null,
    lastCheckedAt:
      typeof raw.lastCheckedAt === 'number' && Number.isFinite(raw.lastCheckedAt) ? raw.lastCheckedAt : null
  }
}

const NODE_TIMERS: UpdateTimers = {
  setTimeout: (run, ms) => {
    const handle = setTimeout(run, ms)
    handle.unref?.()
    return handle
  },
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  setInterval: (run, ms) => {
    const handle = setInterval(run, ms)
    handle.unref?.()
    return handle
  },
  clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>)
}

/** The smallest change in download progress worth telling the window about. */
const PROGRESS_STEP = 0.01

export class UpdateService {
  private stored: Stored
  private show: UpdateShowState = idleShowState()
  private phase: UpdatePhase = 'idle'
  private available: AvailableUpdate | null = null
  private progress: number | null = null
  private message: string | null = null
  private downloadAbort: AbortController | null = null
  private inflight: Promise<void> | null = null
  private whatsNew: WhatsNew | null = null
  private updaterMade: Promise<UpdaterPort | null> | null = null
  private launchTimer: unknown = null
  private tickTimer: unknown = null
  private lastLockout: string | null = null
  private writing: Promise<void> = Promise.resolve()
  /** Set by `dispose()`: nothing is written after it, so a quit leaves no write behind it. */
  private closed = false
  /** Checks and downloads from their first step, before they have anything in `inflight`. */
  private readonly pending = new Set<Promise<unknown>>()
  private readonly now: () => Date
  private readonly timers: UpdateTimers
  private readonly engineBusy: () => boolean
  private readonly log: (line: string) => void

  constructor(private readonly options: UpdateServiceOptions) {
    this.now = options.now ?? (() => new Date())
    this.timers = options.timers ?? NODE_TIMERS
    this.engineBusy = options.engineBusy ?? (() => false)
    this.log = options.log ?? (() => {})
    this.stored = readStored(options.filePath)
    this.whatsNew = this.findWhatsNew()
    this.lastLockout = this.lockout()
  }

  // ─── Reading ──────────────────────────────────────────────────────────────

  status(): UpdateStatus {
    return {
      current: this.options.current,
      install: this.options.install,
      phase: this.phase,
      available: this.available,
      progress: this.progress,
      message: this.message,
      lastCheckedAt: this.stored.lastCheckedAt,
      lockout: this.lockout(),
      settings: this.stored.settings
    }
  }

  /** Why checks are locked out now, or null. */
  lockout(): string | null {
    const now = this.now()
    return lockoutReason(this.stored.settings, now.getHours() * 60 + now.getMinutes(), this.show)
  }

  /** Whether the show is anything but idle: the window's cues, or this process's sound. */
  busy(): boolean {
    return this.show.busy || this.engineBusy()
  }

  // ─── The schedule ─────────────────────────────────────────────────────────

  /** The launch check, after the window has had time to open a show, and the daily one after it. */
  start(): void {
    if (this.launchTimer !== null) return
    this.launchTimer = this.timers.setTimeout(() => {
      void this.automaticCheck()
    }, this.options.launchDelayMs ?? UPDATE_LAUNCH_DELAY_MS)
    this.tickTimer = this.timers.setInterval(() => this.tick(), UPDATE_TICK_MS)
  }

  /**
   * Stops the schedule and any download, and starts no write after it: the app is quitting, or
   * the test is over. A write already under way is not cut short — `flush()` waits for it.
   */
  dispose(): void {
    this.closed = true
    if (this.launchTimer !== null) this.timers.clearTimeout(this.launchTimer)
    if (this.tickTimer !== null) this.timers.clearInterval(this.tickTimer)
    this.launchTimer = null
    this.tickTimer = null
    this.downloadAbort?.abort()
  }

  /**
   * Settles once nothing is under way and nothing is being written: every check, download and
   * write this service started has finished. The file's folder can be removed after it — a
   * test's, at its end — without a write landing in a folder that is gone.
   */
  async flush(): Promise<void> {
    for (;;) {
      await Promise.allSettled([...this.pending])
      await this.settled()
      const writing = this.writing
      await writing
      if (writing === this.writing && this.inflight === null && this.pending.size === 0) return
    }
  }

  /** `dispose()`, then `flush()`: the way out that leaves nothing running and nothing half written. */
  async close(): Promise<void> {
    this.dispose()
    await this.flush()
  }

  /**
   * The hourly look at the clock: a day since the last check that reached the server is a
   * check due, and a lockout that began or ended is a status the window has to redraw.
   */
  tick(): void {
    this.noteLockout()
    const last = this.stored.lastCheckedAt
    if (last === null || this.now().getTime() - last >= UPDATE_DAILY_MS) void this.automaticCheck()
  }

  /**
   * A check nobody asked for: at launch and daily. It runs only when checks are on, not locked
   * out and nothing is already under way, and it says nothing when the network is not there.
   */
  async automaticCheck(): Promise<void> {
    if (!this.stored.settings.check) return
    if (this.lockout() !== null) return
    if (this.phase === 'checking' || this.phase === 'downloading' || this.phase === 'downloaded') return
    await this.runCheck(false)
  }

  // ─── What the operator asks for ───────────────────────────────────────────

  /** Check now, from Settings. Refused while locked out; otherwise the status it left behind. */
  async check(): Promise<UpdateStatus> {
    const locked = this.lockout()
    if (locked !== null) throw new Refusal(`${locked} Change that in Settings → Updates.`)
    if (this.phase === 'downloading') throw new Refusal('An update is downloading already.')
    if (this.phase === 'downloaded') return this.status()
    if (this.phase !== 'checking') await this.runCheck(true)
    else await this.inflight
    return this.status()
  }

  /** Starts the download the last check offered. Answers once it has started, not finished. */
  download(): Promise<void> {
    return this.track(this.startDownload())
  }

  private async startDownload(): Promise<void> {
    const cannot = selfUpdateRefusal(this.options.install)
    if (!canSelfUpdate(this.options.install)) throw new Refusal(cannot ?? 'This copy cannot replace itself.')
    if (this.available === null) throw new Refusal('There is no update to download: check for one first.')
    if (this.phase === 'downloading' || this.phase === 'downloaded') return
    if (this.busy()) {
      this.set({ phase: 'held', message: HELD_FOR_SHOW, progress: null })
      throw new Refusal(HELD_FOR_SHOW)
    }
    const locked = this.lockout()
    if (locked !== null) throw new Refusal(`${locked} Nothing is downloaded while it lasts.`)
    const updater = await this.updater()
    if (updater === null) throw new Refusal(cannot ?? 'This copy has no updater.')
    const abort = new AbortController()
    this.downloadAbort = abort
    this.set({ phase: 'downloading', progress: 0, message: null })
    let shown = 0
    this.inflight = updater
      .download(abort.signal, fraction => {
        if (abort.signal.aborted) return
        if (fraction !== null && Math.abs(fraction - shown) < PROGRESS_STEP && fraction < 1) return
        shown = fraction ?? shown
        this.set({ progress: fraction })
      })
      .then(
        () => {
          if (abort.signal.aborted) {
            this.set({ phase: 'held', message: STOPPED_FOR_SHOW, progress: null })
            return
          }
          this.set({ phase: 'downloaded', progress: 1, message: null })
        },
        (error: unknown) => {
          if (abort.signal.aborted) {
            this.set({ phase: 'held', message: STOPPED_FOR_SHOW, progress: null })
            return
          }
          const failure = classifyUpdateFailure(error as { code?: unknown; message?: unknown })
          this.log(`[update] download failed: ${failure.kind}: ${(error as Error)?.message ?? String(error)}`)
          if (failure.kind === 'integrity' || failure.kind === 'signature') {
            this.set({ phase: 'refused', message: failure.sentence, progress: null })
          } else if (failure.kind === 'offline' || failure.kind === 'missing') {
            this.set({
              phase: 'available',
              message: 'The download could not reach the update server. Nothing was installed; try again once this machine is online.',
              progress: null
            })
          } else {
            const reason = String((error as Error)?.message ?? error).split('\n')[0].slice(0, 200)
            this.set({ phase: 'failed', message: `The download failed, and nothing was installed: ${reason}.`, progress: null })
          }
        }
      )
      .finally(() => {
        if (this.downloadAbort === abort) this.downloadAbort = null
        this.inflight = null
      })
  }

  /** The operator's restart: quits and installs what was downloaded. Never during a show. */
  async install(): Promise<void> {
    if (this.phase !== 'downloaded') throw new Refusal('There is no downloaded update to install.')
    if (this.busy()) {
      this.set({ message: HELD_FOR_SHOW })
      throw new Refusal(HELD_FOR_SHOW)
    }
    const updater = await this.updater()
    if (updater === null) throw new Refusal('This copy has no updater.')
    updater.installNow()
  }

  /** The machine's settings, changed: written down, and the window told. */
  async configure(patch: Partial<UpdateSettings>): Promise<UpdateStatus> {
    const merged = {
      ...this.stored.settings,
      ...patch,
      lockout: { ...this.stored.settings.lockout, ...(patch.lockout ?? {}) }
    }
    this.stored = { ...this.stored, settings: normalizeUpdateSettings(merged) }
    await this.persist()
    this.lastLockout = this.lockout()
    this.pushStatus()
    return this.status()
  }

  /**
   * What the window says the show is doing. A show that starts while a download is under way
   * stops the download: the bytes are thrown away, and the operator asks again once it is idle.
   */
  report(state: UpdateShowState): void {
    this.show = {
      busy: state.busy === true,
      showMode: state.showMode === true,
      showOpen: state.showOpen === true
    }
    if (this.show.busy && this.downloadAbort !== null) {
      this.log('[update] the show started: the download is stopped')
      this.downloadAbort.abort()
    }
    this.noteLockout()
  }

  /** One shot: the versions installed since this machine last ran, and then nothing. */
  async takeWhatsNew(): Promise<WhatsNew | null> {
    const taken = this.whatsNew
    if (taken === null) return null
    this.whatsNew = null
    this.stored = { ...this.stored, lastSeenVersion: this.options.current }
    await this.persist().catch(error => this.log(`[update] could not write ${this.options.filePath}: ${String(error)}`))
    return taken
  }

  /** Settles once whatever is under way has — a check or a download. For the tests and for quit. */
  async settled(): Promise<void> {
    while (this.inflight !== null) await this.inflight
  }

  // ─── The workings ─────────────────────────────────────────────────────────

  private updater(): Promise<UpdaterPort | null> {
    if (this.updaterMade === null) {
      this.updaterMade = this.options.updater().catch(error => {
        this.log(`[update] the updater could not be made: ${String(error)}`)
        return null
      })
    }
    return this.updaterMade
  }

  /** A check, counted from its first step — making the updater — so `flush()` waits for all of it. */
  private runCheck(manual: boolean): Promise<void> {
    return this.track(this.checkOnce(manual))
  }

  /** Remembers work under way until it settles, whichever way it settles. */
  private track<T>(work: Promise<T>): Promise<T> {
    this.pending.add(work)
    const done = (): void => {
      this.pending.delete(work)
    }
    work.then(done, done)
    return work
  }

  private async checkOnce(manual: boolean): Promise<void> {
    const updater = await this.updater()
    if (updater === null) {
      if (manual) {
        const sentence = selfUpdateRefusal(this.options.install) ?? 'This copy has no updater.'
        throw new Refusal(sentence)
      }
      return
    }
    const before: UpdatePhase = this.available !== null ? 'available' : 'idle'
    const beforeMessage = this.available !== null ? this.message : null
    this.set({ phase: 'checking', message: null })
    const run = (async () => {
      try {
        const found = await updater.check()
        this.stored = { ...this.stored, lastCheckedAt: this.now().getTime() }
        await this.persist().catch(error => this.log(`[update] could not write ${this.options.filePath}: ${String(error)}`))
        if (found === null) {
          this.available = null
          this.set({ phase: 'up-to-date', message: null, progress: null })
          return
        }
        this.available = {
          version: found.version,
          notes: boundedNotes(found.notes),
          releaseDate: found.releaseDate
        }
        this.set({
          phase: 'available',
          progress: null,
          message: canSelfUpdate(this.options.install) ? null : selfUpdateRefusal(this.options.install)
        })
      } catch (error) {
        const failure = classifyUpdateFailure(error as { code?: unknown; message?: unknown })
        this.log(`[update] check failed (${manual ? 'asked for' : 'automatic'}): ${failure.kind}: ${(error as Error)?.message ?? String(error)}`)
        if (!manual) {
          // Nobody asked, so nobody is told: a machine with no network backstage is ordinary.
          this.set({ phase: before, message: beforeMessage })
          return
        }
        if (failure.kind === 'offline' || failure.kind === 'missing') {
          this.set({ phase: this.available !== null ? 'available' : 'offline', message: failure.sentence })
        } else {
          this.set({ phase: 'failed', message: failure.sentence })
        }
      }
    })()
    this.inflight = run.finally(() => {
      this.inflight = null
    })
    await this.inflight
  }

  /** "What's new": the notes of every version newer than the last this machine ran. */
  private findWhatsNew(): WhatsNew | null {
    const previous = this.stored.lastSeenVersion
    const current = this.options.current
    if (previous === null || compareVersions(previous, current) !== -1) {
      // A first run is an install, not an update; a downgrade is somebody's deliberate choice.
      // Either way this version is the one seen, and there is nothing to say about it.
      if (previous !== current) {
        this.stored = { ...this.stored, lastSeenVersion: current }
        void this.persist().catch(error => this.log(`[update] could not write ${this.options.filePath}: ${String(error)}`))
      }
      return null
    }
    let sections: WhatsNew['sections'] = []
    try {
      sections = sectionsBetween(parseReleaseNotes(this.options.changelog()), previous, current)
    } catch (error) {
      this.log(`[update] the release notes could not be read: ${String(error)}`)
    }
    return { version: current, previous, sections }
  }

  private noteLockout(): void {
    const now = this.lockout()
    if (now === this.lastLockout) return
    this.lastLockout = now
    this.pushStatus()
  }

  private set(patch: Partial<{ phase: UpdatePhase; message: string | null; progress: number | null }>): void {
    if (patch.phase !== undefined) this.phase = patch.phase
    if (patch.message !== undefined) this.message = patch.message
    if (patch.progress !== undefined) this.progress = patch.progress
    this.pushStatus()
  }

  private pushStatus(): void {
    try {
      this.options.push(this.status())
    } catch (error) {
      this.log(`[update] the status could not be sent: ${String(error)}`)
    }
  }

  /** Writes one at a time, in order: two quick changes must not land out of order. */
  private persist(): Promise<void> {
    if (this.closed) return this.writing
    const snapshot = `${JSON.stringify(this.stored, null, 2)}\n`
    const next = this.writing.then(() => writeFileAtomically(this.options.filePath, snapshot))
    this.writing = next.catch(() => {})
    return next
  }
}
