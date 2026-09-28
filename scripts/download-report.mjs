#!/usr/bin/env node
// The download report: whether anyone is downloading the installers, and from where.
//
// No one is told about the app yet, so a download is the only signal it makes outside this
// repository — and nothing in the pipeline sees it. The site's cards point at
// `pub.cuerunner.app`, a Cloudflare R2 bucket on the `cuerunner.app` zone, and the app sends
// nothing itself (a promise the README makes), so the counts are read from the host that
// serves the files rather than from the files: Cloudflare's GraphQL Analytics API, grouped by
// path and country for a window.
//
// What the numbers are not: a headcount. Cloudflare counts edge requests, and a resumed or
// ranged download, a re-click, a link scanner or a cache revalidation each adds requests, so a
// count reads as "someone is downloading", never as a person. Only a request path and a country
// code are asked for; nothing that identifies a request (IP, user agent, ASN) is read or
// written.
//
//   node scripts/download-report.mjs                      the markdown comment for the window
//   node scripts/download-report.mjs --json               the same report as JSON
//   node scripts/download-report.mjs --json --out r.json  ... written to a file
//   node scripts/download-report.mjs --render r.json      render a JSON report again [--first]
//
// Environment:
//   CF_ANALYTICS_TOKEN  required. Zone Analytics:Read on the zone; never printed or logged.
//   CF_ZONE_ID          default a74e2b670114be33630a147f6c058d79 (cuerunner.app)
//   MIRROR_HOST         default pub.cuerunner.app
//   WINDOW_HOURS        default 26, so a daily run leaves no gap between one window and the next
//
// Exit 0 with a zero total when there is nothing to report, so a workflow can stay silent; exit
// 1 with the cause on stderr for a missing token, an HTTP or GraphQL error, or a response that
// is not the shape this asked for.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** The one endpoint, the one zone and the one host this is for; each can be overridden by env. */
const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql'
const DEFAULT_ZONE_ID = 'a74e2b670114be33630a147f6c058d79'
const DEFAULT_HOST = 'pub.cuerunner.app'
const DEFAULT_WINDOW_HOURS = 26

/** The window can look back before Cloudflare stops serving a dataset's older hours. */
const MAX_WINDOW_HOURS = 24 * 30

/**
 * The page this asks for, and the bytes it will read, both capped: the query groups by path and
 * country, so a busy window makes rows rather than one number, and an answer bigger than this
 * is refused rather than parsed. A full page is reported as truncated — the counts are a floor.
 */
export const QUERY_LIMIT = 500
const MAX_QUERY_LIMIT = 1000
export const MAX_RESPONSE_BYTES = 1024 * 1024

/** Served downloads answer 200, or 206 when the transfer is a range — a resumed one. */
const SUCCESS_STATUSES = [200, 206]

/**
 * The one line saying what the counts are not, carried in the message itself: the workflow
 * posts the script's markdown, so the caveat cannot drift from the counts it describes.
 */
export const CAVEAT =
  'Edge requests, not people: a resumed or ranged download, a re-click or a scanner adds counts — read this as "someone is downloading", not a headcount. Country code only; nothing identifying is read or kept.'

/**
 * The installer names under the two prefixes the mirror writes, and the platform each family
 * ships to. The mirror's own names are what the site's cards link (`Cuerunner-Setup.exe` and
 * the like); the build names are what a version's own directory carries. A name that is not one
 * of these — `SHA256SUMS`, a stray scan of `/latest/` — is not a download, and counting it
 * would be counting something other than what the report says it counts.
 */
const INSTALLERS = [
  { platform: 'windows', name: /^Cuerunner(?:-Setup| Setup [\w.\- ]+)\.exe$/ },
  { platform: 'macos', name: /^Cuerunner(?:-[\w.\-]+)?\.dmg$/ },
  { platform: 'linux', name: /^Cuerunner(?:-[\w.\-]+)?\.AppImage$/ }
]

/** One path the report counts, as the platform it is for and the path as it was requested. */
export function installerOf(requestPath) {
  if (typeof requestPath !== 'string') return null
  let path
  try {
    path = decodeURIComponent(requestPath)
  } catch {
    return null // a path that is not valid percent-encoding cannot be one of these names
  }
  const match = /^\/(latest|versions\/[^/]+)\/([^/]+)$/.exec(path)
  if (match === null) return null
  const name = match[2]
  for (const installer of INSTALLERS) {
    if (installer.name.test(name)) return { platform: installer.platform, path }
  }
  return null
}

/**
 * The query, and the variables carrying everything that decides what it counts: the mirror
 * host, the window, GET, the two success statuses, and the two prefixes the installer paths
 * live under. The filter is handed over as variables so a test can read what is asked for
 * without reading the query text, and so no value is ever spliced into the query as code.
 */
export function buildQuery({ zoneId, host, since, until, limit = QUERY_LIMIT }) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new Error(`the page size has to be an integer between 1 and ${MAX_QUERY_LIMIT}, not ${limit}`)
  }
  const query = `query DownloadReport($zoneTag: string, $filter: filter) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      httpRequestsAdaptiveGroups(limit: ${limit}, orderBy: [count_DESC], filter: $filter) {
        count
        dimensions {
          clientRequestPath
          clientCountryName
        }
      }
    }
  }
}`
  return {
    query,
    variables: {
      zoneTag: zoneId,
      filter: {
        datetime_geq: since,
        datetime_lt: until,
        clientRequestHTTPHost: host,
        clientRequestHTTPMethodName: 'GET',
        edgeResponseStatus_in: SUCCESS_STATUSES,
        OR: [
          { clientRequestPath_like: '/latest/%' },
          { clientRequestPath_like: '/versions/%' }
        ]
      }
    }
  }
}

/** The window's two ends, as Cloudflare's `Time` takes them. */
export function windowOf(hours, now = new Date()) {
  const until = new Date(now).getTime()
  return {
    since: new Date(until - hours * 3600 * 1000).toISOString(),
    until: new Date(until).toISOString()
  }
}

/** What the script is run with, read from the environment — the token included, never printed. */
export function readConfig(env = process.env) {
  const token = (env.CF_ANALYTICS_TOKEN ?? '').trim()
  if (token === '') {
    throw new Error(
      'CF_ANALYTICS_TOKEN is not set — create a Cloudflare API token with Zone Analytics:Read on the ' +
        'cuerunner.app zone and provide it in the environment'
    )
  }
  const zoneId = (env.CF_ZONE_ID ?? '').trim() || DEFAULT_ZONE_ID
  const host = (env.MIRROR_HOST ?? '').trim() || DEFAULT_HOST
  if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error(`MIRROR_HOST "${host}" is not a hostname`)
  const hours = env.WINDOW_HOURS === undefined || env.WINDOW_HOURS === '' ? DEFAULT_WINDOW_HOURS : Number(env.WINDOW_HOURS)
  if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_WINDOW_HOURS) {
    throw new Error(`WINDOW_HOURS has to be between 1 and ${MAX_WINDOW_HOURS} hours, not "${env.WINDOW_HOURS}"`)
  }
  return { token, zoneId, host, hours }
}

/**
 * The rows a Cloudflare answer holds, or a loud failure: GraphQL `errors` are the permission
 * and the query mistakes, and a response of another shape is not something to read zero
 * downloads out of. The token is asked for one zone, so anything other than one zone back —
 * including none, which is what a token without access to the zone sees — is an error rather
 * than an empty report.
 */
export function parseResponse(payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new Error('Cloudflare answered with something that is not a JSON object')
  }
  const errors = Array.isArray(payload.errors) ? payload.errors : []
  if (errors.length > 0) {
    const said = errors
      .map((error) => (error && typeof error.message === 'string' ? error.message : JSON.stringify(error)))
      .slice(0, 3)
      .join('; ')
    throw new Error(`Cloudflare GraphQL refused the query: ${said}`)
  }
  const zones = payload.data?.viewer?.zones
  if (!Array.isArray(zones)) throw new Error('the answer carries no viewer.zones — not the shape this query asks for')
  if (zones.length !== 1) {
    throw new Error(
      `the token sees ${zones.length} zones for CF_ZONE_ID — check the zone id and that the token can read it`
    )
  }
  const groups = zones[0]?.httpRequestsAdaptiveGroups
  if (!Array.isArray(groups)) {
    throw new Error('the answer carries no httpRequestsAdaptiveGroups — not the shape this query asks for')
  }
  return groups.map((group, index) => {
    const count = group?.count
    const path = group?.dimensions?.clientRequestPath
    const country = group?.dimensions?.clientCountryName
    if (!Number.isFinite(count) || typeof path !== 'string' || typeof country !== 'string') {
      throw new Error(`row ${index} is not a {count, dimensions {clientRequestPath, clientCountryName}} group`)
    }
    return { path, country, count }
  })
}

/** Most first, and alphabetical between equals, so two runs over the same rows agree. */
function byCountThenName(a, b) {
  return b.count - a.count || a.name.localeCompare(b.name)
}

function byCountThenPath(a, b) {
  return b.count - a.count || a.path.localeCompare(b.path)
}

/**
 * The rows as one report: the installer rows only, totalled over the window, with the platform
 * split, the countries (most first) and the paths. `truncated` says the answer filled the page
 * this asked for, so the totals are a floor rather than the window's whole.
 */
export function buildReport(rows, { host, hours, since, until, limit = QUERY_LIMIT }) {
  const platforms = { windows: 0, macos: 0, linux: 0 }
  const countries = new Map()
  const paths = new Map()
  let total = 0
  for (const row of rows) {
    const installer = installerOf(row.path)
    if (installer === null) continue // /latest/ holds more than the installers: a probe is not a download
    total += row.count
    platforms[installer.platform] += row.count
    countries.set(row.country, (countries.get(row.country) ?? 0) + row.count)
    paths.set(installer.path, (paths.get(installer.path) ?? 0) + row.count)
  }
  return {
    host,
    window: { hours, since, until },
    total,
    platforms,
    countries: [...countries].map(([name, count]) => ({ name, count })).sort(byCountThenName),
    paths: [...paths].map(([path, count]) => ({ path, count })).sort(byCountThenPath),
    limit,
    truncated: rows.length >= limit
  }
}

/** `2026-09-28T20:41:07.123Z` as `2026-09-28 20:41 UTC`, the resolution the window is read at. */
function utcStamp(iso) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`
}

/**
 * The message the workflow posts: the total, the platform split, the top five countries and the
 * window, with the caveat line the header carries. `first` marks the run that starts the
 * report — the issue's own first post — as the first downloads rather than a routine update.
 */
export function renderMarkdown(report, { first = false } = {}) {
  const title = first ? 'First downloads' : 'Download report'
  const hours = report.window.hours
  const period = `${utcStamp(report.window.since)} to ${utcStamp(report.window.until)}`
  if (report.total === 0) {
    return `**${title}** — no installer downloads at \`${report.host}\` in the last ${hours} hours (${period}).\n${CAVEAT}`
  }
  const top = report.countries.slice(0, 5)
  const more = report.countries.length - top.length
  const lines = [
    `**${title}** — ${report.total} installer ${report.total === 1 ? 'download' : 'downloads'} at \`${report.host}\` in the last ${hours} hours (${period}).`,
    CAVEAT,
    '',
    '| Platform | Downloads |',
    '| --- | --- |',
    `| Windows | ${report.platforms.windows} |`,
    `| macOS | ${report.platforms.macos} |`,
    `| Linux | ${report.platforms.linux} |`,
    '',
    `By country (top 5): ${top.map((country) => `\`${country.name}\` ${country.count}`).join(' · ')}${
      more > 0 ? ` — and ${more} more` : ''
    }.`
  ]
  if (report.truncated) {
    lines.push(
      '',
      `> The API returned its whole page (${report.limit} rows), so these counts are a floor: a busier window needs a narrower one.`
    )
  }
  return lines.join('\n')
}

/**
 * The response body, up to `limit` bytes; an answer past it is refused rather than read. The
 * reader's chunks are measured as they arrive, so the cap holds even when no `content-length`
 * is sent.
 */
async function readBounded(response, limit = MAX_RESPONSE_BYTES) {
  if (typeof response?.body?.getReader !== 'function') {
    throw new Error('Cloudflare answered with no readable body')
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel()
      throw new Error(`Cloudflare's answer is larger than the ${limit} bytes this reads — refusing it`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * The whole read, in order: the config, the window, the query, the request, the parse and the
 * aggregation. Injections exist for the tests as much as for the workflow: the fetch is a
 * parameter so no test needs the network, and the clock is one so the window is asserted rather
 * than raced.
 */
export async function fetchReport({ env = process.env, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  const config = readConfig(env)
  const window = windowOf(config.hours, now)
  const { query, variables } = buildQuery({
    zoneId: config.zoneId,
    host: config.host,
    since: window.since,
    until: window.until
  })
  let response
  try {
    response = await fetchImpl(GRAPHQL_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables })
    })
  } catch (cause) {
    throw new Error(`the request to Cloudflare failed: ${cause instanceof Error ? cause.message : cause}`)
  }
  if (!response.ok) {
    let detail = ''
    try {
      detail = (await readBounded(response)).slice(0, 300)
    } catch {
      // The status is the message when the body cannot be read for it.
    }
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
    throw new Error(`Cloudflare answered ${status}${detail === '' ? '' : ` — ${detail}`}`)
  }
  let payload
  try {
    payload = JSON.parse(await readBounded(response))
  } catch (cause) {
    throw new Error(`Cloudflare's answer is not JSON this can read: ${cause instanceof Error ? cause.message : cause}`)
  }
  return buildReport(parseResponse(payload), {
    host: config.host,
    hours: config.hours,
    since: window.since,
    until: window.until,
    limit: QUERY_LIMIT
  })
}

/** The value after `--name`, or nothing when the flag is absent or carries no value. */
function argValue(argv, name) {
  const index = argv.indexOf(`--${name}`)
  if (index < 0) return ''
  const value = argv[index + 1]
  return value === undefined || value.startsWith('--') ? '' : value
}

/**
 * The command line, and the only impure entry: it decides what is read (a JSON report again, or
 * Cloudflare) and where the output goes, and turns any failure into an exit code with the cause
 * on stderr. `main()` is called only when this file is run, so importing it in a test runs
 * nothing.
 */
export async function main(argv = process.argv.slice(2), io = {}) {
  const { env = process.env, fetchImpl = globalThis.fetch, now = new Date(), stdout = process.stdout, stderr = process.stderr } = io
  try {
    const json = argv.includes('--json')
    const first = argv.includes('--first')
    const out = argValue(argv, 'out')
    const from = argValue(argv, 'render')
    if (argv.includes('--out') && out === '') throw new Error('--out needs a file path')
    if (argv.includes('--render') && from === '') throw new Error('--render needs the path of a JSON report')
    if (from !== '' && json) throw new Error('--render prints the markdown message; it does not also take --json')
    const report =
      from !== ''
        ? JSON.parse(readFileSync(from, 'utf8'))
        : await fetchReport({ env, fetchImpl, now })
    const text = json ? `${JSON.stringify(report, null, 2)}\n` : `${renderMarkdown(report, { first })}\n`
    if (out !== '') writeFileSync(out, text)
    else stdout.write(text)
    return 0
  } catch (cause) {
    stderr.write(`download-report: ${cause instanceof Error ? cause.message : cause}\n`)
    return 1
  }
}

// Run directly: `node scripts/download-report.mjs`. An import (`vitest`, another script) gets
// the pure functions and calls nothing. The paths are compared resolved, because a checkout
// reached through a symlink would otherwise run nothing at all — the quietest way for a report
// to say nothing.
function isDirectRun() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isDirectRun()) {
  process.exitCode = await main()
}
