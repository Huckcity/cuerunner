// How this copy was installed, from what the running process can see of it. electron-updater
// makes the same decision for itself on Linux — the `package-type` file electron-builder writes
// into a .deb's resources is how it chooses its Debian updater — and this reads the same file, so
// a .deb is told to go to the download page rather than handed to an updater that would ask for
// the root password to run dpkg mid-show.

import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateInstall } from '../../shared/update'

export interface InstallFacts {
  platform: NodeJS.Platform
  /** Whether this is a packaged build, rather than one run out of a source tree. */
  packaged: boolean
  /** `$APPIMAGE`: the AppImage runtime sets it to the file the app was started from. */
  appImage: string | undefined
  /** The `package-type` electron-builder writes for a system package, or null. */
  packageType: string | null
}

export function installKind(facts: InstallFacts): UpdateInstall {
  if (!facts.packaged) return 'development'
  if (facts.platform === 'win32') return 'nsis'
  if (facts.platform === 'darwin') return 'dmg'
  if (facts.platform === 'linux') {
    if (facts.appImage !== undefined && facts.appImage !== '') return 'appimage'
    switch (facts.packageType) {
      case 'deb':
        return 'deb'
      case 'rpm':
        return 'rpm'
      case 'pacman':
        return 'pacman'
      default:
        return 'unknown'
    }
  }
  return 'unknown'
}

/** The `package-type` beside the app's resources: a word, or null when there is none to read. */
export function readPackageType(resourcesPath: string): string | null {
  const file = join(resourcesPath, 'package-type')
  try {
    // A word, not a document: anything larger is not the file electron-builder writes.
    if (statSync(file).size > 64) return null
    const word = readFileSync(file, 'utf8').trim()
    return /^[a-z]+$/.test(word) ? word : null
  } catch {
    return null
  }
}
