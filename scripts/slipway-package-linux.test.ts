// .slipway/package-linux.yaml is the Slipway port of build.yml's build-linux job. It must keep building what that job
// builds, keep the packaged-MIDI check, and never touch the update feed or carry a secret.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf-8')
const slipway = read('.slipway/package-linux.yaml')
const github = read('.github/workflows/build.yml')

describe('.slipway/package-linux.yaml', () => {
  it('builds with the same script as the GitHub release job', () => {
    expect(github).toContain('npm run dist:linux')
    expect(slipway).toContain('npm run dist:linux')
  })

  it('keeps the packaged-MIDI check', () => {
    expect(slipway).toContain('node scripts/verify-packaged-midi.mjs dist')
  })

  it('records and verifies SHA256SUMS for both packages', () => {
    expect(slipway).toContain('sha256sum *.AppImage *.deb > SHA256SUMS')
    expect(slipway).toContain('sha256sum -c SHA256SUMS')
  })

  it('checks the staged feed names the AppImage with its SHA-512 and keeps it as an artifact', () => {
    expect(github).toContain('latest-linux.yml')
    expect(slipway).toContain('grep -qF "url: $appi" latest-linux.yml')
    expect(slipway).toContain('openssl dgst -sha512 -binary')
    expect(slipway).toContain('dist/latest-linux.yml')
  })

  it('publishes nothing: no feed, no secrets, no schedule', () => {
    const code = slipway.replace(/^\s*#.*$/gm, '')
    expect(code).not.toMatch(/pub\.cuerunner\.app|secrets\.|R2_|CSC_|schedule:/)
  })

  it('decoder cache key follows the FFmpeg pin like ci.yaml', () => {
    const pin = /FFMPEG_VERSION\s*=\s*'([^']+)'/.exec(read('scripts/build-ffmpeg-linux.mjs'))?.[1]
    expect(pin).toBeTruthy()
    expect(slipway).toContain(`key: ffmpeg-decoder-${pin}`)
  })
})
