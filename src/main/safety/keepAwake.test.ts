// Whether the OS really holds the app off is observable only on a real machine — the
// macOS runners stretch a wait visibly when nothing does — so what is pinned here is the
// contract with the OS: the assertion that fits a desk, and one blocker however often the
// app asks for it.
import { describe, it, expect, vi } from 'vitest'
import type * as KeepAwakeModule from './keepAwake'

const { start, isStarted, releasedByTheOs } = vi.hoisted(() => {
  let nextId = 0
  const live = new Set<number>()
  return {
    start: vi.fn(() => {
      const id = ++nextId
      live.add(id)
      return id
    }),
    isStarted: vi.fn((id: number) => live.has(id)),
    /** Whatever the OS does to the assertion behind the app's back. */
    releasedByTheOs: () => live.clear()
  }
})

vi.mock('electron', () => ({ powerSaveBlocker: { start, isStarted } }))

/** A fresh module per test: the id it remembers is state, and state is the subject. */
async function load(): Promise<typeof KeepAwakeModule> {
  vi.resetModules()
  start.mockClear()
  return import('./keepAwake')
}

describe('keepAwake', () => {
  it('asks for the assertion that keeps the timers, not the one that keeps the screen lit', async () => {
    const { keepAwake } = await load()

    keepAwake()

    expect(start).toHaveBeenCalledWith('prevent-app-suspension')
  })

  it('holds a single blocker however often the app asks', async () => {
    const { keepAwake } = await load()

    keepAwake()
    keepAwake()
    keepAwake()

    expect(start).toHaveBeenCalledTimes(1)
  })

  it('reports what the OS holds, not what the app once asked for', async () => {
    const { keepAwake, keepAwakeHeld } = await load()

    keepAwake()
    expect(keepAwakeHeld()).toBe(true)

    releasedByTheOs()
    expect(keepAwakeHeld()).toBe(false)
  })
})