// A random group's draw: every child once before any twice, and no repeat across the seam.
import { describe, it, expect } from 'vitest'
import { ShuffleBag } from './shuffleBag'

/** A seeded generator, so a run of draws is the same run every time. */
function seeded(seed: number): () => number {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

describe('ShuffleBag', () => {
  const children = ['a', 'b', 'c', 'd']

  it('plays every child once before it plays any twice', () => {
    const bag = new ShuffleBag(seeded(7))
    for (let pass = 0; pass < 20; pass++) {
      const drawn = children.map(() => bag.draw('g', children))
      expect([...drawn].sort()).toEqual(children)
    }
  })

  it('never opens a pass with the child that closed the one before', () => {
    const bag = new ShuffleBag(seeded(3))
    let previous: string | null = null
    for (let i = 0; i < 200; i++) {
      const next = bag.draw('g', children)
      expect(next).not.toBe(previous)
      previous = next
    }
  })

  it('keeps one bag per group', () => {
    const bag = new ShuffleBag(seeded(11))
    const g = [bag.draw('g', children), bag.draw('g', children)]
    const h = children.map(() => bag.draw('h', children))
    expect([...h].sort()).toEqual(children)
    const rest = [bag.draw('g', children), bag.draw('g', children)]
    expect([...g, ...rest].sort()).toEqual(children)
  })

  it('leaves out a child taken away since the bag was filled', () => {
    const bag = new ShuffleBag(seeded(5))
    const first = bag.draw('g', children)!
    const remaining = children.filter(id => id !== first)
    const gone = remaining[0]
    const now = children.filter(id => id !== gone)
    const drawn = [bag.draw('g', now), bag.draw('g', now)]
    expect(drawn).not.toContain(gone)
    expect(new Set([first, ...drawn]).size).toBe(3)
  })

  it('has nothing to draw from an empty group, and a group of one plays that one', () => {
    const bag = new ShuffleBag()
    expect(bag.draw('g', [])).toBeNull()
    expect(bag.draw('g', ['only'])).toBe('only')
    expect(bag.draw('g', ['only'])).toBe('only')
  })
})
