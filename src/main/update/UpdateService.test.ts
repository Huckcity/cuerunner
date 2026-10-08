// The update rules, each one held against a fake updater that answers the way the test says:
// no network, no electron-updater, a clock and a schedule of the test's own.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, parseReleaseNotes } from '../../shared/releaseNotes'
import { UpdateService, type FoundUpdate, type UpdaterPort, type UpdateTimers } from './UpdateService'
import {
  HELD_FOR_SHOW,
  STOPPED_FOR_SHOW,
  UPDATE_DAILY_MS,
  UPDATE_TICK_MS,
  type UpdateInstall,
  type UpdateStatus
} from '../../shared/update'

/** A download the fake updater has been asked for, held open until the test settles it. */
interface PendingDownload {
  signal: AbortSignal
  progress: (fraction: number | null) => void
  resolve: () => void
  reject: (error: unknown) => void
}

class FakeUpdater implements UpdaterPort {
  feed: FoundUpdate | null = null
  checkError: unknown = null
  checks = 0
  installs = 0
  readonly downloads: PendingDownload[] = []

  async check(): Promise<FoundUpdate | null> {
    this.checks += 1
    if (this.checkError !== null) throw this.checkError
    return this.feed
  }

  download(signal: AbortSignal, progress: (fraction: number | null) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = { signal, progress, resolve, reject }
      this.downloads.push(pending)
      // electron-updater rejects a cancelled download with its CancellationError.
      signal.addEventListener('abort', () => reject(Object.assign(new Error('cancelled'), { name: 'CancellationError' })))
    })
  }

  installNow(): void {
    this.installs += 1
  }
}

/** Timers the test fires by hand, so "a day later" is a line rather than a day. */
class ManualTimers implements UpdateTimers {
  readonly timeouts: Array<{ run: () => void; ms: number; cleared: boolean }> = []
  readonly intervals: Array<{ run: () => void; ms: number; cleared: boolean }> = []
  setTimeout(run: () => void, ms: number): unknown {
    const entry = { run, ms, cleared: false }
    this.timeouts.push(entry)
    return entry
  }
  clearTimeout(handle: unknown): void {
    ;(handle as { cleared: boolean }).cleared = true
  }
  setInterval(run: () => void, ms: number): unknown {
    const entry = { run, ms, cleared: false }
    this.intervals.push(entry)
    return entry
  }
  clearInterval(handle: unknown): void {
    ;(handle as { cleared: boolean }).cleared = true
  }
}

const NEWER: FoundUpdate = { version: '0.18.0', notes: '# [0.18.0](x) (2026-10-20)\n\n### Features\n\n* **audio:** louder', releaseDate: '2026-10-20' }

const CHANGELOG = [
  '# [0.18.0](https://example/compare) (2026-10-20)',
  '',
  '### Features',
  '',
  '* **update:** the app updates itself ([abc1234](https://example/commit/abc1234))',
  '',
  '## [0.17.1](https://example/compare) (2026-10-12)',
  '',
  '### Bug Fixes',
  '',
  '* **audio:** a fade ends where it says',
  '',
  '# [0.17.0](https://example/compare) (2026-10-05)',
  '',
  '### Bug Fixes',
  '',
  '* **cue-list:** something older'
].join('\n')

let directory: string
let file: string
let clock: Date
let pushed: UpdateStatus[]
let updater: FakeUpdater
let timers: ManualTimers

function make(options: { install?: UpdateInstall; current?: string; engineBusy?: () => boolean; noUpdater?: boolean } = {}): UpdateService {
  return new UpdateService({
    current: options.current ?? '0.17.0',
    install: options.install ?? 'nsis',
    updater: async () => (options.noUpdater ? null : updater),
    filePath: file,
    changelog: () => CHANGELOG,
    engineBusy: options.engineBusy,
    push: status => pushed.push(status),
    now: () => clock,
    timers,
    launchDelayMs: 1000
  })
}

/** Lets the promise chains a call started run to the end. */
async function flush(service: UpdateService): Promise<void> {
  for (let round = 0; round < 5; round++) await Promise.resolve()
  await service.settled()
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'feat-ship-update-'))
  file = join(directory, 'updates.json')
  clock = new Date(2026, 9, 8, 12, 0, 0)
  pushed = []
  updater = new FakeUpdater()
  timers = new ManualTimers()
})

afterEach(() => {
  rmSync(directory, { recursive: true, force: true })
})

describe('checking', () => {
  it('checks once the launch delay has passed, and offers what it found without downloading it', async () => {
    updater.feed = NEWER
    const service = make()
    service.start()
    expect(updater.checks).toBe(0)
    expect(timers.timeouts[0].ms).toBe(1000)
    timers.timeouts[0].run()
    await flush(service)
    expect(updater.checks).toBe(1)
    expect(service.status().phase).toBe('available')
    expect(service.status().available).toMatchObject({ version: '0.18.0', releaseDate: '2026-10-20' })
    expect(service.status().available?.notes).toContain('louder')
    // Offering is all a check does: nothing is fetched until the operator asks.
    expect(updater.downloads).toHaveLength(0)
    expect(pushed.at(-1)?.phase).toBe('available')
  })

  it('checks again once a day has passed since the last check that reached the server', async () => {
    const service = make()
    service.start()
    timers.timeouts[0].run()
    await flush(service)
    expect(updater.checks).toBe(1)
    expect(service.status().phase).toBe('up-to-date')
    expect(timers.intervals[0].ms).toBe(UPDATE_TICK_MS)
    clock = new Date(clock.getTime() + UPDATE_DAILY_MS - 60_000)
    timers.intervals[0].run()
    await flush(service)
    expect(updater.checks, 'a check ran before a day had passed').toBe(1)
    clock = new Date(clock.getTime() + 60_000)
    timers.intervals[0].run()
    await flush(service)
    expect(updater.checks).toBe(2)
  })

  it('remembers when it last checked, so a relaunch does not count the day from zero', async () => {
    const first = make()
    await first.automaticCheck()
    const stored = JSON.parse(readFileSync(file, 'utf8')) as { lastCheckedAt: number }
    expect(stored.lastCheckedAt).toBe(clock.getTime())
    const second = make()
    expect(second.status().lastCheckedAt).toBe(clock.getTime())
  })

  it('checks nothing on its own once the operator turns checking off, and still checks when asked', async () => {
    const service = make()
    await service.configure({ check: false })
    service.start()
    timers.timeouts[0].run()
    clock = new Date(clock.getTime() + 2 * UPDATE_DAILY_MS)
    timers.intervals[0].run()
    await flush(service)
    expect(updater.checks).toBe(0)
    updater.feed = NEWER
    const status = await service.check()
    expect(updater.checks).toBe(1)
    expect(status.phase).toBe('available')
  })

  it('says nothing at all when an automatic check cannot reach the server', async () => {
    updater.checkError = Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), {})
    const service = make()
    await service.automaticCheck()
    expect(updater.checks).toBe(1)
    expect(service.status().phase).toBe('idle')
    expect(service.status().message).toBeNull()
    expect(pushed.some(status => status.message !== null), 'an offline check put a sentence on screen').toBe(false)
    expect(service.status().lastCheckedAt, 'a check that never reached the server counted as one').toBeNull()
  })

  it('is just as quiet about a feed with no release for this platform yet, or a server that is down', async () => {
    const service = make()
    for (const error of [
      Object.assign(new Error('Cannot find channel "latest.yml" update info: HttpError: 404'), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' }),
      Object.assign(new Error('getaddrinfo ENOTFOUND pub.cuerunner.app'), { code: 'ENOTFOUND' }),
      new Error('HttpError: 503 Service Unavailable')
    ]) {
      updater.checkError = error
      await service.automaticCheck()
      expect(service.status().phase).toBe('idle')
      expect(service.status().message).toBeNull()
    }
  })

  it('tells the operator who asked that the server could not be reached, in one line', async () => {
    updater.checkError = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' })
    const service = make()
    const status = await service.check()
    expect(status.phase).toBe('offline')
    expect(status.message).toBe('The update server could not be reached, so nothing was checked.')
  })
})

describe('the lockout', () => {
  it('checks nothing between the two times, even across midnight, and says why', async () => {
    const service = make()
    await service.configure({ lockout: { enabled: true, from: '22:00', to: '02:00' } })
    for (const [hour, minute] of [[23, 15], [0, 30], [1, 59]]) {
      clock = new Date(2026, 9, 8, hour, minute)
      await service.automaticCheck()
      expect(service.status().lockout).toBe('Update checks are locked out from 22:00 to 02:00.')
    }
    expect(updater.checks).toBe(0)
    clock = new Date(2026, 9, 9, 2, 0)
    expect(service.status().lockout).toBeNull()
    await service.automaticCheck()
    expect(updater.checks).toBe(1)
  })

  it('refuses a check the operator asks for during the window, naming where to change it', async () => {
    const service = make()
    await service.configure({ lockout: { enabled: true, from: '11:00', to: '13:00' } })
    await expect(service.check()).rejects.toThrow(
      'Update checks are locked out from 11:00 to 13:00. Change that in Settings → Updates.'
    )
    expect(updater.checks).toBe(0)
  })

  it('checks nothing while a show file is open in Show Mode, and only then', async () => {
    const service = make()
    service.report({ busy: false, showMode: true, showOpen: true })
    await service.automaticCheck()
    expect(updater.checks).toBe(0)
    expect(service.status().lockout).toBe('Update checks are locked out while a show file is open in Show Mode.')
    // An untitled show in Show Mode is nobody's show yet.
    service.report({ busy: false, showMode: true, showOpen: false })
    expect(service.status().lockout).toBeNull()
    await service.automaticCheck()
    expect(updater.checks).toBe(1)
    // And the operator can turn the Show Mode rule off.
    await service.configure({ lockInShowMode: false })
    service.report({ busy: false, showMode: true, showOpen: true })
    expect(service.status().lockout).toBeNull()
  })

  it('tells the window when Show Mode starts or ends a lockout', async () => {
    const service = make()
    pushed.length = 0
    service.report({ busy: false, showMode: true, showOpen: true })
    expect(pushed.at(-1)?.lockout).toMatch(/Show Mode/)
    service.report({ busy: false, showMode: false, showOpen: true })
    expect(pushed.at(-1)?.lockout).toBeNull()
  })
})

describe('downloading and installing, never during a show', () => {
  async function offered(options: Parameters<typeof make>[0] = {}): Promise<UpdateService> {
    updater.feed = NEWER
    const service = make(options)
    await service.check()
    return service
  }

  it('holds a download asked for while a cue is running, with a sentence, and fetches nothing', async () => {
    const service = await offered()
    service.report({ busy: true, showMode: false, showOpen: true })
    await expect(service.download()).rejects.toThrow(HELD_FOR_SHOW)
    expect(service.status().phase).toBe('held')
    expect(service.status().message).toBe(HELD_FOR_SHOW)
    expect(updater.downloads).toHaveLength(0)
  })

  it('counts sound this process is playing as the show running, whatever the window said', async () => {
    let playing = true
    const service = await offered({ engineBusy: () => playing })
    await expect(service.download()).rejects.toThrow(HELD_FOR_SHOW)
    expect(updater.downloads).toHaveLength(0)
    playing = false
    await service.download()
    expect(updater.downloads).toHaveLength(1)
  })

  it('downloads when the show is idle, reports the progress, and waits for the operator to restart', async () => {
    const service = await offered()
    await service.download()
    expect(service.status().phase).toBe('downloading')
    updater.downloads[0].progress(0.5)
    expect(service.status().progress).toBe(0.5)
    updater.downloads[0].resolve()
    await flush(service)
    expect(service.status().phase).toBe('downloaded')
    // Downloaded is as far as it goes on its own: the restart is the operator's.
    expect(updater.installs).toBe(0)
  })

  it('stops a download the show starts under, and installs nothing', async () => {
    const service = await offered()
    await service.download()
    service.report({ busy: true, showMode: false, showOpen: true })
    expect(updater.downloads[0].signal.aborted).toBe(true)
    await flush(service)
    expect(service.status().phase).toBe('held')
    expect(service.status().message).toBe(STOPPED_FOR_SHOW)
    expect(updater.installs).toBe(0)
  })

  it('refuses a download whose checksum does not match, with a sentence', async () => {
    const service = await offered()
    await service.download()
    updater.downloads[0].reject(
      Object.assign(new Error('sha512 checksum mismatch, expected abc, got def'), { code: 'ERR_CHECKSUM_MISMATCH' })
    )
    await flush(service)
    expect(service.status().phase).toBe('refused')
    expect(service.status().message).toBe(
      'Refused: the download did not match the checksum its release published, so it was deleted and nothing was installed.'
    )
    expect(updater.installs).toBe(0)
  })

  it('refuses a download signed by somebody else, with a sentence', async () => {
    const service = await offered()
    await service.download()
    updater.downloads[0].reject(
      Object.assign(new Error('New version 0.18.0 is not signed by the application owner: publisherNames: Cuerunner'), {
        code: 'ERR_UPDATER_INVALID_SIGNATURE'
      })
    )
    await flush(service)
    expect(service.status().phase).toBe('refused')
    expect(service.status().message).toMatch(/^Refused: the update is not signed by the publisher/)
  })

  it('refuses a restart while the show is running, and restarts only when the operator asks with it idle', async () => {
    const service = await offered()
    await service.download()
    updater.downloads[0].resolve()
    await flush(service)
    service.report({ busy: true, showMode: false, showOpen: true })
    await expect(service.install()).rejects.toThrow(HELD_FOR_SHOW)
    expect(updater.installs).toBe(0)
    service.report({ busy: false, showMode: false, showOpen: true })
    await service.install()
    expect(updater.installs).toBe(1)
  })

  it('has nothing to download before a check, and nothing to install before a download', async () => {
    const service = make()
    await expect(service.download()).rejects.toThrow('There is no update to download: check for one first.')
    await expect(service.install()).rejects.toThrow('There is no downloaded update to install.')
  })

  it('downloads nothing during the lockout window either', async () => {
    const service = await offered()
    await service.configure({ lockout: { enabled: true, from: '11:00', to: '13:00' } })
    await expect(service.download()).rejects.toThrow(/locked out from 11:00 to 13:00\. Nothing is downloaded/)
    expect(updater.downloads).toHaveLength(0)
  })

  it('leaves the schedule alone while a download is under way or waiting to install', async () => {
    const service = await offered()
    await service.download()
    await service.automaticCheck()
    expect(updater.checks).toBe(1)
    updater.downloads[0].resolve()
    await flush(service)
    await service.automaticCheck()
    expect(updater.checks).toBe(1)
  })
})

describe('a copy that cannot replace itself', () => {
  it('says a .deb has a newer version and where to get it, and downloads nothing', async () => {
    updater.feed = NEWER
    const service = make({ install: 'deb' })
    const status = await service.check()
    expect(status.phase).toBe('available')
    expect(status.message).toMatch(/installed from the \.deb package, which cannot replace itself/)
    await expect(service.download()).rejects.toThrow(/cannot replace itself: download the new \.deb/)
    expect(updater.downloads).toHaveLength(0)
  })

  it('leaves a development build alone, and says so when asked', async () => {
    const service = make({ install: 'development', noUpdater: true })
    service.start()
    timers.timeouts[0].run()
    await flush(service)
    expect(service.status().phase).toBe('idle')
    await expect(service.check()).rejects.toThrow('This is a development build, run from its source tree: it updates when the source does.')
  })
})

describe('what is new', () => {
  it('says nothing on a first run, and remembers the version for next time', async () => {
    const service = make({ current: '0.18.0' })
    expect(await service.takeWhatsNew()).toBeNull()
    await flush(service)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(JSON.parse(readFileSync(file, 'utf8')).lastSeenVersion).toBe('0.18.0')
  })

  it('shows every version since the last one this machine ran, newest first, once', async () => {
    writeFileSync(file, JSON.stringify({ lastSeenVersion: '0.17.0' }))
    const service = make({ current: '0.18.0' })
    const news = await service.takeWhatsNew()
    expect(news?.previous).toBe('0.17.0')
    expect(news?.version).toBe('0.18.0')
    expect(news?.sections.map(section => section.version)).toEqual(['0.18.0', '0.17.1'])
    expect(news?.sections[0].groups[0].items[0]).toEqual({ scope: 'update', text: 'the app updates itself' })
    expect(await service.takeWhatsNew(), 'the notes were handed out twice').toBeNull()
    // And not again after a relaunch.
    expect(await make({ current: '0.18.0' }).takeWhatsNew()).toBeNull()
  })

  it('says nothing after a downgrade, which somebody chose', async () => {
    writeFileSync(file, JSON.stringify({ lastSeenVersion: '0.19.0' }))
    expect(await make({ current: '0.18.0' }).takeWhatsNew()).toBeNull()
  })
})

describe('the settings', () => {
  it('keeps the operator’s choices, merging a change to the window with the rest of it', async () => {
    const service = make()
    await service.configure({ lockout: { enabled: true, from: '18:00', to: '23:30' } })
    await service.configure({ lockout: { ...service.status().settings.lockout, to: '23:45' } })
    await service.configure({ check: false })
    const relaunched = make()
    expect(relaunched.status().settings).toEqual({
      check: false,
      lockout: { enabled: true, from: '18:00', to: '23:45' },
      lockInShowMode: true
    })
  })

  it('reads a damaged file as the defaults, which check', () => {
    writeFileSync(file, '{ not json')
    expect(make().status().settings.check).toBe(true)
    writeFileSync(file, JSON.stringify({ settings: { check: 'yes', lockout: { enabled: true, from: '25:00' } } }))
    expect(make().status().settings).toMatchObject({ check: true, lockout: { enabled: true, from: '18:00' } })
  })
})

describe('the CHANGELOG this build ships', () => {
  it('reads as versions, newest first, each with its changes', () => {
    const changelog = readFileSync(join(__dirname, '..', '..', '..', 'CHANGELOG.md'), 'utf8')
    const sections = parseReleaseNotes(changelog)
    expect(sections.length).toBeGreaterThan(5)
    expect(compareVersions(sections[0].version, sections[1].version)).toBe(1)
    expect(sections[0].groups.every(group => group.items.length > 0)).toBe(true)
  })
})
