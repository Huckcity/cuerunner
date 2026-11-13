import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')

// The decoder cache key in .slipway/ci.yaml is a literal (hashFiles() in a cache key fails at
// save time, slipway-systems/slipway#375), so it must follow the FFmpeg pin by hand: this test is the hand.
describe('Slipway decoder cache key', () => {
  it('names the FFmpeg version the build script pins, in every job that caches it', () => {
    const script = readFileSync(join(root, 'scripts/build-ffmpeg-linux.mjs'), 'utf8')
    const version = /const FFMPEG_VERSION = '([^']+)'/.exec(script)?.[1]
    expect(version).toBeTruthy()
    const ci = readFileSync(join(root, '.slipway/ci.yaml'), 'utf8')
    const keys = [...ci.matchAll(/- key: (ffmpeg-decoder-\S+)/g)].map((m) => m[1])
    expect(keys.length).toBeGreaterThan(0)
    for (const key of keys) expect(key).toBe(`ffmpeg-decoder-${version}`)
  })
})
