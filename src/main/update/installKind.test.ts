import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installKind, readPackageType } from './installKind'

const base = { platform: 'linux' as NodeJS.Platform, packaged: true, appImage: undefined, packageType: null }

describe('how this copy was installed', () => {
  it('is a development build whenever it is not packaged', () => {
    expect(installKind({ ...base, packaged: false, appImage: '/opt/Cuerunner.AppImage' })).toBe('development')
  })

  it('is the platform’s own installer on Windows and macOS', () => {
    expect(installKind({ ...base, platform: 'win32' })).toBe('nsis')
    expect(installKind({ ...base, platform: 'darwin' })).toBe('dmg')
  })

  it('is an AppImage when the AppImage runtime says so, and a system package when electron-builder wrote one', () => {
    expect(installKind({ ...base, appImage: '/home/op/Cuerunner.AppImage', packageType: 'deb' })).toBe('appimage')
    expect(installKind({ ...base, packageType: 'deb' })).toBe('deb')
    expect(installKind({ ...base, packageType: 'rpm' })).toBe('rpm')
    expect(installKind({ ...base, packageType: 'pacman' })).toBe('pacman')
    expect(installKind({ ...base })).toBe('unknown')
  })
})

describe('the package-type file', () => {
  let directory = ''
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('is read as one word, and anything else is no answer', () => {
    directory = mkdtempSync(join(tmpdir(), 'feat-ship-pkg-'))
    expect(readPackageType(directory)).toBeNull()
    writeFileSync(join(directory, 'package-type'), 'deb\n')
    expect(readPackageType(directory)).toBe('deb')
    writeFileSync(join(directory, 'package-type'), 'deb; rm -rf /')
    expect(readPackageType(directory)).toBeNull()
    writeFileSync(join(directory, 'package-type'), 'x'.repeat(100))
    expect(readPackageType(directory)).toBeNull()
  })
})
