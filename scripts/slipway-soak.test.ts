// .slipway/soak.yaml is the Slipway port of .github/workflows/soak.yml. The two must agree on what a night is
// (shard count, the kill-test specs) or the Slipway result would quietly stop meaning the same thing.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string): string => readFileSync(join(__dirname, '..', file), 'utf-8')
const slipway = read('.slipway/soak.yaml')
const github = read('.github/workflows/soak.yml')

describe('.slipway/soak.yaml', () => {
  it('runs the same eight shards as the GitHub night', () => {
    expect(github).toContain('shard: [0, 1, 2, 3, 4, 5, 6, 7]')
    expect(slipway).toContain('shard: [0, 1, 2, 3, 4, 5, 6, 7]')
    expect(slipway).toContain('--shards 8')
    expect(github).toContain('--shards 8')
  })

  it('runs the same kill tests', () => {
    const specs = /e2e\/engine-restart\.spec\.ts e2e\/reliability\.spec\.ts e2e\/durability\.spec\.ts e2e\/device-loss\.spec\.ts/
    expect(github).toMatch(specs)
    expect(slipway).toMatch(specs)
  })

  it('keeps the timing-sensitive group the CI lanes share and does not start a second nightly', () => {
    expect(slipway).toContain('group: timing-sensitive')
    expect(slipway).not.toMatch(/^\s+schedule:/m)
  })

  it('decoder cache key follows the FFmpeg pin like ci.yaml', () => {
    const pin = /FFMPEG_VERSION\s*=\s*'([^']+)'/.exec(read('scripts/build-ffmpeg-linux.mjs'))?.[1]
    expect(pin).toBeTruthy()
    expect(slipway).toContain(`key: ffmpeg-decoder-${pin}`)
  })
})

describe('.slipway/soak.yaml fan-in', () => {
  it('downloads every shard report by name (a run cannot list all its artifacts)', () => {
    for (let i = 0; i < 8; i++) expect(slipway).toContain(`name: soak-shard-${i}, path: artifacts`)
  })
})
