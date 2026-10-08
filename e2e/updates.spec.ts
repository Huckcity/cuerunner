// Updating, against a feed of the suite's own: a local server on port 0 serving the
// `latest*.yml` electron-updater reads and a payload whose bytes are not the ones the feed
// promises. The app is pointed at it the way a build out of the source tree can be and a
// packaged one cannot (`CUERUNNER_UPDATE_FEED`), and the real updater runs against it: the
// launch check finds the release and offers it with its notes, a download asked for while a cue
// is running is held and fetches nothing, and once the show is idle the download is refused for
// the checksum it does not match. Nothing is ever installed — no feed here offers bytes that
// would pass — so the app the suite runs is never replaced.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'
import { PLATFORM_FEEDS, type FeedPlatform } from '../src/shared/update'

/** The bytes the server hands out as the update, and a digest that is not theirs. */
const PAYLOAD = Buffer.from('not an installer: the suite never offers bytes that would pass\n')
const WRONG_SHA512 = createHash('sha512').update('some other release entirely').digest('base64')

const NOTES = [
  '# [999.0.0](https://example.invalid/compare) (2026-12-01)',
  '',
  '### Features',
  '',
  '* **updates:** the release the suite pretends to publish ([abcdef1](https://example.invalid/commit/abcdef1))',
  ''
].join('\n')

/**
 * Every platform's feed, served the way the release mirror serves them: under `latest/`, each
 * entry rewritten to that release's own `versions/<tag>/` copy under the name the mirror writes
 * it by. Each platform's app asks for its own feed and installs its own file from it
 * (`PLATFORM_FEEDS`, held to electron-updater by `src/main/update/platformFeed.test.ts`), so the
 * server answers all three and the assertions read this platform's.
 */
const OFFERED: Record<string, string[]> = {
  'latest.yml': ['Cuerunner-Setup.exe'],
  'latest-mac.yml': ['Cuerunner-mac.zip', 'Cuerunner.dmg'],
  'latest-linux.yml': ['Cuerunner.AppImage', 'Cuerunner.deb']
}

/** Where the mirror puts a release's files, relative to the server's root. */
const VERSIONS = 'versions/v999.0.0/'

/** What this platform's app reads, and the path of the one file it would download. */
const PLATFORM = PLATFORM_FEEDS[process.platform as FeedPlatform]
const OWN_FEED = `latest/${PLATFORM.feed}`
const OWN_PAYLOAD = `${VERSIONS}${OFFERED[PLATFORM.feed].find(name => name.endsWith(`.${PLATFORM.installs}`))}`
const PAYLOADS = Object.values(OFFERED).flat().map(name => `${VERSIONS}${name}`)

function feedYaml(files: string[]): string {
  return [
    'version: 999.0.0',
    'files:',
    ...files.flatMap(file => [`  - url: ../${VERSIONS}${file}`, `    sha512: ${WRONG_SHA512}`, `    size: ${PAYLOAD.length}`]),
    `path: ../${VERSIONS}${files[0]}`,
    `sha512: ${WRONG_SHA512}`,
    'releaseNotes: |',
    ...NOTES.split('\n').map(line => (line === '' ? '' : `  ${line}`)),
    "releaseDate: '2026-12-01T00:00:00.000Z'",
    ''
  ].join('\n')
}

let server: Server
let feedUrl: string
/** Every path the app asked the feed for, in order. */
let requests: string[]
let root: string
let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  requests = []
  server = createServer((request, response) => {
    const name = decodeURIComponent(new URL(request.url ?? '/', 'http://feed').pathname.slice(1))
    requests.push(name)
    const feed = name.startsWith('latest/') ? OFFERED[name.slice('latest/'.length)] : undefined
    if (feed !== undefined) {
      response.writeHead(200, { 'content-type': 'text/yaml' })
      response.end(feedYaml(feed))
      return
    }
    if (PAYLOADS.includes(name)) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(PAYLOAD.length) })
      response.end(PAYLOAD)
      return
    }
    response.writeHead(404)
    response.end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/latest/`
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-ship-updates-'))
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  await new Promise<void>(resolve => server.close(() => resolve()))
  fs.rmSync(root, { recursive: true, force: true })
})

/** The app, pointed at the suite's feed, as an AppImage would be on Linux. */
async function launch(extra: Record<string, string> = {}, userDataDir?: string): Promise<void> {
  // An AppImage's runtime names the file it was started from; the updater replaces it only on
  // an install, which this suite never reaches.
  const appImage = path.join(root, 'Cuerunner.AppImage')
  fs.writeFileSync(appImage, 'the suite’s stand-in for the running AppImage\n')
  ;({ app, page } = await launchApp({
    userDataDir,
    env: {
      CUERUNNER_UPDATE_FEED: feedUrl,
      CUERUNNER_UPDATE_LAUNCH_DELAY_MS: '300',
      APPIMAGE: appImage,
      // Where electron-updater keeps a download on Linux: the suite's own folder, not the desk's.
      XDG_CACHE_HOME: path.join(root, 'cache'),
      ...extra
    }
  }))
}

const notice = (): ReturnType<Page['locator']> => page.locator('.update-notice')

test('offers the release the feed publishes, holds it during a show, and refuses bytes that do not match', async () => {
  await launch()

  // The launch check, on its own: the release is offered, not fetched.
  await expect(notice()).toContainText('Cuerunner 999.0.0 is available.')
  expect(requests, `this platform reads ${OWN_FEED}`).toContain(OWN_FEED)
  expect(requests.filter(name => PAYLOADS.includes(name)), 'a check downloaded something').toEqual([])

  // Its notes, as words.
  await notice().getByRole('button', { name: 'Release notes' }).click()
  const notes = page.getByRole('dialog', { name: 'Cuerunner 999.0.0' })
  await expect(notes).toContainText('the release the suite pretends to publish')
  await expect(notes).not.toContainText('abcdef1')
  await notes.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(notes).toHaveCount(0)

  // A show running: a long wait, fired.
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.inspector-tab', { hasText: 'Wait' }).click()
  await page.locator('.field-row', { hasText: 'Duration (s)' }).locator('input').fill('60')
  await page.locator('.field-row', { hasText: 'Duration (s)' }).locator('input').press('Enter')
  await page.getByRole('button', { name: /GO/ }).click()
  await expect(page.locator('.cue-row[data-state]').first()).toBeVisible()

  await notice().getByRole('button', { name: 'Download' }).click()
  await expect(notice()).toContainText(
    'Held: something in the show is running. Nothing is downloaded or installed during a show — ask again once the show is idle.'
  )
  expect(requests.filter(name => PAYLOADS.includes(name)), 'a download went out during the show').toEqual([])

  // The show stopped: the operator asks again, and the bytes are refused for their checksum.
  await page.locator('body').press('Escape')
  await expect(page.locator('.cue-row[data-state]')).toHaveCount(0)
  await notice().getByRole('button', { name: 'Download again' }).click()
  await expect(notice()).toContainText(
    'Refused: the download did not match the checksum its release published, so it was deleted and nothing was installed.'
  )
  // The download went out for this platform's own file, from the release's own folder, and no other.
  expect(requests.filter(name => PAYLOADS.includes(name)), 'the download never went out').toEqual([OWN_PAYLOAD])
  // Refused is the end of it: nothing to restart into.
  await expect(notice().getByRole('button', { name: 'Restart now' })).toHaveCount(0)
})

test('checks nothing in the show hours, and says so when asked', async () => {
  await launch({ CUERUNNER_UPDATE_LAUNCH_DELAY_MS: '600000' })
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="settings"]').click()
  await page.locator('.settings-tab', { hasText: 'Updates' }).click()

  // A window around now, whatever the clock says now.
  const now = await page.evaluate(() => {
    const date = new Date()
    return date.getHours() * 60 + date.getMinutes()
  })
  const at = (minutes: number): string => {
    const whole = ((minutes % 1440) + 1440) % 1440
    return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`
  }
  await page.locator('#update-lockout').check()
  await page.locator('#update-lockout-from').fill(at(now - 60))
  await page.locator('#update-lockout-to').fill(at(now + 60))
  await expect(page.locator('[data-testid="update-lockout"]')).toContainText('Update checks are locked out from')

  const before = requests.length
  await page.getByRole('button', { name: 'Check now' }).click()
  await expect(page.locator('.update-section [role="alert"]')).toContainText('Change that in Settings → Updates.')
  expect(requests.length, 'a locked-out check reached the feed').toBe(before)

  // Out of the window, the same press checks.
  await page.locator('#update-lockout').uncheck()
  await page.getByRole('button', { name: 'Check now' }).click()
  await expect(page.locator('.update-standing')).toContainText('Cuerunner 999.0.0 is available.')
})

test('says what is new once, after an update, and not again', async () => {
  // The version an app run out of the source tree reports is Electron's own.
  const version = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'node_modules', 'electron', 'package.json'), 'utf-8')
  ).version as string
  const [major, minor] = version.split('.').map(Number)
  const previous = `${major}.${minor}.0-before`
  const changelog = path.join(root, 'CHANGELOG.md')
  fs.writeFileSync(changelog, [
    `# [${version}](x) (2026-12-01)`,
    '',
    '### Features',
    '',
    '* **updates:** what this version brought',
    '',
    `# [${major}.${minor}.0-before](x) (2026-11-01)`,
    '',
    '* already seen'
  ].join('\n'))
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  fs.writeFileSync(path.join(userDataDir, 'updates.json'), JSON.stringify({ lastSeenVersion: previous }))

  await launch({ CUERUNNER_TEST_CHANGELOG: changelog, CUERUNNER_UPDATE_LAUNCH_DELAY_MS: '600000' }, userDataDir)
  const dialog = page.getByRole('dialog', { name: `What’s new in Cuerunner ${version}` })
  await expect(dialog).toContainText(`Updated from ${previous}.`)
  await expect(dialog).toContainText('what this version brought')
  await expect(dialog).not.toContainText('already seen')
  await dialog.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)

  await closeApp(app)
  await launch({ CUERUNNER_TEST_CHANGELOG: changelog, CUERUNNER_UPDATE_LAUNCH_DELAY_MS: '600000' }, userDataDir)
  await expect(page.locator('.toolbar-brand')).toBeVisible()
  // Long enough for the one-shot read to have answered, had it anything to say.
  await page.waitForTimeout(1000)
  await expect(page.getByRole('dialog', { name: /What’s new/ })).toHaveCount(0)
})
