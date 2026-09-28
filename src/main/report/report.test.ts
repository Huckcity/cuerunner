// The report is what a person answering the mail would otherwise ask for one question at a
// time, and the one thing it must not be is a way for the operator's account name, their
// licence, or an unbounded log to leave the machine unread. These hold the composer to that.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  composeReport,
  DESCRIPTION_LIMIT,
  DUMP_LIMIT,
  LOG_LINES,
  LOG_LINE_LIMIT,
  readCrashDumps,
  redactHome,
  type ReportFacts
} from './report'

function facts(over: Partial<ReportFacts> = {}): ReportFacts {
  return {
    appVersion: '0.14.0',
    packaged: true,
    electron: '41.0.0',
    chrome: '140.0.0',
    node: '22.0.0',
    platform: 'win32',
    arch: 'x64',
    osRelease: '10.0.22631',
    engine: null,
    engineStatus: { connected: true, binaryPath: null, restarts: 0, lastError: null, started: true, stderrTail: [] },
    license: 'unlicensed',
    crashDumps: [],
    crashDumpDir: 'C:\\Users\\ruth\\AppData\\Roaming\\Cuerunner\\Crashpad',
    home: 'C:\\Users\\ruth',
    now: Date.parse('2026-09-28T20:00:00Z'),
    ...over
  }
}

describe('redactHome', () => {
  it('replaces the home folder in every spelling a log writes a path in', () => {
    const text = 'C:\\Users\\ruth\\Music\\a.wav and C:/Users/ruth/Music/b.wav and c:\\users\\RUTH\\c.wav'
    expect(redactHome(text, 'C:\\Users\\ruth')).toBe('~\\Music\\a.wav and ~/Music/b.wav and ~\\c.wav')
  })

  it('leaves a home that is a single character alone rather than eating every slash', () => {
    expect(redactHome('a/b/c', '/')).toBe('a/b/c')
  })
})

describe('composeReport', () => {
  it('holds the operator’s words, the versions and the engine’s own account', () => {
    const text = composeReport(facts({
      engineStatus: {
        connected: false, binaryPath: null, restarts: 3, lastError: 'device removed', started: true,
        stderrTail: ['wasapi: lost the device']
      }
    }), { description: 'The sound stopped mid-cue', log: [] })

    expect(text).toContain('The sound stopped mid-cue')
    expect(text).toContain('Cuerunner 0.14.0')
    expect(text).toContain('win32 x64')
    expect(text).toContain('restarts since launch: 3')
    expect(text).toContain('last error: device removed')
    expect(text).toContain('wasapi: lost the device')
    expect(text).toContain('Nothing has been sent anywhere.')
  })

  it('says the licence state and never anything a key carries', () => {
    const text = composeReport(facts({ license: 'active' }), { description: '', log: [] })
    expect(text).toContain('licence: active')
    expect(text).not.toMatch(/licensee|CRN-/i)
  })

  it('strips the home folder from the log and from the crash folder', () => {
    const text = composeReport(facts(), {
      description: 'see C:\\Users\\ruth\\Desktop\\notes.txt',
      log: ['missing C:\\Users\\ruth\\Music\\walk-in.wav']
    })
    expect(text).not.toContain('ruth')
    expect(text).toContain('~\\Music\\walk-in.wav')
    expect(text).toContain('~\\AppData\\Roaming\\Cuerunner\\Crashpad')
  })

  it('keeps the newest log lines, cuts a runaway line, and says it cut', () => {
    const log = Array.from({ length: LOG_LINES + 50 }, (_, i) => `line ${i}`)
    log.push('x'.repeat(LOG_LINE_LIMIT * 5))
    const text = composeReport(facts(), { description: '', log })

    expect(text).not.toContain('line 0\n')
    expect(text).toContain(`line ${LOG_LINES + 49}`)
    expect(text).toContain(`[cut at ${LOG_LINE_LIMIT} characters]`)
    expect(text).toContain(`SESSION LOG (last ${LOG_LINES} lines)`)
    expect(text.length).toBeLessThan(LOG_LINES * (LOG_LINE_LIMIT + 60) + 5_000)
  })

  it('cuts a description past its ceiling instead of carrying it whole', () => {
    const text = composeReport(facts(), { description: 'y'.repeat(DESCRIPTION_LIMIT + 500), log: [] })
    expect(text).toContain(`[cut at ${DESCRIPTION_LIMIT} characters]`)
    expect(text).not.toContain('y'.repeat(DESCRIPTION_LIMIT + 1))
  })

  it('reads as empty rather than blank when there is nothing to say', () => {
    const text = composeReport(facts(), { description: '  ', log: [] })
    expect(text).toContain('(nothing written)')
    expect(text).toContain('(empty)')
    expect(text).toContain('(none)')
  })
})

describe('readCrashDumps', () => {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function folder(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-dumps-'))
    made.push(dir)
    return dir
  }

  it('is empty for a machine that has never crashed', () => {
    expect(readCrashDumps(join(tmpdir(), 'cuerunner-no-such-folder'))).toEqual([])
  })

  it('lists only dumps, newest first, from the folders Crashpad nests them in, and never reads one', () => {
    const dir = folder()
    mkdirSync(join(dir, 'reports'))
    writeFileSync(join(dir, 'reports', 'old.dmp'), 'aaaa')
    writeFileSync(join(dir, 'reports', 'new.DMP'), 'bb')
    writeFileSync(join(dir, 'settings.dat'), 'not a dump')
    utimesSync(join(dir, 'reports', 'old.dmp'), 1_000, 1_000)
    utimesSync(join(dir, 'reports', 'new.DMP'), 2_000, 2_000)

    expect(readCrashDumps(dir).map(dump => [dump.name, dump.bytes])).toEqual([['new.DMP', 2], ['old.dmp', 4]])
  })

  it('lists at most the newest few', () => {
    const dir = folder()
    for (let i = 0; i < DUMP_LIMIT + 5; i++) {
      const file = join(dir, `${i}.dmp`)
      writeFileSync(file, 'x')
      utimesSync(file, 1_000 + i, 1_000 + i)
    }
    const listed = readCrashDumps(dir)
    expect(listed).toHaveLength(DUMP_LIMIT)
    expect(listed[0].name).toBe(`${DUMP_LIMIT + 4}.dmp`)
  })
})
