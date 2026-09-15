import type {
  Cue, AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, ScriptCue, SceneCue, NetworkCue, DevampCue,
  MscCue
} from '../types/cue'
import { audioEngine } from './audioEngineClient'
import type {
  AudioEngineEvent,
  AudioEngineSessionChange,
  AudioFadeParam,
  AudioStartOptions
} from './audioEngineClient'
import { SampleScheduler, SCHEDULER_LOOKAHEAD_MS } from './scheduler'
import { InputGuard, refirePolicy } from './inputGuard'
import type { FireSurface } from './inputGuard'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import { recallScene } from './scenes'
import { sendMsc } from './showControl'
import { network } from './networkClient'
import { playRegion } from '../utils/silenceTrim'
import type { RunningCue, CueRunResult, LogEntryInput } from '../store'
import type { TriggerGuardSettings } from '../types/workspace'
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
  /** The task that releases the handover, kept so a seek can re-time it. */
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

export class CueRunner {
  private deps: RunnerDeps | null = null
  private scheduler: SampleScheduler | null = null
  private unsubscribeEvents: (() => void) | null = null
  private unsubscribeSession: (() => void) | null = null
  private runs = new Map<string, CueRun>()
  // Starts scheduled at a timeline offset, kept per child so stopping the child (or the
  // group above it) takes the pending start away before it fires.
  private timelineTasks = new Map<string, Set<number>>()
  private groupStartOffsets = new Map<string, number>()
  // Playlist groups step one child per GO. The cursor holds the index of the child the
  // next GO will fire; 0 means a pass is complete or has not started.
  private playlistCursors = new Map<string, number>()
  // Bumped by a global STOP or PANIC. Every continuation captures the generation it
  // was started under and does nothing once it is stale, so work that settles after
  // STOP — a network request, a script — cannot resume the show.
  private generation = 0
  private runSeq = 0
  // Cues whose silence trim was skipped for want of a licence, so a walk-in playlist
  // says it once per cue rather than once per GO.
  private trimNotices = new Set<string>()
  // What each firing surface last fired, and which notes are still down. Owned here
  // because this is the one place every surface reaches — the keyboard, a trigger, the
  // GO button — and a guard that lived in one of them would be a guard on one of them.
  private guard = new InputGuard(() => this.deps?.getTriggerGuard().windowMs ?? 0)

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

    const targetIdx = selectedId ? cues.findIndex(c => c.id === selectedId) : 0
    if (targetIdx < 0) return

    const cue = cues[targetIdx]
    if (!cue || !cue.isArmed) return

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
    const selectionTarget = steppingPlaylist
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
    setSelected(selectionTarget?.id ?? null)

    // Firing a cue that is already in flight replaces it rather than stacking a second
    // copy of it on the same cue id — which is what a cue set to restart is asking for.
    if (this.hasActiveRun(cue.id)) this.stop(cue.id)

    const startMs = this.now()
    this.fireCue(cue, startMs, (doneAt, run) => {
      // A playlist group mid-pass is not finished, so it must not hand over yet
      if (cue.advance === 'on-end' && nextCue && !this.isMidPlaylist(cue.id)) {
        this.goById(nextCue.id, doneAt, run)
      }
    })

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
    const nextCue = cues[idx + 1] ?? null
    this.fireCue(cue, atMs ?? this.now(), (doneAt, run) => {
      if (cue.advance === 'on-end' && nextCue) {
        this.goById(nextCue.id, doneAt, run)
      }
    }, parent)
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
    adopted = false
  ): void {
    const generation = this.generation

    // A cue fired while it is already in flight replaces its previous run.
    if (this.runs.has(cue.id)) this.stopCue(cue.id, 0)

    const run: CueRun = {
      cueId: cue.id,
      seq: ++this.runSeq,
      generation,
      startAt: adopted ? startMs : startMs + cue.preWait,
      seekMs,
      postWait: cue.postWait,
      endAt: null,
      plannedMs: null,
      rate: cue.type === 'audio' ? (cue as AudioCue).playbackRate : 1,
      endTask: null,
      engineRunId: null,
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
    } else if (cue.type !== 'scene') {
      // A scene recall writes its own line — what the desk was told — so a duration
      // here would only say the same thing twice.
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

  private track(run: CueRun, taskId: number): void {
    run.tasks.add(taskId)
  }

  /** Schedules a run's end at a time the clock can predict, handover included. */
  private scheduleRunEnd(run: CueRun, endMs: number, finish: Finish): void {
    this.planRelease(run, endMs)
    this.track(run, this.scheduler!.schedule({ at: endMs, due: () => finish(endMs) }))
  }

  private execute(cue: Cue, run: CueRun, at: number, finish: Finish): void {
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
      case 'script':
        this.executeScript(cue as ScriptCue, finish)
        break
    }
  }

  /**
   * Sends an audio cue's start to the engine with its absolute time, and arms the run's
   * end when the plan can say when that is.
   */
  private planAudio(cue: AudioCue, run: CueRun, at: number, finish: Finish): void {
    if (!cue.filePath) {
      // A cue with no file plays nothing. It still takes its time in the sequence,
      // rather than holding the show open forever.
      this.track(run, this.scheduler!.schedule({ at, due: () => finish(at) }))
      return
    }

    const options = startOptions(cue, run.seekMs, this.trimAtFire(cue))
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
    window.winslab.midi.send({
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
    window.winslab.osc.send({ host: cue.host, port: cue.port, address: cue.address, args: cue.args })
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
   * Whether a cue's silence trim applies right now: the cue asked for it and this machine
   * may apply it. A show written on a licensed machine opens on an unlicensed one with
   * its cues intact and its trims unattended — the cue plays its whole region, which is
   * what the cue did before the trim existed.
   */
  private trimApplies(cue: AudioCue): boolean {
    return cue.trimSilence === true && this.deps!.isPro()
  }

  /** The trim as a cue's own firing sees it, which is also where a lapsed licence is said. */
  private trimAtFire(cue: AudioCue): boolean {
    if (this.trimApplies(cue)) return true
    if (cue.trimSilence !== true) return false
    if (!this.trimNotices.has(cue.id)) {
      // Once per cue: a log line per firing would bury the show it is describing, and the
      // cue's own panel already carries the lock.
      this.trimNotices.add(cue.id)
      this.log({
        level: 'info',
        message: 'silence trim needs WinsLab Pro — playing the whole region',
        label: this.cueLabel(cue)
      })
    }
    return false
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
    if (!this.deps!.isPro()) {
      // The cue stays in the file — a show written on a licensed machine opens on an
      // unlicensed one, and nothing is thrown away — but the desk is not driven
      // without a license, and a cue that did nothing quietly would be worse.
      this.log({ level: 'error', message: 'scene cues need WinsLab Pro', label })
      finish(this.now(), { outcome: 'error', error: 'WinsLab Pro is required' })
      return
    }
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
            child.type === 'devamp' || child.type === 'msc') continue
        items.push({ kind: 'seek', child, seekOffsetMs })
      }
    }

    if (items.length === 0) { finish(at); return }
    let remaining = items.length
    const childDone: Handover = (endMs) => {
      if (!stillRunning()) return
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
      let task = 0
      task = this.scheduler!.schedule({
        at: fireAt,
        due: () => {
          this.removeTimelineTask(child.id, task)
          if (!stillRunning()) return
          this.fireCue(child, atMs, childDone, run)
        }
      })
      let tasks = this.timelineTasks.get(child.id)
      if (!tasks) { tasks = new Set(); this.timelineTasks.set(child.id, tasks) }
      tasks.add(task)
    }
  }

  private removeTimelineTask(cueId: string, task: number): void {
    const tasks = this.timelineTasks.get(cueId)
    if (!tasks) return
    tasks.delete(task)
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
      // The child that just ended is the one a STOP must take the next child back from.
      this.runSequence(cues, index + 1, doneAt, onDone, stillRunning, childRun)
    }, parent)
  }

  /**
   * Takes one cue's run away: its scheduled work, its script, its audio, and its run
   * state. A handover that was released but has not begun is taken back too, so a
   * stopped cue never moves the show on.
   */
  private stopCue(cueId: string, fadeMs: number): void {
    const run = this.runs.get(cueId)
    if (run) this.cancelRun(cueId, run)
    for (const task of this.timelineTasks.get(cueId) ?? []) this.scheduler!.cancel(task)
    this.timelineTasks.delete(cueId)
    scriptHost.cancel(cueId)
    void audioEngine.stop(cueId, fadeMs).catch(() => {
      // A cue the engine never knew about has nothing to stop.
    })
    this.deps!.setRunning(cueId, null)
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
      for (const [cueId, other] of [...this.runs]) {
        if (other === run) continue
        this.cancelRun(cueId, other)
      }
      // A script runs in a worker of its own, so stopping the audio cannot reach it:
      // "everything" has to take the scripts the way STOP does.
      scriptHost.cancelAll()
      void audioEngine.stopAll(fadeMs).catch(() => {})
      this.deps!.clearAllRunning()
    } else {
      const target = this.deps!.getCues().find(c => c.id === cue.targetCueId)
      if (target?.type === 'group') {
        this.stopGroup(target as GroupCue, fadeMs)
        this.stopCue(target.id, fadeMs)
      } else {
        // A stop aimed at one cue takes the sound away; the cue's own run ends as the
        // engine reports it stopped, so a fade is heard and the row goes dark when the
        // sound does. A script has no such report, so it is taken away here.
        void audioEngine.stop(cue.targetCueId, fadeMs).catch(() => {})
        if (target?.type === 'script') {
          scriptHost.cancel(target.id)
          this.deps!.setRunning(target.id, null)
        }
      }
    }
    // A wait-for-fade stop keeps the run open until the fade has finished sounding,
    // so the next cue does not start over it.
    if (cue.fadeOut && cue.waitForFade) {
      const endAt = at + cue.fadeOutDuration
      this.scheduleRunEnd(run, endAt, finish)
    } else {
      finish(at)
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

    this.stop(groupId)
    const { setRunning } = this.deps!
    const groupCue = group as GroupCue
    const now = this.now()
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
      if (this.runs.get(groupId) === run) this.runs.delete(groupId)
      setRunning(groupId, { cueId: groupId, state: 'post-wait', startedAt: Date.now(), progress: 1 })
      this.track(run, this.scheduler!.schedule({
        at: endMs + groupCue.postWait,
        due: () => {
          if (run.cancelled) return
          setRunning(groupId, null)
        }
      }))
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

  stop(cueId?: string): void {
    const { clearAllRunning } = this.deps!
    if (cueId) {
      // A group is stopped with its children: leaving them running would be a name that
      // does nothing, and a sequence would keep firing them.
      const cue = this.deps!.getCues().find(c => c.id === cueId)
      if (cue?.type === 'group') this.stopGroup(cue as GroupCue, 0)
      this.stopCue(cueId, 0)
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
   * A routing change on a cue that is already playing. The engine takes its routing
   * with the start command, so the run is put back down at the position it had reached,
   * with the routing the store now holds — it does not start over from its start time.
   */
  setLiveRouting(cueId: string): void {
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || run.phase !== 'running') return
    const position = audioEngine.getProgress(cueId)?.elapsedMs
    if (position === undefined || position === null) return
    this.seekCue(cueId, position)
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
    if (event.type === 'panic') {
      this.handleExternalPanic()
      return
    }
    if (event.type === 'state') return
    if (event.type === 'error' && event.cueId === null) {
      // An engine-wide fault (device loss, engine crash) has no cue to blame.
      this.log({ level: 'error', message: `audio engine: ${event.message}` })
      // A device fault is the engine already letting go of the sound: it panics what it
      // was playing the moment the device goes. Its per-voice `ended` lines follow a
      // couple of seconds later, because it waits for the audio thread to acknowledge
      // that panic — and until they arrive every row would still read as playing, with
      // the next GO on one of them refused as a repeat of a cue that is no longer making
      // a sound. So the release the engine's `panic` line brings is taken here, with the
      // fault, rather than when the silence finally gets reported.
      if (event.code === 'device') this.handleExternalPanic()
      return
    }

    const cueId = event.cueId
    if (!cueId) return
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || run.phase !== 'running' || !run.finish) return
    // A run that was replaced has a new engine identity; its old events are not ours.
    if (event.runId && run.engineRunId && event.runId !== run.engineRunId) return

    if (event.type === 'error') {
      console.error('Audio playback failed:', event.message)
      run.finish(this.now(), { outcome: 'error', error: event.message })
      return
    }

    if (event.reason === 'stopped' || event.reason === 'cancelled' || event.reason === 'replaced') {
      this.cancelRun(cueId, run)
      this.deps!.setRunning(cueId, null)
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
}

export const cueRunner = new CueRunner()
