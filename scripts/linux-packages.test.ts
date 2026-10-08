// The Linux packages the build makes, read from the one place they are declared: the
// `build` block of package.json. An AppImage cannot declare what it needs from the system,
// so a Debian package is made beside it, and what that package depends on is the part that
// has to be right — a .deb that installs and then cannot open a sound device is worse than
// no .deb at all.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SUPPORT_ADDRESS } from '../src/shared/support'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

interface BuildConfig {
  linux: {
    target: Array<{ target: string; arch: string[] }>
    maintainer?: string
  }
  deb?: { depends?: string[]; recommends?: string[] }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
  homepage?: string
  build: BuildConfig
}

/** The package names a Depends entry allows: `a | b` is either. */
function alternatives(entry: string): string[] {
  return entry.split('|').map(name => name.trim())
}

describe('the Linux packages', () => {
  it('makes a .deb beside the AppImage, both for x64', () => {
    const targets = pkg.build.linux.target.map(entry => `${entry.target}:${entry.arch.join(',')}`)
    expect(targets).toEqual(['AppImage:x64', 'deb:x64'])
  })

  it('names who maintains it with the address the app sends reports to, and a homepage', () => {
    // electron-builder refuses a .deb without either, and the address is the one support reads.
    expect(pkg.build.linux.maintainer).toBe(`Cuerunner <${SUPPORT_ADDRESS}>`)
    expect(pkg.homepage).toBe('https://cuerunner.app')
  })

  it('depends on ALSA under either of the names distributions give it', () => {
    // The engine and the MIDI module both open ALSA; Ubuntu 24.04 renamed the library
    // package `libasound2t64`, and older releases still call it `libasound2`.
    const depends = pkg.build.deb?.depends ?? []
    const alsa = depends.find(entry => alternatives(entry).includes('libasound2'))
    expect(alsa).toBeDefined()
    expect(alternatives(alsa!)).toContain('libasound2t64')
  })

  it('keeps the libraries Electron itself needs, since a custom list replaces the default one', () => {
    // electron-builder's own default list, which `depends` overrides rather than extends,
    // and the GBM library recent Electron needs to open a window at all.
    const depends = (pkg.build.deb?.depends ?? []).flatMap(alternatives)
    for (const library of [
      'libgtk-3-0', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
      'libatspi2.0-0', 'libuuid1', 'libsecret-1-0', 'libgbm1'
    ]) {
      expect(depends).toContain(library)
    }
  })
})
