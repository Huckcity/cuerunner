import type { SqMembershipIntent } from '../../shared/show'
import type { DcaReport } from './dcaReports'

/**
 * Which of a switch's two halves goes first. Placing the new fader first leaves the channel
 * on both for the moment between the frames, where an SQ adds the two offsets; clearing the
 * old one first leaves it on none, where it plays at its own fader. Which of the two is
 * inaudible is measured with audio, not here — so it is a choice, and placing first is what
 * the 2026-10-04 capture switched with.
 */
export type SwitchOrder = 'assign-first' | 'clear-first'

/**
 * How far a challenger has to be above the fader a channel is riding before the channel
 * moves, in the desk's raw level units. Near the top of travel one step of the SQ's table is
 * 15–17 units, so this is about one step: enough that two faders resting together do not
 * trade a channel back and forth, and too little to hear at a crossover.
 */
export const HYSTERESIS = 16

/**
 * Highest wins: a channel placed on several DCAs rides only the highest of them on the desk,
 * and moves when another one overtakes it.
 *
 * An SQ adds the offsets of every DCA a channel is on, so a second fader at -inf silences the
 * channel whatever the first one says. This keeps the scene's word — the channel is placed on
 * all of them — and puts it on the desk as one membership at a time: the fader that is
 * highest now. At a crossover the two faders are at the same level, so the channel changes
 * fader without changing level.
 *
 * Every number here is the desk's own: channels and DCAs from 1, levels raw. A muted DCA
 * counts as -inf, so muting a channel's own fader hands it to the group. The class only plans:
 * what it returns is the memberships to write, in order, and `landed` is told each one that
 * got there — the desk record is what was written, never what was planned.
 */
export class HighestWins {
  private readonly levels = new Map<number, number>()
  private readonly muted = new Map<number, boolean>()
  /** The channels being followed, and the faders each is placed on, in the show's order. */
  private readonly following = new Map<number, number[]>()
  /** What each channel was last written onto, as far as this knows. */
  private readonly onDesk = new Map<number, Set<number>>()

  constructor(
    private readonly order: SwitchOrder = 'assign-first',
    private readonly hysteresis: number = HYSTERESIS
  ) {}

  /**
   * One channel's faders, as a recall asks for them. With `highest` and more than one fader
   * the channel is followed from here on; otherwise it is written as asked — every fader it
   * is placed on, which is how a show leaves highest wins without stranding a channel on the
   * one fader it happened to be riding.
   *
   * `wrote` is what the window's record says the desk holds, which is what this starts from
   * for a channel it has not written yet: a channel the show placed before this session was
   * written by somebody, and clearing only what is known keeps a recall from clearing blind.
   */
  ride(channel: number, dcas: readonly number[], wrote: readonly number[], highest: boolean): SqMembershipIntent[] {
    if (!this.onDesk.has(channel)) this.onDesk.set(channel, new Set(wrote))
    const candidates = [...new Set(dcas)]
    if (highest && candidates.length > 1) this.following.set(channel, candidates)
    else this.following.delete(channel)
    const target = highest && candidates.length > 1 ? [this.winner(channel, candidates)] : candidates
    return this.plan(channel, target)
  }

  /**
   * A membership written some other way — a recall's own pair — which is the show taking the
   * channel back: it is not followed any more, and the record is what that write left.
   */
  release(channel: number): void {
    this.following.delete(channel)
  }

  /** A write that got there: the record moves with it. */
  landed(write: SqMembershipIntent): void {
    const onDesk = this.onDesk.get(write.channel) ?? new Set<number>()
    if (write.placed) onDesk.add(write.dca)
    else onDesk.delete(write.dca)
    this.onDesk.set(write.channel, onDesk)
  }

  /**
   * One fact about a DCA, and the switches it causes: every followed channel whose highest
   * fader is now another one, each as the writes that move it.
   */
  report(report: DcaReport): SqMembershipIntent[] {
    if ('level' in report) {
      if (this.levels.get(report.dca) === report.level) return []
      this.levels.set(report.dca, report.level)
    } else {
      if (this.muted.get(report.dca) === report.muted) return []
      this.muted.set(report.dca, report.muted)
    }
    return this.resolve(dca => dca === report.dca)
  }

  /**
   * Every followed channel put back on its highest fader: what a channel needs after a write
   * that did not get there, or after the levels it was decided on were forgotten and read again.
   */
  resolveAll(): SqMembershipIntent[] {
    return this.resolve(() => true)
  }

  /** Whether any fader a followed channel could ride has a level nobody has read yet. */
  needsLevels(): boolean {
    for (const candidates of this.following.values()) {
      if (candidates.some(dca => !this.levels.has(dca))) return true
    }
    return false
  }

  /** Forgets what the faders were: a desk link that dropped may have missed them moving. */
  forgetLevels(): void {
    this.levels.clear()
    this.muted.clear()
  }

  /** Whether a channel is being followed now. */
  follows(channel: number): boolean {
    return this.following.has(channel)
  }

  private resolve(touches: (dca: number) => boolean): SqMembershipIntent[] {
    const writes: SqMembershipIntent[] = []
    for (const [channel, candidates] of this.following) {
      if (!candidates.some(touches)) continue
      writes.push(...this.plan(channel, [this.winner(channel, candidates)]))
    }
    return writes
  }

  /** The level a fader counts as: -inf while muted, unknown until it has been read. */
  private effective(dca: number): number | undefined {
    if (this.muted.get(dca) === true) return 0
    return this.levels.get(dca)
  }

  /**
   * The fader a channel should ride now. The one it is on keeps it until another is clearly
   * higher; a fader nobody has read loses to one that has been read; and with nothing read at
   * all the channel stays where it is, or takes the first fader the scene placed it on.
   */
  private winner(channel: number, candidates: readonly number[]): number {
    const onDesk = this.onDesk.get(channel) ?? new Set<number>()
    const current = candidates.find(dca => onDesk.has(dca))
    let best: number | undefined
    for (const dca of candidates) {
      const level = this.effective(dca)
      if (level === undefined) continue
      const bestLevel = best === undefined ? undefined : this.effective(best)
      if (bestLevel === undefined || level > bestLevel) best = dca
    }
    if (best === undefined) return current ?? candidates[0]
    if (current === undefined || current === best) return best
    const held = this.effective(current)
    if (held === undefined) return best
    const challenger = this.effective(best) as number
    return challenger > held + this.hysteresis ? best : current
  }

  /**
   * The writes that take a channel from what it is on to `target`: the faders to place and
   * the ones to clear, in the switch order, each carrying the channel's flag as that write
   * leaves it.
   */
  private plan(channel: number, target: readonly number[]): SqMembershipIntent[] {
    const onDesk = this.onDesk.get(channel) ?? new Set<number>()
    const wanted = new Set(target)
    const place = target.filter(dca => !onDesk.has(dca))
    const clear = [...onDesk].filter(dca => !wanted.has(dca)).sort((a, b) => a - b)
    const steps = this.order === 'assign-first'
      ? [...place.map(dca => ({ dca, placed: true })), ...clear.map(dca => ({ dca, placed: false }))]
      : [...clear.map(dca => ({ dca, placed: false })), ...place.map(dca => ({ dca, placed: true }))]
    const riding = new Set(onDesk)
    return steps.map(({ dca, placed }) => {
      if (placed) riding.add(dca)
      else riding.delete(dca)
      return { channel, dca, placed, rides: riding.size > 0 }
    })
  }
}
