// The session log on disk: stamped lines, each bounded, one file rolled to one previous at
// its ceiling, and a write that cannot happen is swallowed rather than thrown into the show.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LOG_BATCH_LIMIT, LOG_FILE_NAME, LOG_FILE_PREVIOUS, LOG_LINE_LIMIT,
  SessionLogFile, boundLine, isLogBatch
} from './sessionLogFile'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cuerunner-parity-sweep-log-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const at = new Date('2026-10-08T20:05:00.000Z')

describe('SessionLogFile', () => {
  it('writes each line stamped with when it was written, in the order asked', async () => {
    const log = new SessionLogFile(join(dir, 'logs'), 1024 * 1024, () => at)
    await log.append(['INFO [1 · Walk-in] started'])
    await log.append(['ERROR [main] audio engine exited', 'INFO second'])
    expect(readFileSync(join(dir, 'logs', LOG_FILE_NAME), 'utf-8')).toBe(
      '2026-10-08T20:05:00.000Z INFO [1 · Walk-in] started\n' +
      '2026-10-08T20:05:00.000Z ERROR [main] audio engine exited\n' +
      '2026-10-08T20:05:00.000Z INFO second\n'
    )
  })

  it('rolls the file to one previous at its ceiling, so the folder never holds more than two', async () => {
    const log = new SessionLogFile(dir, 200, () => at)
    const line = 'x'.repeat(60)
    for (let i = 0; i < 3; i++) await log.append([`${i} ${line}`])
    // Three stamped lines pass 200 bytes: the third starts a new file.
    expect(readFileSync(join(dir, LOG_FILE_PREVIOUS), 'utf-8')).toContain('1 xxx')
    expect(readFileSync(join(dir, LOG_FILE_NAME), 'utf-8')).toBe(`2026-10-08T20:05:00.000Z 2 ${line}\n`)
    for (let i = 3; i < 6; i++) await log.append([`${i} ${line}`])
    expect(readFileSync(join(dir, LOG_FILE_PREVIOUS), 'utf-8')).not.toContain('0 xxx')
  })

  it('never rejects, even where it cannot write', async () => {
    // A file where the folder should be: no log can be made there.
    const blocked = join(dir, 'not-a-folder')
    writeFileSync(blocked, 'in the way')
    const log = new SessionLogFile(blocked, 1024, () => at)
    await expect(log.append(['lost'])).resolves.toBeUndefined()
    // And the next write still goes through the queue.
    await expect(log.append(['also lost'])).resolves.toBeUndefined()
    expect(existsSync(join(blocked, LOG_FILE_NAME))).toBe(false)
  })

  it('takes no more than one batch’s worth of lines from a single write', async () => {
    const log = new SessionLogFile(dir, 10 * 1024 * 1024, () => at)
    await log.append(Array.from({ length: LOG_BATCH_LIMIT + 50 }, (_, i) => `line ${i}`))
    const lines = readFileSync(join(dir, LOG_FILE_NAME), 'utf-8').trimEnd().split('\n')
    expect(lines).toHaveLength(LOG_BATCH_LIMIT)
  })
})

describe('boundLine', () => {
  it('keeps a line on one line and no longer than the limit', () => {
    expect(boundLine('a\nb\r\nc')).toBe('a ⏎ b ⏎ c')
    const long = boundLine('y'.repeat(LOG_LINE_LIMIT + 10))
    expect(long).toHaveLength(LOG_LINE_LIMIT + 1)
    expect(long.endsWith('…')).toBe(true)
  })
})

describe('isLogBatch', () => {
  it('takes a bounded list of strings and nothing else', () => {
    expect(isLogBatch(['a', 'b'])).toBe(true)
    expect(isLogBatch([])).toBe(true)
    expect(isLogBatch('a')).toBe(false)
    expect(isLogBatch([1])).toBe(false)
    expect(isLogBatch(Array.from({ length: LOG_BATCH_LIMIT + 1 }, () => 'x'))).toBe(false)
  })
})
