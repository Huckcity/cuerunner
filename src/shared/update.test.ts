import { describe, expect, it } from 'vitest'
import {
  boundedNotes,
  canSelfUpdate,
  classifyUpdateFailure,
  defaultUpdateSettings,
  formatClockTime,
  inClockWindow,
  lockoutReason,
  normalizeUpdateSettings,
  parseClockTime,
  selfUpdateRefusal,
  UPDATE_NOTES_MAX_CHARS
} from './update'

describe('what a failure means', () => {
  it('reads a checksum that does not match as a refusal, whichever way the updater says it', () => {
    expect(classifyUpdateFailure({ code: 'ERR_CHECKSUM_MISMATCH', message: 'sha512 checksum mismatch, expected a, got b' }).kind).toBe('integrity')
    expect(classifyUpdateFailure({ message: 'sha512 checksum mismatch, expected a, got b' }).kind).toBe('integrity')
    expect(classifyUpdateFailure({ message: 'checksum mismatch: expected a but got b (X-Checksum-Sha2 header)' }).kind).toBe('integrity')
    expect(classifyUpdateFailure({ code: 'ERR_UPDATER_NO_CHECKSUM', message: 'no checksum' }).kind).toBe('integrity')
  })

  it('reads a signature that is not the publisher’s as a refusal, on Windows and on macOS', () => {
    expect(classifyUpdateFailure({ code: 'ERR_UPDATER_INVALID_SIGNATURE', message: 'not signed by the application owner' }).kind).toBe('signature')
    expect(classifyUpdateFailure({ message: 'Code signature at URL file:///… did not pass validation: code failed to satisfy specified code requirement(s)' }).kind).toBe('signature')
    expect(classifyUpdateFailure({ message: 'Could not get code signature for running application' }).kind).toBe('signature')
  })

  it('reads every way of having no network as offline', () => {
    for (const failure of [
      { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND pub.cuerunner.app' },
      { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' },
      { message: 'net::ERR_INTERNET_DISCONNECTED' },
      { message: 'net::ERR_NAME_NOT_RESOLVED' },
      { message: 'net::ERR_CONNECTION_TIMED_OUT' },
      { message: 'net::ERR_PROXY_CONNECTION_FAILED' },
      { message: 'HttpError: 502 Bad Gateway' },
      { message: 'socket hang up' }
    ]) {
      expect(classifyUpdateFailure(failure).kind, failure.message).toBe('offline')
    }
  })

  it('reads a feed that has no release for this platform as missing, not as a fault', () => {
    expect(classifyUpdateFailure({ code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND', message: 'Cannot find channel' }).kind).toBe('missing')
    expect(classifyUpdateFailure({ message: 'HttpError: 404 Not Found' }).kind).toBe('missing')
  })

  it('names anything else a fault, quoting the first line of what the updater said', () => {
    const failure = classifyUpdateFailure({ message: 'Cannot parse update info\nrawData: …' })
    expect(failure.kind).toBe('fault')
    expect(failure.sentence).toBe('The update could not be checked: Cannot parse update info.')
    expect(classifyUpdateFailure(null).kind).toBe('fault')
  })
})

describe('the lockout window', () => {
  it('reads and writes the time of day as HH:MM', () => {
    expect(parseClockTime('18:00')).toBe(1080)
    expect(parseClockTime('7:05')).toBe(425)
    expect(parseClockTime('24:00')).toBeNull()
    expect(parseClockTime('18:60')).toBeNull()
    expect(parseClockTime('six')).toBeNull()
    expect(formatClockTime(425)).toBe('07:05')
  })

  it('runs past midnight when it ends before it starts, and is empty when the two are the same', () => {
    expect(inClockWindow(23 * 60, 22 * 60, 2 * 60)).toBe(true)
    expect(inClockWindow(60, 22 * 60, 2 * 60)).toBe(true)
    expect(inClockWindow(2 * 60, 22 * 60, 2 * 60)).toBe(false)
    expect(inClockWindow(12 * 60, 22 * 60, 2 * 60)).toBe(false)
    expect(inClockWindow(12 * 60, 9 * 60, 17 * 60)).toBe(true)
    expect(inClockWindow(12 * 60, 9 * 60, 9 * 60)).toBe(false)
  })

  it('says why checks are locked out: the window first, then Show Mode with a show open', () => {
    const settings = { ...defaultUpdateSettings(), lockout: { enabled: true, from: '18:00', to: '23:30' } }
    const show = { busy: false, showMode: true, showOpen: true }
    expect(lockoutReason(settings, 19 * 60, show)).toBe('Update checks are locked out from 18:00 to 23:30.')
    expect(lockoutReason(settings, 12 * 60, show)).toBe('Update checks are locked out while a show file is open in Show Mode.')
    expect(lockoutReason(settings, 12 * 60, { ...show, showOpen: false })).toBeNull()
    expect(lockoutReason({ ...settings, lockout: { ...settings.lockout, enabled: false } }, 19 * 60, { ...show, showMode: false })).toBeNull()
  })
})

describe('the settings a file holds', () => {
  it('keeps what is valid and puts the default where something is not', () => {
    expect(normalizeUpdateSettings(undefined)).toEqual(defaultUpdateSettings())
    expect(normalizeUpdateSettings({ check: false, lockout: { enabled: true, from: '9:5', to: '23:30' }, lockInShowMode: 'no' })).toEqual({
      check: false,
      lockout: { enabled: true, from: '18:00', to: '23:30' },
      lockInShowMode: true
    })
    expect(normalizeUpdateSettings({ lockout: { from: '9:05' } }).lockout.from).toBe('09:05')
  })
})

describe('which installs replace themselves', () => {
  it('is the three the pipeline publishes a feed for', () => {
    expect(['nsis', 'dmg', 'appimage'].every(kind => canSelfUpdate(kind as never))).toBe(true)
    for (const kind of ['deb', 'rpm', 'pacman', 'development', 'unknown'] as const) {
      expect(canSelfUpdate(kind)).toBe(false)
      expect(selfUpdateRefusal(kind)).toMatch(/\S/)
    }
    expect(selfUpdateRefusal('nsis')).toBeNull()
  })
})

describe('release notes the window is handed', () => {
  it('cuts notes past the bound, and reads a feed’s list of notes as one text', () => {
    expect(boundedNotes('x'.repeat(UPDATE_NOTES_MAX_CHARS + 10))).toHaveLength(UPDATE_NOTES_MAX_CHARS + 3)
    expect(boundedNotes([{ version: '1.0.0', note: 'one' }, { version: '0.9.0', note: 'two' }])).toBe('one\n\ntwo')
    expect(boundedNotes(null)).toBe('')
  })
})
