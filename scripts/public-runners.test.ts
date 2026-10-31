// This repository is public. A fork's pull request runs the workflow files in that pull request,
// so a self-hosted runner reachable from a pull_request lane would run a stranger's code on the
// machine behind it. These hold the workflows to the rule: pull requests run on GitHub's runners.
//
// The files cannot enforce the whole rule, because the fork writes its own: the rest of it is that
// no runner stays registered on the repository, which README's CI section states.
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const directory = join(__dirname, '..', '.github', 'workflows')
const workflows = readdirSync(directory)
  .filter(file => file.endsWith('.yml'))
  .map(file => ({ file, text: readFileSync(join(directory, file), 'utf-8') }))

/** The workflow without its comments, which are allowed to talk about any of this. */
const code = (text: string): string => text.split('\n').filter(line => !/^\s*#/.test(line)).join('\n')

describe('a public repository and its runners', () => {
  it('finds the workflows', () => {
    expect(workflows.length).toBeGreaterThan(0)
  })

  it('never hands a fork the base repository\'s secrets', () => {
    const risky = workflows.filter(({ text }) => /pull_request_target|workflow_run/.test(code(text)))
    expect(risky.map(({ file }) => file)).toEqual([])
  })

  it('runs every pull request lane on GitHub\'s runners', () => {
    const risky = workflows.filter(({ text }) => /pull_request/.test(code(text)) && /self-hosted/.test(code(text)))
    expect(risky.map(({ file }) => file)).toEqual([])
  })

  it('schedules nothing on a self-hosted runner', () => {
    const risky = workflows.filter(({ text }) => /schedule:/.test(code(text)) && /self-hosted/.test(code(text)))
    expect(risky.map(({ file }) => file)).toEqual([])
  })

  it('confines self-hosted labels to the two hardware lanes', () => {
    const hosted = workflows.filter(({ text }) => /self-hosted/.test(code(text))).map(({ file }) => file)
    expect(hosted.sort()).toEqual(['integration-hardware.yml', 'integration-vendor.yml'])
  })
})
