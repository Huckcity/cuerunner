// What each platform's updater reads and installs, held to electron-updater itself rather than
// to this repository's account of it: its real generic provider is asked for the latest version
// on each platform, against an executor that records the request and answers with a feed shaped
// the way the release mirror serves it — entries rewritten to `../versions/<tag>/<name>` — and
// the file it would install is picked with the same call, and the same extensions, its updaters
// make. A library upgrade that moved any of it fails here, before a platform stops updating.
import { afterEach, describe, expect, it } from 'vitest'
import { GenericProvider } from 'electron-updater/out/providers/GenericProvider'
import { findFile } from 'electron-updater/out/providers/Provider'
import { MacUpdater } from 'electron-updater/out/MacUpdater'
import { PLATFORM_FEEDS, UPDATE_FEED_URL, classifyUpdateFailure, platformFeed } from '../../shared/update'

/** The feed each platform is served, as the mirror writes it for a release tagged v0.18.0. */
const SERVED: Record<string, string[]> = {
  'latest.yml': ['Cuerunner-Setup.exe'],
  'latest-mac.yml': ['Cuerunner-mac.zip', 'Cuerunner.dmg'],
  'latest-linux.yml': ['Cuerunner.AppImage', 'Cuerunner.deb']
}

function feedYaml(names: string[]): string {
  return [
    'version: 0.18.0',
    'files:',
    ...names.flatMap(name => [`  - url: ../versions/v0.18.0/${name}`, '    sha512: c2hhNTEy', '    size: 12']),
    `path: ../versions/v0.18.0/${names[0]}`,
    'sha512: c2hhNTEy',
    "releaseDate: '2026-10-20T00:00:00.000Z'",
    ''
  ].join('\n')
}

/** electron-updater's provider for one platform, with an executor that records what it asked for. */
function provider(platform: string): { provider: GenericProvider; asked: string[] } {
  const asked: string[] = []
  const executor = {
    request: async (options: { path?: string }) => {
      const path = (options.path ?? '').split('?')[0]
      asked.push(path)
      const name = path.split('/').pop() ?? ''
      const names = SERVED[name]
      if (names === undefined) throw Object.assign(new Error(`HttpError: 404 ${path}`), { statusCode: 404 })
      return feedYaml(names)
    }
  }
  const updater = { channel: null, isAddNoCacheQuery: false }
  return {
    provider: new GenericProvider(
      { provider: 'generic', url: UPDATE_FEED_URL },
      updater as never,
      { platform: platform as never, executor: executor as never, isUseMultipleRangeRequest: false }
    ),
    asked
  }
}

declare function filterFiles<T>(files: T[], isArm64Mac: boolean): T[]

const savedArch = process.env['TEST_UPDATER_ARCH']
afterEach(() => {
  if (savedArch === undefined) delete process.env['TEST_UPDATER_ARCH']
  else process.env['TEST_UPDATER_ARCH'] = savedArch
})

describe('each platform reads its own feed from the mirror, and installs its own file from it', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    const facts = PLATFORM_FEEDS[platform]
    it(`${platform}: reads ${facts.feed} and installs the ${facts.installs}`, async () => {
      process.env['TEST_UPDATER_ARCH'] = 'x64'
      const { provider: feed, asked } = provider(platform)
      const info = await feed.getLatestVersion()
      expect(asked).toEqual([`/latest/${facts.feed}`])
      expect(info.version).toBe('0.18.0')
      const file = findFile(feed.resolveFiles(info), facts.installs, [...facts.passesOver])
      // The entry the mirror rewrote resolves out of `latest/` into this release's own folder.
      expect(file?.url.href).toBe(`https://pub.cuerunner.app/versions/v0.18.0/${SERVED[facts.feed][0]}`)
    })
  }

  it('macOS keeps the universal zip on an Apple Silicon Mac and on an Intel one alike', async () => {
    const { provider: feed } = provider('darwin')
    const files = feed.resolveFiles(await feed.getLatestVersion())
    for (const arm64 of [true, false]) {
      // Protected in the library's types; it is the call MacUpdater makes before it picks the zip.
      const kept = (MacUpdater as unknown as { filterFilesForArch: typeof filterFiles }).filterFilesForArch(files, arm64)
      expect(findFile(kept, 'zip', ['pkg', 'dmg'])?.url.pathname, `arm64=${arm64}`).toBe('/versions/v0.18.0/Cuerunner-mac.zip')
    }
  })

  it('Linux installs the AppImage the feed lists before the .deb beside it, whatever the order', () => {
    const files = [
      { url: new URL('https://pub.cuerunner.app/versions/v0.18.0/Cuerunner.deb'), info: { url: 'Cuerunner.deb', sha512: 'x' } },
      { url: new URL('https://pub.cuerunner.app/versions/v0.18.0/Cuerunner.AppImage'), info: { url: 'Cuerunner.AppImage', sha512: 'x' } }
    ]
    expect(findFile(files, 'AppImage', ['rpm', 'deb', 'pacman'])?.info.url).toBe('Cuerunner.AppImage')
  })

  it('an ARM Linux machine asks for a feed this pipeline does not publish, and is told there is none', async () => {
    process.env['TEST_UPDATER_ARCH'] = 'arm64'
    const { provider: feed, asked } = provider('linux')
    const failure = await feed.getLatestVersion().then(() => null, (error: Error) => error)
    expect(asked).toEqual(['/latest/latest-linux-arm64.yml'])
    // A feed that is not there is "no release for this platform", which a check never says aloud.
    expect(classifyUpdateFailure(failure).kind).toBe('missing')
  })

  it('names no feed for a platform the app does not ship on', () => {
    expect(platformFeed('freebsd')).toBeNull()
    expect(platformFeed('win32')).toBe(PLATFORM_FEEDS.win32)
  })
})
