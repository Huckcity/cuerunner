#!/usr/bin/env node
// The release notes an update feed carries, written where electron-builder reads them.
//
// electron-builder puts `release-notes.md` from the build-resources folder into each platform's
// `latest*.yml` as `releaseNotes`, and that is what the app's update bar shows before anything is
// downloaded. The notes are the CHANGELOG's own sections — semantic-release wrote them, and the
// tag the release is built from carries them — for the version being packaged and the few before
// it, so an operator two releases behind reads what both of them changed. The app reads them as
// plain words (`src/shared/releaseNotes.ts`); nothing here renders anything.
//
// Run by every `predist` hook. A version the CHANGELOG has no section for — a build of a branch
// between releases — writes no notes, and removes the last build's, rather than describing a
// release this is not.
//
//   node scripts/release-notes.mjs [--changelog CHANGELOG.md] [--version 0.18.0] [--out resources/release-notes.md]

import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** How many versions the feed's notes go back, at most. */
export const VERSIONS = 3
/**
 * The most the feed carries. The feed is fetched by every machine every day, so older versions
 * are left out whole once the next would pass this — the version being packaged is always in.
 */
export const MAX_CHARS = 32 * 1024
/** The CHANGELOG is read up to this much. */
const MAX_CHANGELOG_BYTES = 1024 * 1024

const HEADING = /^#{1,2}\s+\[?v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?\]?/

function parts(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version)
  return match === null ? null : [Number(match[1]), Number(match[2]), Number(match[3])]
}

function notNewer(a, b) {
  for (let at = 0; at < 3; at++) if (a[at] !== b[at]) return a[at] < b[at]
  return true
}

/**
 * The CHANGELOG's sections for `version` and the ones before it, as the Markdown they are, or
 * '' when it has none for `version` itself.
 */
export function notesFor(changelog, version, count = VERSIONS) {
  const target = parts(version)
  if (target === null) return ''
  const lines = changelog.split(/\r?\n/)
  const sections = []
  let current = null
  for (const line of lines) {
    const heading = HEADING.exec(line)
    if (heading !== null) {
      current = { version: [Number(heading[1]), Number(heading[2]), Number(heading[3])], lines: [line] }
      sections.push(current)
      continue
    }
    // Any other top heading ("Unreleased") belongs to no release.
    if (/^#{1,2}\s/.test(line)) {
      current = null
      continue
    }
    if (current !== null) current.lines.push(line)
  }
  const own = sections.findIndex(section => section.version.every((part, at) => part === target[at]))
  if (own === -1) return ''
  const picked = sections.slice(own).filter(section => notNewer(section.version, target)).slice(0, count)
  let text = ''
  for (const section of picked) {
    const block = `${section.lines.join('\n').trim()}\n`
    if (text === '') text = block.length > MAX_CHARS ? `${block.slice(0, MAX_CHARS - 2)}…\n` : block
    else if (text.length + block.length + 1 <= MAX_CHARS) text += `\n${block}`
    else break
  }
  return text
}

function argument(name, fallback) {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 || at + 1 >= process.argv.length ? fallback : process.argv[at + 1]
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changelogPath = resolve(argument('changelog', join(root, 'CHANGELOG.md')))
  const version = argument('version', JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version)
  const out = resolve(argument('out', join(root, 'resources', 'release-notes.md')))
  let changelog = ''
  if (existsSync(changelogPath) && statSync(changelogPath).size <= MAX_CHANGELOG_BYTES) {
    changelog = readFileSync(changelogPath, 'utf8')
  }
  const notes = notesFor(changelog, version)
  if (notes === '') {
    rmSync(out, { force: true })
    console.log(`[release-notes] the CHANGELOG has no section for ${version}: the update feed carries no notes`)
  } else {
    writeFileSync(out, notes)
    console.log(`[release-notes] ${out}: the notes for ${version}, and the versions before it that fit`)
  }
}
