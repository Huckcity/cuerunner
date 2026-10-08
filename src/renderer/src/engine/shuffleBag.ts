/**
 * A random group's draw without repeats: every child is played once, in a random order, before
 * any is played again — a bag of names drawn from until it is empty, then filled again. A plain
 * random pick plays the same thunderclap three times in a row often enough that an audience
 * hears the loop; the bag does not. A bag refilled after its last draw never starts with the
 * child that ended the last one, so the seam between two passes is not a repeat either.
 */
export class ShuffleBag {
  private bags = new Map<string, string[]>()
  private last = new Map<string, string>()

  constructor(private readonly random: () => number = Math.random) {}

  /** The next child of `groupId` to play, from the ids it has armed now. */
  draw(groupId: string, childIds: readonly string[]): string | null {
    if (childIds.length === 0) return null
    // A child disarmed or removed since the bag was filled is not in it any more; one added
    // since goes in the next fill.
    let bag = (this.bags.get(groupId) ?? []).filter(id => childIds.includes(id))
    if (bag.length === 0) {
      bag = this.shuffled(childIds)
      const previous = this.last.get(groupId)
      if (bag.length > 1 && bag[bag.length - 1] === previous) {
        // The draw comes off the end: the one just played does not open the next pass.
        ;[bag[0], bag[bag.length - 1]] = [bag[bag.length - 1], bag[0]]
      }
    }
    const next = bag.pop()!
    this.bags.set(groupId, bag)
    this.last.set(groupId, next)
    return next
  }

  /** Forgets every bag: a show that has just been opened has played nothing yet. */
  reset(): void {
    this.bags.clear()
    this.last.clear()
  }

  private shuffled(ids: readonly string[]): string[] {
    const out = [...ids]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1))
      ;[out[i], out[j]] = [out[j], out[i]]
    }
    return out
  }
}
