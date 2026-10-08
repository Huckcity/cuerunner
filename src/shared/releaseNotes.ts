// Release notes, read from the Markdown semantic-release writes: the CHANGELOG this build
// ships with (for "What's new" after an update) and the notes an update's feed carries (for
// the prompt before one). Both are the same shape — a heading per version, a heading per kind
// of change, one bullet per change — so one reader serves both, and what it hands the window
// is plain data the window draws as text. Nothing here renders Markdown: a link becomes its
// words and a commit reference is dropped, so nothing the notes say can become markup.

/** One change, as a bullet in the notes: `**scope:** text`. */
export interface ReleaseItem {
  /** The part of the app it is about ("audio", "cue-list"), or null for a bullet with none. */
  scope: string | null
  text: string
}

/** A kind of change within a version: "Features", "Bug Fixes". */
export interface ReleaseGroup {
  title: string
  items: ReleaseItem[]
}

/** One version's notes. */
export interface ReleaseSection {
  version: string
  /** The release date as the notes write it (`2026-10-05`), or null. */
  date: string | null
  groups: ReleaseGroup[]
}

/** The bounds every read is held to: the notes are a file somebody else wrote. */
export const RELEASE_NOTES_LIMITS = {
  /** Characters of Markdown read; the rest is not looked at. */
  chars: 512 * 1024,
  sections: 64,
  groupsPerSection: 16,
  itemsPerGroup: 256,
  /** Characters of one bullet's text. */
  itemChars: 600
} as const

interface ParsedVersion {
  parts: [number, number, number]
  prerelease: string | null
}

function parseVersion(text: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (match === null) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] ?? null }
}

/**
 * Semantic-version order: -1, 0 or 1, or null when either is not a version. A prerelease sorts
 * before its release; two prereleases compare by their text, which is all this app's own tags
 * ever need.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (left === null || right === null) return null
  for (let at = 0; at < 3; at++) {
    if (left.parts[at] !== right.parts[at]) return left.parts[at] < right.parts[at] ? -1 : 1
  }
  if (left.prerelease === right.prerelease) return 0
  if (left.prerelease === null) return 1
  if (right.prerelease === null) return -1
  return left.prerelease < right.prerelease ? -1 : 1
}

/** A bullet's Markdown as the words it says: links to their text, commit references gone. */
function plainText(markdown: string): string {
  return (
    markdown
      // ` ([abc1234](https://…/commit/…))` and `, closes [#12](…)` at the end of a bullet.
      .replace(/,?\s*(closes|fixes|resolves)\s+\[[^\]]*\]\([^)]*\)/gi, '')
      .replace(/\s*\(\[[0-9a-f]{7,40}\]\([^)]*\)\)/gi, '')
      // Images say nothing in a list of changes.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

/**
 * Every version's notes in a CHANGELOG or a feed's notes, newest first as the file has them.
 * A version heading is `#` or `##` followed by the version (bracketed when it links its
 * comparison); a group is `###`; a change is a `*` or `-` bullet, with the lines indented under
 * it read as part of it. Anything else — a paragraph under BREAKING CHANGES — is read as an
 * item of the group it sits in, so nothing a release says is dropped.
 */
export function parseReleaseNotes(markdown: string): ReleaseSection[] {
  const text = markdown.length > RELEASE_NOTES_LIMITS.chars ? markdown.slice(0, RELEASE_NOTES_LIMITS.chars) : markdown
  const sections: ReleaseSection[] = []
  let section: ReleaseSection | null = null
  let group: ReleaseGroup | null = null
  let item: { scope: string | null; lines: string[] } | null = null

  const closeItem = (): void => {
    if (item === null) return
    const words = plainText(item.lines.join(' '))
    if (words !== '' && section !== null) {
      if (group === null) {
        if (section.groups.length < RELEASE_NOTES_LIMITS.groupsPerSection) {
          group = { title: 'Changes', items: [] }
          section.groups.push(group)
        }
      }
      if (group !== null && group.items.length < RELEASE_NOTES_LIMITS.itemsPerGroup) {
        group.items.push({ scope: item.scope, text: clip(words, RELEASE_NOTES_LIMITS.itemChars) })
      }
    }
    item = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    const version = /^#{1,2}\s+\[?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\]?(?:\([^)]*\))?\s*(?:\((\d{4}-\d{2}-\d{2})\))?/.exec(line)
    if (version !== null) {
      closeItem()
      if (sections.length >= RELEASE_NOTES_LIMITS.sections) break
      section = { version: version[1], date: version[2] ?? null, groups: [] }
      sections.push(section)
      group = null
      continue
    }
    // A top heading that is not a version ("Unreleased") ends the version above it: what is
    // under it belongs to no release.
    if (/^#{1,2}\s/.test(line)) {
      closeItem()
      section = null
      group = null
      continue
    }
    if (section === null) continue
    const heading = /^#{3,6}\s+(.+)$/.exec(line)
    if (heading !== null) {
      closeItem()
      group = null
      if (section.groups.length < RELEASE_NOTES_LIMITS.groupsPerSection) {
        group = { title: clip(plainText(heading[1]), 80), items: [] }
        section.groups.push(group)
      }
      continue
    }
    const bullet = /^[*-]\s+(.*)$/.exec(line)
    if (bullet !== null) {
      closeItem()
      const scoped = /^\*\*([^*:]+):\*\*\s*(.*)$/.exec(bullet[1])
      item = scoped === null ? { scope: null, lines: [bullet[1]] } : { scope: scoped[1].trim(), lines: [scoped[2]] }
      continue
    }
    if (line.trim() === '') {
      // A blank line ends whatever was being read: a bullet or a paragraph.
      closeItem()
      continue
    }
    if (item !== null && /^\s+/.test(raw)) {
      item.lines.push(line.trim())
      continue
    }
    // A paragraph line: its own item, so a breaking change's explanation is kept.
    closeItem()
    item = { scope: null, lines: [line.trim()] }
  }
  closeItem()
  // A group with nothing in it says nothing.
  for (const each of sections) each.groups = each.groups.filter(entry => entry.items.length > 0)
  return sections
}

/**
 * The sections between two versions: newer than `after` (every one, when `after` is null)
 * and no newer than `upTo`, newest first. What an operator who skipped a release or two is
 * shown — every change since the version they last ran, not only the latest.
 */
export function sectionsBetween(
  sections: readonly ReleaseSection[],
  after: string | null,
  upTo: string
): ReleaseSection[] {
  return sections
    .filter(section => {
      const notNewer = compareVersions(section.version, upTo)
      if (notNewer === null || notNewer > 0) return false
      if (after === null) return true
      const newer = compareVersions(section.version, after)
      return newer !== null && newer > 0
    })
    .sort((a, b) => compareVersions(b.version, a.version) ?? 0)
}
