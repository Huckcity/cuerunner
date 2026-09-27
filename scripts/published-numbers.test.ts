// The throughput figures the project publishes, held to the runs that produce them.
//
// Two halves, because the rule has two failure modes. A figure typed into prose has nothing to
// compare against — no artifact, no lane — so a scan for the phrasings is its only holder: the
// realtime multiple is a floor the benchmark enforces by exiting non-zero below it (read here from
// the enforcement, `native/audio/tests/matrix-bench.mjs`), and a share of a core is a measurement
// that belongs to the run that measured it. A page can also render a figure its artifact never
// carried, and only rendering the page catches that, so the reliability page is mounted the way a
// browser runs it — the precedent is src/main/services/companionPage.test.ts — against the
// artifacts a nightly writes: fresh, absent, unreadable, malformed, outside the page's 48-hour
// bound (older, dated ahead of the clock, and undated) and hostile.
//
// The fixtures stand in for the artifact because there is none in the tree (the nightly soak
// publishes `soak-latest.json` beside the page), and because a stale result cannot be produced by
// waiting. It sits among the script tests for the same reason published-floors.test.ts does:
// reading files is Node's to do.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads a file the guard cannot run without: an absent input is a failure, never a skip. */
function read(relative: string): string {
  try {
    return fs.readFileSync(path.join(root, relative), 'utf-8')
  } catch (cause) {
    throw new Error(`published numbers: ${relative} cannot be read — ${(cause as Error).message}`)
  }
}

const README = read('README.md')
const CONTRACT = '_bmad-output/specs/spec-cuerunner/SPEC.md'
const BENCH = 'native/audio/tests/matrix-bench.mjs'
const RELIABILITY = read('website/reliability.html')

/** A statement of a figure, with the file and line it was read from. */
interface Statement {
  file: string
  line: number
  text: string
}

/**
 * The floor `matrix-bench` enforces: it exits non-zero below it, and that exit code — not a run's
 * output — is what makes the floor a published fact. The guard reads it from the enforcement so
 * that prose and the gate move together, and so that any other multiple prose states reads as what
 * it is: a measurement, which belongs to the run that measured it.
 */
function enforcedFloor(): number {
  const match = /^const THRESHOLD = (\d+(?:\.\d+)?)$/m.exec(read(BENCH))
  if (match === null) {
    throw new Error(`published numbers: ${BENCH} states no THRESHOLD, so no realtime floor is enforced`)
  }
  return Number(match[1])
}

/** How far back from the phrase a figure is read: this repo's prose hard-wraps mid-sentence. */
const WINDOW = 80

/**
 * A multiple: "8.7x", "2×", "8.7 times". The unit is written lowercase in this repo's prose — the
 * benchmark prints `${rtf.toFixed(2)}x realtime` and the removed table wrote "8.7x" — and an
 * uppercase suffix is a model name ("Ryzen 7 5800X"), so reading only the lowercase form is what
 * keeps a model out of the scan; the trailing boundary keeps "2x3" out.
 */
const MULTIPLE = /(?<![\w.])(\d+(?:\.\d+)?)\s*(?:x(?![\w])|×|times\b)/g

/** A multiple inside a range — "Playback speed, 0.25× to 4×" — is a setting, not a result. */
const RANGE_BEFORE = /(?:\bto|[–—-])\s*$/
const RANGE_AFTER = /^\s*(?:to\b|[–—-])\s*\d/

/**
 * Every realtime multiple a text states. The figure is read where it precedes the phrase it belongs
 * to — "8.7x realtime", "8.7x\nrealtime", "8.7 times faster than realtime" are one statement — and
 * only the enforced floor may be stated that way: the multiple any one machine reaches is the
 * benchmark's own output.
 */
function realtimeMultiples(file: string, text: string): Array<Statement & { value: number }> {
  const found: Array<Statement & { value: number }> = []
  const seen = new Set<string>()
  for (const phrase of text.matchAll(/real-?\s?time/gi)) {
    const at = phrase.index ?? 0
    const from = Math.max(0, at - WINDOW)
    for (const match of text.slice(from, at).matchAll(MULTIPLE)) {
      const start = from + (match.index ?? 0)
      const end = start + match[0].length
      if (RANGE_BEFORE.test(text.slice(Math.max(0, start - 8), start))) continue
      if (RANGE_AFTER.test(text.slice(end, end + 8))) continue
      const line = text.slice(0, start).split('\n').length
      const key = `${line}:${match[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      found.push({ file, line, text: match[0], value: Number(match[1]) })
    }
  }
  return found.sort((a, b) => a.line - b.line)
}

/**
 * The fraction words a share of a core is stated with. The patterns below read them from here, so a
 * wording one of them knows cannot be invisible to the others.
 */
const FRACTIONS =
  'hal(?:f|ves)|thirds?|quarters?|fourths?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|elevenths?|twelfths?|sixteenths?|twentieths?'

/** One core, named the ways a reader meets it — a share of a core or of a CPU is the same figure. */
const ONE_CORE = '(?:cpu|core)s?'

const FRACTION = new RegExp(`\\b(?:${FRACTIONS})\\b`, 'gi')
const FRACTION_OF_CORE = new RegExp(
  `\\b(?:${FRACTIONS})[\\s-]+(?:of[\\s-]+)?(?:a[\\s-]+|an[\\s-]+|one[\\s-]+|the[\\s-]+)?(?:modern[\\s-]+)?${ONE_CORE}\\b`,
  'gi'
)
const PERCENT_OF_CORE = new RegExp(
  `\\b\\d+(?:\\.\\d+)?\\s*%\\s*(?:of\\s+)?(?:a\\s+|an\\s+|one\\s+|the\\s+)?(?:modern\\s+)?${ONE_CORE}\\b`,
  'gi'
)
/** A decimal share of one core — "0.25 cores" — but not a whole-core count ("4 cores or more"). */
const DECIMAL_OF_CORE = new RegExp(
  `\\b\\d+\\.\\d+\\s*(?:of\\s+)?(?:a\\s+|an\\s+|one\\s+|the\\s+)?(?:modern\\s+)?${ONE_CORE}\\b`,
  'gi'
)

/**
 * Every share of a core a text states, as the figure it is, one per line. A share only counts where
 * a core is what it qualifies — "a quarter of one modern core" says what the engine costs to run,
 * while "a quarter of a second" (the takeover bound on the redundancy page) and "the free half" say
 * something else — so a phrase is read with its core across a line break, and a bare fraction is
 * read only on a line that names a core. A phrase wraps in HTML, so the line a match starts on is
 * the line the guard names.
 */
function coreFractions(file: string, text: string): Statement[] {
  const byLine = new Map<number, string>()
  const record = (line: number, statement: string) => {
    const seen = byLine.get(line)
    if (seen === undefined || statement.length > seen.length) byLine.set(line, statement)
  }
  const phrases = [
    ...text.matchAll(FRACTION_OF_CORE),
    ...text.matchAll(PERCENT_OF_CORE),
    ...text.matchAll(DECIMAL_OF_CORE)
  ]
  for (const match of phrases) {
    record(text.slice(0, match.index ?? 0).split('\n').length, match[0].replace(/\s+/g, ' '))
  }
  text.split('\n').forEach((line, index) => {
    if (!/\b(?:core|cpu)/i.test(line)) return
    for (const match of line.matchAll(FRACTION)) record(index + 1, match[0])
  })
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, statement]) => ({ file, line, text: statement }))
}

/**
 * Everything under `website/` a deploy serves: the hand-written and generated pages, and the
 * generator's sources beside them — `deploy-website.yml` uploads all of `website/`, so a figure
 * typed into `website/docs/*.mjs` ships fetchable whether or not a rebuild has moved it into a page.
 */
function siteFiles(): Array<{ file: string; text: string }> {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`published numbers: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const docs = `docs${path.sep}`
  const served = entries
    .filter((entry) => entry.endsWith('.html') || (entry.startsWith(docs) && entry.endsWith('.mjs')))
    .sort()
  if (served.length === 0) throw new Error('published numbers: website/ has nothing to read')
  return served.map((entry) => {
    const file = `website/${entry.split(path.sep).join('/')}`
    return { file, text: read(file) }
  })
}

/**
 * The published files the scan reads: the README a builder reads, the contract, and everything the
 * site serves.
 *
 * Exempt, and this is the whole list: the planning register and spine under
 * `_bmad-output/planning-artifacts/` (`epics.md`,
 * `architecture/architecture-cuerunner-2026-09-17/ARCHITECTURE-SPINE.md`), and the dated evidence
 * and logs — `_bmad-output/specs/spec-cuerunner/quality-and-proof.md`, the two `.memlog.md` files
 * under `_bmad-output/`, and `ENGINE-REVIEW-2-AND-ROADMAP.md`. They record what was measured, when,
 * and by which run or lane; a figure in them is history rather than a current claim.
 */
const PUBLISHED = [{ file: 'README.md', text: README }, { file: CONTRACT, text: read(CONTRACT) }, ...siteFiles()]

describe('a realtime multiple in prose', () => {
  const floor = enforcedFloor()

  it('is the floor the benchmark enforces, or it is not stated', () => {
    expect(
      PUBLISHED.flatMap((page) => realtimeMultiples(page.file, page.text))
        .filter((each) => each.value !== floor)
        .map(
          (each) =>
            `${each.file}:${each.line} states "${each.text}", and the floor the suite enforces is ${floor}x realtime`
        )
    ).toEqual([])
  })

  it('is published by the README as the gate it is', () => {
    const floors = realtimeMultiples('README.md', README).filter((each) => each.value === floor)
    expect(floors.length, `README.md states no ${floor}x realtime floor`).toBeGreaterThan(0)
  })

  it('is read across a wrap and in its spelled form', () => {
    expect(realtimeMultiples('x.md', 'the engine renders at 8.7x\nrealtime on the reference machine')).toEqual([
      { file: 'x.md', line: 1, text: '8.7x', value: 8.7 }
    ])
    expect(realtimeMultiples('x.md', 'a typical show runs 43 times faster than realtime')).toEqual([
      { file: 'x.md', line: 1, text: '43 times', value: 43 }
    ])
  })

  it('is not read out of a model name or a rate range', () => {
    expect(realtimeMultiples('x.md', 'Measured on a Ryzen 7 5800X, one core, realtime.')).toEqual([])
    expect(realtimeMultiples('x.md', 'Playback speed, 0.25× to 4×, applied in realtime.')).toEqual([])
  })
})

describe('a core fraction in prose', () => {
  it('is not stated, because no run produced one', () => {
    expect(
      PUBLISHED.flatMap((page) => coreFractions(page.file, page.text)).map(
        (each) => `${each.file}:${each.line} states "${each.text}", a throughput figure no run produced`
      )
    ).toEqual([])
  })

  it('is read in the spellings a page would use', () => {
    const shares = (text: string) => coreFractions('x.md', text).map((each) => each.text)
    expect(shares('the heaviest supported mix fits in a quarter of one modern CPU')).toEqual([
      'quarter of one modern CPU'
    ])
    expect(shares('a typical show in three quarters of a core')).toEqual(['quarters of a core'])
    expect(shares('about 0.25 cores for the worst mix')).toEqual(['0.25 cores'])
    expect(shares('fits in a quarter-of-one-modern-core')).toEqual(['quarter-of-one-modern-core'])
  })

  it('leaves the phrases that are not a share of one core alone', () => {
    const shares = (text: string) => coreFractions('x.md', text).map((each) => each.text)
    expect(shares('the app asks Core Audio, ALSA and JACK for a device')).toEqual([])
    expect(shares('the free half keeps working; a half-unpacked archive is refused')).toEqual([])
    expect(shares('the mirror position is at best a quarter of a second old')).toEqual([])
    expect(shares('two cores or more; four cores is comfortable')).toEqual([])
  })
})

describe('the files the scan reads', () => {
  it('are everything a deploy serves, sources as well as pages', () => {
    const files = PUBLISHED.map((page) => page.file)
    expect(files).toContain('README.md')
    expect(files).toContain(CONTRACT)
    expect(files.some((file) => file.startsWith('website/docs/') && file.endsWith('.mjs'))).toBe(true)
    expect(files.some((file) => file.startsWith('website/') && file.endsWith('.html'))).toBe(true)
  })
})

const HOUR = 3600000

/** The date a reader is shown for a run, in the page's own format, so a wrong one is caught. */
function shown(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC'
  }).format(new Date(iso))
}

/** The fields the page reads, as `scripts/soak-report.mjs` writes them. */
interface SoakResult {
  tool: string
  version: number
  generatedAt: string
  run: { id: string; url: string; sha: string; ref: string; repository: string }
  passed: boolean
  totals: Record<string, unknown>
  shards: Array<Record<string, unknown>>
}

/** A fixture with the named fields left out, as a result from an older run carries it. */
function without(object: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))
}

/**
 * A soak result with numbers no other case uses, so a figure on screen can be traced to the
 * fixture it came from — which is what makes "the page rendered a figure the artifact never
 * carried" a failure rather than a coincidence.
 */
function result(patch: Partial<SoakResult> = {}): SoakResult {
  return {
    tool: 'soak-result',
    version: 1,
    generatedAt: new Date(Date.now() - 2 * HOUR).toISOString(),
    run: {
      id: '4815162342',
      url: 'https://github.com/Huckcity/cuerunner/actions/runs/4815162342',
      sha: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c',
      ref: 'refs/heads/main',
      repository: 'Huckcity/cuerunner'
    },
    passed: true,
    totals: {
      shards: 2,
      shardsPassed: 2,
      showMinutes: 120,
      cuesScheduled: 1050,
      cuesStarted: 1048,
      starts: 1050,
      xruns: 0,
      decodeUnderruns: 0,
      droppedFileChunks: 0,
      errorEvents: 0,
      maxStartDelayMs: 12.5,
      meanStartDelayMs: 3.4,
      worstClockDriftPct: 0.07,
      peakActiveVoices: 41,
      peakStreamingVoices: 12,
      startToleranceMs: 15.67,
      clockTolerancePct: 0.5
    },
    shards: [
      {
        shard: 1,
        minutes: 60,
        seed: 2026091401,
        passed: true,
        failures: [],
        observedStarts: 522,
        scheduledRuns: 522,
        maxStartDelayMs: 12.5,
        driftPct: 0.07,
        xruns: 0,
        decodeUnderruns: 0
      },
      {
        shard: 2,
        minutes: 60,
        seed: 2026091402,
        passed: true,
        failures: [],
        observedStarts: 526,
        scheduledRuns: 528,
        maxStartDelayMs: 9.5,
        driftPct: 0.03,
        xruns: 0,
        decodeUnderruns: 0
      }
    ],
    ...patch
  }
}

/** What the page's `fetch` is answering with, including the ways it can fail. */
type Artifact =
  | { kind: 'absent' }
  | { kind: 'unreadable' }
  | { kind: 'malformed' }
  | { kind: 'json'; value: unknown }

function between(page: string, open: string, close: string): string {
  return page.slice(page.indexOf(open) + open.length, page.indexOf(close))
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`the page has no #${id}`)
  return node
}

/**
 * Mounts the page the way a browser runs it: the served markup in a document, the inline script
 * executed against the stubbed fetch, and the page's own completion awaited — the script is one
 * async expression, so nothing here sleeps or polls. Nothing of the page is copied: the fixture is
 * a `soak-latest.json` and the assertions read the elements a visitor sees.
 */
async function mount(artifact: Artifact): Promise<void> {
  document.body.innerHTML = between(RELIABILITY, '<body>', '</body>').replace(/<script[\s\S]*?<\/script>/, '')
  const answer =
    artifact.kind === 'unreadable'
      ? () => Promise.reject(new Error('the network is gone'))
      : () =>
          Promise.resolve(
            artifact.kind === 'absent'
              ? { ok: false, status: 404 }
              : {
                  ok: true,
                  status: 200,
                  json: () =>
                    artifact.kind === 'malformed'
                      ? Promise.reject(new Error('not json'))
                      : Promise.resolve(artifact.value)
                }
          )
  Object.defineProperty(window, 'fetch', { value: vi.fn(answer), configurable: true, writable: true })
  await new Function(`return (${between(RELIABILITY, '<script>', '</script>')}\n)`)()
}

/** The metric slots the cards render. */
const CARDS = ['m-hours', 'm-cues', 'm-xruns', 'm-underruns', 'm-delay', 'm-drift']

/** The page as it stands when it holds no result it can stand behind. */
function expectNoResult(): void {
  expect(el('run-data').hidden, 'the run block is rendered').toBe(true)
  expect(el('run-absent').hidden, 'the page says nothing at all').toBe(false)
  for (const id of CARDS) expect(el(id).textContent, `#${id} holds a figure`).toBe('—')
  expect(el('shard-rows').children, 'shard rows are rendered').toHaveLength(0)
}

/** The shard table as a reader reads it: one row per shard, cell by cell. */
function shardRows(): string[][] {
  return Array.from(el('shard-rows').querySelectorAll('tr')).map((row) =>
    Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent ?? '')
  )
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('the reliability page', () => {
  it('renders the run’s numbers while the result is current', async () => {
    const artifact = result()

    await mount({ kind: 'json', value: artifact })

    expect(el('run-data').hidden).toBe(false)
    expect(el('run-absent').hidden).toBe(true)
    expect(el('run-outcome').textContent).toBe('Passed')
    expect(el('run-stamp').textContent).toContain(`run of ${shown(artifact.generatedAt)} UTC`)
    expect(el('run-stamp').textContent).toContain('2 of 2 shards')
    expect(el('run-stamp').textContent).toContain('workflow run 4815162342')

    expect(el('m-hours').textContent).toBe('2.0 hours')
    expect(el('n-hours').textContent).toBe('120 show minutes')
    expect(el('m-cues').textContent).toBe('1048')
    expect(el('n-cues').textContent).toBe('of 1050 scheduled')
    expect(el('m-xruns').textContent).toBe('0')
    expect(el('m-underruns').textContent).toBe('0')
    expect(el('m-delay').textContent).toBe('12.5 ms')
    expect(el('n-delay').textContent).toBe('within the 15.67 ms tolerance')
    expect(el('m-drift').textContent).toBe('0.07%')
    expect(el('n-drift').textContent).toBe('within the 0.5% tolerance')
    expect(el('run-failures').hidden).toBe(true)

    expect(shardRows()).toEqual([
      ['1', '60', '522 / 522', '12.5 ms', '0.07%', '0', '0', 'Passed'],
      ['2', '60', '526 / 528', '9.5 ms', '0.03%', '0', '0', 'Passed']
    ])
  })

  it('renders a night that failed, and names the shard that failed with it', async () => {
    // The branch a reader sees on a red morning, and the one nothing mounted: the outcome,
    // the shard row and the failure list all come from the artifact, and nothing in this
    // suite had ever rendered a report with `passed: false`.
    const night = result({
      passed: false,
      shards: [
        { ...result().shards[0], passed: false, failures: ['device callbacks missed their deadline — 1 xruns'] }
      ]
    })

    await mount({ kind: 'json', value: night })

    expect(el('run-outcome').textContent).toBe('Failed')
    expect(el('run-outcome').classList.contains('fail')).toBe(true)
    // The shard's own verdict is its row's, not the run's.
    expect(shardRows().at(-1)?.at(-1)).toBe('Failed')
    expect(el('run-failures').textContent).toContain('Shard 1')
    expect(el('run-failures').textContent).toContain('1 xruns')
  })

  it('hides the shard table when the artifact carries no shards', async () => {
    // A report whose shards were never uploaded: the heading and the table go, rather than
    // sitting there empty under a page that claims to report on eight of them.
    await mount({ kind: 'json', value: result({ shards: [] }) })

    expect(el('shard-subhead').hidden).toBe(true)
    expect(el('shard-table').hidden).toBe(true)
    expect(shardRows()).toHaveLength(0)
  })

  it('links the workflow run the numbers came from, and only when it is a link', async () => {
    await mount({ kind: 'json', value: result() })
    const link = el('run-stamp').querySelector('a')
    expect(link?.getAttribute('href')).toBe('https://github.com/Huckcity/cuerunner/actions/runs/4815162342')
    expect(link?.textContent).toBe('workflow run 4815162342')

    // `javascript:` is not a link a page should carry, and neither is a missing one: the
    // stamp is then the stamp alone.
    const unlinked = result({ run: { ...result().run, url: 'javascript:alert(1)' } })
    document.body.innerHTML = ''
    await mount({ kind: 'json', value: unlinked })
    expect(el('run-stamp').querySelector('a')).toBeNull()
    expect(el('run-stamp').textContent).toContain('run of')
  })

  it('says it has no result when none is published', async () => {
    await mount({ kind: 'absent' })

    expect(el('run-absent').textContent).toMatch(/published yet/i)
    expectNoResult()
  })

  it('says it has no result when the artifact cannot be read in the browser', async () => {
    await mount({ kind: 'unreadable' })

    expect(el('run-absent').textContent).toMatch(/could not be read in this browser/i)
    expectNoResult()
  })

  it('says it has no result when the artifact is not a soak result', async () => {
    await mount({ kind: 'malformed' })
    expect(el('run-absent').textContent).toMatch(/could not be read/i)
    expectNoResult()

    await mount({ kind: 'json', value: { tool: 'soak-result-typo', passed: true, totals: {} } })
    expect(el('run-absent').textContent).toMatch(/could not be read/i)
    expectNoResult()
  })

  it('renders no figure of a run past the bound, and names the run it holds', async () => {
    const inside = result({ generatedAt: new Date(Date.now() - (48 * HOUR - 60000)).toISOString() })
    await mount({ kind: 'json', value: inside })
    expect(el('run-data').hidden).toBe(false)
    expect(el('m-cues').textContent).toBe('1048')

    const past = result({ generatedAt: new Date(Date.now() - (48 * HOUR + 60000)).toISOString() })
    await mount({ kind: 'json', value: past })

    expectNoResult()
    expect(el('run-absent').textContent).toMatch(/no current result/i)
    expect(el('run-absent').textContent).toContain(`${shown(past.generatedAt)} UTC`)
    expect(el('run-absent').textContent).not.toContain('1048')
  })

  it('says it has no result when the artifact is dated ahead of the page’s own clock', async () => {
    const ahead = result({ generatedAt: new Date(Date.now() + 1 * HOUR).toISOString() })
    await mount({ kind: 'json', value: ahead })

    expect(el('run-absent').textContent).toMatch(/no current result/i)
    expect(el('run-absent').textContent).toContain(`${shown(ahead.generatedAt)} UTC`)
    expectNoResult()
  })

  it('says it has no result when the artifact does not say when it ran', async () => {
    await mount({ kind: 'json', value: result({ generatedAt: 'sometime' }) })

    expect(el('run-absent').textContent).toMatch(/no current result/i)
    expectNoResult()
  })

  it('states the bound a result is held to, where a reader sees it', async () => {
    await mount({ kind: 'absent' })

    expect(document.body.textContent).toMatch(/\b48 hours\b/i)
  })

  it('leaves a figure the artifact does not carry as a placeholder', async () => {
    const artifact = result()

    await mount({
      kind: 'json',
      value: {
        ...artifact,
        totals: without(artifact.totals, 'maxStartDelayMs', 'decodeUnderruns'),
        shards: artifact.shards.map((shard) => without(shard, 'xruns'))
      }
    })

    expect(el('m-delay').textContent).toBe('—')
    expect(el('n-delay').textContent).toBe('not stated in this result')
    expect(el('m-underruns').textContent).toBe('—')
    expect(el('m-xruns').textContent, 'a measured zero is a figure, not a placeholder').toBe('0')
    expect(shardRows()[0][5]).toBe('—')
  })

  it('renders the artifact’s text, never its markup', async () => {
    const evil = '<img src=x onerror="window.pwned = 1"><script>alert(1)</script>'
    const artifact = result()

    await mount({
      kind: 'json',
      value: {
        ...artifact,
        failureNote: evil,
        shards: [{ ...artifact.shards[0], passed: false, failures: [evil] }]
      }
    })

    expect(document.querySelectorAll('script')).toHaveLength(0)
    expect(document.querySelector('img[src="x"]'), 'the payload became an element').toBeNull()
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined()
    expect(el('run-failures').hidden).toBe(false)
    expect(el('run-failures').textContent).toContain(evil)
    expect(el('run-outcome').textContent).toBe('Passed')
  })
})
