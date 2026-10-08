import { describe, expect, it, vi } from 'vitest'
import { MAX_KEPT_CHOICES, createMachineCameraChoices, normalizeCameraDevice } from './cameraChoices'

describe('which device this machine opens for each camera cue', () => {
  it('has none on a machine that has picked none', () => {
    const choices = createMachineCameraChoices({ filePath: 'x', readFile: () => { throw new Error('ENOENT') } })
    expect(choices.choice('c1')).toBeNull()
    expect(choices.all()).toEqual({})
  })

  it('writes a pick down by cue, reads it back on the next run, and forgets one put away', async () => {
    let disk = ''
    const write = vi.fn(async (_path: string, text: string) => { disk = text })
    const first = createMachineCameraChoices({ filePath: 'c.json', readFile: () => disk, writeFile: write })
    await first.choose('c1', { deviceId: 'abc', label: 'Stage cam' })
    await first.choose('c2', { deviceId: 'def', label: 'Desk cam' })
    const second = createMachineCameraChoices({ filePath: 'c.json', readFile: () => disk, writeFile: write })
    expect(second.choice('c1')).toEqual({ deviceId: 'abc', label: 'Stage cam' })
    await second.choose('c1', null)
    expect(second.choice('c1')).toBeNull()
    expect(Object.keys(JSON.parse(disk).cues)).toEqual(['c2'])
  })

  it('reads a file this machine did not write as nothing, entry by entry', () => {
    expect(normalizeCameraDevice({ deviceId: 7 })).toBeNull()
    expect(normalizeCameraDevice({ deviceId: '' })).toBeNull()
    expect(normalizeCameraDevice({ deviceId: 'x'.repeat(600) })).toBeNull()
    expect(normalizeCameraDevice({ deviceId: 'abc' })).toEqual({ deviceId: 'abc', label: '' })
    const choices = createMachineCameraChoices({ filePath: 'x', readFile: () => '{ not json' })
    expect(choices.all()).toEqual({})
    const huge = createMachineCameraChoices({ filePath: 'x', readFile: () => ' '.repeat(600 * 1024) })
    expect(huge.all()).toEqual({})
  })

  it('forgets the oldest picks past the most it keeps', async () => {
    let disk = ''
    const choices = createMachineCameraChoices({ filePath: 'c.json', readFile: () => disk, writeFile: async (_p, text) => { disk = text } })
    for (let i = 0; i < MAX_KEPT_CHOICES + 3; i++) await choices.choose(`c${i}`, { deviceId: `d${i}`, label: '' })
    const stored = JSON.parse(disk) as { cues: Record<string, unknown> }
    expect(Object.keys(stored.cues)).toHaveLength(MAX_KEPT_CHOICES)
    expect(stored.cues['c0']).toBeUndefined()
  })
})
