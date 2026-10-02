// What a pack used the last time it did a show, held at the edges that decide it: where one
// session ends and the next begins, what is too short or too small to say anything, and that a
// bad file never stops a show opening.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BatteryLog } from './BatteryLog'

const MIN = 60_000
let dir = ''
let file = ''
let clock = 0

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'battery-log-'))
  file = join(dir, 'rf-battery.json')
  clock = 1_700_000_000_000
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

/** The write is real disk I/O the fake clock cannot advance, so wait for the file itself. */
async function written(path: string): Promise<void> {
  for (let tries = 0; tries < 200; tries += 1) {
    if (await access(path).then(() => true, () => false)) return
    await new Promise(resolve => setImmediate(resolve))
  }
  throw new Error(`${path} was never written`)
}

const log = (): BatteryLog => new BatteryLog({ filePath: file, now: () => clock })

/** A pack read once a minute from `from` down to `to`, a point a time over `minutes`. */
function show(l: BatteryLog, id: string, from: number, to: number, minutes: number): void {
  for (let m = 0; m <= minutes; m += 1) {
    clock += MIN
    l.observe(id, Math.round(from + ((to - from) * m) / minutes))
  }
}

describe('BatteryLog', () => {
  it('knows nothing of a pack it has never seen, or has only seen this session', () => {
    const l = log()
    expect(l.lastUsed('ch-1')).toBeUndefined()
    show(l, 'ch-1', 90, 60, 60)
    // The session still running is not a past: it is what is being asked about.
    expect(l.lastUsed('ch-1')).toBeUndefined()
  })

  it('says what the last show used once the pack has been off and come back', () => {
    const l = log()
    show(l, 'ch-1', 90, 66, 120)
    clock += 3 * 60 * MIN // switched off overnight
    l.observe('ch-1', 61)

    expect(l.lastUsed('ch-1')).toBe(24)
  })

  it('takes fresh cells as the end of a session: a jump up of ten points is somebody opening the pack', () => {
    const l = log()
    show(l, 'ch-1', 80, 40, 90)
    clock += MIN
    l.observe('ch-1', 100)

    expect(l.lastUsed('ch-1')).toBe(40)
  })

  it('does not take gauge noise for fresh cells, or for a new session', () => {
    const l = log()
    // 60, 63, 59, 66, 58: a gauge that wanders by a few points is one pack running down.
    for (const percent of [60, 63, 59, 66, 58]) {
      clock += 5 * MIN
      l.observe('ch-1', percent)
    }
    clock += 3 * 60 * MIN
    l.observe('ch-1', 57)

    // One session of 60 -> 58 over twenty minutes: under what the gauge itself wanders by.
    expect(l.lastUsed('ch-1')).toBeUndefined()
  })

  it('ignores a session too short to be a show, and one that used less than the gauge\'s noise', () => {
    const l = log()
    show(l, 'bench', 90, 70, 10) // ten minutes on the bench
    show(l, 'quiet', 90, 88, 120) // two points in two hours
    clock += 3 * 60 * MIN
    l.observe('bench', 70)
    l.observe('quiet', 88)

    expect(l.lastUsed('bench')).toBeUndefined()
    expect(l.lastUsed('quiet')).toBeUndefined()
  })

  it('reads the worst of the recent shows, because the question is whether it will last', () => {
    const l = log()
    for (const used of [10, 30, 15]) {
      show(l, 'ch-1', 90, 90 - used, 90)
      clock += 3 * 60 * MIN
    }
    l.observe('ch-1', 90)

    expect(l.lastUsed('ch-1')).toBe(30)
  })

  it('forgets a show once more recent ones have pushed it out of what is read', () => {
    const l = log()
    for (const used of [50, 10, 12, 14]) {
      show(l, 'ch-1', 90, 90 - used, 90)
      clock += 3 * 60 * MIN
    }
    l.observe('ch-1', 90)

    expect(l.lastUsed('ch-1')).toBe(14)
  })

  it('keeps its past across a restart, once it has been told to write', async () => {
    const first = log()
    show(first, 'ch-1', 90, 66, 120)
    clock += 3 * 60 * MIN
    first.observe('ch-1', 61)
    await first.flush()

    const second = log()
    expect(second.lastUsed('ch-1')).toBe(24)
  })

  it('writes on its own a little after something changed, and not at all when nothing did', async () => {
    const l = log()
    l.observe('ch-1', 80)
    await vi.advanceTimersByTimeAsync(11_000)
    await written(file)
    expect(JSON.parse(await readFile(file, 'utf-8')).packs['ch-1'].current.start).toBe(80)

    const stamp = await readFile(file, 'utf-8')
    l.observe('ch-1', 80) // the same reading, again
    await vi.advanceTimersByTimeAsync(11_000)
    await new Promise(resolve => setImmediate(resolve))
    expect(await readFile(file, 'utf-8')).toBe(stamp)
  })

  it('leaves no temporary file beside the one it writes', async () => {
    const l = log()
    l.observe('ch-1', 80)
    await l.flush()
    expect(await readdir(dir)).toEqual(['rf-battery.json'])
  })

  it('opens with no past from a file that is missing, corrupt or not its own', async () => {
    expect(log().lastUsed('ch-1')).toBeUndefined()
    await writeFile(file, '{ nope')
    expect(log().lastUsed('ch-1')).toBeUndefined()
    await writeFile(file, JSON.stringify({ version: 1, packs: { 'ch-1': { finished: [{ start: 'x' }, 5, null] } } }))
    expect(log().lastUsed('ch-1')).toBeUndefined()
  })

  it('keeps no more packs than it is willing to write, dropping the oldest', async () => {
    const l = log()
    for (let i = 0; i < 80; i += 1) l.observe(`ch-${i}`, 80)
    await l.flush()
    const packs = Object.keys(JSON.parse(await readFile(file, 'utf-8')).packs)
    expect(packs).toHaveLength(64)
    expect(packs).not.toContain('ch-0')
    expect(packs).toContain('ch-79')
  })
})
