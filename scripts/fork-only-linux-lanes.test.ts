// Slipway starts nothing for a fork's pull request (PIPELINE_SPEC section 2), so the Linux lanes
// that `.slipway/ci.yaml` runs for the repository's own branches stay on GitHub for forks only.
// A Linux job here without the fork condition would run twice on every same-repository pull request.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FORK = 'github.event.pull_request.head.repo.full_name != github.repository'
const read = (file: string): string => readFileSync(join(__dirname, '..', '.github', 'workflows', file), 'utf-8')

/** The text of one top-level job: from its key to the next job key. */
const job = (text: string, name: string): string => {
  const start = text.indexOf(`\n  ${name}:\n`)
  expect(start, `job ${name}`).toBeGreaterThan(-1)
  const rest = text.slice(start + 1)
  const next = rest.slice(1).search(/\n  [a-z-]+:\n/)
  return next < 0 ? rest : rest.slice(0, next + 1)
}
const ifLine = (text: string): string => /^    if: (.*)$/m.exec(text)?.[1] ?? ''

describe('Linux lanes Slipway also runs', () => {
  it.each([
    ['ci.yml', 'typecheck', false],
    ['ci.yml', 'electron-install', false],
    ['ci.yml', 'integration', false],
    ['native.yml', 'native-engine', false],
    ['ci.yml', 'unit-test', true],
    ['ci.yml', 'e2e', true],
  ])('%s %s runs on GitHub for a fork\'s pull request only', (file, name, matrix) => {
    const line = ifLine(job(read(file), name))
    expect(line).toContain(FORK)
    if (matrix) expect(line).toContain("matrix.label != 'linux'")
  })
})
