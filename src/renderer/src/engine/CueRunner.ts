import type { Cue, AudioCue, MidiCue, OscCue, WaitCue, FadeCue, StopCue, GroupCue, ScriptCue, SceneCue } from '../types/cue'
import { audioPlayer } from './AudioPlayer'
import { scriptHost, ScriptCancelledError } from './scriptHost'
import { recallScene } from './scenes'
import type { RunningCue, CueRunResult, LogEntryInput } from '../store'

type SetRunning = (id: string, state: RunningCue | null) => void
type ClearAllRunning = () => void
type GetCues = () => Cue[]
type GetSelected = () => string | null
type SetSelected = (id: string | null) => void

// Cap on log lines a single script run may emit, so a chatty script cannot flood the log.
const MAX_RUN_LOG_LINES = 200

// Response body characters recorded with a network run. Follows the same
// 4000-character rule as the session log's message cap.
const NETWORK_BODY_LIMIT = 4000

// PANIC cuts the audio with a short fade rather than at zero-crossing; the guide
// documents this as 200 ms.
const PANIC_FADE_MS = 200

// Reads a response body without buffering an unbounded stream: at most
// NETWORK_BODY_LIMIT characters are kept, and the reader is cancelled as soon as the
// budget is spent. Longer bodies get a truncation marker. Returns undefined for a
// body-less or empty response.
async function readNetworkBody(response: Response): Promise<string | undefined> {
  if (!response.body) return undefined

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let body = ''

  try {
    while (body.length < NETWORK_BODY_LIMIT) {
      const { done, value } = await reader.read()
      if (done) return body || undefined
      if (value) body += decoder.decode(value, { stream: true })
    }

    // Budget spent: one more read tells us whether the body continues. Either way the
    // stream is cancelled, so the remainder is never pulled into memory.
    const { done } = await reader.read()
    if (done && body.length <= NETWORK_BODY_LIMIT) return body
    return body.slice(0, NETWORK_BODY_LIMIT) + '\n… (truncated)'
  } finally {
    await reader.cancel().catch(() => {})
  }
}

// What a cue's execute() may add to its run result.
type Report = (patch: Partial<CueRunResult>) => void

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
}

export class CueRunner {
  private deps: RunnerDeps | null = null
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private groupStartOffsets = new Map<string, number>()
  // Playlist groups step one child per GO. The cursor holds the index of the child the
  // next GO will fire; 0 means a pass is complete or has not started.
  private playlistCursors = new Map<string, number>()
  // The run a group is currently on. Stopping a group replaces or drops the token, and
  // every continuation the group started compares against it, so a child that finishes
  // after the stop cannot carry the sequence — or the show — on.
  private groupRuns = new Map<string, symbol>()
  // Bumped by a global STOP or PANIC. Every continuation captures the generation it
  // was started under and does nothing once it is stale, so work that settles after
  // STOP — a network request, a script — cannot resume the show.
  private generation = 0

  init(deps: RunnerDeps): void {
    this.deps = deps
  }

  go(): void {
    const { getCues, getSelected, setSelected } = this.deps!
    const cues = getCues()
    const selectedId = getSelected()

    const targetIdx = selectedId ? cues.findIndex(c => c.id === selectedId) : 0
    if (targetIdx < 0) return

    const cue = cues[targetIdx]
    if (!cue || !cue.isArmed) return

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

    // Cancel timers if the cue is already mid-run (prevents stacking)
    // AudioPlayer.play() handles the audio-only case internally
    if (this.hasActiveTimers(cue.id)) this.stop(cue.id)

    this.fireCue(cue, () => {
      // A playlist group mid-pass is not finished, so it must not hand over yet
      if (cue.advance === 'on-end' && nextCue && !this.isMidPlaylist(cue.id)) {
        this.goById(nextCue.id)
      }
    })

    if (cue.advance === 'on-start' && nextCue) {
      this.goById(nextCue.id)
    }
  }

  goById(id: string): void {
    const { getCues } = this.deps!
    const cues = getCues()
    const cue = cues.find(c => c.id === id)
    if (!cue || !cue.isArmed) return
    const idx = cues.findIndex(c => c.id === id)
    const nextCue = cues[idx + 1] ?? null
    this.fireCue(cue, () => {
      if (cue.advance === 'on-end' && nextCue) {
        this.goById(nextCue.id)
      }
    })
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

  private fireCue(cue: Cue, onDone: () => void): void {
    const { setRunning, setLastRun } = this.deps!
    const label = this.cueLabel(cue)
    // Everything below belongs to this run of the show: if STOP or PANIC lands while
    // the cue is in flight, the continuations are dropped instead of firing the next cue.
    const generation = this.generation

    const run = (state: Omit<RunningCue, 'cueId'>) =>
      setRunning(cue.id, { cueId: cue.id, ...state })

    const execute = (): void => {
      if (this.isStale(generation)) return
      const startedAt = Date.now()
      let detail: Partial<CueRunResult> = {}
      // A stopped run records nothing: no run result, no completion line in the log.
      const report = (patch: Partial<CueRunResult>): void => {
        if (!this.isStale(generation)) detail = { ...detail, ...patch }
      }

      run({ state: 'playing', startedAt, progress: 0 })
      this.log({ level: 'info', message: 'started', label })
      this.execute(cue, () => {
        if (this.isStale(generation)) return
        const durationMs = Date.now() - startedAt
        setLastRun(cue.id, {
          startedAt,
          durationMs,
          outcome: 'success',
          ...detail
        })

        // A firing reports as a line in the log: the failure reason, or what the cue did.
        const networkError = cue.type === 'network' && detail.status === undefined
        if (detail.outcome === 'error' || networkError) {
          this.log({ level: 'error', message: detail.error ?? 'request failed', label })
        } else if (cue.type === 'network' && detail.status !== undefined) {
          const statusText = detail.statusText ? ` ${detail.statusText}` : ''
          this.log({
            level: 'info',
            message: `${cue.method} ${cue.url} → ${detail.status}${statusText} (${durationMs}ms)`,
            label
          })
        } else if (cue.type !== 'scene') {
          // A scene recall writes its own line — what the desk was told — so a duration
          // here would only say the same thing twice.
          this.log({ level: 'info', message: `completed in ${durationMs}ms`, label })
        }

        run({ state: 'post-wait', startedAt: Date.now(), progress: 1 })
        const t = setTimeout(() => {
          setRunning(cue.id, null)
          onDone()
        }, cue.postWait)
        this.timers.set(cue.id + ':post', t)
      }, report)
    }

    if (cue.preWait > 0) {
      run({ state: 'pre-wait', startedAt: Date.now(), progress: 0 })
      const t = setTimeout(execute, cue.preWait)
      this.timers.set(cue.id + ':pre', t)
    } else {
      execute()
    }
  }

  private execute(cue: Cue, onDone: () => void, report: Report = () => {}): void {
    switch (cue.type) {
      case 'audio':
        this.executeAudio(cue as AudioCue, onDone, report)
        break
      case 'midi':
        this.executeMidi(cue as MidiCue, onDone, report)
        break
      case 'osc':
        this.executeOsc(cue as OscCue, onDone, report)
        break
      case 'wait':
        this.executeWait(cue as WaitCue, onDone)
        break
      case 'fade':
        this.executeFade(cue as FadeCue, onDone)
        break
      case 'stop':
        this.executeStop(cue as StopCue, onDone)
        break
      case 'group':
        this.executeGroup(cue as GroupCue, onDone)
        break
      case 'network':
        fetch(cue.url, {
          method: cue.method,
          headers: cue.headers,
          body: cue.method !== 'GET' ? cue.body : undefined,
          signal: AbortSignal.timeout(cue.timeout ?? 5000)
        })
          .then(async response => {
            report({ status: response.status, statusText: response.statusText })
            if (!response.ok) {
              report({
                outcome: 'error',
                error: `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
              })
            }
            const body = await readNetworkBody(response)
            if (body !== undefined) report({ body })
          })
          .catch((e: unknown) => {
            report({ outcome: 'error', error: e instanceof Error ? e.message : String(e) })
            console.error('Network cue failed:', e)
          })
          .finally(() => { this.timers.delete(cue.id); onDone() })
        break
      case 'scene': {
        const sceneCue = cue as SceneCue
        const label = this.cueLabel(cue)
        if (!this.deps!.isPro()) {
          // The cue stays in the file — a show written on a licensed machine opens on an
          // unlicensed one, and nothing is thrown away — but the desk is not driven
          // without a licence, and a cue that did nothing quietly would be worse.
          this.log({ level: 'error', message: 'scene cues need WinsLab Pro', label })
          report({ outcome: 'error', error: 'WinsLab Pro is required' })
          onDone()
          break
        }
        if (sceneCue.sceneId === '') {
          // A cue pointed at nothing must not be read as "close every mic": that would be
          // a silent, and very loud, surprise in the middle of a show.
          this.log({ level: 'error', message: 'no scene chosen', label })
          report({ outcome: 'error', error: 'no scene chosen' })
          onDone()
          break
        }
        // The recall logs what the desk was told, under this cue's label.
        void recallScene(sceneCue.sceneId, label).then(result => {
          if (result.failures.length > 0) {
            report({ outcome: 'error', error: result.failures.join(', ') })
          }
          onDone()
        })
        break
      }
      case 'script': {
        const scriptCue = cue as ScriptCue
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
          code: scriptCue.script,
          workspacePath: this.deps!.getWorkspacePath(),
          timeoutMs: scriptCue.timeout,
          onLog: logOutput
        })
          .then(() => onDone())
          .catch((e: unknown) => {
            // A cancelled run is not a failure, and it is not a completion: STOP has
            // already cleared its state, and nothing may resume from here.
            if (e instanceof ScriptCancelledError) return
            report({ outcome: 'error', error: e instanceof Error ? e.message : String(e) })
            console.error('Script cue error:', e)
            onDone()
          })
        break
      }
    }
  }

  private executeAudio(cue: AudioCue, onDone: () => void, report: Report): void {
    const { syncCueDuration } = this.deps!
    // A missing file or a file that will not decode fails here; without this the run
    // was recorded as a success and the operator heard nothing.
    audioPlayer.play(cue, onDone, durationMs => syncCueDuration(cue.id, durationMs))
      .catch(error => {
        report({ outcome: 'error', error: errorMessage(error) })
        console.error('Audio playback failed:', error)
        onDone()
      })
  }

  private executeMidi(cue: MidiCue, onDone: () => void, report: Report): void {
    window.winslab.midi.send({
      portName: cue.portName || this.deps!.getMidiDefaultPort(),
      messages: cue.messages
    })
      .then(result => {
        if (!result.ok) {
          report({ outcome: 'error', error: result.error ?? 'MIDI send failed' })
        }
      })
      .catch(error => report({ outcome: 'error', error: errorMessage(error) }))
      .finally(onDone)
  }

  private executeOsc(cue: OscCue, onDone: () => void, report: Report): void {
    window.winslab.osc.send({ host: cue.host, port: cue.port, address: cue.address, args: cue.args })
      .then(result => {
        if (!result.ok) {
          report({ outcome: 'error', error: result.error ?? 'OSC send failed' })
        }
      })
      .catch(error => report({ outcome: 'error', error: errorMessage(error) }))
      .finally(onDone)
  }

  private executeWait(cue: WaitCue, onDone: () => void): void {
    const t = setTimeout(onDone, cue.duration)
    this.timers.set(cue.id, t)
  }

  private executeFade(cue: FadeCue, onDone: () => void): void {
    if (cue.fadeProperty === 'volume') {
      audioPlayer.setVolume(cue.targetCueId, cue.targetValue, cue.duration, cue.curve)
    } else {
      audioPlayer.setPan(cue.targetCueId, cue.targetValue, cue.duration, cue.curve)
    }
    const t = setTimeout(() => {
      if (cue.stopTargetWhenDone) this.stop(cue.targetCueId)
      onDone()
    }, cue.duration)
    this.timers.set(cue.id, t)
  }

  private executeGroup(cue: GroupCue, onDone: () => void): void {
    const allCues = this.deps!.getCues()
    const children = allCues.filter(c => c.parentId === cue.id && c.isArmed)

    if (children.length === 0) { onDone(); return }

    const run = Symbol('group run')
    this.groupRuns.set(cue.id, run)
    const stillRunning = (): boolean => this.groupRuns.get(cue.id) === run
    // A group that was stopped finishes nothing: no run result, no post-wait, no advance.
    const done = (): void => { if (stillRunning()) onDone() }

    if (cue.mode === 'timeline') {
      const startOffset = this.groupStartOffsets.get(cue.id) ?? 0
      this.groupStartOffsets.delete(cue.id)
      this.executeGroupTimeline(cue, children, done, startOffset, stillRunning)
    } else if (cue.mode === 'random') {
      this.fireCue(children[Math.floor(Math.random() * children.length)], done)
    } else if (cue.mode === 'playlist') {
      // One child per GO: fire the child at the cursor and advance it. Wrapping to 0
      // marks the pass complete, which also releases the selection and lets
      // advance=on-end hand over to the next cue.
      const index = (this.playlistCursors.get(cue.id) ?? 0) % children.length
      this.playlistCursors.set(cue.id, (index + 1) % children.length)
      this.fireCue(children[index], done)
    } else {
      // sequence
      this.runSequence(children, 0, done, stillRunning)
    }
  }

  private executeGroupTimeline(
    cue: GroupCue,
    children: Cue[],
    onDone: () => void,
    startOffset: number,
    stillRunning: () => boolean
  ): void {
    const { setRunning } = this.deps!

    // Correct startedAt so the playhead reflects the seek position
    setRunning(cue.id, { cueId: cue.id, state: 'playing', startedAt: Date.now() - startOffset, progress: 0 })

    type Item =
      | { kind: 'schedule'; child: Cue; delay: number }
      | { kind: 'seek';     child: Cue; seekOffsetMs: number }

    const items: Item[] = []
    for (const child of children) {
      if (child.timelineOffset >= startOffset) {
        items.push({ kind: 'schedule', child, delay: child.timelineOffset - startOffset })
      } else {
        const seekOffsetMs = startOffset - child.timelineOffset
        // Skip if we know the cue has already finished
        if (child.duration > 0 && seekOffsetMs >= child.duration) continue
        // Fire-and-forget types have already happened — don't replay
        if (child.type === 'midi' || child.type === 'osc' || child.type === 'scene' ||
            child.type === 'network' || child.type === 'script' || child.type === 'stop') continue
        items.push({ kind: 'seek', child, seekOffsetMs })
      }
    }

    if (items.length === 0) { onDone(); return }
    let remaining = items.length

    for (const item of items) {
      if (item.kind === 'schedule') {
        const { child, delay } = item
        const t = setTimeout(() => {
          this.timers.delete(child.id + ':timeline')
          if (!stillRunning()) return
          this.fireCue(child, () => { remaining--; if (remaining === 0) onDone() })
        }, delay)
        this.timers.set(child.id + ':timeline', t)
      } else {
        const { child, seekOffsetMs } = item
        this.fireCueFromOffset(child, seekOffsetMs, () => { remaining--; if (remaining === 0) onDone() })
      }
    }
  }

  private fireCueFromOffset(cue: Cue, seekOffsetMs: number, onDone: () => void): void {
    const { setRunning, syncCueDuration } = this.deps!

    if (cue.type === 'audio') {
      const audioCue = cue as AudioCue
      setRunning(cue.id, { cueId: cue.id, state: 'playing', startedAt: Date.now() - seekOffsetMs, progress: 0 })
      audioPlayer.play(
        { ...audioCue, startTime: audioCue.startTime + seekOffsetMs },
        () => { setRunning(cue.id, null); onDone() },
        durationMs => syncCueDuration(cue.id, durationMs)
      ).catch(() => { setRunning(cue.id, null); onDone() })
    } else if (cue.type === 'wait') {
      const remainingMs = Math.max(0, (cue as WaitCue).duration - seekOffsetMs)
      setRunning(cue.id, { cueId: cue.id, state: 'playing', startedAt: Date.now() - seekOffsetMs, progress: 0 })
      const t = setTimeout(() => { setRunning(cue.id, null); onDone() }, remainingMs)
      this.timers.set(cue.id, t)
    } else {
      onDone()
    }
  }

  private runSequence(
    cues: Cue[],
    index: number,
    onDone: () => void,
    stillRunning: () => boolean
  ): void {
    if (!stillRunning()) return
    if (index >= cues.length) { onDone(); return }
    this.fireCue(cues[index], () => this.runSequence(cues, index + 1, onDone, stillRunning))
  }

  /**
   * Takes one cue's run away: its timers, its script, its audio, and its run state.
   * `fadeMs` is the stop cue's fade; 0 cuts.
   */
  private stopCue(cueId: string, fadeMs: number): void {
    for (const key of [cueId, cueId + ':pre', cueId + ':post', cueId + ':timeline']) {
      clearTimeout(this.timers.get(key))
      this.timers.delete(key)
    }
    scriptHost.cancel(cueId)
    audioPlayer.stop(cueId, fadeMs)
    this.deps!.setRunning(cueId, null)
  }

  /**
   * A group and everything under it, however deep. The run token goes first: a child
   * that ends while the tree is being walked must not be able to carry the group on.
   */
  private stopGroup(group: GroupCue, fadeMs: number): void {
    this.groupRuns.delete(group.id)
    for (const child of this.deps!.getCues().filter(c => c.parentId === group.id)) {
      this.stopCue(child.id, fadeMs)
      if (child.type === 'group') this.stopGroup(child as GroupCue, fadeMs)
    }
  }

  private executeStop(cue: StopCue, onDone: () => void): void {
    const fadeMs = cue.fadeOut ? cue.fadeOutDuration : 0
    if (cue.targetCueId === 'all') {
      audioPlayer.stopAll(fadeMs)
      // A script runs in a worker of its own, so stopping the audio cannot reach it:
      // "everything" has to take the scripts and the groups the way STOP does.
      scriptHost.cancelAll()
      this.groupRuns.clear()
    } else {
      const target = this.deps!.getCues().find(c => c.id === cue.targetCueId)
      if (target?.type === 'group') {
        this.stopGroup(target as GroupCue, fadeMs)
        this.stopCue(target.id, fadeMs)
      } else {
        audioPlayer.stop(cue.targetCueId, fadeMs)
        if (target?.type === 'script') {
          scriptHost.cancel(target.id)
          // A cancelled run records nothing and never completes, so the cue it was
          // running for has to be released here, or it stays lit for the rest of the show.
          this.deps!.setRunning(target.id, null)
        }
      }
    }
    // A wait-for-fade stop keeps the run open until the fade has finished sounding,
    // so the next cue does not start over it.
    if (cue.fadeOut && cue.waitForFade) {
      const t = setTimeout(onDone, cue.fadeOutDuration)
      this.timers.set(cue.id, t)
    } else {
      onDone()
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
    const wasPlaying = children.some(c =>
      this.timers.has(c.id + ':timeline') ||
      this.timers.has(c.id + ':pre') ||
      this.timers.has(c.id) ||
      this.timers.has(c.id + ':post') ||
      audioPlayer.isPlaying(c.id)
    )
    if (wasPlaying) {
      this.stop(groupId)
      const { setRunning } = this.deps!
      const groupCue = group as GroupCue
      // groupStartOffsets already has seekMs — execute() → executeGroup() will read + consume it
      this.execute(groupCue, () => {
        setRunning(groupId, { cueId: groupId, state: 'post-wait', startedAt: Date.now(), progress: 1 })
        const t = setTimeout(() => { setRunning(groupId, null) }, groupCue.postWait)
        this.timers.set(groupId + ':post', t)
      })
    }
  }

  private hasActiveTimers(cueId: string): boolean {
    return this.timers.has(cueId + ':pre') ||
           this.timers.has(cueId + ':post') ||
           this.timers.has(cueId) ||
           this.timers.has(cueId + ':timeline')
  }

  // True when a global STOP or PANIC has happened since the given generation started.
  private isStale(generation: number): boolean {
    return generation !== this.generation
  }

  // Shared by STOP and PANIC: no timer started before this call may fire afterwards.
  private cancelScheduledWork(): void {
    for (const key of this.timers.keys()) clearTimeout(this.timers.get(key))
    this.timers.clear()
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
      this.generation++
      this.cancelScheduledWork()
      scriptHost.cancelAll()
      audioPlayer.stopAll()
      clearAllRunning()
    }
  }

  // PANIC is the one place that wants the tails: stop() cuts immediately, panic counts
  // down with a fixed fade so the cut does not click. It must not call stop() first —
  // that would silence every source before the fade could be scheduled.
  panic(): void {
    this.generation++
    this.cancelScheduledWork()
    scriptHost.cancelAll()
    audioPlayer.stopAll(PANIC_FADE_MS)
    this.deps!.clearAllRunning()
  }
}

export const cueRunner = new CueRunner()
