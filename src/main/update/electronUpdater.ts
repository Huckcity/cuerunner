// electron-updater (MIT, electron-userland), as the port the update rules talk to.
//
// It is loaded on first use rather than with main: it reads the app's version and paths as it
// is constructed, and a machine whose checks are off never needs it. Everything it would do on
// its own is turned off here — it never downloads by itself, never installs a web installer and
// never patches an old file block by block — so what it does is what `UpdateService` asks: look
// at the feed, download one file and check its SHA-512 (and on Windows the publisher who signed
// it), and install either on the operator's restart or on the quit that was happening anyway.

import type { AppUpdater, ProgressInfo } from 'electron-updater'
import type { UpdateInstall } from '../../shared/update'
import type { FoundUpdate, UpdaterPort } from './UpdateService'

export interface ElectronUpdaterOptions {
  /**
   * How this copy was installed, which picks the updater: named rather than left to
   * electron-updater's own guess, which reads a `package-type` file first — and an AppImage
   * packaged beside a .deb can carry the .deb's.
   */
  install: UpdateInstall
  /** The feed: the folder the `latest*.yml` files are in. */
  feedUrl: string
  /**
   * A config file standing in for the `app-update.yml` a packaged build carries, for a build
   * run out of the source tree that has been pointed at a feed (the E2E suite's own server).
   */
  devConfigPath: string | null
  log(line: string): void
}

export async function createElectronUpdater(options: ElectronUpdaterOptions): Promise<UpdaterPort> {
  const module = await import('electron-updater')
  const { CancellationToken } = module
  // A system package only ever checks — `UpdateService` downloads nothing for one — but it is
  // still given its own updater, because the AppImage one counts itself inactive anywhere the
  // AppImage runtime has not set `$APPIMAGE`.
  const updater: AppUpdater = ((): AppUpdater => {
    switch (options.install) {
      case 'nsis':
        return new module.NsisUpdater()
      case 'dmg':
        return new module.MacUpdater()
      case 'appimage':
        return new module.AppImageUpdater()
      case 'rpm':
        return new module.RpmUpdater()
      case 'pacman':
        return new module.PacmanUpdater()
      default:
        return new module.DebUpdater()
    }
  })()
  updater.logger = {
    info: message => options.log(`[updater] ${String(message)}`),
    warn: message => options.log(`[updater] ${String(message)}`),
    error: message => options.log(`[updater] ${String(message)}`)
  }
  // The operator downloads; nothing else does.
  updater.autoDownload = false
  // The one automatic action: a downloaded update goes in when the app is quit anyway.
  updater.autoInstallOnAppQuit = true
  updater.autoRunAppAfterInstall = true
  updater.allowDowngrade = false
  // A web installer fetches its payload after the checksum was checked, and a patch assembled
  // block by block from the old install is a file nobody published: one whole file, checked
  // against the digest its feed names, is the thing this app installs.
  updater.disableWebInstaller = true
  updater.disableDifferentialDownload = true
  if (options.devConfigPath !== null) {
    updater.forceDevUpdateConfig = true
    updater.updateConfigPath = options.devConfigPath
  }
  updater.setFeedURL({ provider: 'generic', url: options.feedUrl })
  // An updater is an EventEmitter, and one that emits `error` with nobody listening throws it
  // out of the process. Every failure also rejects the call that caused it, which is where the
  // rules read it; this listener only keeps it from being thrown twice.
  updater.on('error', () => {})

  return {
    async check(): Promise<FoundUpdate | null> {
      const result = await updater.checkForUpdates()
      if (result === null) throw new Error('the updater is not active in this build')
      if (!result.isUpdateAvailable) return null
      const info = result.updateInfo
      return {
        version: info.version,
        notes: info.releaseNotes ?? '',
        releaseDate: typeof info.releaseDate === 'string' ? info.releaseDate : null
      }
    },

    async download(signal, progress): Promise<void> {
      const token = new CancellationToken()
      const cancel = (): void => token.cancel()
      if (signal.aborted) throw new Error('the download was stopped before it began')
      signal.addEventListener('abort', cancel)
      const onProgress = (info: ProgressInfo): void => {
        progress(info.total > 0 ? Math.min(1, info.transferred / info.total) : null)
      }
      updater.on('download-progress', onProgress)
      try {
        await updater.downloadUpdate(token)
      } finally {
        signal.removeEventListener('abort', cancel)
        updater.off('download-progress', onProgress)
      }
    },

    installNow(): void {
      // Silent, because the installer's own pages ask nothing an update needs answered, and
      // started afterwards, because the operator pressed Restart rather than Quit.
      updater.quitAndInstall(true, true)
    }
  }
}
