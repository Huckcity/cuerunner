// Scheduling on the audio engine's own clock. A task carries an absolute time, and is
// dispatched in two phases: `early` once the task is inside the lookahead — native
// commands must be sent before their time so the engine can hit it exactly — and `due`
// when the clock reaches it, which is how the show moves from one cue to the next.
//
// The times are never re-derived from "now": a task scheduled for 12 000 ms is
// dispatched with 12 000 ms whether the renderer called back early, late, or unevenly.

export interface ScheduledTask {
  /** Absolute time on the sample clock, ms. */
  at: number
  /** Dispatched once when `at` comes within the lookahead. */
  early?: () => void
  /** Dispatched when the clock reaches `at`; the task is removed first. */
  due?: () => void
}

/** How far ahead of its time a task is dispatched to the engine. */
export const SCHEDULER_LOOKAHEAD_MS = 100

export class SampleScheduler {
  private entries = new Map<number, { task: ScheduledTask; earlyDone: boolean }>()
  private nextId = 1
  private unsubscribe: () => void

  constructor(
    private readonly now: () => number,
    subscribe: (cb: () => void) => () => void,
    private readonly lookaheadMs: number = SCHEDULER_LOOKAHEAD_MS
  ) {
    this.unsubscribe = subscribe(() => this.advance())
  }

  /** Registers a task, dispatching it at once when it is already within reach. */
  schedule(task: ScheduledTask): number {
    const id = this.nextId++
    this.entries.set(id, { task, earlyDone: false })
    this.advance()
    return id
  }

  cancel(id: number): void {
    this.entries.delete(id)
  }

  cancelAll(): void {
    this.entries.clear()
  }

  dispose(): void {
    this.cancelAll()
    this.unsubscribe()
  }

  advance(): void {
    const now = this.now()
    const due: Array<[number, ScheduledTask]> = []

    for (const id of [...this.entries.keys()]) {
      const entry = this.entries.get(id)
      if (!entry) continue
      const { task } = entry
      if (!entry.earlyDone && task.early && task.at - now <= this.lookaheadMs) {
        entry.earlyDone = true
        task.early()
        // An early-only task is finished once its command has gone out.
        if (!task.due) this.entries.delete(id)
      }
      if (task.due && now >= task.at) due.push([id, task])
    }

    // Several tasks can come due in one tick; the earliest scheduled time runs first so
    // the order does not depend on when each was registered.
    due.sort((a, b) => a[1].at - b[1].at)
    for (const [id, task] of due) {
      if (!this.entries.delete(id)) continue
      task.due?.()
    }
  }
}
