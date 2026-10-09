// The update rules, wired to this process: electron-updater, the machine's settings file beside
// the licence, the CHANGELOG the build ships with, the engines whose sound counts as the show
// running, and every window told when anything changes.
//
// The service is made on first use. `registerIpcHandlers()` registers its channels at startup
// without touching the app's version or paths, so the suites that load main against a stand-in
// Electron are not asked for either; `startUpdates()` begins the schedule once the app is ready.

import { app, BrowserWindow, shell } from 'electron'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sendToWindow } from '../ipc/broadcast'
import { reportMainError } from '../errors'
import { audioEngine } from '../audio/AudioEngine'
import { midiFiles } from '../midi/midiFileRuntime'
import { existingOutputManager } from '../output/ipc'
import { UPDATE_CHANNELS } from '../../shared/ipc/update'
import { UPDATE_DOWNLOAD_PAGE, UPDATE_FEED_URL } from '../../shared/update'
import { writeFileAtomically } from '../workspace/recovery'
import { UpdateService } from './UpdateService'
import { installKind, readPackageType } from './installKind'
import { createElectronUpdater } from './electronUpdater'

/** The CHANGELOG is read up to this much: a release's notes are kilobytes, not megabytes. */
const CHANGELOG_MAX_BYTES = 1024 * 1024

let service: UpdateService | null = null

/**
 * A feed a build run out of the source tree has been pointed at — the E2E suite's own server.
 * A packaged build never reads it: the feed it checks is the one it was built with.
 */
function devFeed(): string | null {
  if (app.isPackaged) return null
  const feed = process.env['CUERUNNER_UPDATE_FEED']
  if (feed === undefined || !/^https?:\/\/[^\s]+\/$/.test(feed)) return null
  return feed
}

/** A launch delay a source-tree build pointed at a feed may be given, in milliseconds. */
function devLaunchDelay(): number | undefined {
  const raw = Number(process.env['CUERUNNER_UPDATE_LAUNCH_DELAY_MS'])
  return Number.isFinite(raw) && raw >= 0 && raw <= 600_000 ? raw : undefined
}

/** Where the CHANGELOG this build was made from is: beside the resources, or the source tree's. */
function changelogPaths(): string[] {
  if (app.isPackaged) return [join(process.resourcesPath, 'CHANGELOG.md')]
  const override = process.env['CUERUNNER_TEST_CHANGELOG']
  const appPath = app.getAppPath()
  return [
    ...(override === undefined ? [] : [override]),
    join(appPath, 'CHANGELOG.md'),
    // The suite starts `out/main/index.js`, whose app path is that folder.
    join(appPath, '..', '..', 'CHANGELOG.md')
  ]
}

function readChangelog(): string {
  for (const path of changelogPaths()) {
    try {
      if (statSync(path).size > CHANGELOG_MAX_BYTES) continue
      return readFileSync(path, 'utf8')
    } catch {
      // Not here: the next place, or no notes at all.
    }
  }
  return ''
}

function create(): UpdateService {
  const feed = devFeed()
  // Pointed at a feed, a source-tree build is updated the way a packaged one on this platform
  // would be — that is the path the suite has to exercise.
  const install = installKind({
    platform: process.platform,
    packaged: app.isPackaged || feed !== null,
    appImage: process.env['APPIMAGE'],
    packageType: app.isPackaged ? readPackageType(process.resourcesPath) : null
  })
  const userData = app.getPath('userData')
  const log = (line: string): void => console.log(line)
  return new UpdateService({
    current: app.getVersion(),
    install,
    filePath: join(userData, 'updates.json'),
    changelog: readChangelog,
    // This process's own share of the show: sound, a MIDI file, or a picture on an output —
    // a video, image or text cue on a screen, which stays there after its cue stops counting.
    engineBusy: () =>
      (audioEngine.snapshot()?.active ?? false) ||
      midiFiles.isPlaying() ||
      (existingOutputManager()?.showing() ?? false),
    push: status => {
      for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, UPDATE_CHANNELS.events, status)
    },
    log,
    // The suite asks for its launch check sooner than an operator's machine waits for one.
    launchDelayMs: feed !== null ? devLaunchDelay() : undefined,
    updater: async () => {
      if (install === 'development') return null
      let devConfigPath: string | null = null
      if (feed !== null) {
        devConfigPath = join(userData, 'dev-app-update.yml')
        await writeFileAtomically(
          devConfigPath,
          `provider: generic\nurl: ${feed}\nupdaterCacheDirName: cuerunner-updater-dev\n`
        )
      }
      return createElectronUpdater({ install, feedUrl: feed ?? UPDATE_FEED_URL, devConfigPath, log })
    }
  })
}

/** The machine's update service, made the first time anything asks for it. */
export function updates(): UpdateService {
  if (service === null) service = create()
  return service
}

/** The launch check and the daily one, once the app is ready; nothing runs until then. */
export function startUpdates(): void {
  try {
    updates().start()
  } catch (error) {
    reportMainError(`[main] updates did not start: ${String(error)}`)
  }
}

/**
 * The way out: the schedule and any download stopped, no write started after it, and the one
 * under way finished. Registered on `will-quit` beside the other services' teardown; Electron
 * does not wait for the promise, but nothing new is written once it has been called.
 */
export async function closeUpdates(): Promise<void> {
  await service?.close()
}

/** The download page, in the browser: where a copy that cannot replace itself gets the new one. */
export async function openDownloads(): Promise<void> {
  await shell.openExternal(UPDATE_DOWNLOAD_PAGE)
}
