import type {
  Cue, AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, ScriptCue, SceneCue, NetworkCue, DevampCue,
  MscCue,
  MicCue,
  LightCue,
  TimecodeCue,
  ControlCue,
  OscPatch,
  InputCue
} from '../../../shared/cue'
import { fadeTargetIds, oscDestination, oscMessages, STOP_ALL, stopTargetIds } from '../../../shared/cueTargets'
import { fadeRoutes, stopOrder } from './targets'
import type { MidiFileCue } from '../../../shared/cue'
import { isProCueType } from '../../../shared/cue'
import type { PictureSettings, VideoCue, VideoOutput, VisualCue } from '../../../shared/visual'
import { isVisualCue } from '../../../shared/visual'
import { cameraSourceProblem } from '../../../shared/camera'
import { visualCues, type VisualHost } from './visualCues'
import { picturesTakenByGo } from './stopOnNextGo'
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
import { ShuffleBag } from './shuffleBag'
import type { FireSurface } from './inputGuard'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import { recallScene } from './scenes'
import { sendMsc } from './showControl'
import { sendMic } from './mic'
import {
  NO_MIDI_FILE_SELECTED,
  pauseMidiFile as holdMidiFile,
  playMidiFile,
  resumeMidiFile as releaseHeldMidiFile,
  seekMidiFile,
  stopMidiFile
} from './midiFile'
import { goLight, isLightCue, levelLight, panicLights, releaseLight, stopLight, stopLightsAmong } from './lighting'
import {
  controlTimecode,
  releaseTimecode,
  startTimecode,
  timecodeLengthMs,
  timecodeRequest,
  timecodeRunning,
  watchTimecodeEnd
} from './timecodeCue'
import { network } from './networkClient'
import { playRegion } from '../utils/silenceTrim'
import type { RunningCue, CueRunResult, LogEntryInput } from '../store'
import type { TriggerGuardSettings } from '../../../shared/workspace'
import type { TakeoverPlan } from '../../../shared/redundancy'
import { slicedLengthMs, slicePieces, slicesInUse } from '../../../shared/slices'
import { engineShapeOf } from '../../../shared/fadeShape'
import { patchSlotOf } from './audioRouting'
import { listArmed, listOfCue, MAIN_CUE_LIST_ID, type CueListInfo } from '../../../shared/cueLists'
import { idsInList, sequenceOf } from './cueListScope'

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

// A second STOP this long after a faded one's fade has ended still reads as the second press
// of a double press: a hand that pressed twice is not timing the fade.
const DOUBLE_STOP_GRACE_MS = 500

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
  if (options.slices && options.slices.length > 0) {
    // The last slice of a region that runs to the end of the file ends where the file does.
    const pieces = options.slices.map(piece => ({ ...piece, endTime: Math.min(piece.endTime, durationMs) }))
    if (pieces.some(piece => piece.endTime <= piece.startTime)) return null
    const sliced = slicedLengthMs(pieces, options.rate)
    if (sliced === null) return null
    // A start part-way in (a seek, a timeline) skips what lies before it.
    return Math.max(0, sliced - Math.max(0, options.startTime - pieces[0].startTime) / (options.rate > 0 ? options.rate : 1))
  }
  if (options.loopCount < 0) return null
  const segmentMs = (options.endTime ?? durationMs) - options.startTime
  if (segmentMs <= 0) return null
  const rate = options.rate > 0 ? options.rate : 1
  return (segmentMs * (options.loopCount + 1)) / rate
}

/** The engine options a cue plays with, offset into the file for a seek. */
export function startOptions(cue: AudioCue, seekMs = 0, trim = false): AudioStartOptions {
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
    outputs: cue.outputs,
    ...soundExtras(cue, played.startMs, played.endMs)
  }
}

/** A drawn shape as the trailing argument of a fade, or nothing at all when there is none. */
function shapeArg(shape: number[] | null | undefined): [number[]] | [] {
  return shape ? [shape] : []
}

/** Where a region with no end of its own ends, for a slice: past any file, which the engine clamps. */
const OPEN_END_MS = 1e12

/**
 * What a sounding cue carries beyond its region and level: the patch it plays through, its
 * fade-in's drawn shape and its slices — each only when the cue has it, so a cue without
 * them sends the start it always sent.
 */
function soundExtras(
  cue: Pick<AudioCue, 'outputPatchId' | 'fadeInShape' | 'slices'>, regionStartMs = 0, regionEndMs: number | null = null
): Partial<AudioStartOptions> {
  const extras: Partial<AudioStartOptions> = {}
  const patch = patchSlotOf(cue.outputPatchId)
  if (patch >= 0) extras.patch = patch
  const fadeInShape = engineShapeOf(cue.fadeInShape)
  if (fadeInShape) extras.fadeInShape = fadeInShape
  if (slicesInUse(cue.slices)) extras.slices = slicePieces(cue.slices, regionStartMs, regionEndMs ?? OPEN_END_MS)
  return extras
}

/** A live input's start: its level, routing, patch and fade-in, as a file voice's would be. */
function inputStartOptions(cue: InputCue): Partial<AudioStartOptions> {
  return {
    volume: cue.volume,
    pan: cue.pan,
    trim: 1,
    fadeInDuration: cue.fadeInDuration,
    outputs: cue.outputs,
    ...soundExtras({ outputPatchId: cue.outputPatchId, fadeInShape: cue.fadeInShape, slices: null })
  }
}

/**
 * The sound of a video cue, as the audio voice it plays as: the same region, loops, level,
 * pan and routing, under the video cue's own id — so a fade, a stop, the routing matrix and
 * the meters treat it exactly as they treat an audio cue's.
 */
export function videoSound(cue: VideoCue): AudioCue {
  return {
    ...cue,
    type: 'audio',
    startTime: cue.startTime,
    endTime: cue.endTime,
    fadeInDuration: cue.fadeInDuration,
    volume: cue.volume,
    pan: cue.pan,
    outputs: cue.outputs,
    loopCount: cue.loopCount,
    playbackRate: 1,
    trim: 1,
    trimSilence: false,
    soundRegion: null,
    outputPatchId: cue.outputPatchId ?? null,
    fadeInShape: cue.fadeInShape ?? null,
    fadeOutShape: cue.fadeOutShape ?? null,
    slices: null
  } as unknown as AudioCue
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
  /** A video whose file has no sound: its run ends with its picture, not with a voice. */
  silentPicture?: boolean
  /** The task that fades a video's sound out onto its end, so a re-planned end can move it. */
  soundFadeTask?: number | null
  /** An audio cue's fade to silence before its end, and the level it fades from; null for none. */
  fadeOut?: { ms: number; volume: number; shape?: number[] | null } | null
  /** The task that sends that fade, while it has not gone out. */
  fadeOutTask?: number | null
  /** Whether the fade has gone to the engine, so a re-planned end knows to undo it first. */
  fadeOutSent?: boolean
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
  // What the rows are showing for each running cue, so a pause can say "paused" there and
  // a resume can put back what it said. Optional: a runner without it still holds the show,
  // and only the rows do not change.
  getRunning?: () => ReadonlyMap<string, RunningCue>
  // The show's cue lists, the one on screen, and each list's own playhead. Optional: a runner
  // without them runs one list, the way every show did before there were several.
  getCueLists?: () => CueListInfo[]
  getActiveListId?: () => string
  getListPlayhead?: (listId: string) => string | null
  setListPlayhead?: (listId: string, cueId: string | null) => void
  // The show's OSC patches, read per send: a patch edited while the show is loaded is where
  // the next message goes. Optional: a runner without it sends every message to its own host.
  getOscPatches?: () => OscPatch[]
  // Arms or disarms cues, as an edit of the show: what a Control cue's arm and disarm do.
  // Optional: a runner without it says so in the log rather than half-arming anything.
  setArmed?: (cueIds: string[], armed: boolean) => void
  // What the show says about its pictures — whether the next GO takes them down — and the
  // outputs they are on, which a crossfade's targets are read against. Optional: a runner
  // without them takes nothing down on a GO but the pictures that say so themselves.
  getPictureSettings?: () => PictureSettings
  getVideoOutputs?: () => readonly VideoOutput[]
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
  /**
   * The show held whole — every running sound held where it stands, and the show clock with
   * it — or null while it runs. `wallAt` is the window's clock at the hold, for the rows'
   * own counters, which read the window's clock rather than the show's.
   */
  private held: { wallAt: number; cueIds: string[]; rows: Map<string, RunningCue> } | null = null
  /** When the operator's last faded STOP began, and its fade, while a second press can cut it. */
  private softStopAt: number | null = null
  private softStopFadeMs = 0
  /** What each random group has left to draw before it repeats a child. */
  private randomDraws = new ShuffleBag()
  /** Audio cues held on their own, while the rest of the show goes on, by cue id. */
  private pausedCues = new Map<string, { at: number; wallAt: number; row: RunningCue | null }>()
  /**
   * Cues a Control cue's Load has readied to start part-way in, by cue id: how far in, ms. The
   * next firing starts there and forgets it; a Reset forgets it without firing.
   */
  private loadedAt = new Map<string, number>()

  init(deps: RunnerDeps): void {
    this.deps = deps
    if (this.scheduler) return
    // One scheduler for the life of the runner: every cue's times are on the engine's
    // sample clock, watched on a 25 ms tick with a lookahead so commands go out before
    // the moment they name.
    this.scheduler = new SampleScheduler(() => audioEngine.nowMs(), cb => audioEngine.onTick(cb))
    this.unsubscribeEvents = audioEngine.onEvent(event => this.handleEngineEvent(event))
    this.unsubscribeSession = audioEngine.onSessionChange(change => this.handleSessionChange(change))
    visualCues.init(this.visualHost())
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

  /**
   * GO: fires the cue a list's playhead is on and moves the playhead past it. With no list
   * named it is the list on screen, whose playhead is the selection; a remote may name another
   * list, whose place moves without that list coming to the front.
   */
  go(listId?: string): void {
    const { getCues } = this.deps!
    const { get: getSelected, set: setSelected } = this.playheadOf(listId)
    const selectedId = getSelected()
    // One list's running order: the cue after a list's last cue is nothing, never the first cue
    // of another list that happens to sit behind it in the show.
    const cues = sequenceOf(getCues(), selectedId)

    // Nothing selected fires nothing. It used to fire the first cue of the show, and the
    // selection is empty exactly once in every performance: after the last cue. One more
    // press there — a hand resting on Space as the house lights come up — started the
    // walk-in again over the bows. A show that has just been opened is standing on its
    // first cue, so the top of the show is still one press away where it should be.
    if (!selectedId) return
    if (this.refuseWhileHeld()) return
    const standingIdx = cues.findIndex(c => c.id === selectedId)
    if (standingIdx < 0) return
    if (!this.listFires(cues[standingIdx].id)) return

    // A disarmed cue is skipped, not stood on: the press fires the next armed cue after
    // it. Returning here instead fired nothing and left the selection where it was, so
    // every later GO landed on the same disarmed cue — under a bar that said "GO skips it".
    const cue = this.nextArmed(cues, standingIdx)
    if (!cue) return
    const targetIdx = cues.indexOf(cue)

    // The hand that shook. Every way of firing a cue reaches the runner, so the window
    // is asked here rather than at each of them — and Space, which the OS repeats while
    // it is held down, is exactly what it is for. Each list's GO is a press of its own: a GO
    // on the cart straight after one on the main list is two lists being run, not a bounce.
    const pressed = listId ?? this.deps!.getActiveListId?.() ?? MAIN_CUE_LIST_ID
    if (!this.guard.accepts('key', pressed === MAIN_CUE_LIST_ID ? 'go' : `go:${pressed}`, this.now())) return

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
    this.takeDownOnGo(cue)

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
    const cues = sequenceOf(getCues(), id)
    const cue = cues.find(c => c.id === id)
    if (!cue || !cue.isArmed) return
    // A press into a list that has been taken out of the show fires nothing; the show's own
    // handovers inside a list never started one.
    if (atMs === undefined && !this.listFires(id)) return
    // A press — a trigger, a desk button, a remote — waits for the show to be let go; the
    // show's own handovers are on the held clock and come due when it runs again.
    if (atMs === undefined && this.refuseWhileHeld()) return
    if (atMs === undefined && this.hasActiveRun(cue.id) && refirePolicy(cue) === 'ignore') return
    // A press from a trigger or a desk is a GO like the button's: what goes on the next GO goes.
    if (atMs === undefined) this.takeDownOnGo(cue)
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
    const cues = sequenceOf(this.deps.getCues(), cueId)
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

  /** A list's playhead, read and moved: the selection for the list on screen, or another list's own. */
  private playheadOf(listId: string | undefined): { get: () => string | null; set: (id: string | null) => void } {
    const deps = this.deps!
    const active = deps.getActiveListId?.()
    if (listId === undefined || listId === active || !deps.getListPlayhead || !deps.setListPlayhead) {
      return { get: deps.getSelected, set: deps.setSelected }
    }
    const read = deps.getListPlayhead
    const write = deps.setListPlayhead
    return { get: () => read(listId), set: id => write(listId, id) }
  }

  /** Whether a press may fire this cue's list: a list taken out of the show says why it did not. */
  private listFires(cueId: string): boolean {
    const lists = this.deps?.getCueLists?.()
    if (lists === undefined) return true
    const listId = listOfCue(this.deps!.getCues(), cueId)
    if (listId === null || listArmed(lists, listId)) return true
    const name = lists.find(list => list.id === listId)?.name ?? listId
    this.log({ level: 'info', message: `not fired: the list “${name}” is disarmed` })
    return false
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

    // A cue a Load readied part-way in starts there, once: the load is the next firing's.
    if (!adopted && seekMs === 0) {
      const loaded = this.loadedAt.get(cue.id)
      if (loaded !== undefined) {
        this.loadedAt.delete(cue.id)
        seekMs = loaded
      }
    }

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
    if (cue.type === 'audio') {
      const audio = cue as AudioCue
      const fadeOutMs = audio.fadeOutDuration ?? 0
      run.fadeOut = fadeOutMs > 0 ? { ms: fadeOutMs, volume: audio.volume, shape: engineShapeOf(audio.fadeOutShape) } : null
      this.planAudio(audio, run, executeAt, finish)
    }
    // A live input goes out the same way: its absolute time, inside the lookahead.
    if (cue.type === 'input') this.planInput(cue as InputCue, run, executeAt, finish)
    // A video's sound and picture are both scheduled at fire time, for the same instant.
    if (cue.type === 'video') this.planVideo(cue as VideoCue, run, executeAt, finish)

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
      case 'light':
        this.executeLight(cue as LightCue, run, at, finish)
        break
      case 'script':
        this.executeScript(cue as ScriptCue, finish)
        break
      case 'memo':
        // A note has nothing to do: it completes where it began, so a chain runs through it.
        finish(at)
        break
      case 'midiFile':
        this.executeMidiFile(cue as MidiFileCue, run, at, finish)
        break
      case 'timecode':
        this.executeTimecode(cue as TimecodeCue, run, at, finish)
        break
      case 'input':
        // Planned when the cue was fired, as an audio cue is.
        break
      case 'video':
        // Planned when the cue was fired, like an audio cue.
        break
      case 'image':
      case 'text':
      case 'camera':
        this.executePicture(cue as VisualCue, run, at, finish)
        break
      case 'control':
        this.executeControl(cue as ControlCue, at, finish)
        break
    }
  }

  /**
   * The pictures a GO takes down before it fires `incoming`: the ones set to go on the next GO
   * (stopOnNextGo.ts), each over its own fade out.
   */
  private takeDownOnGo(incoming: Cue): void {
    const stops = picturesTakenByGo({
      cues: this.deps!.getCues(),
      showing: visualCues.showingIds(),
      incoming,
      settings: this.deps!.getPictureSettings?.() ?? { stopOnNextGo: false },
      outputs: this.deps!.getVideoOutputs?.() ?? []
    })
    for (const stop of stops) {
      if (this.runs.has(stop.cueId) || visualCues.isShowing(stop.cueId)) this.stopCue(stop.cueId, stop.fadeMs)
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
    finish: Finish,
    /**
     * A video's sound: whether its end is planned (a held last frame plans none), what to do
     * with a file that has no sound (true when the picture carries on alone), and where the
     * voice really began, for the picture to follow.
     */
    video?: { planEnd: boolean; soundless: (error: unknown) => boolean; started: (startAtMs: number) => void }
  ): Promise<void> {
    try {
      const metadata = await audioEngine.prepare(cue.id, cue.filePath)
      if (metadata.durationMs > 0) this.deps!.syncCueDuration(cue.id, metadata.durationMs)
      // The cue did not carry a length when its end had to be planned; now the engine
      // has said what it is, so the run still ends at a known time.
      if (metadata.durationMs > 0 && (video === undefined || video.planEnd)) {
        this.scheduleAudioEnd(run, at, options, metadata.durationMs, finish)
      }
    } catch (error) {
      if (run.cancelled) return
      if (video !== undefined && video.soundless(error)) return
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
        video?.started(result.startAtMs)
      })
      .catch(error => {
        if (run.cancelled) return
        console.error('Audio playback failed:', error)
        finish(Math.max(at, this.now()), { outcome: 'error', error: errorMessage(error) })
      })
  }

  /**
   * Sends a live input's start to the engine with its absolute time. It runs until it is
   * stopped — or, given a length, until that length is up, when it closes over its fade-out.
   * An input that cannot be opened ends the run with the engine's own sentence.
   */
  private planInput(cue: InputCue, run: CueRun, at: number, finish: Finish): void {
    const label = this.cueLabel(cue)
    if (cue.inputChannels.length === 0) {
      this.track(run, this.scheduler!.schedule({
        at,
        due: () => finish(at, { outcome: 'error', error: 'no input channels chosen' })
      }))
      return
    }
    this.track(run, this.scheduler!.schedule({
      at,
      early: () => {
        void audioEngine.startInput(cue.id, at, cue.device, cue.inputChannels, inputStartOptions(cue))
          .then(result => {
            run.engineRunId = result.runId
          })
          .catch(error => {
            if (run.cancelled) return
            this.log({ level: 'error', message: errorMessage(error), label })
            finish(Math.max(at, this.now()), { outcome: 'error', error: errorMessage(error) })
          })
      }
    }))
    if (cue.duration > 0) {
      const endAt = at + cue.duration
      this.planRelease(run, endAt)
      this.track(run, this.scheduler!.schedule({
        at: endAt,
        due: () => {
          void audioEngine.stop(cue.id, Math.max(0, cue.fadeOutDuration)).catch(() => {})
          finish(endAt)
        }
      }))
    }
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
    // Every path that moves a run's end comes through here — the first plan, a start that
    // went out late, a seek, a rate change — so the fade-out is landed on the end here too.
    this.armFadeOut(run)
  }

  /**
   * Lands an audio cue's fade-out on its end: the ramp to silence starts `fadeOut.ms` before
   * the run's planned end and reaches it exactly there. It goes out inside the lookahead with
   * its absolute time, as a start does, so the engine — not a renderer tick — times it.
   *
   * An end that moves after the fade has begun puts the level back where the cue set it
   * before planning the fade again, or a seek out of the fade would leave the cue half-faded.
   */
  private armFadeOut(run: CueRun): void {
    const fade = run.fadeOut
    if (!fade || fade.ms <= 0 || run.endAt === null) return
    if (run.fadeOutTask != null) {
      this.scheduler!.cancel(run.fadeOutTask)
      run.fadeOutTask = null
    }
    if (run.fadeOutSent) {
      run.fadeOutSent = false
      void audioEngine.fade(run.cueId, 'volume', fade.volume, 0, 'linear').catch(() => {
        // A voice that has gone has no level to restore.
      })
    }
    const endAt = run.endAt
    // A cue shorter than its fade fades for all of itself.
    const at = Math.min(Math.max(endAt - fade.ms, run.startAt), endAt)
    // A fade already inside the lookahead is dispatched by `schedule` before it returns, and
    // then there is no task left to keep.
    let dispatched = false
    const task = this.scheduler!.schedule({
      at,
      early: () => {
        dispatched = true
        run.fadeOutTask = null
        if (run.cancelled) return
        run.fadeOutSent = true
        const from = Math.max(at, this.now())
        void audioEngine.fade(run.cueId, 'volume', 0, Math.max(0, endAt - from), 'sCurve', from, ...shapeArg(fade.shape)).catch(() => {
          // The voice ended before its fade: there is nothing left to fade.
        })
      }
    })
    if (!dispatched) run.fadeOutTask = task
    this.track(run, task)
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

  /**
   * Plays a MIDI File cue's file from main, where the port is. Main answers with how long
   * the run has left — the file's tempo map, the region, the rate and the loops all worked
   * out there — so the run's end is planned the way an audio cue's is, and the cue completes
   * and the show follows on by itself. A run that loops until it is stopped has no end to
   * plan: it holds the show until STOP, or a stop cue, takes it away.
   */
  private executeMidiFile(cue: MidiFileCue, run: CueRun, at: number, finish: Finish): void {
    if (!cue.filePath) {
      // Like an audio cue with no file: it takes no time, and it says it played nothing.
      finish(at, { outcome: 'error', error: NO_MIDI_FILE_SELECTED })
      return
    }
    const sentAt = this.now()
    playMidiFile(cue, cue.portName || this.deps!.getMidiDefaultPort(), run.seekMs)
      .then(result => {
        if (run.cancelled || this.isStale(run.generation)) return
        if (!result.ok) {
          finish(this.now(), { outcome: 'error', error: result.error })
          return
        }
        // The length a whole run takes, as main worked it out: what the row shows, and what
        // a group's own length is summed from.
        if (run.seekMs === 0 && result.remainingMs !== null) {
          this.deps!.syncCueDuration(cue.id, Math.round(result.remainingMs))
        }
        this.planMidiFileEnd(run, sentAt, result.remainingMs, finish)
      })
      .catch(error => {
        if (run.cancelled) return
        finish(this.now(), { outcome: 'error', error: errorMessage(error) })
      })
  }

  /** Plans a MIDI file run's end `remainingMs` after `from`, replacing any end it had. */
  private planMidiFileEnd(run: CueRun, from: number, remainingMs: number | null, finish: Finish): void {
    if (run.endTask !== null) { this.scheduler!.cancel(run.endTask); run.endTask = null }
    if (run.releaseTask !== null && !run.released) { this.scheduler!.cancel(run.releaseTask); run.releaseTask = null }
    if (remainingMs === null) {
      run.endAt = null
      run.plannedMs = null
      return
    }
    run.endAt = from + remainingMs
    run.plannedMs = remainingMs
    this.armAudioEndTask(run, finish)
    this.planRelease(run, run.endAt)
  }

  /**
   * Holds a MIDI File cue's file in main, the one way every pause reaches it — the show's PAUSE,
   * a cue's own, a Control cue's. Its planned end is taken away while it is held — a held cue
   * must not complete and move the show on — and main releases what it has sounding, so a held
   * file is silence rather than a chord left down.
   */
  private holdMidiFileRun(cueId: string, run: CueRun): void {
    this.planMidiFileEnd(run, this.now(), null, run.finish!)
    holdMidiFile(cueId)
  }

  /**
   * Lets a held MIDI File cue's file play on in main, with its channels chased back, and plans
   * its end again from what main says is left: the file's own account of where it stands, not
   * the window's sum of how long it was held.
   */
  private releaseMidiFileRun(cueId: string, run: CueRun): void {
    const from = this.now()
    void releaseHeldMidiFile(cueId).then(result => {
      if (run.cancelled || run.phase !== 'running' || !run.finish || !result.ok) return
      // Held again before main answered: the hold that came after is the one that stands.
      if (this.isPaused(cueId)) return
      this.planMidiFileEnd(run, from, result.remainingMs, run.finish)
    }).catch(() => {})
  }

  /**
   * Moves a running MIDI File cue `positionMs` of played time into itself — a Control cue's
   * Load — with every channel chased there. A held file moves and stays held; its end is
   * planned when it is let go.
   */
  private seekMidiFileRun(cueId: string, run: CueRun, positionMs: number): void {
    const from = this.now()
    void seekMidiFile(cueId, positionMs).then(result => {
      if (run.cancelled || run.phase !== 'running' || !run.finish || !result.ok) return
      if (this.isPaused(cueId)) return
      this.planMidiFileEnd(run, from, result.remainingMs, run.finish)
    }).catch(() => {})
  }

  /**
   * Sends an OSC cue's messages in the order the cue lists them, each to its patch or to its
   * own host, one after another so the wire carries them in that order. A message that fails
   * does not hold back the ones after it — the desk that did answer should still be told — and
   * the run reports the first failure, naming which message it was when there are several.
   */
  private executeOsc(cue: OscCue, finish: Finish): void {
    const messages = oscMessages(cue)
    const patches = this.deps!.getOscPatches?.() ?? []
    const failures: string[] = []
    const sendAll = async (): Promise<void> => {
      for (const [index, message] of messages.entries()) {
        const which = messages.length > 1 ? `message ${index + 1} (${message.address || 'no address'}): ` : ''
        const destination = oscDestination(message, patches)
        if ('error' in destination) {
          failures.push(`${which}${destination.error}`)
          continue
        }
        try {
          const result = await window.cuerunner.osc.send({
            host: destination.host,
            port: destination.port,
            address: message.address,
            args: message.args
          })
          if (!result.ok) failures.push(`${which}${result.error ?? 'OSC send failed'}`)
        } catch (error) {
          failures.push(`${which}${errorMessage(error)}`)
        }
      }
    }
    void sendAll().finally(() => {
      const detail: Partial<CueRunResult> = failures.length === 0
        ? {}
        : {
            outcome: 'error',
            error: failures.length === 1 ? failures[0] : `${failures[0]} (and ${failures.length - 1} more)`
          }
      finish(this.now(), detail)
    })
  }

  private executeWait(cue: WaitCue, run: CueRun, at: number, finish: Finish): void {
    const endAt = at + Math.max(0, cue.duration - run.seekMs)
    this.scheduleRunEnd(run, endAt, finish)
  }

  /**
   * Fades every cue the fade names, together, over the same time and curve: each sound's level
   * (and pan) in the audio engine, each light's intensity in the lighting engine, and every cue
   * inside a group it names the same way. Asked to stop its targets when it is done, it stops
   * each where its own kind stops — and a group it names whole, so a sequence does not step on.
   */
  private executeFade(cue: FadeCue, run: CueRun, at: number, finish: Finish): void {
    const ids = fadeTargetIds(cue)
    const routes = fadeRoutes(this.deps!.getCues(), ids)
    const picture = cue.fadeProperty === 'opacity' || cue.fadeProperty === 'geometry'
    const param: AudioFadeParam = cue.fadeProperty === 'volume' ? 'volume' : 'pan'
    // A picture's level, on its output: the same ramp, drawn rather than heard — and its place,
    // where the fade moves that too, over the same time and curve. Every picture it names.
    if (picture) {
      for (const id of routes.pictures) {
        // A drawn shape moves the picture on the same curve the sound and the lights take.
        if (cue.fadeProperty === 'opacity') {
          if (cue.shape) visualCues.fade(id, cue.targetValue, cue.duration, cue.curve, at, cue.shape)
          else visualCues.fade(id, cue.targetValue, cue.duration, cue.curve, at)
        }
        if (cue.geometryTarget) {
          if (cue.shape) visualCues.move(id, cue.geometryTarget, cue.duration, cue.curve, at, cue.shape)
          else visualCues.move(id, cue.geometryTarget, cue.duration, cue.curve, at)
        }
      }
    }
    // A target the show no longer has is still told to the engine, which refuses what it never
    // knew — the way a stop's is — and the run says it was missing.
    const sounds = picture ? [] : [...routes.audio, ...routes.missing]
    // A drawn shape plays in place of the named curve on every route: the audio engine reads
    // its table, the lights and the pictures the shape itself.
    const shape = engineShapeOf(cue.shape)
    for (const id of sounds) {
      // The ramp starts at the cue's own time on the clock, whether that is now or later.
      void audioEngine.fade(id, param, cue.targetValue, cue.duration, cue.curve, at, ...shapeArg(shape))
        .catch(() => {
          // A fade with nothing playing is not an error: the cue still takes its time.
        })
      // A volume fade that takes the pan with it: the same ramp's time and curve, on the pan.
      if (param === 'volume' && typeof cue.panTargetValue === 'number') {
        void audioEngine.fade(id, 'pan', cue.panTargetValue, cue.duration, cue.curve, at, ...shapeArg(shape))
          .catch(() => {})
      }
    }
    // A Fade cue aimed at a Light cue moves the intensity that cue holds to its target share of
    // what the cue set, over the fade.
    const level = Math.min(1, Math.max(0, cue.targetValue))
    for (const id of routes.light) {
      if (cue.shape) void levelLight(id, level, cue.duration, cue.curve, cue.shape)
      else void levelLight(id, level, cue.duration, cue.curve)
    }

    // A fade that names nothing, or only cues the show no longer has, moves nothing — and says
    // so, rather than reporting "completed" for a fade nobody heard. Its timing is unchanged.
    const reason = ids.length === 0
      ? 'no cue chosen to fade'
      : routes.missing.length === ids.length
        ? (ids.length === 1 ? 'the cue it fades is not in the show' : 'the cues it fades are not in the show')
        : routes.missing.length > 0
          ? `${routes.missing.length} of the cues it fades ${routes.missing.length === 1 ? 'is' : 'are'} not in the show`
          : null
    const endAt = at + cue.duration
    this.planRelease(run, endAt)
    this.track(run, this.scheduler!.schedule({
      at: endAt,
      due: () => {
        if (cue.stopTargetWhenDone) {
          for (const id of routes.groups) {
            const group = this.deps!.getCues().find(candidate => candidate.id === id)
            this.stopCue(id, 0)
            if (group?.type === 'group') this.stopGroup(group as GroupCue, 0)
          }
          // Every sound and every picture it moved, whichever of the two it moved.
          for (const id of new Set([...routes.audio, ...routes.pictures, ...routes.missing])) this.stopCue(id, 0)
          for (const id of routes.light) void releaseLight(id, 0)
        }
        finish(endAt, reason === null ? {} : { outcome: 'error', error: reason })
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
    // A devamp that stops the target at the end of its pass, rather than letting it play on:
    // a sliced cue ends at the end of the slice it is in, a loop at the end of its pass.
    const stopAtEnd = cue.devampMode === 'stop'
    // Releasing a cue that is not looping is a no-op the engine reports, and that is not
    // an error: the operator's devamp arrived after the vamp had already ended.
    const released = releaseEndMs === undefined
      ? (stopAtEnd ? audioEngine.release(cue.targetCueId, undefined, undefined, true) : audioEngine.release(cue.targetCueId))
      : (stopAtEnd
        ? audioEngine.release(cue.targetCueId, undefined, releaseEndMs, true)
        : audioEngine.release(cue.targetCueId, undefined, releaseEndMs))
    // A video's picture is let go of with its sound, from the same moment.
    const pictureReleased = target?.type === 'video' ? visualCues.release(cue.targetCueId, this.now()) : false
    void released.then(result => {
      const detail: Partial<CueRunResult> = {}
      if (!result.applied && !pictureReleased) {
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

  /**
   * A Light cue: its look goes to the lighting engine, which fades it on its own clock, and the
   * run ends when the fade does — the cue's duration is its fade time. The lights stay where it
   * put them after the run has ended: that is tracking, not a cue still running.
   */
  private executeLight(cue: LightCue, run: CueRun, at: number, finish: Finish): void {
    const label = this.cueLabel(cue)
    const endAt = at + Math.max(0, cue.duration - run.seekMs)
    void goLight(cue, run.seekMs).then(result => {
      if (run.cancelled) return
      if (!result.ok) {
        this.log({ level: 'error', message: result.error ?? 'the lighting did not take it', label })
        finish(Math.max(at, this.now()), { outcome: 'error', error: result.error ?? 'the lighting did not take it' })
        return
      }
      if (cue.look.length === 0 && cue.effects.length === 0) {
        // A cue nobody has recorded anything into changes nothing, and says so.
        this.log({ level: 'info', message: 'nothing in its look', label })
      }
    })
    this.scheduleRunEnd(run, endAt, finish)
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
      // Drawn from a bag rather than picked: every child once before any of them twice.
      const childId = this.randomDraws.draw(cue.id, children.map(child => child.id))
      const child = children.find(candidate => candidate.id === childId) ?? children[0]
      this.fireCue(child, at, done, run)
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
            child.type === 'devamp' || child.type === 'msc' || child.type === 'mic' ||
            child.type === 'memo' || child.type === 'control') continue
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
    if (isLightCue(this.deps!.getCues(), cueId)) stopLight(cueId)
    this.cancelTimelineTasks(cueId)
    scriptHost.cancel(cueId)
    // A live input closes over its own fade-out when nothing else says how: a hot microphone
    // cut dead is a click in the room.
    const stopped = this.deps!.getCues().find(c => c.id === cueId)
    if (fadeMs <= 0 && stopped?.type === 'input') fadeMs = Math.max(0, (stopped as InputCue).fadeOutDuration)
    void audioEngine.stop(cueId, fadeMs).catch(() => {
      // A cue the engine never knew about has nothing to stop.
    })
    // Its picture goes with it, over the same fade.
    visualCues.stop(cueId, fadeMs)
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
    // A MIDI file this run started is stopped in main, its notes released; for every other
    // run this is nothing.
    stopMidiFile(cueId)
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
    const targets = stopTargetIds(cue)
    let reason: string | null = null
    if (targets === STOP_ALL) {
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
      visualCues.stopAll(fadeMs)
      this.deps!.clearAllRunning()
    } else {
      // Every cue it names, groups first: a child stopped in the same breath as its group
      // must not settle the group on to its next step before the group itself is taken.
      const { ordered, missing } = stopOrder(this.deps!.getCues(), targets.filter(id => id !== cue.id))
      for (const target of ordered) this.stopTarget(cue, target, fadeMs)
      for (const id of missing) {
        // No such cue: still tell the engine, which refuses what it never knew.
        void audioEngine.stop(id, fadeMs).catch(() => {})
      }
      // A stop aimed at a cue that is no longer in the show stops nothing, and says so: the
      // cue it named was deleted, and a stop that reported "ok" for it is a cue that looks
      // like it is doing its job on the night it is not. Its timing is what it always was —
      // the show moves on when it would have — only the result differs.
      if (targets.length === 0) reason = 'no cue chosen to stop'
      else if (missing.length === targets.length) {
        reason = targets.length === 1 ? 'the cue it stops is not in the show' : 'the cues it stops are not in the show'
      } else if (missing.length > 0) {
        reason = `${missing.length} of the cues it stops ${missing.length === 1 ? 'is' : 'are'} not in the show`
      }
    }
    const done: Finish = reason === null
      ? finish
      : endMs => finish(endMs, { outcome: 'error', error: reason })
    // A wait-for-fade stop keeps the run open until the fade has finished sounding,
    // so the next cue does not start over it.
    if (cue.fadeOut && cue.waitForFade) {
      const endAt = at + cue.fadeOutDuration
      this.scheduleRunEnd(run, endAt, done)
    } else {
      done(at)
    }
  }

  /** Takes one cue a stop names away, the way its own kind is stopped. */
  private stopTarget(cue: StopCue, target: Cue, fadeMs: number): void {
    if (target.type === 'audio') {
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
      const pending = this.runs.get(target.id)
      this.cancelTimelineTasks(target.id)
      if (pending && pending.phase === 'pending') {
        this.stopCue(target.id, fadeMs)
      } else {
        void audioEngine.stop(target.id, fadeMs).catch(() => {})
      }
    } else if (target.type === 'group') {
      // The group's own run goes first, so its children settling cannot carry it on.
      this.stopCue(target.id, fadeMs)
      this.stopGroup(target as GroupCue, fadeMs)
    } else if (target.type === 'light') {
      // A light that is stopped stays on where its fade had got to; a stop with a fade-out
      // is the one that turns it off — what the cue holds fades home over the fade-out.
      this.stopCue(target.id, fadeMs)
      if (cue.fadeOut) void releaseLight(target.id, fadeMs)
    } else {
      this.stopCue(target.id, fadeMs)
    }
  }

  /**
   * A Control cue: its verb, on every cue it names, in the order it names them — and then it
   * completes at once, so a chain runs through it the way it runs through a memo. It never acts
   * on itself: a Start of itself would fire for ever, and the rest mean nothing on a cue that is
   * already over. A target the show no longer has is skipped and counted in the result.
   */
  private executeControl(cue: ControlCue, at: number, finish: Finish): void {
    const label = this.cueLabel(cue)
    const cues = this.deps!.getCues()
    const ids = cue.targetCueIds.filter(id => id !== cue.id)
    if (ids.length === 0) {
      // A control cue aimed at nothing must do nothing rather than guess which cue was meant.
      this.log({ level: 'error', message: 'no cue chosen', label })
      finish(at, { outcome: 'error', error: 'no cue chosen' })
      return
    }
    const byId = new Map(cues.map(candidate => [candidate.id, candidate]))
    const targets = ids.flatMap(id => byId.get(id) ?? [])
    const missing = ids.length - targets.length

    switch (cue.action) {
      case 'start':
        for (const target of targets) {
          if (!target.isArmed) {
            this.log({ level: 'error', message: 'not started: it is disarmed', label: this.cueLabel(target) })
            continue
          }
          // A list taken out of the show fires none of its cues, from a Control cue as from GO.
          if (!this.listFires(target.id)) continue
          // A cue already running is left to its own policy, as a second press of it would be.
          if (this.hasActiveRun(target.id) && refirePolicy(target) === 'ignore') continue
          this.log({ level: 'info', message: `started by ${label}`, label: this.cueLabel(target) })
          // On the clock at this cue's own moment: the start is the show's plumbing, not a press.
          this.goById(target.id, at)
        }
        break
      case 'stop':
        for (const target of stopOrder(cues, targets.map(t => t.id)).ordered) {
          this.stopCue(target.id, 0)
          if (target.type === 'group') this.stopGroup(target as GroupCue, 0)
        }
        break
      case 'pause':
        for (const id of this.holdTargets(targets)) this.pauseCue(id)
        break
      case 'resume':
        for (const id of this.holdTargets(targets)) this.resumeCue(id)
        break
      case 'load':
        for (const target of targets) this.loadCue(target, Math.max(0, cue.loadToMs))
        break
      case 'reset':
        for (const target of targets) this.resetCue(target)
        break
      case 'goto': {
        // A playhead is one place in one list: the first target the show still has is where its
        // own list's playhead goes — that list's, whichever list is in front. Moving the list
        // on screen to a cue in another list would leave this list standing where it was and
        // put a cue of another list under its GO.
        const first = targets[0]
        if (first !== undefined) {
          this.playheadOf(listOfCue(cues, first.id) ?? undefined).set(first.id)
          this.log({ level: 'info', message: `moved the playhead to ${this.cueLabel(first)}`, label })
        }
        break
      }
      case 'arm':
      case 'disarm': {
        const armed = cue.action === 'arm'
        if (this.deps!.setArmed === undefined) {
          this.log({ level: 'error', message: `cannot ${cue.action} cues here`, label })
          break
        }
        const changing = targets.filter(target => target.isArmed !== armed).map(target => target.id)
        if (changing.length > 0) this.deps!.setArmed(changing, armed)
        this.log({ level: 'info', message: `${armed ? 'armed' : 'disarmed'} ${targets.length} cue${targets.length === 1 ? '' : 's'}`, label })
        break
      }
    }

    finish(at, missing === 0
      ? {}
      : { outcome: 'error', error: `${missing} of the cues it acts on ${missing === 1 ? 'is' : 'are'} not in the show` })
  }

  /**
   * The cues a pause or resume of these targets holds: each cue named, and every audio, video
   * and MIDI file cue inside a group named — the sounds, the moving pictures and the files are
   * what is held; a group has none of its own.
   */
  private holdTargets(targets: readonly Cue[]): string[] {
    const cues = this.deps!.getCues()
    const ids = new Set<string>()
    for (const target of targets) {
      if (target.type !== 'group') { ids.add(target.id); continue }
      const inside = new Set([target.id])
      for (const candidate of cues) {
        if (candidate.parentId === null || !inside.has(candidate.parentId)) continue
        inside.add(candidate.id)
        if ((candidate.type === 'audio' || candidate.type === 'video' || candidate.type === 'input' || candidate.type === 'midiFile') && this.runs.has(candidate.id)) ids.add(candidate.id)
      }
    }
    return [...ids]
  }

  /**
   * Readies a cue to start `atMs` into itself: a cue that is playing moves there now, and one
   * that is not starts there the next time it is fired — once — with its file already decoded
   * so the GO that follows is instant. A timeline group is readied the way the timeline's own
   * cursor readies one.
   */
  private loadCue(target: Cue, atMs: number): void {
    const label = this.cueLabel(target)
    if (target.type === 'input') {
      // A live input has no place in itself to start from: it is opened, so its GO is instant.
      void audioEngine.inputOpen({ device: (target as InputCue).device || 'default' }).catch(() => {
        // An input that will not open says so when the cue is fired.
      })
      this.log({ level: 'info', message: 'input opened, ready to go live', label })
      return
    }
    const midiFileRun = target.type === 'midiFile' ? this.midiFileRun(target.id) : null
    if (midiFileRun !== null) {
      this.seekMidiFileRun(target.id, midiFileRun, atMs)
      this.log({ level: 'info', message: `moved to ${(atMs / 1000).toFixed(1)}s`, label })
      return
    }
    if ((target.type === 'audio' || target.type === 'video') && this.hasActiveRun(target.id)) {
      this.seekCue(target.id, (target as AudioCue | VideoCue).startTime + atMs)
      this.log({ level: 'info', message: `moved to ${(atMs / 1000).toFixed(1)}s`, label })
      return
    }
    if (target.type === 'group' && (target as GroupCue).mode === 'timeline') {
      this.groupStartOffsets.set(target.id, atMs)
    } else if (atMs > 0) {
      this.loadedAt.set(target.id, atMs)
    } else {
      this.loadedAt.delete(target.id)
    }
    if (target.type === 'audio' && (target as AudioCue).filePath !== '') {
      void audioEngine.prepare(target.id, (target as AudioCue).filePath).catch(() => {
        // A file that will not decode says so when it is fired; a load readies what it can.
      })
    }
    // A picture is readied on its output the way its own firing readies it: decoded, not shown.
    if (isVisualCue(target)) visualCues.prepare(target)
    this.log({ level: 'info', message: `loaded to ${(atMs / 1000).toFixed(1)}s`, label })
  }

  /**
   * Puts a cue back the way the show opened it: stopped where it stands with no fade, its load
   * forgotten, a playlist group back at its first child and a random group drawing afresh.
   */
  private resetCue(target: Cue): void {
    this.stopCue(target.id, 0)
    if (target.type === 'group') this.stopGroup(target as GroupCue, 0)
    this.loadedAt.delete(target.id)
    this.pausedCues.delete(target.id)
    this.groupStartOffsets.delete(target.id)
    this.playlistCursors.delete(target.id)
    this.randomDraws.forget(target.id)
    this.log({ level: 'info', message: 'reset', label: this.cueLabel(target) })
  }

  /** Whether a Load has readied this cue to start part-way in, and how far, ms. */
  loadedOffset(cueId: string): number | null {
    return this.loadedAt.get(cueId) ?? null
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
    // Whatever was held goes with the work: the voices are being stopped, so there is
    // nothing to let go of, and a show clock left standing would hold the next show still.
    this.dropHolds()
    this.generation++
    for (const [cueId, run] of [...this.runs]) this.cancelRun(cueId, run)
    this.runs.clear()
    this.scheduler!.cancelAll()
    this.timelineTasks.clear()
    this.playlistCursors.clear()
    // What a Load readied is part of the show that was stopped: the next GO starts clean.
    this.loadedAt.clear()
  }

  stop(cueId?: string, settles = true): void {
    const { clearAllRunning } = this.deps!
    if (cueId) {
      // A held voice is stopped at once by the engine; its hold goes with it.
      this.pausedCues.delete(cueId)
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
      // A light mid-fade stops where it is and stays on.
      stopLightsAmong(this.deps!.getCues(), this.runs.keys())
      this.cancelAllWork()
      scriptHost.cancelAll()
      void audioEngine.stopAll(0).catch(() => {})
      visualCues.stopAll(0)
      clearAllRunning()
    }
  }

  /**
   * The operator's STOP — Esc, the transport's button, a remote's /stop. A show that sets a
   * STOP fade fades everything out over it and takes the runs away at once, so nothing moves
   * the show on behind the fade; a second STOP before the fade is over cuts what is left of
   * it, which is the hard stop a double press of Esc has always meant. A show with no fade
   * set cuts at once, as STOP always has.
   */
  operatorStop(): void {
    if (!this.deps) return
    const fadeMs = Math.max(0, this.deps.getTriggerGuard().stopFadeMs ?? 0)
    const now = Date.now()
    const fading = this.softStopAt !== null && now - this.softStopAt < this.softStopFadeMs + DOUBLE_STOP_GRACE_MS
    // STOP is the list on screen's, the way GO is: where another list is running too — a cart
    // under the main sequence — that one plays on. Where nothing else is running, it is the
    // STOP it always was, everything and every task with it.
    const scope = this.stopScope()
    if (scope !== null) {
      const cut = fadeMs === 0 || fading
      const stopped = this.stopList(scope, cut ? 0 : fadeMs)
      this.softStopAt = cut ? null : now
      this.softStopFadeMs = cut ? 0 : fadeMs
      if (stopped > 0) {
        this.log({ level: 'info', message: cut ? 'stopped the list on screen' : `stopped the list on screen with a ${fadeMs} ms fade — STOP again to cut it` })
      }
      return
    }
    if (fadeMs === 0 || fading) {
      if (fading) this.log({ level: 'info', message: 'cut the STOP fade' })
      this.softStopAt = null
      this.stop()
      return
    }
    for (const cueId of [...this.runs.keys()]) {
      void audioEngine.stop(cueId, fadeMs).catch(() => {})
    }
    this.cancelAllWork()
    scriptHost.cancelAll()
    void audioEngine.stopAll(fadeMs).catch(() => {})
    this.deps.clearAllRunning()
    this.softStopAt = now
    this.softStopFadeMs = fadeMs
    this.log({ level: 'info', message: `stopped with a ${fadeMs} ms fade — STOP again to cut it` })
  }

  /**
   * The list STOP is scoped to, or null for the whole show: the list on screen, where some
   * other list has something running or waiting on a timeline.
   */
  private stopScope(): string | null {
    const active = this.deps?.getActiveListId?.()
    if (active === undefined) return null
    const cues = this.deps!.getCues()
    const busy = new Set([...this.runs.keys(), ...this.timelineTasks.keys()])
    if (busy.size === 0) return null
    return idsInList(cues, busy, active).length === busy.size ? null : active
  }

  /**
   * STOP for one list: what runs in it is stopped — faded over `fadeMs`, or cut — and every
   * other list plays on. Its groups go first, top level first, so a child that ends while the
   * list is being walked cannot carry its group on. Returns how many cues it stopped.
   */
  stopList(listId: string, fadeMs = 0): number {
    if (!this.deps) return 0
    const cues = this.deps.getCues()
    const byId = new Map(cues.map(cue => [cue.id, cue]))
    const depth = (id: string): number => {
      let n = 0
      for (let at = byId.get(id); at?.parentId != null && n < cues.length; at = byId.get(at.parentId)) n++
      return n
    }
    const ids = idsInList(cues, new Set([...this.runs.keys(), ...this.timelineTasks.keys()]), listId)
      .sort((a, b) => depth(a) - depth(b))
    for (const id of ids) {
      this.pausedCues.delete(id)
      this.stopCue(id, fadeMs, false)
      const cue = byId.get(id)
      if (cue?.type === 'group') {
        this.stopGroup(cue as GroupCue, fadeMs)
        this.playlistCursors.delete(id)
      }
    }
    return ids.length
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
    // The show that opens has played nothing: its random groups start full.
    this.randomDraws.reset()
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
    visualCues.stopAll(PANIC_FADE_MS)
    // The lights do what the show's rule says a panic does to them: hold, release, or black out.
    panicLights()
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
    visualCues.stopAll(PANIC_FADE_MS)
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
    // Main took the outputs down with the sound; only the record of them is left to drop.
    visualCues.forgetAll()
    this.deps!.clearAllRunning()
  }

  // ── Pause ────────────────────────────────────────────────────────────────

  /** Whether the whole show is held. */
  isHeld(): boolean {
    return this.held !== null
  }

  /** Whether one cue is paused, on its own or with the show. */
  isPaused(cueId: string): boolean {
    return this.pausedCues.has(cueId) || (this.held?.cueIds.includes(cueId) ?? false)
  }

  /** The cues that would be held if the show were paused now: what is making sound. */
  private holdableRuns(): string[] {
    const cues = this.deps!.getCues()
    return [...this.runs].filter(([cueId, run]) => {
      if (run.cancelled || this.pausedCues.has(cueId)) return false
      const cue = cues.find(c => c.id === cueId)
      // A timecode cue's clock runs in main on the wall clock, not the show's: holding the show
      // without it would leave the building's clock running ahead of a cue list that is not.
      if (cue !== undefined && isVisualCue(cue)) {
        // A picture is held where it stands — a video's frame and its sound, an image's or
        // text's display time — so the output and the show clock stop together.
        return run.phase === 'running'
      }
      // A MIDI file plays in main on its own clock, so it is held there, from the moment it runs.
      if (cue?.type === 'midiFile') return run.phase === 'running'
      return (cue?.type === 'audio' || cue?.type === 'timecode' || cue?.type === 'input') &&
        (run.phase === 'pending' || run.phase === 'running')
    }).map(([cueId]) => cueId)
  }

  /**
   * Holds the whole show where it stands: every sound held in the engine, and the show clock
   * stopped, so no wait, pre-wait, handover or planned end comes due until it is let go. GO
   * and every other press wait for the resume, and say so; STOP and PANIC end the hold with
   * everything else.
   */
  pauseAll(): void {
    if (!this.deps || this.held !== null) return
    const holding = this.holdableRuns()
    audioEngine.holdClock()
    const heldAt = this.now()
    for (const cueId of holding) {
      if (timecodeRunning(cueId)) {
        void controlTimecode(cueId, { action: 'pause' })
        continue
      }
      const midiFileRun = this.midiFileRun(cueId)
      if (midiFileRun !== null) {
        this.holdMidiFileRun(cueId, midiFileRun)
        continue
      }
      if (visualCues.isShowing(cueId)) {
        visualCues.pause(cueId, heldAt)
        if (this.runs.get(cueId)?.silentPicture === true || !this.hasVoice(cueId)) continue
      }
      void audioEngine.pause(cueId).catch(() => {
        // A voice that has already gone has nothing to hold.
      })
    }
    const rows = new Map(this.deps.getRunning?.() ?? [])
    // Held before the rows are told, so whatever redraws on them reads the show as held.
    this.held = { wallAt: Date.now(), cueIds: holding, rows }
    for (const [cueId, row] of rows) {
      if (row.state !== 'paused') this.deps.setRunning(cueId, { ...row, state: 'paused' })
    }
    this.log({ level: 'info', message: `paused the show (${this.runs.size} running)` })
  }

  /** Lets a held show go on from where it was held: the clock, the sounds, the rows. */
  resumeAll(): void {
    if (!this.deps || this.held === null) return
    const { wallAt, cueIds, rows } = this.held
    this.held = null
    audioEngine.releaseClock()
    // The show clock has gone on from where it was held; on the engine's, that is now.
    const resumedAt = this.now()
    for (const cueId of cueIds) {
      if (!this.runs.has(cueId)) continue
      if (timecodeRunning(cueId)) {
        void controlTimecode(cueId, { action: 'resume' })
        continue
      }
      const midiFileRun = this.midiFileRun(cueId)
      if (midiFileRun !== null) {
        this.releaseMidiFileRun(cueId, midiFileRun)
        continue
      }
      if (visualCues.isShowing(cueId)) {
        visualCues.resume(cueId, resumedAt)
        if (this.runs.get(cueId)?.silentPicture === true || !this.hasVoice(cueId)) continue
      }
      void audioEngine.resume(cueId).catch(() => {})
    }
    const heldFor = Date.now() - wallAt
    for (const [cueId, row] of rows) {
      if (!this.runs.has(cueId) || this.pausedCues.has(cueId)) continue
      // The rows count on the window's clock, which went on: they go on from where they stood.
      this.deps.setRunning(cueId, { ...row, startedAt: row.startedAt + heldFor })
    }
    this.log({ level: 'info', message: 'resumed the show' })
  }

  /** A MIDI File cue's live run, or null for any other cue or one not running. */
  private midiFileRun(cueId: string): CueRun | null {
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || run.phase !== 'running') return null
    return this.deps!.getCues().find(c => c.id === cueId)?.type === 'midiFile' ? run : null
  }

  /** PAUSE as one key: hold the show, or let it go. */
  togglePause(): void {
    if (this.held !== null) this.resumeAll()
    else this.pauseAll()
  }

  /**
   * Holds one audio cue where it stands while the rest of the show goes on: its sound in the
   * engine, and its own planned end — the handover to the cue after it and its fade-out with
   * it. Only a cue that is playing has a place to be held at, and only an audio cue has a
   * sound to hold; anything else is said in the log rather than half-done.
   */
  pauseCue(cueId: string): boolean {
    if (!this.deps) return false
    if (this.held !== null || this.pausedCues.has(cueId)) return false
    const run = this.runs.get(cueId)
    const cue = this.deps.getCues().find(c => c.id === cueId)
    if (!run || !cue || run.cancelled) return false
    if ((cue.type !== 'audio' && cue.type !== 'video' && cue.type !== 'input' && cue.type !== 'midiFile') || run.phase !== 'running') {
      this.log({ level: 'error', message: 'only an audio, video or MIDI file cue that is playing can be paused on its own', label: this.cueLabel(cue) })
      return false
    }
    if (run.released) {
      // Its handover has already gone to the cue after it: holding the sound now would leave
      // the next cue running on time under a cue that is not.
      this.log({ level: 'error', message: 'too close to its end to pause', label: this.cueLabel(cue) })
      return false
    }
    for (const task of [run.endTask, run.releaseTask, run.fadeOutTask ?? null, run.soundFadeTask ?? null]) {
      if (task !== null) this.scheduler!.cancel(task)
    }
    run.endTask = null
    run.releaseTask = null
    run.fadeOutTask = null
    run.soundFadeTask = null
    // A video's picture stands on its frame while its voice is held: both on the engine's clock.
    if (cue.type === 'video') visualCues.pause(cueId, this.now())
    if (cue.type === 'midiFile') this.holdMidiFileRun(cueId, run)
    else if (cue.type !== 'video' || !run.silentPicture) void audioEngine.pause(cueId).catch(() => {})
    const row = this.deps.getRunning?.().get(cueId) ?? null
    this.pausedCues.set(cueId, { at: this.now(), wallAt: Date.now(), row })
    if (row !== null) this.deps.setRunning(cueId, { ...row, state: 'paused' })
    this.log({ level: 'info', message: 'paused', label: this.cueLabel(cue) })
    return true
  }

  /** Lets one held audio cue go on, its planned end moved on by however long it was held. */
  resumeCue(cueId: string): boolean {
    if (!this.deps) return false
    const pause = this.pausedCues.get(cueId)
    if (pause === undefined) return false
    this.pausedCues.delete(cueId)
    const run = this.runs.get(cueId)
    if (!run || run.cancelled || !run.finish) return false
    const heldFor = this.now() - pause.at
    const resumed = this.deps.getCues().find(c => c.id === cueId)
    if (resumed?.type === 'midiFile') {
      // Its end is main's to say once the file plays on; nothing here is moved by a sum.
      this.releaseMidiFileRun(cueId, run)
      if (pause.row !== null) {
        this.deps.setRunning(cueId, { ...pause.row, startedAt: pause.row.startedAt + (Date.now() - pause.wallAt) })
      }
      this.log({ level: 'info', message: 'resumed', label: this.cueLabel(resumed) })
      return true
    }
    if (resumed?.type === 'video') visualCues.resume(cueId, this.now())
    if (resumed?.type !== 'video' || !run.silentPicture) void audioEngine.resume(cueId).catch(() => {})
    run.startAt += heldFor
    if (run.endAt !== null) {
      run.endAt += heldFor
      // A fade-out that had begun was held in the engine with the voice and goes on from
      // where it was; planning it again would put the level back first.
      const fadeOut = run.fadeOut
      if (run.fadeOutSent) run.fadeOut = null
      this.armAudioEndTask(run, run.finish)
      run.fadeOut = fadeOut
      this.planRelease(run, run.endAt)
      if (resumed?.type === 'video') this.armSoundFadeOut(resumed as VideoCue, run)
    }
    if (pause.row !== null) {
      this.deps.setRunning(cueId, { ...pause.row, startedAt: pause.row.startedAt + (Date.now() - pause.wallAt) })
    }
    const cue = this.deps.getCues().find(c => c.id === cueId)
    if (cue) this.log({ level: 'info', message: 'resumed', label: this.cueLabel(cue) })
    return true
  }

  /** One cue's PAUSE as one press: hold it, or let it go. */
  togglePauseCue(cueId: string): boolean {
    return this.pausedCues.has(cueId) ? this.resumeCue(cueId) : this.pauseCue(cueId)
  }

  /** A press while the show is held is refused, with the reason in the log. */
  private refuseWhileHeld(): boolean {
    if (this.held === null) return false
    this.log({ level: 'error', message: 'the show is paused — resume it (P) before firing a cue' })
    return true
  }

  /** Forgets every hold without letting anything go: what was held is being stopped. */
  private dropHolds(): void {
    this.pausedCues.clear()
    if (this.held === null) return
    this.held = null
    audioEngine.releaseClock()
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
    if (!cue || (cue.type !== 'audio' && cue.type !== 'video' && cue.type !== 'input')) return
    void audioEngine.routing(cueId, cue.outputs).catch(() => {
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
    // A held cue has no end to re-plan until it is let go; the seek waits for the resume.
    if (this.isPaused(cueId)) return
    const cue = this.deps!.getCues().find(c => c.id === cueId)
    if (cue?.type === 'video') {
      this.seekVideo(cue as VideoCue, run, positionMs)
      return
    }
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
      // A video's picture goes with its sound, however the sound was taken.
      visualCues.stop(cueId, 0)
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
    // A video that holds its last frame runs on after its sound has ended: it is stopped,
    // not finished.
    if (this.holdsLastFrame(cueId)) return
    run.finish(now)
  }

  // ── Pictures ──────────────────────────────────────────────────────────────────

  /**
   * A video cue: its picture to its output and its sound to the engine, both for the same
   * instant on the engine's clock. The run ends the way an audio cue's does — when its sound
   * does — unless it holds its last frame (then it runs until it is stopped) or its file has
   * no sound (then it ends with its picture).
   */
  private planVideo(cue: VideoCue, run: CueRun, at: number, finish: Finish): void {
    if (!cue.filePath) {
      this.track(run, this.scheduler!.schedule({
        at,
        due: () => finish(at, { outcome: 'error', error: NO_FILE_SELECTED })
      }))
      return
    }
    // The output opens the file now, so its first frame is waiting when the moment comes —
    // through a pre-wait, or the lookahead at least.
    visualCues.prepare(cue)
    const sound = videoSound(cue)
    const options = startOptions(sound, run.seekMs, false)
    const planEnd = !cue.holdLastFrame
    this.track(run, this.scheduler!.schedule({
      at,
      early: () => {
        void visualCues.play(cue, at, run.seekMs).then(result => {
          if (result.ok || run.cancelled) return
          this.log({ level: 'error', message: result.error, label: this.cueLabel(cue) })
          void audioEngine.stop(cue.id, 0).catch(() => {})
          finish(Math.max(at, this.now()), { outcome: 'error', error: result.error })
        })
        if (planEnd && cue.duration > 0) this.scheduleAudioEnd(run, at, options, cue.duration, finish)
        void this.prepareAndPlay(sound, run, at, options, finish, {
          planEnd,
          soundless: error => {
            const code = (error as { code?: string } | null)?.code
            if (code === 'format-unavailable') {
              // A sound this machine has no decoder for — a WebM's on a Windows without the
              // extension, say. The picture is Chromium's and still plays; the operator is
              // told the sound will not, rather than losing the picture with it.
              this.log({
                level: 'error',
                message: `its sound cannot be decoded on this machine, so its picture plays silent: ${errorMessage(error)}`,
                label: this.cueLabel(cue)
              })
            } else if (code !== 'no-audio') {
              return false
            }
            // A picture with no sound: the run is the picture's from here.
            run.silentPicture = true
            return true
          },
          started: startAtMs => {
            // A prepare that outlasted the lookahead moved the sound's start; the picture
            // follows it rather than running ahead of it.
            if (Math.abs(startAtMs - at) > 5) visualCues.anchor(cue.id, startAtMs)
            this.armSoundFadeOut(cue, run)
          }
        })
      }
    }))
  }

  /** An image or text cue: up at `at`, for its display time, or until it is stopped. */
  private executePicture(cue: VisualCue, run: CueRun, at: number, finish: Finish): void {
    if (cue.type === 'image' && !cue.filePath) {
      finish(at, { outcome: 'error', error: NO_FILE_SELECTED })
      return
    }
    // A camera with nothing chosen, or an address this build cannot play, is said at once
    // rather than put up as black.
    const cameraProblem = cue.type === 'camera' ? cameraSourceProblem(cue) : null
    if (cameraProblem !== null) {
      this.log({ level: 'error', message: cameraProblem, label: this.cueLabel(cue) })
      finish(at, { outcome: 'error', error: cameraProblem })
      return
    }
    void visualCues.play(cue, at, run.seekMs).then(result => {
      if (result.ok || run.cancelled) return
      this.log({ level: 'error', message: result.error, label: this.cueLabel(cue) })
      finish(Math.max(at, this.now()), { outcome: 'error', error: result.error })
    })
    if (cue.duration > 0) {
      // The end is known, and said on the run: the timers count it down.
      run.endAt = at + Math.max(0, cue.duration - run.seekMs)
      run.plannedMs = run.endAt - run.startAt
      this.scheduleRunEnd(run, run.endAt, finish)
    }
  }

  /**
   * A video's fade out lands on its end for its sound as it does for its picture: the voice
   * is faded to nothing over the same time, from the same moment, so the two go together.
   * Re-armed whenever the end moves (a seek, a resume), and nothing at all for a video that
   * holds its last frame, loops for ever, or has no sound.
   */
  private armSoundFadeOut(cue: VideoCue, run: CueRun): void {
    if (run.soundFadeTask !== undefined && run.soundFadeTask !== null) {
      this.scheduler!.cancel(run.soundFadeTask)
      run.soundFadeTask = null
    }
    if (cue.fadeOutDuration <= 0 || cue.holdLastFrame || run.endAt === null || run.silentPicture || this.isPaused(cue.id)) return
    const endAt = run.endAt
    const from = Math.max(this.now(), endAt - cue.fadeOutDuration)
    const task = this.scheduler!.schedule({
      at: from,
      early: () => {
        void audioEngine.fade(cue.id, 'volume', 0, Math.max(0, endAt - from), 'linear', from, ...shapeArg(engineShapeOf(cue.fadeOutShape)))
          .catch(() => {})
      }
    })
    run.soundFadeTask = task
    this.track(run, task)
  }

  /** Whether a cue has an engine voice to hold: a video with no sound has only its picture. */
  private hasVoice(cueId: string): boolean {
    const cue = this.deps?.getCues().find(c => c.id === cueId)
    if (cue?.type === 'audio' || cue?.type === 'input') return true
    return cue?.type === 'video' && this.runs.get(cueId)?.silentPicture !== true
  }

  private holdsLastFrame(cueId: string): boolean {
    const cue = this.deps?.getCues().find(c => c.id === cueId)
    return cue?.type === 'video' && (cue as VideoCue).holdLastFrame
  }

  /** Moves a running video to `positionMs` in its file: sound and picture from the same instant. */
  private seekVideo(cue: VideoCue, run: CueRun, positionMs: number): void {
    const now = this.now()
    const start = Math.max(0, cue.startTime)
    const elapsed = Math.max(0, positionMs - start)
    visualCues.seek(cue.id, elapsed, now)
    run.seekMs = elapsed
    if (!this.isPaused(cue.id) && !run.silentPicture) {
      void audioEngine.seek(cue.id, positionMs).catch(() => {
        // A voice that has already ended has nowhere to move; the picture still has.
      })
    }
    this.replanVideoEnd(cue, run, now, elapsed)
  }

  /** The run's end, from `now` with `elapsed` of the play behind it. */
  private replanVideoEnd(cue: VideoCue, run: CueRun, now: number, elapsed: number): void {
    if (run.endTask !== null) { this.scheduler!.cancel(run.endTask); run.endTask = null }
    if (run.soundFadeTask !== undefined && run.soundFadeTask !== null) { this.scheduler!.cancel(run.soundFadeTask); run.soundFadeTask = null }
    if (!run.released && run.releaseTask !== null) { this.scheduler!.cancel(run.releaseTask); run.releaseTask = null }
    run.endAt = null
    run.plannedMs = null
    if (cue.holdLastFrame || this.isPaused(cue.id) || !run.finish) return
    const total = visualCues.playLength(cue.id) ?? (cue.duration > 0
      ? plannedPlaybackMs(startOptions(videoSound(cue), 0, false), cue.duration)
      : null)
    if (total === null) return
    run.endAt = now + Math.max(0, total - elapsed)
    run.plannedMs = run.endAt - run.startAt
    this.armAudioEndTask(run, run.finish)
    this.planRelease(run, run.endAt)
    this.armSoundFadeOut(cue, run)
  }

  /**
   * The runs whose end the clock can say, the most recently started first: what an output's
   * timer counts down. Show-clock ms.
   */
  runningEnds(): Array<{ cueId: string; label: string; startAt: number; endAt: number }> {
    const cues = this.deps?.getCues() ?? []
    return [...this.runs.values()]
      .filter(run => run.phase === 'running' && !run.cancelled && run.endAt !== null)
      .map(run => {
        const cue = cues.find(c => c.id === run.cueId)
        return { cueId: run.cueId, label: cue ? this.cueLabel(cue) : run.cueId, startAt: run.startAt, endAt: run.endAt as number }
      })
      .sort((a, b) => b.startAt - a.startAt)
  }

  /** What the picture runner tells this one: the outputs' half of a visual cue's run. */
  private visualHost(): VisualHost {
    return {
      pictureGone: cueId => {
        // Taken down without being asked — a dissolve into another cue, an output removed
        // from the show: the cue is stopped, the way a stop cue would have stopped it.
        if (this.runs.has(cueId)) this.stopCue(cueId, 0)
      },
      pictureEnded: (cueId, held, atShowMs) => {
        const run = this.runs.get(cueId)
        if (held || !run || run.cancelled || run.phase !== 'running' || !run.finish) return
        // A planned end closes the run on its own; one nobody could plan — a picture whose
        // length was not known — closes where the picture says.
        if (run.endAt !== null) return
        const cue = this.deps?.getCues().find(c => c.id === cueId)
        if (cue?.type === 'video' && !run.silentPicture && run.engineRunId !== null) return
        run.finish(Math.max(run.startAt, Math.min(atShowMs, this.now())))
      },
      measured: (cueId, durationMs) => {
        const cue = this.deps?.getCues().find(c => c.id === cueId)
        if (cue?.type !== 'video') return
        this.deps!.syncCueDuration(cueId, durationMs)
        const run = this.runs.get(cueId)
        if (!run || run.cancelled || run.phase !== 'running' || run.endAt !== null || this.isPaused(cueId) || !run.finish) return
        if ((cue as VideoCue).holdLastFrame) return
        this.scheduleAudioEnd(run, run.startAt, startOptions(videoSound(cue as VideoCue), run.seekMs, false), durationMs, run.finish)
        this.armSoundFadeOut(cue as VideoCue, run)
      },
      pictureFailed: (cueId, message) => {
        const cue = this.deps?.getCues().find(c => c.id === cueId)
        const run = this.runs.get(cueId)
        if (cue) this.log({ level: 'error', message, label: this.cueLabel(cue) })
        if (!run || run.cancelled || !run.finish) return
        // A video whose sound is playing carries on as sound; a picture with nothing else
        // to it has failed.
        if (cue?.type === 'video' && !run.silentPicture) return
        run.finish(this.now(), { outcome: 'error', error: message })
      },
      dissolving: (incoming, outgoing, fromShowMs) => {
        const cue = this.deps?.getCues().find(c => c.id === incoming)
        const durationMs = cue !== undefined && isVisualCue(cue) ? cue.fadeInDuration : 0
        for (const cueId of outgoing) {
          const other = this.deps?.getCues().find(c => c.id === cueId)
          if (other?.type !== 'video') continue
          // The sound goes with its picture, on the same clock: the incoming one's first frame.
          void audioEngine.fade(cueId, 'volume', 0, durationMs, 'linear', fromShowMs).catch(() => {})
        }
      },
      firstFrame: () => {}
    }
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
