import type {
  Cue, AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, ScriptCue, SceneCue, NetworkCue, DevampCue,
  MscCue,
  MicCue,
  TimecodeCue
} from '../../../shared/cue'
import { isProCueType } from '../../../shared/cue'
import { audioEngine } from './audioEngineClient'
import type {
  AudioEngineEvent,
  AudioEngineSessionChange,
  AudioFadeParam,
  AudioStartOptions
} from './audioEngineClient'
import { declaredEventFields } from '../../../shared/audio'
import { SampleScheduler, SCHEDULER_LOOKAHEAD_MS } from './scheduler'
import { InputGuard, refirePolicy } from './inputGuard'
import type { FireSurface } from './inputGuard'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import { recallScene } from './scenes'
import { sendMsc } from './showControl'
import { sendMic } from './mic'
import { releaseTimecode, startTimecode, timecodeLengthMs, timecodeRequest, watchTimecodeEnd } from './timecodeCue'
import { network } from './networkClient'
import { playRegion } from '../utils/silenceTrim'
import type { RunningCue, CueRunResult, LogEntryInput } from '../store'
import type { TriggerGuardSettings } from '../../../shared/workspace'
import type { TakeoverPlan } from '../../../shared/redundancy'

type SetRunning = (id: string, state: RunningCue | null) => void
type ClearAllRunning = () => void
type GetCues = () => Cue[]
type GetSelected = () => string | null
type SetSelected = (id: string | null) => void

// Cap on log lines a single script run may emit, so a chatty script cannot flood the log.
const MAX_RUN_LOG_LINES = 200

// PANIC cuts the audio with a short fade rather than at zero-crossing; the guide
// documents this as 200 ms.
const PANIC_FADE_MS = 200

// An engine end that lands this close to the planned end is the plan arriving on time.
// One that lands earlier means the media really did end early, and the run is closed
// where the engine says rather than at a time it never reached.
const PLANNED_END_TOLERANCE_MS = 25

// Unrecognised event types whose count is kept. A skewed engine can name a fresh type in
// every event, so the table has a bound like every other read path; past it a new name is
// still logged — the line names the type — but has no count of its own to climb.
const MAX_UNRECOGNISED_EVENT_TYPES = 64

/** What an audio cue's run says when the cue names no file: it ran, and played nothing. */
export const NO_FILE_SELECTED = 'no file selected — nothing played'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The playback length of a finite run in ms, as the engine will play it — or null when
 * only the engine can say (a forever loop, or a file whose length is not known yet).
 */
function plannedPlaybackMs(options: AudioStartOptions, durationMs: number): number | null {
  if (options.loopCount < 0) return null
  const segmentMs = (options.endTime ?? durationMs) - options.startTime
  if (segmentMs <= 0) return null
  const rate = options.rate > 0 ? options.rate : 1
  return (segmentMs * (options.loopCount + 1)) / rate
}

/** The engine options a cue plays with, offset into the file for a seek. */
function startOptions(cue: AudioCue, seekMs = 0, trim = false): AudioStartOptions {
  // The region the cue plays, silence trim and all. An offset — a timeline that starts
  // part-way into the cue — moves the region's own start, and the trim still holds the
  // head of the file: an offset that lands in the trimmed silence is silence.
  const played = playRegion(cue, trim)
  return {
    startTime: Math.max(played.startMs, cue.startTime + seekMs),
    endTime: played.endMs,
    loopCount: cue.loopCount,
    rate: cue.playbackRate,
    trim: cue.trim,
    volume: cue.volume,
    pan: cue.pan,
    // A seek is not a fresh start: fading in again would duck the cue every time the
    // operator drops the playhead somewhere.
    fadeInDuration: seekMs > 0 ? 0 : cue.fadeInDuration,
    outputs: cue.outputs
  }
}

/** What a cue's execute() may add to its run result. */
type Finish = (endMs: number, detail?: Partial<CueRunResult>) => void

/** Where a run hands the show on to, once its own time is known. */
type Handover = (doneAt: number, run: CueRun) => void

type RunPhase = 'pending' | 'running' | 'post-wait' | 'done'

/**
 * One firing of one cue. Everything scheduled for it hangs off the run: taking the run
 * away (STOP, a Stop cue, a restart) takes every pending command with it, so nothing
 * that was stopped can move the show on.
 */
interface CueRun {
  cueId: string
  seq: number
  /** The STOP/PANIC generation this run belongs to. */
  generation: number
  /** Absolute sample time the cue's execution begins, after any pre-wait. */
  startAt: number
  /** How far into the cue a seek started it, ms — the row is shown back-dated by it. */
  seekMs: number
  postWait: number
  /** Absolute sample time a finite run ends, when the plan can say; null otherwise. */
  endAt: number | null
  plannedMs: number | null
  rate: number
  /** The task that closes the run at `endAt`, kept so a live rate change can re-time it. */
  endTask: number | null
  /** The engine's identity for this run, so a replaced run's stale events are dropped. */
  engineRunId: string | null
  /** The engine identity of the run this firing replaced, if it had been acknowledged. */
  supersededEngineRunId: string | null
  releaseTask: number | null
  /** Closes the run's execution at a given sample time. */
  finish: Finish | null
  /** Where this run hands the show on. */
  handover: Handover | null
  requestId: string | null
  tasks: Set<number>
  phase: RunPhase
  cancelled: boolean
  /** Set once the handover has been released. */
  released: boolean
  /** The run this one's handover created, while it has not begun. */
  releasedRun: CueRun | null
  /** Wall-clock moment execution began, for the log line and the run report. */
  beganAt: number
}

/**
 * One start waiting for its moment in a timeline, and the scheduler's id for it once
 * there is one. The box exists because `schedule()` dispatches a task whose time has
 * already come before it returns — inside that call there is no id yet, so the box is
 * what the dispatch takes out of the set it was registered in, and `id` is filled in
 * for a start that is still pending.
 */
interface TimelineStart {
  id: number
}

interface RunnerDeps {
  getCues: GetCues
  getSelected: GetSelected
  setSelected: SetSelected
  setRunning: SetRunning
  clearAllRunning: ClearAllRunning
  syncCueDuration: (id: string, durationMs: number) => void
  setLastRun: (id: string, result: CueRunResult) => void
  appendLog: (entries: LogEntryInput[]) => void
  getWorkspacePath: () => string | null
  // Output port a MIDI cue falls back to when it does not name one itself.
  getMidiDefaultPort: () => string
  // Whether this machine may run the Pro cues. Read per firing rather than latched at
  // init: a key can be entered or removed while the show is loaded.
  isPro: () => boolean
  // How long each firing surface stays deaf after it fires. Read per press, because the
  // operator can change it while the show is loaded.
  getTriggerGuard: () => TriggerGuardSettings
}

export class CueEngine {
  private deps: RunnerDeps | null = null
  private scheduler: SampleScheduler | null = null
  private unsubscribeEvents: (() => void) | null = null
  private unsubscribeSession: (() => void) | null = null
  private runs = new Map<string, CueRun>()
  // Starts scheduled at a timeline offset, kept per child so stopping the child (or the
  // group above it) takes the pending start away before it fires. Each entry is a box
  // rather than a bare task id: a start whose moment has already come is dispatched
  // inside `schedule()`, before the call can return an id, and the box is what the
  // dispatch takes out of the set — see `TimelineStart`.
  private timelineTasks = new Map<string, Set<TimelineStart>>()
  private groupStartOffsets = new Map<string, number>()
  // Playlist groups step one child per GO. The cursor holds the index of the child the
  // next GO will fire; 0 means a pass is complete or has not started.
  private playlistCursors = new Map<string, number>()
  // Bumped by a global STOP or PANIC. Every continuation captures the generation it
  // was started under and does nothing once it is stale, so work that settles after
  // STOP — a network request, a script — cannot resume the show.
  private generation = 0
  private runSeq = 0
  // What each firing surface last fired, and which notes are still down. Owned here
  // because this is the one place every surface reaches — the keyboard, a trigger, the
  // GO button — and a guard that lived in one of them would be a guard on one of them.
  private guard = new InputGuard(() => this.deps?.getTriggerGuard().windowMs ?? 0)
  // Event types the declaration does not name, and how often each has arrived: the count
  // belongs to the fact, so a repeat raises it rather than filling the log with copies.
  // Bounded — a skewed engine naming a fresh type in every event must not grow this map
  // for the life of the window; past the cap a new name is still logged, naming it, but
  // earns no count of its own.
  private unrecognisedEngineEvents = new Map<string, number>()

  init(deps: RunnerDeps): void {
    this.deps = deps
    if (this.scheduler) return
    // One scheduler for the life of the runner: every cue's times are on the engine's
    // sample clock, watched on a 25 ms tick with a lookahead so commands go out before
    // the moment they name.
    this.scheduler = new SampleScheduler(() => audioEngine.nowMs(), cb => audioEngine.onTick(cb))
    this.unsubscribeEvents = audioEngine.onEvent(event => this.handleEngineEvent(event))
    this.unsubscribeSession = audioEngine.onSessionChange(change => this.handleSessionChange(change))
    void audioEngine.syncClock().catch(() => {
      // No clock reading yet: the first tick anchors it. Commands carry absolute times
      // either way.
    })
  }

  dispose(): void {
    this.unsubscribeEvents?.()
    this.unsubscribeEvents = null
    this.unsubscribeSession?.()
    this.unsubscribeSession = null
    this.scheduler?.dispose()
    this.scheduler = null
    this.runs.clear()
  }

  go(): void {
    const { getCues, getSelected, setSelected } = this.deps!
    const cues = getCues()
    const selectedId = getSelected()

    // Nothing selected fires nothing. It used to fire the first cue of the show, and the
    // selection is empty exactly once in every performance: after the last cue. One more
    // press there — a hand resting on Space as the house lights come up — started the
    // walk-in again over the bows. A show that has just been opened is standing on its
    // first cue, so the top of the show is still one press away where it should be.
    if (!selectedId) return
    const standingIdx = cues.findIndex(c => c.id === selectedId)
    if (standingIdx < 0) return

    // A disarmed cue is skipped, not stood on: the press fires the next armed cue after
    // it. Returning here instead fired nothing and left the selection where it was, so
    // every later GO landed on the same disarmed cue — under a bar that said "GO skips it".
    const cue = this.nextArmed(cues, standingIdx)
    if (!cue) return
    const targetIdx = cues.indexOf(cue)

    // The hand that shook. Every way of firing a cue reaches the runner, so the window
    // is asked here rather than at each of them — and Space, which the OS repeats while
    // it is held down, is exactly what it is for.
    if (!this.guard.accepts('key', 'go', this.now())) return

    // A cue that is already in flight is left where it is, unless it was told it may be
    // restarted. Checked before the selection moves, so an ignored press changes nothing
    // at all rather than moving the operator's hand somewhere the show is not going.
    if (this.hasActiveRun(cue.id) && refirePolicy(cue) === 'ignore') return

    // When the fired cue is a group, skip over its children to find the next
    // cue that should receive selection focus after GO
    const nextCue = (() => {
      if (cue.type === 'group') {
        let i = targetIdx + 1
        while (i < cues.length && cues[i].parentId === cue.id) i++
        return cues[i] ?? null
      }
      return cues[targetIdx + 1] ?? null
    })()

    // A playlist group holds the selection while it still has children to fire, so
    // repeated GO presses step through it. On the last step it hands over normally.
    const steppingPlaylist = cue.type === 'group' && (cue as GroupCue).mode === 'playlist' &&
      !this.isLastPlaylistStep(cue.id)

    // If this cue will auto-fire nextCue, skip selection past it
    const afterThis = steppingPlaylist
      ? cue
      : cue.advance && cue.advance !== 'none'
        ? (() => {
            if (!nextCue) return null
            const nextIdx = cues.findIndex(c => c.id === nextCue.id)
            if (nextCue.type === 'group') {
              let i = nextIdx + 1
              while (i < cues.length && cues[i].parentId === nextCue.id) i++
              return cues[i] ?? null
            }
            return cues[nextIdx + 1] ?? null
          })()
        : nextCue
    // The selection is what the next GO fires, so it comes to rest on a cue that can be
    // fired: disarmed cues between here and there are stepped over now, where the
    // operator can see where the show is going, rather than on the next press. Only the
    // selection steps over them — a cue's own advance still hands over to the cue
    // directly after it, and a disarmed cue there ends the chain as it always has.
    const selectionTarget = afterThis === null || afterThis === cue
      ? afterThis
      : this.nextArmed(cues, cues.indexOf(afterThis))
    setSelected(selectionTarget?.id ?? null)

    // Firing a cue that is already in flight replaces it rather than stacking a second
    // copy of it on the same cue id — which is what a cue set to restart is asking for.
    // A group's children go with it, and no step is settled along the way: re-firing a
    // child is not taking it away, so its parent's counting must not move (the same rule
    // fireCue's own replacement obeys). The engine identity of the run being replaced is
    // read before the stop takes the run away, so the late line about it — an `ended`
    // batched 16 ms, for the stop this very GO issued — cannot be read as the new run's.
    const supersededEngineRunId = this.runs.get(cue.id)?.engineRunId ?? null
    if (this.hasActiveRun(cue.id)) this.stop(cue.id, false)

    const startMs = this.now()
    this.fireCue(cue, startMs, (doneAt, run) => {
      // A playlist group mid-pass is not finished, so it must not hand over yet
      if (cue.advance === 'on-end' && nextCue && !this.isMidPlaylist(cue.id)) {
        this.goById(nextCue.id, doneAt, run)
      }
    }, undefined, 0, false, supersededEngineRunId)

    if (cue.advance === 'on-start' && nextCue) {
      this.goById(nextCue.id, startMs)
    }
  }

  /**
   * Fires one named cue. `atMs` says the caller already knows when this belongs on the
   * clock — an advance chain handing over, a timeline placing a child — and such a call
   * is the show's own plumbing, not a press: the interlock is only for a firing that
   * happens *now*, which is what an operator's hand and a remote trigger produce.
   */
  goById(id: string, atMs?: number, parent?: CueRun): void {
    const { getCues } = this.deps!
    const cues = getCues()
    const cue = cues.find(c => c.id === id)
    if (!cue || !cue.isArmed) return
    if (atMs === undefined && this.hasActiveRun(cue.id) && refirePolicy(cue) === 'ignore') return
    const idx = cues.findIndex(c => c.id === id)
    // The cue after a group is the one past its children — handing a group's completion
    // to its own first child would start the group over instead of moving the show on.
    const nextCue = (() => {
      if (cue.type !== 'group') return cues[idx + 1] ?? null
      let i = idx + 1
      while (i < cues.length && cues[i].parentId === cue.id) i++
      return cues[i] ?? null
    })()
    const startMs = atMs ?? this.now()
    this.fireCue(cue, startMs, (doneAt, run) => {
      // A playlist pass that is not complete holds the show, the same interlock go()
      // applies: this entry point is how a trigger or a cue's own advance fires a group.
      if (cue.advance === 'on-end' && nextCue && !this.isMidPlaylist(cue.id)) {
        this.goById(nextCue.id, doneAt, run)
      }
    }, parent)
    // On-start is the cue's own advance, so it belongs to the firing rather than to the
    // key that made it: the guide promises a trigger fires a cue exactly as GO would,
    // and this entry point is how a trigger, a desk button and a cue's own chain fire.
    if (cue.advance === 'on-start' && nextCue) {
      this.goById(nextCue.id, startMs, parent)
    }
  }

  /**
   * Puts a cue that was already playing on another machine back on this one's engine:
   * the same cue, beginning at the position the show had reached in its file, with no
   * pre-wait to sit through and no fade-in over the sound already in flight. This is a
   * takeover rather than a press, so the guard that stands in front of a hand, a desk or
   * a cue light is not consulted — and the cue it replaces is the run that machine left.
   */
  adoptCue(cueId: string, seekMs: number): void {
    if (!this.deps) return
    const cues = this.deps.getCues()
    const cue = cues.find(candidate => candidate.id === cueId)
    if (!cue || !cue.isArmed) return
    const nextCue = cues[cues.findIndex(candidate => candidate.id === cueId) + 1] ?? null
    this.fireCue(cue, this.now(), (doneAt, run) => {
      if (cue.advance === 'on-end' && nextCue) this.goById(nextCue.id, doneAt, run)
    }, undefined, Math.max(0, seekMs), true)
  }

  /**
   * Takes a show over from a machine that stopped answering. What the plan says can be
   * picked up goes back on the engine at the position it had reached; the operator's
   * place in the show comes with it, so the next GO fires what the live machine would
   * have fired. Everything that could not be carried forward is written to the session
   * log with its reason — a MIDI cue has already reached its desk, a wait was half
   * counted — because the operator has to know what the show did without them.
   */
  adopt(plan: TakeoverPlan): { adopted: number; skipped: number } {
    if (!this.deps) return { adopted: 0, skipped: 0 }
    // The mirror is the show now. A cue the operator fired here by hand would otherwise
    // play underneath the show the live machine has just handed over, so anything this
    // machine was running on its own is stopped first — and said, when there was any.
    const stray = [...this.runs.keys()].filter(
      cueId => !plan.adopt.some(entry => entry.cueId === cueId)
    )
    if (stray.length > 0) {
      this.log({
        level: 'info',
        message: `stopped what this machine was running on its own (${stray.length})`
      })
      this.stop()
    }
    this.log({ level: 'info', message: plan.note })
    for (const entry of plan.adopt) this.adoptCue(entry.cueId, entry.seekMs)
    for (const entry of plan.skipped) {
      this.log({ level: 'error', message: `not picked up: ${entry.reason}`, label: entry.label })
    }
    if (plan.selectedId && this.deps.getCues().some(cue => cue.id === plan.selectedId)) {
      this.deps.setSelected(plan.selectedId)
    }
    return { adopted: plan.adopt.length, skipped: plan.skipped.length }
  }

  /**
   * The first armed cue at or after `from`, or null when the show has none left. A
   * disarmed cue is stepped over, and a disarmed group takes everything under it along:
   * its children are part of the cue that was taken out of the show, not cues of their
   * own waiting behind it.
   */
  private nextArmed(cues: Cue[], from: number): Cue | null {
    let i = from
    while (i < cues.length && !cues[i].isArmed) {
      const under = new Set([cues[i].id])
      i++
      while (i < cues.length && cues[i].parentId !== null && under.has(cues[i].parentId as string)) {
        under.add(cues[i].id)
        i++
      }
    }
    return cues[i] ?? null
  }

  // Cue identity as it was when the entry was written, e.g. "3 · Network Cue".
  private cueLabel(cue: Cue): string {
    return `${cue.number} · ${cue.name}`
  }

  private armedChildren(groupId: string): Cue[] {
    return this.deps!.getCues().filter(c => c.parentId === groupId && c.isArmed)
  }

  // True while a playlist group has fired at least one child but not yet a full pass.
  private isMidPlaylist(groupId: string): boolean {
    return (this.playlistCursors.get(groupId) ?? 0) !== 0
  }

  // True when the next GO fires the final armed child and completes the pass.
  private isLastPlaylistStep(groupId: string): boolean {
    const children = this.armedChildren(groupId)
    if (children.length === 0) return true
    return (this.playlistCursors.get(groupId) ?? 0) === children.length - 1
  }

  private log(entry: LogEntryInput): void {
    this.deps?.appendLog([entry])
  }

  private now(): number {
    return audioEngine.nowMs()
  }

  /**
   * Fires a cue so that its execution begins at `startMs` on the sample clock — not at
   * whatever moment this happens to be. `onDone` is called with the sample time the cue
   * hands over to, which is known in advance for anything with a predictable length.
   *
   * `adopted` is the one caller that is not a firing: the cue was already playing on
   * another machine, so its execution begins now with no pre-wait to sit through — the
   * wait happened on the machine this show came from.
   */
  private fireCue(
    cue: Cue,
    startMs: number,
    onDone: Handover,
    parent?: CueRun,
    seekMs = 0,
    adopted = false,
    /** A run the caller already took away, whose engine identity only it could read. */
    supersededRunId: string | null = null
  ): void {
    const generation = this.generation

    // A cue fired while it is already in flight replaces its previous run. Capture the
    // old run's engine identity before taking it away: an `ended` line from that run,
    // batched 16 ms, can arrive after this firing, and must not close the new run
    // before its own start is acknowledged. A caller that had to stop the run itself —
    // go()'s restart, so a group's children go with it — passes the identity instead.
    const supersededEngineRunId = supersededRunId ?? this.runs.get(cue.id)?.engineRunId ?? null
    if (this.runs.has(cue.id)) this.stopCue(cue.id, 0, false)

    const seq = ++this.runSeq
    const run: CueRun = {
      cueId: cue.id,
      seq,
      generation,
      startAt: adopted ? startMs : startMs + cue.preWait,
      seekMs,
      postWait: cue.postWait,
      endAt: null,
      plannedMs: null,
      rate: cue.type === 'audio' ? (cue as AudioCue).playbackRate : 1,
      endTask: null,
      engineRunId: null,
      supersededEngineRunId,
      releaseTask: null,
      finish: null,
      handover: onDone,
      requestId: null,
      tasks: new Set(),
      phase: 'pending',
      cancelled: false,
      released: false,
      releasedRun: null,
      beganAt: Date.now()
    }
    this.runs.set(cue.id, run)
    // STOP takes back a handover that has been released but has not begun: the cue it
    // would have started must not run either.
    if (parent && !parent.cancelled) parent.releasedRun = run

    const executeAt = run.startAt
    const label = this.cueLabel(cue)
    const finish: Finish = (endMs, detail) => this.finishRun(cue, run, endMs, detail ?? {})
    run.finish = finish

    // Native commands carry this cue's absolute time and go out as soon as the moment
    // is within the lookahead — the pre-wait tick must not become the start latency.
    if (cue.type === 'audio') this.planAudio(cue as AudioCue, run, executeAt, finish)

    const begin = (): void => {
      if (run.phase !== 'pending' || run.cancelled || this.isStale(generation)) return
      run.phase = 'running'
      run.beganAt = Date.now()
      this.deps!.setRunning(cue.id, {
        cueId: cue.id,
        state: 'playing',
        startedAt: run.beganAt - seekMs,
        progress: 0
      })
      this.log({ level: 'info', message: 'started', label })
      this.execute(cue, run, executeAt, finish)
    }

    if (!adopted && cue.preWait > 0) {
      this.track(run, this.scheduler!.schedule({
        at: startMs,
        due: () => {
          if (run.cancelled) return
          this.deps!.setRunning(cue.id, { cueId: cue.id, state: 'pre-wait', startedAt: Date.now(), progress: 0 })
        }
      }))
    }
    this.track(run, this.scheduler!.schedule({ at: executeAt, due: begin }))
  }

  /**
   * Closes a run's execution at `endMs`: records the result, moves the row to post-wait
   * and hands the show on at `endMs + postWait`.
   */
  private finishRun(cue: Cue, run: CueRun, endMs: number, detail: Partial<CueRunResult>): void {
    if (run.cancelled || this.isStale(run.generation)) return
    if (run.phase !== 'running' && run.phase !== 'pending') return
    run.phase = 'post-wait'
    if (run.endTask !== null) {
      this.scheduler!.cancel(run.endTask)
      run.endTask = null
    }

    const { setRunning, setLastRun } = this.deps!
    const label = this.cueLabel(cue)
    const durationMs = Math.max(0, Math.round(endMs - run.startAt))
    setLastRun(cue.id, { startedAt: run.beganAt, durationMs, outcome: 'success', ...detail })

    // A firing reports as a line in the log: the failure reason, or what the cue did.
    const networkError = cue.type === 'network' && detail.status === undefined
    if (detail.outcome === 'error' || networkError) {
      this.log({ level: 'error', message: detail.error ?? 'request failed', label })
    } else if (cue.type === 'network' && detail.status !== undefined) {
      const network = cue as NetworkCue
      const statusText = detail.statusText ? ` ${detail.statusText}` : ''
      this.log({
        level: 'info',
        message: `${network.method} ${network.url} → ${detail.status}${statusText} (${durationMs}ms)`,
        label
      })
    } else if (cue.type !== 'scene' && cue.type !== 'mic') {
      // A scene recall and a mic cue write their own line — what the desk was told, which mic
      // was closed — so a duration here would only say the same thing twice.
      this.log({ level: 'info', message: `completed in ${durationMs}ms`, label })
    }

    setRunning(cue.id, { cueId: cue.id, state: 'post-wait', startedAt: Date.now(), progress: 1 })

    const doneAt = endMs + run.postWait
    // The row goes dark at `doneAt` before the show moves on, so the cue that is
    // finishing is not still lit when its successor is not yet due.
    this.track(run, this.scheduler!.schedule({
      at: doneAt,
      due: () => {
        run.phase = 'done'
        if (this.runs.get(cue.id) === run) this.runs.delete(cue.id)
        if (run.cancelled) return
        setRunning(cue.id, null)
      }
    }))
    this.release(run, doneAt)
  }

  /**
   * Hands the show on at `doneAt`, once. For a run whose end the sample clock can
   * predict, this happens a lookahead early so the next cue's own commands go out
   * before the moment they name instead of after the previous cue's callbacks.
   */
  private release(run: CueRun, doneAt: number): void {
    if (run.released || run.cancelled || !run.handover) return
    run.released = true
    run.handover(doneAt, run)
  }

  /** Plans the early handover for a run whose end time is known in advance. */
  private planRelease(run: CueRun, endMs: number): void {
    if (run.released) return
    const doneAt = endMs + run.postWait
    const releaseAt = Math.max(this.now(), doneAt - SCHEDULER_LOOKAHEAD_MS)
    run.releaseTask = this.scheduler!.schedule({ at: releaseAt, due: () => this.release(run, doneAt) })
    this.track(run, run.releaseTask)
  }

  /**
   * Fires a taken-away group child's handover once, so the group's counting settles the
   * way it would have when the child ended. Separate from `release` because that one
   * refuses a cancelled run — which is right for a scheduled handover, and wrong here:
   * the run was taken away on purpose, and the group is still owed its step.
   */
  private settleParent(run: CueRun): void {
    if (run.released || !run.handover) return
    run.released = true
    run.handover(this.now(), run)
  }

  private track(run: CueRun, taskId: number): void {
    run.tasks.add(taskId)
  }

  /** Schedules a run's end at a time the clock can predict, handover included. */
  private scheduleRunEnd(run: CueRun, endMs: number, finish: Finish): void {
    this.planRelease(run, endMs)
    this.track(run, this.scheduler!.schedule({ at: endMs, due: () => finish(endMs) }))
  }

  private execute(cue: Cue, run: CueRun, at: number, finish: Finish): void {
    // The class is a declaration (`PRO_CUE_TYPES`, beside `CUE_TYPES`) read where the cue
    // is dispatched, so every Pro type the declaration names is refused — not only the one
    // whose executor was written first.
    if (isProCueType(cue.type) && !this.deps!.isPro()) {
      const label = this.cueLabel(cue)
      // The cue stays in the file — a show written on a licensed machine opens on an
      // unlicensed one, and nothing is thrown away — but the desk is not driven
      // without a license, and a cue that did nothing quietly would be worse.
      this.log({ level: 'error', message: `${cue.type} cues need Cuerunner Pro`, label })
      finish(this.now(), { outcome: 'error', error: 'Cuerunner Pro is required' })
      return
    }
    switch (cue.type) {
      case 'audio':
        // Planned when the cue was fired: its command and end carry absolute times.
        break
      case 'midi':
        this.executeMidi(cue as MidiCue, finish)
        break
      case 'osc':
        this.executeOsc(cue as OscCue, finish)
        break
      case 'wait':
        this.executeWait(cue as WaitCue, run, at, finish)
        break
      case 'fade':
        this.executeFade(cue as FadeCue, run, at, finish)
        break
      case 'stop':
        this.executeStop(cue as StopCue, run, at, finish)
        break
      case 'group':
        this.executeGroup(cue as GroupCue, run, at, finish)
        break
      case 'network':
        this.executeNetwork(cue as NetworkCue, run, finish)
        break
      case 'scene':
        this.executeScene(cue as SceneCue, finish)
        break
      case 'devamp':
        this.executeDevamp(cue as DevampCue, finish)
        break
      case 'msc':
        this.executeMsc(cue as MscCue, finish)
        break
      case 'mic':
        this.executeMic(cue as MicCue, finish)
        break
      case 'script':
        this.executeScript(cue as ScriptCue, finish)
        break
      case 'timecode':
        this.executeTimecode(cue as TimecodeCue, run, at, finish)
        break
    }
  }

  /**
   * Starts the cue's clock in main. A clock with an end runs that long on this clock too,
   * so the show moves on from it exactly as from a wait; one without an end runs until it
   * is stopped, and a jam-synced one ends when main says it has.
   */
  private executeTimecode(cue: TimecodeCue, run: CueRun, at: number, finish: Finish): void {
    const label = this.cueLabel(cue)
    const request = timecodeRequest(cue, this.deps!.getMidiDefaultPort())
    if (typeof request === 'string') {
      this.log({ level: 'error', message: request, label })
      finish(this.now(), { outcome: 'error', error: request })
      return
    }
    void startTimecode(request).then(result => {
      if (!result.ok) {
        finish(this.now(), { outcome: 'error', error: result.error })
        return
      }
      if (run.cancelled) {
        // Stopped while main was starting it: the clock must not outlive the run.
        releaseTimecode(cue.id)
        return
      }
      const lengthMs = timecodeLengthMs(cue)
      if (lengthMs !== null) this.scheduleRunEnd(run, at + lengthMs, finish)
      else if (cue.endTimecode.trim() !== '') watchTimecodeEnd(cue.id, () => finish(this.now()))
    })
  }

  /**
   * Sends an audio cue's start to the engine with its absolute time, and arms the run's
   * end when the plan can say when that is.
   */
  private planAudio(cue: AudioCue, run: CueRun, at: number, finish: Finish): void {
    if (!cue.filePath) {
      // A cue with no file plays nothing. It still takes its time in the sequence,
      // rather than holding the show open forever — and it says so: a GO that made no
      // sound and reported "completed in 0ms" was a cue that looked as though it worked.
      this.track(run, this.scheduler!.schedule({
        at,
        due: () => finish(at, { outcome: 'error', error: NO_FILE_SELECTED })
      }))
      return
    }

    const options = startOptions(cue, run.seekMs, this.trimApplies(cue))
    this.track(run, this.scheduler!.schedule({
      at,
      early: () => {
        // The run's end is planned from the options right away rather than after the
        // engine's reply: a short cue's chain must be known before the cue is over.
        this.armAudioEnd(cue, run, at, options, finish)
        void this.prepareAndPlay(cue, run, at, options, finish)
      }
    }))
  }

  /**
   * The engine plays a cue it has decoded first, and the inspector is not the only way
   * into a cue: a saved show can be fired without its Audio tab ever being drawn. The
   * prepare ahead of the start is what makes GO independent of which surfaces were
   * opened; on a file that is already warm it is a cache hit, not a second decode.
   */
  private async prepareAndPlay(
    cue: AudioCue,
    run: CueRun,
    at: number,
    options: AudioStartOptions,
    finish: Finish
  ): Promise<void> {
    try {
      const metadata = await audioEngine.prepare(cue.id, cue.filePath)
      if (metadata.durationMs > 0) this.deps!.syncCueDuration(cue.id, metadata.durationMs)
      // The cue did not carry a length when its end had to be planned; now the engine
      // has said what it is, so the run still ends at a known time.
      if (metadata.durationMs > 0) {
        this.scheduleAudioEnd(run, at, options, metadata.durationMs, finish)
      }
    } catch (error) {
      if (run.cancelled) return
      console.error('Audio playback failed:', error)
      finish(Math.max(at, this.now()), { outcome: 'error', error: errorMessage(error) })
      return
    }

    if (run.cancelled || run.phase === 'post-wait' || run.phase === 'done') return
    // A cue handed a time the engine's clock has already passed begins at once, so a
    // prepare that outlasted the lookahead moves the real start — and the run's end has
    // to move with it, or the tail is cut and the cue after it goes early. Jitter inside
    // the lookahead is left alone: those starts land on the next block anyway, and
    // re-timing every handover by it would make the chain drift.
    const startedAt = this.now()
    if (startedAt - at > SCHEDULER_LOOKAHEAD_MS) this.reanchorAudioEnd(run, startedAt, finish)
    void audioEngine.start(cue.id, at, options)
      .then(result => {
        // The engine's identity for this run, so a replaced run's stale events are
        // not mistaken for the new one's.
        run.engineRunId = result.runId
      })
      .catch(error => {
        if (run.cancelled) return
        console.error('Audio playback failed:', error)
        finish(Math.max(at, this.now()), { outcome: 'error', error: errorMessage(error) })
      })
  }

  private armAudioEnd(cue: AudioCue, run: CueRun, at: number, options: AudioStartOptions, finish: Finish): void {
    // A length the cue already carries is planned now, before the engine is asked for
    // anything; without one the end is planned once the prepare has answered.
    if (cue.duration > 0) this.scheduleAudioEnd(run, at, options, cue.duration, finish)
  }

  /** Moves a run's end with a start that went out later than the time it names. */
  private reanchorAudioEnd(run: CueRun, startedAt: number, finish: Finish): void {
    if (run.endAt === null || run.plannedMs === null) return
    const endAt = startedAt + run.plannedMs
    if (endAt <= run.endAt) return
    run.endAt = endAt
    if (run.releaseTask !== null && !run.released) {
      this.scheduler!.cancel(run.releaseTask)
      run.releaseTask = null
    }
    this.armAudioEndTask(run, finish)
    this.planRelease(run, run.endAt)
  }

  private scheduleAudioEnd(
    run: CueRun,
    at: number,
    options: AudioStartOptions,
    durationMs: number,
    finish: Finish
  ): void {
    const plannedMs = plannedPlaybackMs(options, durationMs)
    if (plannedMs === null || run.endAt !== null) return
    run.plannedMs = plannedMs
    run.rate = options.rate
    run.endAt = at + plannedMs
    this.armAudioEndTask(run, finish)
    this.planRelease(run, run.endAt)
  }

  private armAudioEndTask(run: CueRun, finish: Finish): void {
    const endAt = run.endAt
    if (endAt === null) return
    if (run.endTask !== null) this.scheduler!.cancel(run.endTask)
    run.endTask = this.scheduler!.schedule({
      at: endAt,
      due: () => {
        run.endTask = null
        finish(endAt)
      }
    })
  }

  private executeMidi(cue: MidiCue, finish: Finish): void {
    const detail: Partial<CueRunResult> = {}
    window.cuerunner.midi.send({
      portName: cue.portName || this.deps!.getMidiDefaultPort(),
      messages: cue.messages
    })
      .then(result => {
        if (!result.ok) {
          detail.outcome = 'error'
          detail.error = result.error ?? 'MIDI send failed'
        }
      })
      .catch(error => {
        detail.outcome = 'error'
        detail.error = errorMessage(error)
      })
      .finally(() => finish(this.now(), detail))
  }

  private executeOsc(cue: OscCue, finish: Finish): void {
    const detail: Partial<CueRunResult> = {}
    window.cuerunner.osc.send({ host: cue.host, port: cue.port, address: cue.address, args: cue.args })
      .then(result => {
        if (!result.ok) {
          detail.outcome = 'error'
          detail.error = result.error ?? 'OSC send failed'
        }
      })
      .catch(error => {
        detail.outcome = 'error'
        detail.error = errorMessage(error)
      })
      .finally(() => finish(this.now(), detail))
  }

  private executeWait(cue: WaitCue, run: CueRun, at: number, finish: Finish): void {
    const endAt = at + Math.max(0, cue.duration - run.seekMs)
    this.scheduleRunEnd(run, endAt, finish)
  }

  private executeFade(cue: FadeCue, run: CueRun, at: number, finish: Finish): void {
    const param: AudioFadeParam = cue.fadeProperty === 'volume' ? 'volume' : 'pan'
    // The ramp starts at the cue's own time on the clock, whether that is now or later.
    void audioEngine.fade(cue.targetCueId, param, cue.targetValue, cue.duration, cue.curve, at)
      .catch(() => {
        // A fade with nothing playing is not an error: the cue still takes its time.
      })
    const endAt = at + cue.duration
    this.planRelease(run, endAt)
    this.track(run, this.scheduler!.schedule({
      at: endAt,
      due: () => {
        if (cue.stopTargetWhenDone) this.stopCue(cue.targetCueId, 0)
        finish(endAt)
      }
    }))
  }

  private executeNetwork(cue: NetworkCue, run: CueRun, finish: Finish): void {
    const requestId = `${cue.id}:${run.seq}`
    run.requestId = requestId
    network.request({
      method: cue.method,
      url: cue.url,
      headers: cue.headers,
      body: cue.method !== 'GET' ? cue.body : undefined,
      timeout: cue.timeout ?? 5000,
      requestId
    })
      .then(result => {
        run.requestId = null
        if (!result.ok) {
          finish(this.now(), { outcome: 'error', error: result.error ?? 'request failed' })
          return
        }
        const detail: Partial<CueRunResult> = {
          status: result.status ?? undefined,
          statusText: result.statusText
        }
        if (result.status !== null && result.status >= 400) {
          detail.outcome = 'error'
          detail.error = `HTTP ${result.status}${result.statusText ? ` ${result.statusText}` : ''}`
        }
        if (result.body) detail.body = result.body
        finish(this.now(), detail)
      })
      .catch(error => {
        run.requestId = null
        finish(this.now(), { outcome: 'error', error: errorMessage(error) })
      })
  }

  /**
   * Whether a cue's silence trim applies: the cue asked for it. Nothing else — a show
   * written with the trim on is the show that plays, on any machine.
   */
  private trimApplies(cue: AudioCue): boolean {
    return cue.trimSilence === true
  }

  /**
   * Releases a vamping cue: the target stops looping and plays out to the end of its
   * file, from wherever the loop had reached. The engine does the work on the audio
   * thread, so the join is a sample rather than a seam; this cue then completes, which
   * is what lets the next cue of a group start over music that is still playing — that
   * is the whole point of a devamp.
   */
  private executeDevamp(cue: DevampCue, finish: Finish): void {
    const label = this.cueLabel(cue)
    if (cue.targetCueId === '') {
      // A devamp pointed at nothing must not be read as "release everything": the cue
      // that is vamping is a decision the operator made, and guessing at it silently is
      // not this cue's business.
      this.log({ level: 'error', message: 'no cue chosen to release', label })
      finish(this.now(), { outcome: 'error', error: 'no cue chosen' })
      return
    }
    const target = this.deps!.getCues().find(c => c.id === cue.targetCueId)
    // Releasing a trimmed cue plays out to where its sound stops. The engine would
    // otherwise play to the end of the file, which for a cue trimmed of its tail is the
    // silence the trim exists to leave out — and the show would wait through it.
    const releaseEndMs = target?.type === 'audio' && this.trimApplies(target as AudioCue)
      ? (target as AudioCue).soundRegion?.endMs
      : undefined
    // Releasing a cue that is not looping is a no-op the engine reports, and that is not
    // an error: the operator's devamp arrived after the vamp had already ended.
    const released = releaseEndMs === undefined
      ? audioEngine.release(cue.targetCueId)
      : audioEngine.release(cue.targetCueId, undefined, releaseEndMs)
    void released.then(result => {
      const detail: Partial<CueRunResult> = {}
      if (!result.applied) {
        detail.outcome = 'error'
        detail.error = target === undefined
          ? 'the cue it releases is not in the show'
          : 'that cue was not looping'
      }
      finish(this.now(), detail)
    }).catch(error => {
      finish(this.now(), { outcome: 'error', error: errorMessage(error) })
    })
  }

  private executeMic(cue: MicCue, finish: Finish): void {
    const label = this.cueLabel(cue)
    const verb = cue.action === 'mute' ? 'muted' : 'unmuted'
    if (cue.channelId === '') {
      // A cue aimed at nothing must do nothing rather than guess which pack was meant.
      this.log({ level: 'error', message: 'no mic chosen', label })
      finish(this.now(), { outcome: 'error', error: 'no mic chosen' })
      return
    }
    void sendMic(cue).then(result => {
      const detail: Partial<CueRunResult> = {}
      if (result.ok) {
        // What it did, under this cue's label: a duration here would say nothing.
        this.log({ level: 'info', message: `${verb} ${cue.label || cue.channelId}`, label })
      } else {
        detail.outcome = 'error'
        detail.error = result.error ?? 'the receiver did not take it'
      }
      finish(this.now(), detail)
    })
  }

  private executeMsc(cue: MscCue, finish: Finish): void {
    // The command goes out as it stands: a console's cue number is the console's, and
    // this app has nothing to check it against. Where it goes is the cue's own choice,
    // and a cue with nowhere to go says why rather than reporting a send.
    void sendMsc(cue).then(result => {
      const detail: Partial<CueRunResult> = {}
      if (!result.ok) {
        detail.outcome = 'error'
        detail.error = result.error ?? 'the command did not go'
      }
      finish(this.now(), detail)
    })
  }

  private executeScene(cue: SceneCue, finish: Finish): void {
    const label = this.cueLabel(cue)
    if (cue.sceneId === '') {
      // A cue pointed at nothing must not be read as "close every mic": that would be
      // a silent, and very loud, surprise in the middle of a show.
      this.log({ level: 'error', message: 'no scene chosen', label })
      finish(this.now(), { outcome: 'error', error: 'no scene chosen' })
      return
    }
    // The recall logs what the desk was told, under this cue's label.
    void recallScene(cue.sceneId, label).then(result => {
      const detail: Partial<CueRunResult> = {}
      if (result.failures.length > 0) {
        detail.outcome = 'error'
        detail.error = result.failures.join(', ')
      }
      finish(this.now(), detail)
    })
  }

  private executeScript(cue: ScriptCue, finish: Finish): void {
    const label = this.cueLabel(cue)

    // Script output is capped per run so a chatty script cannot flood the log.
    let emitted = 0
    const logOutput = (level: 'output' | 'error', message: string): void => {
      if (emitted >= MAX_RUN_LOG_LINES) return
      emitted++
      this.log(emitted === MAX_RUN_LOG_LINES
        ? { level: 'error', message: `output truncated after ${MAX_RUN_LOG_LINES} lines`, label }
        : { level, message, label })
    }

    // The script runs in a worker: a loop that never yields cannot freeze the
    // interface, and STOP/PANIC can terminate it. See scriptHost.ts.
    scriptHost.run({
      cueId: cue.id,
      code: cue.script,
      workspacePath: this.deps!.getWorkspacePath(),
      timeoutMs: cue.timeout,
      onLog: logOutput
    })
      .then(() => finish(this.now()))
      .catch((e: unknown) => {
        // A cancelled run is not a failure, and it is not a completion: STOP has
        // already cleared its state, and nothing may resume from here.
        if (e instanceof ScriptCancelledError) return
        console.error('Script cue error:', e)
        finish(this.now(), { outcome: 'error', error: errorMessage(e) })
      })
  }

  private executeGroup(cue: GroupCue, run: CueRun, at: number, finish: Finish): void {
    const children = this.armedChildren(cue.id)

    if (children.length === 0) { finish(at); return }

    // A group that was stopped finishes nothing: no run result, no post-wait, no advance.
    const stillRunning = (): boolean => !run.cancelled && run.phase !== 'done' && !this.isStale(run.generation)
    const done: Handover = (endMs, _childRun) => {
      if (stillRunning()) finish(endMs)
    }

    if (cue.mode === 'timeline') {
      this.executeGroupTimeline(cue, children, run, at, finish, stillRunning)
    } else if (cue.mode === 'random') {
      this.fireCue(children[Math.floor(Math.random() * children.length)], at, done, run)
    } else if (cue.mode === 'playlist') {
      // One child per GO: fire the child at the cursor and advance it. Wrapping to 0
      // marks the pass complete, which also releases the selection and lets
      // advance=on-end hand over to the next cue.
      const index = (this.playlistCursors.get(cue.id) ?? 0) % children.length
      this.playlistCursors.set(cue.id, (index + 1) % children.length)
      this.fireCue(children[index], at, done, run)
    } else {
      // sequence
      this.runSequence(children, 0, at, done, stillRunning, run)
    }
  }

  private executeGroupTimeline(
    cue: GroupCue,
    children: Cue[],
    run: CueRun,
    at: number,
    finish: Finish,
    stillRunning: () => boolean
  ): void {
    const { setRunning } = this.deps!

    const startOffset = this.groupStartOffsets.get(cue.id) ?? 0
    this.groupStartOffsets.delete(cue.id)
    // The timeline's zero is `startOffset` ms before the moment the group is fired, so
    // a seek lands the children where the cursor says.
    const origin = at - startOffset

    // Correct startedAt so the playhead reflects the seek position
    setRunning(cue.id, { cueId: cue.id, state: 'playing', startedAt: Date.now() - startOffset, progress: 0 })

    type Item =
      | { kind: 'schedule'; child: Cue; atMs: number }
      | { kind: 'seek'; child: Cue; seekOffsetMs: number }

    const now = this.now()
    const items: Item[] = []
    for (const child of children) {
      const childAt = origin + child.timelineOffset
      if (childAt >= now) {
        items.push({ kind: 'schedule', child, atMs: childAt })
      } else {
        const seekOffsetMs = now - childAt
        // Skip if we know the cue has already finished
        if (child.duration > 0 && seekOffsetMs >= child.duration) continue
        // Fire-and-forget types have already happened — don't replay
        if (child.type === 'midi' || child.type === 'osc' || child.type === 'scene' ||
            child.type === 'network' || child.type === 'script' || child.type === 'stop' ||
            child.type === 'devamp' || child.type === 'msc' || child.type === 'mic') continue
        items.push({ kind: 'seek', child, seekOffsetMs })
      }
    }

    if (items.length === 0) { finish(at); return }
    let remaining = items.length
    const childDone: Handover = (endMs, _childRun) => {
      if (!stillRunning()) return
      // A child that was stopped counts down like one that ended: the timeline is not
      // waiting for it any more, and the group settles when its last child has. Nothing
      // is recorded for the stopped child — finishRun refuses a cancelled run.
      remaining--
      if (remaining === 0) finish(endMs)
    }

    for (const item of items) {
      if (item.kind === 'seek') {
        this.fireCue(item.child, now, childDone, run, item.seekOffsetMs)
        continue
      }
      const { child, atMs } = item
      // The child is fired a lookahead before its own time so its commands are in the
      // engine's hands before the moment they name.
      const fireAt = Math.max(now, atMs - SCHEDULER_LOOKAHEAD_MS)
      // The start is registered before it is scheduled, because a time that is already
      // inside the lookahead — a stagger under 100 ms, or a seek that landed on it — is
      // dispatched inside `schedule()`, before the call can return an id. The box is what
      // that dispatch takes out of the set; the id lands in it when there is one to land
      // (`TimelineStart`), so no entry outlives the start it stands for.
      const start: TimelineStart = { id: 0 }
      let tasks = this.timelineTasks.get(child.id)
      if (!tasks) { tasks = new Set(); this.timelineTasks.set(child.id, tasks) }
      tasks.add(start)
      start.id = this.scheduler!.schedule({
        at: fireAt,
        due: () => {
          this.removeTimelineStart(child.id, start)
          if (!stillRunning()) return
          this.fireCue(child, atMs, childDone, run)
        }
      })
    }
  }

  private removeTimelineStart(cueId: string, start: TimelineStart): void {
    const tasks = this.timelineTasks.get(cueId)
    if (!tasks) return
    tasks.delete(start)
    if (tasks.size === 0) this.timelineTasks.delete(cueId)
  }

  private runSequence(
    cues: Cue[],
    index: number,
    at: number,
    onDone: Handover,
    stillRunning: () => boolean,
    parent: CueRun
  ): void {
    if (!stillRunning()) return
    if (index >= cues.length) { onDone(at, parent); return }
    this.fireCue(cues[index], at, (doneAt, childRun) => {
      if (!stillRunning()) return
      // A child that was stopped settles the step the same way one that ended does:
      // the sequence moves on, and only the last child's handover finishes the group.
      // The stopped child records nothing — finishRun refuses a cancelled run — and
      // STOP at the group makes this a no-op, because the group's own run went first.
      this.runSequence(cues, index + 1, doneAt, onDone, stillRunning, childRun)
    }, parent)
  }

  /**
   * Takes one cue's run away: its scheduled work, its script, its audio, and its run
   * state. A handover that was released but has not begun is taken back too, so a
   * stopped cue never moves the show on.
   */
  private stopCue(cueId: string, fadeMs: number, settles = true): void {
    const run = this.runs.get(cueId)
    if (run) this.cancelRun(cueId, run)
    this.cancelTimelineTasks(cueId)
    scriptHost.cancel(cueId)
    void audioEngine.stop(cueId, fadeMs).catch(() => {
      // A cue the engine never knew about has nothing to stop.
    })
    this.deps!.setRunning(cueId, null)
    // A cue taken away mid-group settles its parent's counting the way its own end
    // would have: a sequence steps on to the next child, a timeline counts this one
    // down. Without it the group stays lit with nothing coming and a later GO is
    // refused as a re-fire. A group that was stopped first (STOP, panic, a stop cue
    // aimed at the group) makes each of those a no-op, and a top-level run settles
    // nowhere here: its handover is the go() that moves the show to the next cue, and
    // stopping a cue must not start that one. Re-firing a child is not taking it away —
    // the child is about to run again — so that caller asks for no settling.
    if (settles && run && this.isGroupChild(cueId)) this.settleParent(run)
  }

  /** Whether this cue is a child of a group, so its handover settles a parent. */
  private isGroupChild(cueId: string): boolean {
    return (this.deps!.getCues().find(c => c.id === cueId)?.parentId ?? null) !== null
  }

  /** Takes every start this cue has waiting in a timeline out of the scheduler. */
  private cancelTimelineTasks(cueId: string): void {
    for (const start of this.timelineTasks.get(cueId) ?? []) this.scheduler!.cancel(start.id)
    this.timelineTasks.delete(cueId)
  }

  /**
   * Every start a timeline is still holding, whoever put it there. A cue that has not
   * fired yet is a task and no run, so a walk that only looks at `runs` — "stop
   * everything" and the restart path — would leave those starts to arrive after it.
   */
  private cancelTimelineStarts(): void {
    for (const cueId of [...this.timelineTasks.keys()]) this.cancelTimelineTasks(cueId)
  }

  /** Cancels a run's tasks and takes back a not-yet-begun handover it released. */
  private cancelRun(cueId: string, run: CueRun): void {
    if (run.cancelled) return
    const wasPending = run.phase === 'pending'
    run.cancelled = true
    run.phase = 'done'
    if (wasPending) {
      // Its start may already have gone out within the lookahead; the engine has to be
      // told to drop it, or a cue that was stopped would begin a moment later.
      void audioEngine.cancel(cueId).catch(() => {})
    }
    for (const task of run.tasks) this.scheduler!.cancel(task)
    run.tasks.clear()
    if (run.endTask !== null) { this.scheduler!.cancel(run.endTask); run.endTask = null }
    if (run.releaseTask !== null) { this.scheduler!.cancel(run.releaseTask); run.releaseTask = null }
    if (run.requestId) network.cancel(run.requestId)
    // A timecode cue's clock runs in main, and stops with its run.
    releaseTimecode(cueId)
    if (this.runs.get(cueId) === run) this.runs.delete(cueId)

    const released = run.releasedRun
    run.releasedRun = null
    if (released && released.phase === 'pending') this.cancelRun(released.cueId, released)
  }

  /**
   * A group and everything under it, however deep. The group's own run goes first: a
   * child that ends while the tree is being walked must not be able to carry the group
   * on.
   */
  private stopGroup(group: GroupCue, fadeMs: number): void {
    for (const child of this.deps!.getCues().filter(c => c.parentId === group.id)) {
      this.stopCue(child.id, fadeMs)
      if (child.type === 'group') this.stopGroup(child as GroupCue, fadeMs)
    }
  }

  private executeStop(cue: StopCue, run: CueRun, at: number, finish: Finish): void {
    const fadeMs = cue.fadeOut ? cue.fadeOutDuration : 0
    if (cue.targetCueId === 'all') {
      // Groups first: each run is taken away, and a run that is a group's child settles
      // its parent, so the parent has to be gone before its children are walked or a
      // live group would fire its next step into a stop that was meant to take all.
      const others = [...this.runs].filter(([, other]) => other !== run)
      for (const [cueId, other] of others) {
        if (this.deps!.getCues().find(c => c.id === cueId)?.type === 'group') this.cancelRun(cueId, other)
      }
      for (const [cueId, other] of others) {
        if (this.deps!.getCues().find(c => c.id === cueId)?.type !== 'group') this.cancelRun(cueId, other)
      }
      // A timeline child that has not fired yet is not a run at all: it is a start
      // waiting in the scheduler, and "everything" has to take those too or a stopped
      // group's children begin arriving after the stop — and each of them would hold its
      // cue against a later GO as though it were already on.
      this.cancelTimelineStarts()
      // A script runs in a worker of its own, so stopping the audio cannot reach it:
      // "everything" has to take the scripts the way STOP does.
      scriptHost.cancelAll()
      void audioEngine.stopAll(fadeMs).catch(() => {})
      this.deps!.clearAllRunning()
    } else {
      const target = this.deps!.getCues().find(c => c.id === cue.targetCueId)
      if (target?.type === 'audio') {
        // A stop aimed at one cue takes the sound away; the cue's own run ends as the
        // engine reports it stopped, so a fade is heard and the row goes dark when the
        // sound does. Everything else is taken away here, because nothing else will
        // report: a wait, a fade, a MIDI/OSC send, a network request, a scene, a devamp,
        // an MSC command and a script hold no engine voice to answer for them.
        //
        // A cue that has not begun is the one case where there is no voice to fade: a
        // pre-wait run would otherwise begin after the stop that named it, so it is
        // taken away here with its planned start. A start a timeline is still holding
        // for this cue — a child that has not fired yet — goes the same way, whatever
        // the run beside it is doing: it is a firing that has not happened.
        const pending = this.runs.get(cue.targetCueId)
        this.cancelTimelineTasks(cue.targetCueId)
        if (pending && pending.phase === 'pending') {
          this.stopCue(cue.targetCueId, fadeMs)
        } else {
          void audioEngine.stop(cue.targetCueId, fadeMs).catch(() => {})
        }
      } else if (target === undefined) {
        // No such cue: still tell the engine, which refuses what it never knew.
        void audioEngine.stop(cue.targetCueId, fadeMs).catch(() => {})
      } else if (target.type === 'group') {
        // The group's own run goes first, so its children settling cannot carry it on.
        this.stopCue(target.id, fadeMs)
        this.stopGroup(target as GroupCue, fadeMs)
      } else {
        this.stopCue(target.id, fadeMs)
      }
    }
    // A stop aimed at a cue that is no longer in the show stops nothing, and says so: the
    // cue it named was deleted, and a stop that reported "ok" for it is a cue that looks
    // like it is doing its job on the night it is not. Its timing is what it always was —
    // the show moves on when it would have — only the result differs.
    const targetGone = cue.targetCueId !== 'all' &&
      !this.deps!.getCues().some(c => c.id === cue.targetCueId)
    const done: Finish = targetGone
      ? endMs => finish(endMs, { outcome: 'error', error: 'the cue it stops is not in the show' })
      : finish
    // A wait-for-fade stop keeps the run open until the fade has finished sounding,
    // so the next cue does not start over it.
    if (cue.fadeOut && cue.waitForFade) {
      const endAt = at + cue.fadeOutDuration
      this.scheduleRunEnd(run, endAt, done)
    } else {
      done(at)
    }
  }

  getGroupStartOffset(groupId: string): number {
    return this.groupStartOffsets.get(groupId) ?? 0
  }

  clearGroupStartOffset(groupId: string): void {
    this.groupStartOffsets.delete(groupId)
  }

  seekTimeline(groupId: string, seekMs: number): void {
    this.groupStartOffsets.set(groupId, seekMs)
    const cues = this.deps!.getCues()
    const group = cues.find(c => c.id === groupId)
    if (!group || group.type !== 'group' || (group as GroupCue).mode !== 'timeline') return

    const children = cues.filter(c => c.parentId === groupId)
    if (!this.isGroupPlaying(groupId, children)) return

    // A seek is a re-fire, not a stop: the group is about to run again where the
    // operator pointed, so the sequence above it is owed no step.
    this.stop(groupId, false)
    const { setRunning } = this.deps!
    const groupCue = group as GroupCue
    const now = this.now()
    // Where a fired timeline hands the show on: past the group's children, the way go()
    // reads it — a seeked group is still the group the operator started, and a lost
    // handover leaves the show parked on a group that has finished.
    const nextCue = (() => {
      const idx = cues.findIndex(c => c.id === groupId)
      let i = idx + 1
      while (i < cues.length && cues[i].parentId === groupId) i++
      return cues[i] ?? null
    })()
    // groupStartOffsets already has seekMs — executeGroup() will read + consume it
    const run: CueRun = {
      cueId: groupId,
      seq: ++this.runSeq,
      generation: this.generation,
      startAt: now,
      seekMs: 0,
      postWait: groupCue.postWait,
      endAt: null,
      plannedMs: null,
      rate: 1,
      endTask: null,
      engineRunId: null,
      supersededEngineRunId: null,
      releaseTask: null,
      finish: null,
      handover: null,
      requestId: null,
      tasks: new Set(),
      phase: 'running',
      cancelled: false,
      released: false,
      releasedRun: null,
      beganAt: Date.now()
    }
    this.runs.set(groupId, run)
    const stillRunning = (): boolean => !run.cancelled && !this.isStale(run.generation)
    this.executeGroup(groupCue, run, now, (endMs) => {
      if (!stillRunning()) return
      setRunning(groupId, { cueId: groupId, state: 'post-wait', startedAt: Date.now(), progress: 1 })
      const doneAt = endMs + groupCue.postWait
      // The run stays in `runs` until its post-wait is over, the way a fired group's
      // does: a GO inside those milliseconds is a re-fire of a cue still on its way out.
      this.track(run, this.scheduler!.schedule({
        at: doneAt,
        due: () => {
          run.phase = 'done'
          if (this.runs.get(groupId) === run) this.runs.delete(groupId)
          if (run.cancelled) return
          setRunning(groupId, null)
        }
      }))
      if (groupCue.advance === 'on-end' && nextCue) this.goById(nextCue.id, doneAt, run)
    })
  }

  private isGroupPlaying(groupId: string, children: Cue[]): boolean {
    if (this.runs.has(groupId)) return true
    return children.some(c =>
      this.runs.has(c.id) ||
      (this.timelineTasks.get(c.id)?.size ?? 0) > 0
    )
  }

  private hasActiveRun(cueId: string): boolean {
    return this.runs.has(cueId) || (this.timelineTasks.get(cueId)?.size ?? 0) > 0
  }

  /**
   * Whether this firing may happen, asked by the surfaces that see events the runner
   * does: a show's OSC and MIDI arrive as whole messages, and the note that is being
   * held is only visible here. The operator's own GO asks through `go()` instead, which
   * asks this on the way past.
   */
  acceptsFire(surface: FireSurface, key: string): boolean {
    return this.guard.accepts(surface, key, this.now())
  }

  /** A note going down, so that holding it is not the same as pressing it again. */
  pressNote(key: string): void {
    this.guard.pressNote(key, this.now())
  }

  /** A note coming up. Never gated: a release is not a firing. */
  releaseNote(key: string): void {
    this.guard.releaseNote(key)
  }

  /**
   * Forgets who fired what, and what was down. A show that has just loaded has no history
   * for the guard to be deaf to — the file's own state did not press anything — and a
   * note that was down when the last one ended is a note nobody is holding now.
   */
  resetGuards(): void {
    this.guard.reset()
  }

  // True when a global STOP or PANIC has happened since the given generation started.
  private isStale(generation: number): boolean {
    return generation !== this.generation
  }

  /** No task started before this call may fire afterwards, and no handover survives it. */
  private cancelAllWork(): void {
    this.generation++
    for (const [cueId, run] of [...this.runs]) this.cancelRun(cueId, run)
    this.runs.clear()
    this.scheduler!.cancelAll()
    this.timelineTasks.clear()
    this.playlistCursors.clear()
  }

  stop(cueId?: string, settles = true): void {
    const { clearAllRunning } = this.deps!
    if (cueId) {
      // A group is stopped with its children: leaving them running would be a name that
      // does nothing, and a sequence would keep firing them. The group's own run goes
      // first, so its children settling cannot carry it on. `settles` is the caller's
      // answer to whether this is a cue being taken away or a cue about to run again.
      const cue = this.deps!.getCues().find(c => c.id === cueId)
      this.stopCue(cueId, 0, settles)
      if (cue?.type === 'group') this.stopGroup(cue as GroupCue, 0)
    } else {
      // Every run's cue is stopped individually as well: a start that has already been
      // handed to the engine must be taken back, not just forgotten by the renderer.
      for (const cueId of [...this.runs.keys()]) {
        void audioEngine.stop(cueId, 0).catch(() => {})
      }
      this.cancelAllWork()
      scriptHost.cancelAll()
      void audioEngine.stopAll(0).catch(() => {})
      clearAllRunning()
    }
  }

  /**
   * The show is being replaced — New, Open, the demo, a bundle, a recovered session —
   * and what is running belongs to the show that is leaving. Loading only swaps the list:
   * the store forgets what was running while the engine goes on playing it, so the sound
   * carried on under a transport that said "idle", over a cue list it was not in. This is
   * STOP, said by the load, with a line in the log for a silence nobody pressed for.
   */
  stopForShowChange(): void {
    // A window whose transport has not mounted has started nothing.
    if (!this.deps) return
    if (this.runs.size > 0 || this.timelineTasks.size > 0) {
      this.log({ level: 'info', message: 'stopped what was running: another show was opened' })
    }
    this.stop()
  }

  // PANIC is the one place that wants the tails: stop() cuts immediately, panic counts
  // down with a fixed fade so the cut does not click. It must not call stop() first —
  // that would silence every source before the fade could be scheduled.
  panic(): void {
    this.cancelAllWork()
    scriptHost.cancelAll()
    void audioEngine.panic(PANIC_FADE_MS).catch(() => {})
    this.deps!.clearAllRunning()
    // The stuck control is what an operator reaches for PANIC to fix: a pad whose
    // note-off never came is not a note anybody is holding, and leaving it held would
    // keep that trigger dead for the rest of the night.
    this.guard.reset()
  }

  /**
   * The show has moved to the other machine of a pair: it claimed the show under a higher
   * term, and it is playing what this machine was playing. This machine stops being the
   * sound — with the same short fade a panic cuts with, because the machine that took the
   * show over is already inside the same cue and a hard cut would be a click on top of
   * the two of them. Nothing here advances the show: the cue the next GO would fire is
   * the other machine's to fire now.
   */
  standDown(): void {
    if (!this.deps) return
    this.cancelAllWork()
    scriptHost.cancelAll()
    void audioEngine.stopAll(PANIC_FADE_MS).catch(() => {})
    this.deps.clearAllRunning()
  }

  /**
   * A panic that happened in the main process — the menu, OSC, a MIDI all-sound-off,
   * the heartbeat — has already silenced the engine. The renderer's half is to take
   * back everything it was still holding and to say so, without panicking again.
   */
  handleExternalPanic(): void {
    this.cancelAllWork()
    scriptHost.cancelAll()
    this.deps!.clearAllRunning()
  }

  /**
   * A live change from the inspector: the engine hears it at once, and a rate change
   * re-times the run's planned end so the cue after it still starts on the beat.
   */
  setLiveParameter(cueId: string, param: AudioFadeParam, value: number): void {
    void audioEngine.fade(cueId, param, value, 0, 'linear').catch(() => {
      // Nothing playing has nothing to change.
    })

    const run = this.runs.get(cueId)
    if (param !== 'rate' || !run || run.endAt === null || run.plannedMs === null || !run.finish) return

    const now = this.now()
    const remainingMs = Math.max(0, run.endAt - now)
    const from = run.rate > 0 ? run.rate : 1
    const to = value > 0 ? value : 1
    const remainingAtNewRate = remainingMs * (from / to)
    run.endAt = now + remainingAtNewRate
    run.plannedMs = (now - run.startAt) + remainingAtNewRate
    run.rate = to
    if (run.releaseTask !== null && !run.released) {
      this.scheduler!.cancel(run.releaseTask)
      run.releaseTask = null
    }
    this.armAudioEndTask(run, run.finish)
    this.planRelease(run, run.endAt)
  }

  /**
   * A routing change on a cue that is already playing. The engine replaces a running
   * voice's matrix where it stands, so the routing the store now holds reaches the sound
   * without the cue moving: no restart, no re-seek, and nothing about the run's timing
   * changes with it.
   */
  setLiveRouting(cueId: string): void {
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || run.phase !== 'running') return
    const cue = this.deps!.getCues().find(c => c.id === cueId)
    if (!cue || cue.type !== 'audio') return
    void audioEngine.routing(cueId, (cue as AudioCue).outputs).catch(() => {
      // A cue with no voice has no matrix to replace.
    })
  }

  /**
   * Drops a running audio cue's playhead at `positionMs` in the file. The run keeps its
   * identity — this is the same firing, moved — so the engine moves the position without
   * touching the envelope: no fade-in over the position the operator chose, and no
   * volume/pan/trim reset. A one-shot run's end is re-planned from where it now is; a
   * looped run's is the engine's to report.
   */
  seekCue(cueId: string, positionMs: number): void {
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || run.phase !== 'running' || !run.finish) return
    const cue = this.deps!.getCues().find(c => c.id === cueId)
    if (!cue || cue.type !== 'audio') return

    const audioCue = cue as AudioCue
    void audioEngine.seek(cueId, positionMs)
      .then(result => {
        if (run.cancelled || run.phase !== 'running' || !run.finish) return
        run.seekMs = Math.max(0, positionMs - audioCue.startTime)
        this.deps!.setRunning(cueId, {
          cueId,
          state: 'playing',
          startedAt: Date.now() - run.seekMs,
          progress: 0
        })

        const options: AudioStartOptions = {
          ...startOptions(audioCue, 0, this.trimApplies(audioCue)),
          // The operator pointed at a place in the file; that is where it plays from,
          // even if the trim would have started the cue later.
          startTime: positionMs
        }
        const planned = audioCue.loopCount === 0 && audioCue.duration > 0
          ? plannedPlaybackMs(options, audioCue.duration)
          : null
        if (run.endTask !== null) { this.scheduler!.cancel(run.endTask); run.endTask = null }
        if (planned === null) {
          // The engine's ended event has to close this run.
          run.endAt = null
          run.plannedMs = null
          return
        }
        if (!run.released && run.releaseTask !== null) {
          // The handover has not gone out yet, so it is re-planned from the new end.
          this.scheduler!.cancel(run.releaseTask)
          run.releaseTask = null
        }
        run.startAt = result.at
        run.endAt = result.at + planned
        run.plannedMs = planned
        this.armAudioEndTask(run, run.finish)
        this.planRelease(run, run.endAt)
      })
      .catch(error => {
        if (run.cancelled || !run.finish) return
        console.error('Audio seek failed:', error)
        run.finish(this.now(), { outcome: 'error', error: errorMessage(error) })
      })
  }

  /**
   * The engine process was replaced. Nothing is re-timed here: every time the show
   * holds is in show time, and the client kept that clock continuous across the change,
   * so a wait cue mid-count keeps the rest of its time and a cue scheduled for later is
   * still due at the time it named. What the operator must have is the explanation —
   * the engine's own fault line says it died, and this one says the show carried on.
   */
  private handleSessionChange(change: AudioEngineSessionChange): void {
    this.log({
      level: 'error',
      message: `audio engine restarted (session ${change.sessionId}); the show clock carried on`
    })
  }

  /**
   * What the engine says happened. Its words win over the plan when the two disagree:
   * a run that ended early is closed where the engine reports, and its handover
   * happens from there. A run the engine stopped was taken away on purpose, so it
   * records nothing and advances nothing.
   */
  private handleEngineEvent(event: AudioEngineEvent): void {
    // Recognition before any run bookkeeping: a type the wire declaration does not name
    // is not this projection's to interpret, and it must never be read as a cue's natural
    // end — an unrecognised line that happens to carry a running cue's id would otherwise
    // close it, turning "I do not understand this" into "the cue ended". It is reported
    // instead, with how often it has arrived.
    if (declaredEventFields(event.type) === null) {
      this.reportUnrecognisedEngineEvent(event.type)
      return
    }
    if (event.type === 'panic') {
      this.handleExternalPanic()
      return
    }
    if (event.type === 'state') return
    if (event.type === 'error' && event.cueId === null) {
      // An engine-wide fault (device loss, engine crash) has no cue to blame, and this
      // line is the operator's: the engine's own words, and nothing more. The release is
      // not its to take. A loss ends every voice it lost `device-lost`, so the run is
      // closed by the `ended` line that names that cue and records `audio device lost`,
      // and the panic the engine queues behind those lines clears what is left — the
      // post-wait runs and any handover they had scheduled. Taking the release here as
      // well would cancel every run before its own fault line could be acted on, which
      // is exactly the per-cue handling the loss exists to reach.
      this.log({ level: 'error', message: `audio engine: ${event.message}` })
      return
    }

    const cueId = event.cueId
    if (!cueId) return
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || run.phase !== 'running' || !run.finish) return
    // A run that was replaced has a new engine identity; its old events are not ours.
    // A line that names neither is not about any run in particular and is left alone.
    // A replaced run's `ended`, batched 16 ms, can arrive after the new firing: it
    // names the superseded identity and must not close the run that replaced it.
    if (event.runId && run.engineRunId && event.runId !== run.engineRunId) return
    if (event.runId && run.supersededEngineRunId && event.runId === run.supersededEngineRunId) return
    if (event.type === 'error') {
      console.error('Audio playback failed:', event.message)
      run.finish(this.now(), { outcome: 'error', error: event.message })
      return
    }

    if (event.reason === 'stopped' || event.reason === 'cancelled' || event.reason === 'replaced') {
      // The engine took this voice away: the run goes, and if it was a group's child its
      // stopping settles the group the way its own end would have. finishRun would refuse
      // a cancelled run — and must, so a stopped cue records no completion.
      this.cancelRun(cueId, run)
      this.deps!.setRunning(cueId, null)
      if (this.isGroupChild(cueId)) this.settleParent(run)
      return
    }
    if (event.reason === 'error' || event.reason === 'device-lost') {
      const failure = event.reason === 'device-lost' ? 'audio device lost' : 'playback failed'
      console.error('Audio playback failed:', failure)
      run.finish(this.now(), { outcome: 'error', error: failure })
      return
    }
    const now = this.now()
    if (run.endAt !== null && now >= run.endAt - PLANNED_END_TOLERANCE_MS) return
    run.finish(now)
  }

  /**
   * A type the declaration does not name, logged with how many times it has arrived: the
   * first as written, a repeat with its count, so the operator sees the climb rather than
   * a wall of copies. The run bookkeeping above never touches it, and the names whose
   * count is kept are bounded — past the cap a new name is still logged, naming it, but
   * reports as a one-off each time.
   *
   * A type that is not a string is named as the value that arrived — `7`, `'7'` and `null`
   * are three different types with three different counts — and only an event with no type
   * at all reads as such.
   */
  private reportUnrecognisedEngineEvent(type: unknown): void {
    const absent = type === undefined
    const name = absent ? 'none' : JSON.stringify(type) ?? String(type)
    const seen = this.unrecognisedEngineEvents.get(name) ?? 0
    if (seen > 0 || this.unrecognisedEngineEvents.size < MAX_UNRECOGNISED_EVENT_TYPES) {
      this.unrecognisedEngineEvents.set(name, seen + 1)
    }
    const repeat = seen > 0 ? ` (×${seen + 1})` : ''
    const what = absent
      ? 'an event with no type'
      : `an unrecognised event type ${typeof type === 'string' ? `'${type}'` : name}`
    this.log({ level: 'error', message: `audio engine sent ${what}${repeat}` })
  }
}

export const cueEngine = new CueEngine()
