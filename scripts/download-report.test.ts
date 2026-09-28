// The download report, held to what it reads and what it says — and the workflow that carries
// it, held to staying silent when there is nothing to report.
//
// The report is the only view of a download there is: the app sends nothing (a promise the
// README makes) and the files are served by a Cloudflare bucket, so the counts come from the
// host that serves them. The checks here are two halves. The script's half is the counting: a
// fixture of Cloudflare's own answer, aggregated — with the paths that are not installers left
// out — and the query's filters read off the variables it carries (the host, the window, GET,
// the success statuses), never off the query's formatting. Every refusal the script promises —
// a missing token, an HTTP error, GraphQL `errors`, an answer of another shape, an answer past
// the byte cap — is asserted by the name it is raised with. The workflow's half is the promises
// it makes: the analytics token is the only secret, the permissions are the two it names, and
// the comment step runs only when the total is not zero, so an app nobody has been told about
// stays silent rather than posting `0`.
//
// The workflow checks are pure functions of the file, so the cases at the end hand them a
// workflow the repository would never commit and get each failure back by name. A passing run
// otherwise says only that nothing has drifted yet.
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import {
  CAVEAT,
  MAX_RESPONSE_BYTES,
  QUERY_LIMIT,
  buildQuery,
  buildReport,
  installerOf,
  main,
  parseResponse,
  readConfig,
  renderMarkdown,
  windowOf
} from './download-report.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads a file the guard cannot run without: an absent one is a failure, never a skip. */
function read(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(`download report: ${relative} cannot be read — ${(cause as Error).message}`)
  }
}

/**
 * A response body as `fetch` hands it over: one chunk of the text's bytes, then done. Built by
 * hand so no test needs a real `Response` or the network.
 */
function bodyOf(text: string) {
  const bytes = new TextEncoder().encode(text)
  let sent = false
  return {
    getReader() {
      return {
        async read() {
          if (sent) return { done: true as const, value: undefined }
          sent = true
          return { done: false as const, value: bytes }
        },
        async cancel() {}
      }
    }
  }
}

/** A fetch that answers with one payload, recording nothing beyond what the tests read. */
function answering(payload: unknown) {
  const text = JSON.stringify(payload)
  return async () => ({ ok: true, status: 200, statusText: 'OK', body: bodyOf(text) })
}

/** What a run wrote, for the tests that read the two streams. */
function captured() {
  let text = ''
  return { stream: { write: (chunk: string) => ((text += chunk), true) }, read: () => text }
}

const NOW = new Date('2026-09-28T20:41:07.000Z')
const META = {
  host: 'pub.cuerunner.app',
  hours: 26,
  since: '2026-09-27T18:41:07.000Z',
  until: '2026-09-28T20:41:07.000Z',
  limit: QUERY_LIMIT
}

/**
 * One answer from the dataset: the installer paths a real window would carry — the mirror's
 * names under `latest/`, the build names under a version — beside what is also under those
 * prefixes but is not a download (`SHA256SUMS`, a notes file, the release directory itself).
 */
const GROUPS = [
  { count: 6, dimensions: { clientRequestPath: '/latest/Cuerunner-Setup.exe', clientCountryName: 'US' } },
  { count: 4, dimensions: { clientRequestPath: '/latest/Cuerunner.dmg', clientCountryName: 'DE' } },
  { count: 3, dimensions: { clientRequestPath: '/versions/v0.14.0/Cuerunner%20Setup%200.14.0.exe', clientCountryName: 'US' } },
  { count: 2, dimensions: { clientRequestPath: '/versions/v0.14.0/Cuerunner-0.14.0-universal.dmg', clientCountryName: 'FR' } },
  { count: 1, dimensions: { clientRequestPath: '/versions/v0.14.0/Cuerunner-0.14.0.AppImage', clientCountryName: 'JP' } },
  { count: 40, dimensions: { clientRequestPath: '/latest/SHA256SUMS', clientCountryName: 'US' } },
  { count: 30, dimensions: { clientRequestPath: '/latest/README.txt', clientCountryName: 'CN' } },
  { count: 20, dimensions: { clientRequestPath: '/versions/v0.13.0/notes.md', clientCountryName: 'DE' } }
]
const PAYLOAD = { data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: GROUPS }] } }, errors: null }

/** The report the fixture describes: the installer rows only, totalled. */
function fixtureReport() {
  return buildReport(parseResponse(PAYLOAD), META)
}

describe('the query the script builds', () => {
  const { query, variables } = buildQuery({
    zoneId: 'zone-id',
    host: 'mirror.example.com',
    since: '2026-09-27T00:00:00.000Z',
    until: '2026-09-28T00:00:00.000Z'
  })

  it('asks for the mirror, the window, GET and the success statuses as variables', () => {
    // The variables, not the query text: what is asked for is what a reader of the request can
    // see without parsing GraphQL, and a value spliced into the text would not show up here.
    expect(variables).toEqual({
      zoneTag: 'zone-id',
      filter: {
        datetime_geq: '2026-09-27T00:00:00.000Z',
        datetime_lt: '2026-09-28T00:00:00.000Z',
        clientRequestHTTPHost: 'mirror.example.com',
        clientRequestHTTPMethodName: 'GET',
        edgeResponseStatus_in: [200, 206],
        OR: [{ clientRequestPath_like: '/latest/%' }, { clientRequestPath_like: '/versions/%' }]
      }
    })
  })

  it('groups by the path and the country, so the report can split them', () => {
    expect(query).toContain('httpRequestsAdaptiveGroups')
    expect(query).toContain('clientRequestPath')
    expect(query).toContain('clientCountryName')
  })

  it('bounds the page it asks for', () => {
    expect(QUERY_LIMIT).toBeLessThanOrEqual(1000)
    expect(query).toContain(`limit: ${QUERY_LIMIT}`)
    expect(() => buildQuery({ zoneId: 'z', host: 'h', since: 's', until: 'u', limit: 0 })).toThrow(/page size/)
    expect(() => buildQuery({ zoneId: 'z', host: 'h', since: 's', until: 'u', limit: 10_000 })).toThrow(/page size/)
  })

  it('reads the environment into the config, with the document defaults', () => {
    const config = readConfig({ CF_ANALYTICS_TOKEN: 'secret' })
    expect(config).toEqual({
      token: 'secret',
      zoneId: 'a74e2b670114be33630a147f6c058d79',
      host: 'pub.cuerunner.app',
      hours: 26
    })
    expect(windowOf(config.hours, NOW)).toEqual({ since: META.since, until: META.until })
  })
})

describe('the answer the script reads', () => {
  it('reads the installer rows and leaves the counts to the aggregation', () => {
    expect(parseResponse(PAYLOAD)).toHaveLength(GROUPS.length)
    expect(parseResponse(PAYLOAD)[0]).toEqual({
      path: '/latest/Cuerunner-Setup.exe',
      country: 'US',
      count: 6
    })
  })

  it('refuses a GraphQL error with the message the API gave', () => {
    const refused = {
      errors: [{ message: 'does not have permission com.cloudflare.api.account.zone.analytics.read' }],
      data: null
    }
    expect(() => parseResponse(refused)).toThrow(/permission com\.cloudflare\.api\.account\.zone\.analytics\.read/)
  })

  it('refuses an answer that is not the shape the query asks for', () => {
    expect(() => parseResponse(null)).toThrow(/not a JSON object/)
    expect(() => parseResponse({ data: { viewer: { zones: [] } } })).toThrow(/sees 0 zones/)
    expect(() => parseResponse({ data: { viewer: { zones: [{}, {}] } } })).toThrow(/sees 2 zones/)
    expect(() => parseResponse({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: {} }] } } })).toThrow(
      /no httpRequestsAdaptiveGroups/
    )
    expect(() =>
      parseResponse({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count: 1, dimensions: {} }] }] } } })
    ).toThrow(/row 0/)
    expect(() =>
      parseResponse({
        data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [{ count: '3', dimensions: { clientRequestPath: '/latest/Cuerunner.dmg', clientCountryName: 'US' } }] }] } }
      })
    ).toThrow(/row 0/)
  })

  it('refuses an answer bigger than the bytes it reads', async () => {
    const stderr = captured()
    const exit = await main(['--json'], {
      env: { CF_ANALYTICS_TOKEN: 'secret' },
      fetchImpl: async () => ({ ok: true, status: 200, statusText: 'OK', body: bodyOf('x'.repeat(MAX_RESPONSE_BYTES + 1)) }),
      now: NOW,
      stdout: captured().stream,
      stderr: stderr.stream
    })
    expect(exit).toBe(1)
    expect(stderr.read()).toContain(`${MAX_RESPONSE_BYTES} bytes`)
  })
})

describe('the counts the report keeps', () => {
  it('counts only the paths that are an installer', () => {
    const platforms = (requestPath: string) => installerOf(requestPath)?.platform ?? null
    expect(platforms('/latest/Cuerunner-Setup.exe')).toBe('windows')
    expect(platforms('/latest/Cuerunner.dmg')).toBe('macos')
    expect(platforms('/latest/Cuerunner.AppImage')).toBe('linux')
    expect(platforms('/versions/v0.14.0/Cuerunner-Setup.exe')).toBe('windows')
    expect(platforms('/versions/v0.14.0/Cuerunner%20Setup%200.14.0.exe')).toBe('windows')
    expect(platforms('/versions/v0.14.0/Cuerunner-0.14.0-universal.dmg')).toBe('macos')
    expect(platforms('/versions/v0.14.0/Cuerunner-0.14.0.AppImage')).toBe('linux')
    expect(installerOf('/versions/v0.14.0/Cuerunner%20Setup%200.14.0.exe')?.path).toBe(
      '/versions/v0.14.0/Cuerunner Setup 0.14.0.exe'
    )
    // What sits under the same prefixes and is not a download.
    expect(platforms('/latest/SHA256SUMS')).toBeNull()
    expect(platforms('/latest/README.txt')).toBeNull()
    expect(platforms('/versions/v0.14.0/notes.md')).toBeNull()
    expect(platforms('/latest/Cuerunner.dmg.bak')).toBeNull()
    expect(platforms('/index.html')).toBeNull()
    expect(platforms('/latest/')).toBeNull()
    expect(platforms('/versions/v0.14.0/')).toBeNull()
    expect(platforms('/%E0%A4%A')).toBeNull()
  })

  it('totals the platforms and the countries over the installer rows only', () => {
    const report = fixtureReport()
    expect(report.total).toBe(16)
    expect(report.platforms).toEqual({ windows: 9, macos: 6, linux: 1 })
    expect(report.countries).toEqual([
      { name: 'US', count: 9 },
      { name: 'DE', count: 4 },
      { name: 'FR', count: 2 },
      { name: 'JP', count: 1 }
    ])
    expect(report.paths).toEqual([
      { path: '/latest/Cuerunner-Setup.exe', count: 6 },
      { path: '/latest/Cuerunner.dmg', count: 4 },
      { path: '/versions/v0.14.0/Cuerunner Setup 0.14.0.exe', count: 3 },
      { path: '/versions/v0.14.0/Cuerunner-0.14.0-universal.dmg', count: 2 },
      { path: '/versions/v0.14.0/Cuerunner-0.14.0.AppImage', count: 1 }
    ])
    expect(report.truncated).toBe(false)
  })

  it('says a full page is a floor rather than the window', () => {
    const rows = Array.from({ length: QUERY_LIMIT }, () => ({
      path: '/latest/Cuerunner.dmg',
      country: 'US',
      count: 1
    }))
    const report = buildReport(rows, META)
    expect(report.truncated).toBe(true)
    expect(renderMarkdown(report)).toContain('a floor')
  })
})

describe('the message and the JSON', () => {
  it('is the markdown comment for a window with downloads', () => {
    const message = renderMarkdown(fixtureReport())
    expect(message).toContain('**Download report** — 16 installer downloads at `pub.cuerunner.app`')
    expect(message).toContain('2026-09-27 18:41 UTC to 2026-09-28 20:41 UTC')
    expect(message).toContain('| Windows | 9 |')
    expect(message).toContain('| macOS | 6 |')
    expect(message).toContain('| Linux | 1 |')
    expect(message).toContain('`US` 9 · `DE` 4 · `FR` 2 · `JP` 1')
    expect(message).toContain(CAVEAT)
  })

  it("says a zero as nothing to report, and says the issue's first post as the first downloads", () => {
    const zero = renderMarkdown(buildReport([], META))
    expect(zero).toContain('no installer downloads')
    expect(zero).not.toContain('| Platform |')
    expect(renderMarkdown(fixtureReport(), { first: true }).startsWith('**First downloads**')).toBe(true)
    expect(renderMarkdown(fixtureReport()).startsWith('**Download report**')).toBe(true)
  })

  it('exits 0 with a zero total, and 1 with the cause on stderr when the token is missing', async () => {
    const stdout = captured()
    const exit = await main(['--json'], {
      env: { CF_ANALYTICS_TOKEN: 'secret' },
      fetchImpl: answering({ data: { viewer: { zones: [{ httpRequestsAdaptiveGroups: [] }] } }, errors: null }),
      now: NOW,
      stdout: stdout.stream,
      stderr: captured().stream
    })
    expect(exit).toBe(0)
    expect(JSON.parse(stdout.read()).total).toBe(0)

    const stderr = captured()
    expect(await main([], { env: {}, stdout: captured().stream, stderr: stderr.stream })).toBe(1)
    expect(stderr.read()).toContain('CF_ANALYTICS_TOKEN')
  })

  it('fails loudly on an HTTP error, naming the status', async () => {
    const stderr = captured()
    const exit = await main([], {
      env: { CF_ANALYTICS_TOKEN: 'secret' },
      fetchImpl: async () => ({ ok: false, status: 403, statusText: 'Forbidden', body: bodyOf('permission denied') }),
      now: NOW,
      stdout: captured().stream,
      stderr: stderr.stream
    })
    expect(exit).toBe(1)
    expect(stderr.read()).toContain('403 Forbidden')
  })

  it('renders a report again from its JSON, which is what the workflow comments from', async () => {
    const scratch = fs.mkdtempSync(path.join(tmpdir(), 'download-report-'))
    try {
      const file = path.join(scratch, 'report.json')
      expect(
        await main(['--json', '--out', file], {
          env: { CF_ANALYTICS_TOKEN: 'secret' },
          fetchImpl: answering(PAYLOAD),
          now: NOW,
          stdout: captured().stream,
          stderr: captured().stream
        })
      ).toBe(0)
      const stdout = captured()
      expect(await main(['--render', file], { env: {}, stdout: stdout.stream, stderr: captured().stream })).toBe(0)
      expect(stdout.read()).toBe(`${renderMarkdown(fixtureReport())}\n`)
      const first = captured()
      expect(await main(['--render', file, '--first'], { env: {}, stdout: first.stream, stderr: captured().stream })).toBe(0)
      expect(first.read().startsWith('**First downloads**')).toBe(true)
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('runs when the checkout is reached through a symlink', () => {
    // A run that compared the module URL with the invoked path unresolved would exit 0 having
    // done nothing — the report would be silent whether or not anyone downloaded. The missing
    // token is the assertion: the guard has to have run at all to write that name.
    const scratch = fs.mkdtempSync(path.join(tmpdir(), 'download-report-link-'))
    try {
      fs.symlinkSync(path.join(root, 'scripts'), path.join(scratch, 'scripts'), 'junction')
      const result = spawnSync('node', [path.join(scratch, 'scripts', 'download-report.mjs')], {
        env: { ...process.env, CF_ANALYTICS_TOKEN: '' },
        encoding: 'utf-8'
      })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('CF_ANALYTICS_TOKEN')
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  })

  it('refuses a window it cannot ask for', () => {
    expect(() => readConfig({ CF_ANALYTICS_TOKEN: 'secret', WINDOW_HOURS: '0' })).toThrow(/WINDOW_HOURS/)
    expect(() => readConfig({ CF_ANALYTICS_TOKEN: 'secret', WINDOW_HOURS: 'nope' })).toThrow(/WINDOW_HOURS/)
    expect(() => readConfig({ CF_ANALYTICS_TOKEN: 'secret', MIRROR_HOST: 'not a host' })).toThrow(/MIRROR_HOST/)
  })
})

// ---------------------------------------------------------------------------------------------
// The workflow, held to the promises above it.
// ---------------------------------------------------------------------------------------------

const WORKFLOW = '.github/workflows/download-report.yml'
const YAML = read(WORKFLOW)

/** The lines of a top-level block — `on:`, `permissions:` — up to the next top-level key. */
function topBlock(yaml: string, key: string): string[] {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => new RegExp(`^${key}:`).test(line))
  if (start === -1) throw new Error(`${WORKFLOW} declares no top-level \`${key}:\` — the guard cannot read what is not there`)
  const block: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\S/.test(lines[index])) break
    block.push(lines[index])
  }
  return block
}

/** The lines of one job of the workflow, its own key line included. */
function jobBlock(yaml: string, name: string): string[] {
  const lines = yaml.split('\n')
  const start = lines.findIndex((line) => line === `  ${name}:`)
  if (start === -1) throw new Error(`${WORKFLOW} declares no job \`${name}\` — the guard cannot read what is not there`)
  const block = [lines[start]]
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^ {2}\S/.test(lines[index])) break
    block.push(lines[index])
  }
  return block
}

/** One step of a job: the keys these checks read, and the command a `run:` step executes. */
interface Step {
  id: string
  name: string
  condition: string
  run: string
  env: Record<string, string>
}

/**
 * The steps of a job, in file order. A step begins at a `- ` marker at the steps' own indent;
 * a `name:` deeper than that is a key of something a step carries, not a step.
 */
function stepsOf(block: string[]): Step[] {
  const starts: number[] = []
  block.forEach((line, index) => {
    if (/^ {6}- /.test(line)) starts.push(index)
  })
  return starts.map((start, index) => readStep(block.slice(start, starts[index + 1] ?? block.length)))
}

/** One step, read from its own lines: the keys at the step's level, and its block scalars. */
function readStep(lines: string[]): Step {
  let id = ''
  let name = ''
  let condition = ''
  let run = ''
  const env: Record<string, string> = {}
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const named = /^ {6}- name: (.+)$/.exec(line) ?? /^ {8}name: (.+)$/.exec(line)
    if (named !== null) {
      name = named[1].trim()
      continue
    }
    const identified = /^ {8}id: (.+)$/.exec(line)
    if (identified !== null) {
      id = identified[1].trim()
      continue
    }
    const conditional = /^ {8}if: (.+)$/.exec(line)
    if (conditional !== null) {
      condition = conditional[1].trim()
      continue
    }
    if (/^ {8}run: \|$/.test(line)) {
      const body: string[] = []
      let end = index + 1
      while (end < lines.length && /^ {10}/.test(lines[end])) {
        body.push(lines[end].slice(10))
        end += 1
      }
      run = body.join('\n')
      index = end - 1
      continue
    }
    const setting = /^ {10}([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(line)
    if (setting !== null) env[setting[1]] = setting[2].trim()
  }
  return { id, name, condition, run, env }
}

/** Whether a step's `if:` admits a run when the count is `total`. The one shape this reads is a
 *  comparison against `steps.<id>.outputs.total`; a condition it cannot read admits the run, so
 *  a changed guard fails the check rather than slipping past it. */
function admitsTotal(condition: string, total: number): boolean {
  const comparison = /steps\.([A-Za-z0-9_-]+)\.outputs\.total\s*(==|!=|>=|>|<=|<)\s*'?(\d+)'?/.exec(condition)
  if (comparison === null) return true
  const bound = Number(comparison[3])
  switch (comparison[2]) {
    case '==':
      return total === bound
    case '!=':
      return total !== bound
    case '>':
      return total > bound
    case '>=':
      return total >= bound
    case '<':
      return total < bound
    default:
      return total <= bound
  }
}

/** A nightly schedule, and a hand to start one; the two triggers the report is driven by. */
function triggerProblems(yaml: string): string[] {
  const block = topBlock(yaml, 'on').join('\n')
  const problems: string[] = []
  if (!/^ {2}schedule:$/m.test(block)) problems.push(`${WORKFLOW}: on: declares no schedule:`)
  const cron = /^ {4}- cron: '(\S+) (\S+) \S+ \S+ \S+'$/m.exec(block)
  if (cron === null) problems.push(`${WORKFLOW}: on: declares no five-field cron: — the report has no nightly`)
  else if (cron[1] === '0') problems.push(`${WORKFLOW}: the cron fires on the hour (${cron[1]} ${cron[2]}) — the report is meant for an off-hour slot`)
  if (!/^ {2}workflow_dispatch:$/m.test(block)) problems.push(`${WORKFLOW}: on: declares no workflow_dispatch: — the report cannot be run by hand`)
  return problems
}

/** The permissions the workflow holds: exactly the two it names, and nothing beside them. */
function permissionProblems(yaml: string): string[] {
  const wanted: Record<string, string> = { contents: 'read', issues: 'write' }
  const held: Record<string, string> = {}
  for (const line of topBlock(yaml, 'permissions')) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const pair = /^ {2}([a-z-]+): (read|write|none)$/.exec(line)
    if (pair === null) return [`${WORKFLOW}: permissions has a line the guard cannot read: "${line.trim()}"`]
    held[pair[1]] = pair[2]
  }
  const problems: string[] = []
  for (const [scope, access] of Object.entries(wanted)) {
    if (held[scope] !== access) problems.push(`${WORKFLOW}: permissions must grant ${scope}: ${access}, not ${held[scope] ?? 'nothing'}`)
  }
  for (const scope of Object.keys(held)) {
    if (!(scope in wanted)) problems.push(`${WORKFLOW}: permissions grants ${scope}, which the report does not need`)
  }
  return problems
}

/** The report runs where the homelab's Linux runner is, the labels the other lanes carry. */
function runnerProblems(yaml: string): string[] {
  const job = jobBlock(yaml, 'report').join('\n')
  const runner = /^ {4}runs-on: \[(.+)\]$/m.exec(job)
  if (runner === null) return [`${WORKFLOW}: the report job declares no single-line runs-on: label list`]
  const labels = runner[1].split(',').map((label) => label.trim()).filter((label) => label !== '')
  const wanted = ['self-hosted', 'linux', 'x64', 'ubox']
  if (labels.join(' ') !== wanted.join(' ')) {
    return [`${WORKFLOW}: the report job runs on [${labels.join(', ')}], not [${wanted.join(', ')}]`]
  }
  return []
}

/**
 * The count step: it runs the script under the analytics token, and leaves the total where the
 * comment step reads it. A run that never stored the total could not keep its own promise to
 * stay silent on zero.
 */
function countProblems(yaml: string): string[] {
  const steps = stepsOf(jobBlock(yaml, 'report'))
  const problems: string[] = []
  const counting = steps.filter((step) => /GITHUB_OUTPUT/.test(step.run) && /total=/.test(step.run))
  if (counting.length !== 1) {
    return [`${WORKFLOW}: ${counting.length} steps write a total= to $GITHUB_OUTPUT; the report's one count step is what the comment step reads`]
  }
  const count = counting[0]
  if (!/scripts\/download-report\.mjs[^\n]*--json/.test(count.run)) {
    problems.push(`${WORKFLOW}: the count step does not run scripts/download-report.mjs --json — ${count.name || 'a step'} runs something else`)
  }
  if (!/--render download-report\.json/.test(count.run)) {
    problems.push(`${WORKFLOW}: the count step does not render the comment from the JSON report it just wrote`)
  }
  if (count.env.CF_ANALYTICS_TOKEN !== '${{ secrets.CF_ANALYTICS_TOKEN }}') {
    problems.push(`${WORKFLOW}: the count step does not read CF_ANALYTICS_TOKEN from the secret`)
  }
  if (count.id === '') problems.push(`${WORKFLOW}: the count step declares no id:, so nothing can read its total`)
  return problems
}

/** The step that fails on a missing secret: it names the token, the permission and the command
 *  that stores it, so the run's first failure is also the one-time fix. */
function tokenGuardProblems(yaml: string): string[] {
  const steps = stepsOf(jobBlock(yaml, 'report'))
  const guard = steps.find((step) => /::error::/.test(step.run) && /CF_ANALYTICS_TOKEN/.test(step.run))
  if (guard === undefined) {
    return [`${WORKFLOW}: no step fails with ::error:: naming CF_ANALYTICS_TOKEN when the secret is unset`]
  }
  const problems: string[] = []
  if (!/CF_ANALYTICS_TOKEN\}" \]/.test(guard.run)) problems.push(`${WORKFLOW}: the token guard does not test the secret for emptiness`)
  if (!/Zone Analytics/.test(guard.run)) problems.push(`${WORKFLOW}: the token guard does not name the permission to create (Zone Analytics)`)
  if (!/gh secret set CF_ANALYTICS_TOKEN/.test(guard.run)) problems.push(`${WORKFLOW}: the token guard does not say how to store the token (gh secret set)`)
  if (guard.env.CF_ANALYTICS_TOKEN !== '${{ secrets.CF_ANALYTICS_TOKEN }}') {
    problems.push(`${WORKFLOW}: the token guard does not read the secret it is guarding`)
  }
  return problems
}

/**
 * The comment step: one step posts, it is guarded by the count it reads, and it stays silent on
 * zero. The first post is the issue itself, which is why the create branch renders with
 * `--first` — the renderer's own first line then says the downloads started.
 */
function postingProblems(yaml: string): string[] {
  const steps = stepsOf(jobBlock(yaml, 'report'))
  const posting = steps.filter((step) => /gh issue /.test(step.run))
  if (posting.length !== 1) return [`${WORKFLOW}: ${posting.length} steps post to the issue; the report is one step`]
  const post = posting[0]
  const problems: string[] = []
  if (!/gh issue comment/.test(post.run)) problems.push(`${WORKFLOW}: the post step never comments on the issue`)
  if (!/gh issue create/.test(post.run)) problems.push(`${WORKFLOW}: the post step never creates the issue when it is missing`)
  if (!/gh issue list --search/.test(post.run)) problems.push(`${WORKFLOW}: the post step does not find the issue by title (gh issue list --search)`)
  if (!/--title 'Download report'|--title "Download report"/.test(post.run)) {
    problems.push(`${WORKFLOW}: the post step creates an issue that is not titled \`Download report\``)
  }
  if (!/--first/.test(post.run)) problems.push(`${WORKFLOW}: the create branch does not render the first post as the first downloads (--first)`)
  if (post.env.GH_TOKEN !== '${{ github.token }}' && post.env.GH_TOKEN !== '${{ secrets.GITHUB_TOKEN }}') {
    problems.push(`${WORKFLOW}: the post step carries no default-token GH_TOKEN`)
  }
  if (post.condition === '') {
    problems.push(`${WORKFLOW}: the post step runs on every total, including zero`)
    return problems
  }
  const counting = steps.filter((step) => /GITHUB_OUTPUT/.test(step.run) && /total=/.test(step.run))
  const countId = counting.length === 1 ? counting[0].id : ''
  if (countId === '' || !new RegExp(`steps\\.${countId}\\.outputs\\.total`).test(post.condition)) {
    problems.push(`${WORKFLOW}: the post step's if: "${post.condition}" reads no total the count step writes`)
  }
  if (admitsTotal(post.condition, 0)) {
    problems.push(`${WORKFLOW}: the post step would run with zero downloads — the issue must stay silent`)
  }
  return problems
}

/** Every secret the workflow reads: the analytics token, and nothing else. */
function secretProblems(yaml: string): string[] {
  const used = new Set([...yaml.matchAll(/\bsecrets\.([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => match[1]))
  const problems: string[] = []
  for (const name of used) {
    if (name !== 'CF_ANALYTICS_TOKEN' && name !== 'GITHUB_TOKEN') {
      problems.push(`${WORKFLOW}: reads the secret ${name}, and the report may read only CF_ANALYTICS_TOKEN and GITHUB_TOKEN`)
    }
  }
  if (!used.has('CF_ANALYTICS_TOKEN')) problems.push(`${WORKFLOW}: the analytics token is never read from secrets`)
  return problems
}

/** Everything the workflow checks read, as one list of failures. */
function workflowProblems(yaml: string): string[] {
  return [
    ...triggerProblems(yaml),
    ...permissionProblems(yaml),
    ...runnerProblems(yaml),
    ...countProblems(yaml),
    ...tokenGuardProblems(yaml),
    ...postingProblems(yaml),
    ...secretProblems(yaml)
  ]
}

/** The live workflow with one thing changed, and a failure when the text to change is not there. */
function doctored(from: string, to: string): string {
  if (!YAML.includes(from)) throw new Error(`the workflow no longer says "${from}" — the case would test nothing`)
  return YAML.replace(from, to)
}

describe('the workflow that carries the report', () => {
  it('is a nightly and a hand-startable run', () => {
    expect(triggerProblems(YAML)).toEqual([])
  })

  it('holds exactly the two permissions it names', () => {
    expect(permissionProblems(YAML)).toEqual([])
  })

  it('runs on the homelab runner the other lanes use', () => {
    expect(runnerProblems(YAML)).toEqual([])
  })

  it('counts with the script and the analytics token, and stores the total', () => {
    expect(countProblems(YAML)).toEqual([])
  })

  it('fails with the one-time fix when the token is unset', () => {
    expect(tokenGuardProblems(YAML)).toEqual([])
  })

  it('posts through the default token, and reads no other secret', () => {
    expect(secretProblems(YAML)).toEqual([])
    expect(postingProblems(YAML)).toEqual([])
  })

  it('posts nothing when the total is zero', () => {
    const post = stepsOf(jobBlock(YAML, 'report')).find((step) => /gh issue /.test(step.run))
    expect(post).toBeDefined()
    expect(admitsTotal(post?.condition ?? '', 0)).toBe(false)
    expect(admitsTotal(post?.condition ?? '', 1)).toBe(true)
  })
})

describe('the workflow the checks exist to refuse', () => {
  it('sees a post step that would run at zero', () => {
    const problems = workflowProblems(doctored(`if: steps.count.outputs.total != '0'`, 'if: always()'))
    expect(problems.some((problem) => problem.includes('would run with zero downloads'))).toBe(true)
  })

  it('sees a post step left unguarded', () => {
    const problems = workflowProblems(YAML.replace(`        if: steps.count.outputs.total != '0'\n`, ''))
    expect(problems.some((problem) => problem.includes('runs on every total'))).toBe(true)
  })

  it('sees a permission the report does not need', () => {
    const problems = workflowProblems(doctored('  issues: write', '  issues: write\n  actions: write'))
    expect(problems).toEqual([expect.stringContaining('grants actions')])
  })

  it('sees a permission that is not the one named', () => {
    const problems = workflowProblems(doctored('  issues: write', '  issues: read'))
    expect(problems).toEqual([expect.stringContaining('must grant issues: write')])
  })

  it('sees a runner that is not the homelab one', () => {
    const problems = workflowProblems(doctored('[self-hosted, linux, x64, ubox]', '[ubuntu-latest]'))
    expect(problems).toEqual([expect.stringContaining('runs on [ubuntu-latest]')])
  })

  it('sees a secret that is not the analytics token', () => {
    const problems = workflowProblems(
      doctored('CF_ANALYTICS_TOKEN: ${{ secrets.CF_ANALYTICS_TOKEN }}', 'CF_ANALYTICS_TOKEN: ${{ secrets.R2_SECRET_ACCESS_KEY }}')
    )
    expect(problems.some((problem) => problem.includes('reads the secret R2_SECRET_ACCESS_KEY'))).toBe(true)
  })

  it('sees a count step that runs another script', () => {
    const problems = workflowProblems(doctored('scripts/download-report.mjs --json', 'scripts/soak-report.mjs --json'))
    expect(problems).toEqual([expect.stringContaining('does not run scripts/download-report.mjs')])
  })

  it('sees a first post that is not marked as the first downloads', () => {
    const problems = workflowProblems(doctored('--render download-report.json --first', '--render download-report.json'))
    expect(problems).toEqual([expect.stringContaining('--first')])
  })

  it('sees a missing token guard', () => {
    const problems = workflowProblems(doctored('::error::CF_ANALYTICS_TOKEN is not set', 'CF_ANALYTICS_TOKEN is not set'))
    expect(problems).toEqual([expect.stringContaining('no step fails with ::error::')])
  })

  it("sees an issue that is not titled `Download report`", () => {
    const problems = workflowProblems(doctored("--title 'Download report'", "--title 'Release report'"))
    expect(problems).toEqual([expect.stringContaining('not titled')])
  })

  it('sees a cron on the hour', () => {
    const problems = workflowProblems(doctored("- cron: '17 7 * * *'", "- cron: '0 7 * * *'"))
    expect(problems).toEqual([expect.stringContaining('on the hour')])
  })
})
