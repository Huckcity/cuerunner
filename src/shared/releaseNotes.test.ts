import { describe, expect, it } from 'vitest'
import { compareVersions, parseReleaseNotes, RELEASE_NOTES_LIMITS, sectionsBetween } from './releaseNotes'

describe('versions', () => {
  it('orders by number, a prerelease before its release', () => {
    expect(compareVersions('0.17.0', '0.18.0')).toBe(-1)
    expect(compareVersions('0.17.10', '0.17.9')).toBe(1)
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
    expect(compareVersions('1.0.0', 'one')).toBeNull()
  })
})

describe('reading the notes', () => {
  const notes = [
    '# [0.18.0](https://github.com/x/compare/v0.17.0...v0.18.0) (2026-10-20)',
    '',
    '',
    '### Bug Fixes',
    '',
    '* **audio:** a fade ends where it says ([abc1234](https://github.com/x/commit/abc1234)), closes [#12](https://github.com/x/issues/12)',
    '* a bullet with no scope and a [link](https://example.com)',
    '',
    '### Features',
    '',
    '* **update:** the app updates itself, <b>safely</b>',
    '  and the line under it belongs to it',
    '',
    '### BREAKING CHANGES',
    '',
    'A show saved with the old field is refused by name.',
    '',
    '# Unreleased',
    '',
    '### Features',
    '',
    '* not in any release',
    '',
    '## [0.17.1](https://github.com/x/compare) (2026-10-12)',
    '',
    '* **cue-list:** one more'
  ].join('\n')

  it('reads each version, its groups and its changes as plain words', () => {
    const sections = parseReleaseNotes(notes)
    expect(sections.map(section => section.version)).toEqual(['0.18.0', '0.17.1'])
    expect(sections[0].date).toBe('2026-10-20')
    expect(sections[0].groups.map(group => group.title)).toEqual(['Bug Fixes', 'Features', 'BREAKING CHANGES'])
    expect(sections[0].groups[0].items).toEqual([
      { scope: 'audio', text: 'a fade ends where it says' },
      { scope: null, text: 'a bullet with no scope and a link' }
    ])
    // Markup in the notes is words in the window, never markup.
    expect(sections[0].groups[1].items).toEqual([
      { scope: 'update', text: 'the app updates itself, safely and the line under it belongs to it' }
    ])
    expect(sections[0].groups[2].items).toEqual([{ scope: null, text: 'A show saved with the old field is refused by name.' }])
  })

  it('leaves what is under a heading that is not a version out of every version', () => {
    const sections = parseReleaseNotes(notes)
    const all = sections.flatMap(section => section.groups.flatMap(group => group.items.map(item => item.text)))
    expect(all).not.toContain('not in any release')
    // A version with changes and no group heading still has them.
    expect(sections[1].groups).toEqual([{ title: 'Changes', items: [{ scope: 'cue-list', text: 'one more' }] }])
  })

  it('is bounded: a bullet, a group and the number of versions all stop at their limits', () => {
    const long = `# [1.0.0](x) (2026-01-01)\n\n### Features\n\n* ${'word '.repeat(400)}`
    const item = parseReleaseNotes(long)[0].groups[0].items[0]
    expect(item.text.length).toBe(RELEASE_NOTES_LIMITS.itemChars)
    const many = Array.from({ length: RELEASE_NOTES_LIMITS.sections + 5 }, (_, at) => `# [1.0.${at}](x)\n\n* change ${at}\n`).join('\n')
    expect(parseReleaseNotes(many)).toHaveLength(RELEASE_NOTES_LIMITS.sections)
  })
})

describe('the versions between two', () => {
  it('is everything newer than the last one run, up to the one running, newest first', () => {
    const sections = parseReleaseNotes(
      ['# [0.19.0](x)', '* c', '## [0.18.1](x)', '* b', '# [0.18.0](x)', '* a', '# [0.17.0](x)', '* old'].join('\n\n')
    )
    expect(sectionsBetween(sections, '0.17.0', '0.18.1').map(section => section.version)).toEqual(['0.18.1', '0.18.0'])
    expect(sectionsBetween(sections, null, '0.18.0').map(section => section.version)).toEqual(['0.18.0', '0.17.0'])
    expect(sectionsBetween(sections, '0.19.0', '0.19.0')).toEqual([])
  })
})
