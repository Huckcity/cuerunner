// The update feed as the packaging declares it: the feed every installed copy checks is the one
// the app's own code names, electron-builder writes a feed for every platform it packages and
// uploads none of them itself, a Mac is given the zip it updates from, and the notes a feed
// carries are the CHANGELOG's own for the version being packaged.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { UPDATE_FEED_URL } from '../src/shared/update'
import { MAX_CHARS, notesFor } from './release-notes.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
  version: string
  scripts: Record<string, string>
  dependencies: Record<string, string>
  build: {
    publish: unknown
    mac: { target: Array<{ target: string; arch: string[] }> }
    extraResources: Array<{ from: string; to: string }>
  }
}

describe('the update feed the packaging declares', () => {
  it('is the feed the app checks, on the download host, and the only one', () => {
    expect(pkg.build.publish).toEqual([{ provider: 'generic', url: UPDATE_FEED_URL }])
    expect(UPDATE_FEED_URL).toBe('https://pub.cuerunner.app/latest/')
  })

  it('is written by every packaging script and uploaded by none of them: the pipeline publishes', () => {
    for (const name of ['dist', 'dist:win', 'dist:mac', 'dist:linux']) {
      expect(pkg.scripts[name], name).toMatch(/electron-builder\b.*--publish never/)
    }
  })

  it('writes the notes before every packaging run', () => {
    for (const name of ['predist', 'predist:win', 'predist:mac', 'predist:linux']) {
      expect(pkg.scripts[name], name).toMatch(/node scripts\/release-notes\.mjs/)
    }
  })

  it('gives a Mac the zip it updates from, beside the dmg a user downloads', () => {
    const targets = pkg.build.mac.target.map(entry => `${entry.target}:${entry.arch.join(',')}`)
    expect(targets).toEqual(['dmg:universal', 'zip:universal'])
  })

  it('ships the CHANGELOG, which is where "What’s new" reads the versions just installed', () => {
    expect(pkg.build.extraResources).toContainEqual({ from: 'CHANGELOG.md', to: 'CHANGELOG.md' })
  })

  it('runs electron-updater as a dependency of the app, not of the build', () => {
    expect(pkg.dependencies['electron-updater']).toMatch(/^\^6\./)
  })
})

describe('the notes a feed carries', () => {
  const changelog = [
    '# [0.19.0](x) (2026-11-01)',
    '',
    '### Features',
    '',
    '* nineteen',
    '',
    '# Unreleased',
    '',
    '* not released',
    '',
    '## [0.18.1](x) (2026-10-25)',
    '',
    '* eighteen-one',
    '',
    '# [0.18.0](x) (2026-10-20)',
    '',
    '* eighteen',
    '',
    '# [0.17.0](x) (2026-10-05)',
    '',
    '* seventeen'
  ].join('\n')

  it('are the packaged version’s section and the ones before it, newest first, three at most', () => {
    const notes = notesFor(changelog, '0.19.0')
    expect(notes).toMatch(/^# \[0\.19\.0\]/)
    expect(notes).toContain('eighteen-one')
    expect(notes).toContain('eighteen')
    expect(notes).not.toContain('seventeen')
    expect(notes).not.toContain('not released')
  })

  it('start at the packaged version, whatever is above it', () => {
    const notes = notesFor(changelog, '0.18.0')
    expect(notes).toMatch(/^# \[0\.18\.0\]/)
    expect(notes).not.toContain('nineteen')
  })

  it('are nothing for a version the CHANGELOG has no section for', () => {
    expect(notesFor(changelog, '0.20.0')).toBe('')
    expect(notesFor(changelog, 'not a version')).toBe('')
  })

  it('leave older versions out whole rather than cutting one in half', () => {
    const big = `# [2.0.0](x)\n\n* ${'a'.repeat(MAX_CHARS - 200)}\n\n# [1.0.0](x)\n\n* ${'b'.repeat(500)}\n`
    const notes = notesFor(big, '2.0.0')
    expect(notes.length).toBeLessThanOrEqual(MAX_CHARS)
    expect(notes).not.toContain('1.0.0')
  })

  it('are there for the version this tree is at', () => {
    const notes = notesFor(readFileSync(join(root, 'CHANGELOG.md'), 'utf-8'), pkg.version)
    expect(notes).toContain(`[${pkg.version}]`)
    expect(notes.length).toBeLessThanOrEqual(MAX_CHARS)
  })
})
