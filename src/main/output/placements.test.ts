import { describe, expect, it, vi } from 'vitest'
import { MAX_KEPT_PLACEMENTS, createMachinePlacements, normalizePlacement } from './placements'

describe('where this machine puts its outputs', () => {
  it('opens every output as a window on a machine that has placed none', () => {
    const placements = createMachinePlacements({ filePath: 'x', readFile: () => { throw new Error('ENOENT') } })
    expect(placements.placement('out-1')).toEqual({ displayId: null, displayLabel: '', fullscreen: false, bounds: null })
    expect(placements.timerWindow()).toEqual({ open: false, mode: 'remaining' })
  })

  it('writes a placement down, keyed by the output, and reads it back on the next run', async () => {
    let disk = ''
    const write = vi.fn(async (_path: string, text: string) => { disk = text })
    const first = createMachinePlacements({ filePath: 'p.json', readFile: () => disk, writeFile: write })
    await first.place('out-1', { displayId: 7, displayLabel: 'Projector', fullscreen: true, bounds: null })
    await first.setTimerWindow({ open: true, mode: 'clock' })
    const second = createMachinePlacements({ filePath: 'p.json', readFile: () => disk, writeFile: write })
    expect(second.placement('out-1')).toEqual({ displayId: 7, displayLabel: 'Projector', fullscreen: true, bounds: null })
    expect(second.timerWindow()).toEqual({ open: true, mode: 'clock' })
  })

  it('reads a file this machine did not write as the defaults, field by field', () => {
    expect(normalizePlacement({ displayId: 'two', fullscreen: 'yes', bounds: { x: 0, y: 0, width: 4, height: 900 } }))
      .toEqual({ displayId: null, displayLabel: '', fullscreen: false, bounds: null })
    const placements = createMachinePlacements({ filePath: 'x', readFile: () => '{ not json' })
    expect(placements.placement('a').fullscreen).toBe(false)
  })

  it('forgets the oldest places past the most it keeps', async () => {
    let disk = ''
    const placements = createMachinePlacements({ filePath: 'p.json', readFile: () => disk, writeFile: async (_p, text) => { disk = text } })
    for (let i = 0; i < MAX_KEPT_PLACEMENTS + 5; i++) {
      await placements.place(`out-${i}`, { displayId: i, displayLabel: '', fullscreen: false, bounds: null })
    }
    const stored = JSON.parse(disk) as { outputs: Record<string, unknown> }
    expect(Object.keys(stored.outputs)).toHaveLength(MAX_KEPT_PLACEMENTS)
    expect(stored.outputs['out-0']).toBeUndefined()
    expect(stored.outputs[`out-${MAX_KEPT_PLACEMENTS + 4}`]).toBeDefined()
  })
})
