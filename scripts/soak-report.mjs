#!/usr/bin/env node
/**
 * Fan-in for the nightly soak: one shard report per job, one result for the night.
 *
 * The soak jobs run as independent shards (each its own seed, each its own process) so
 * they fail separately; this is what turns them back into a single answer — the numbers
 * the reliability page publishes and the step summary a night's run leaves behind.
 *
 *   node scripts/soak-report.mjs --reports artifacts --out soak-latest.json
 *                               [--summary summary.md] [--allow-missing]
 *
 * Run metadata (id, url, sha, ref) comes from the GitHub Actions environment when it is
 * there, so a published result can point at the run that produced it.
 */
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = process.argv[index + 1]
  return value === undefined || value.startsWith('--') ? 'true' : value
}

const REPORTS_DIR = resolve(argValue('reports', 'artifacts'))
const OUT_PATH = resolve(argValue('out', 'soak-latest.json'))
const SUMMARY_PATH = argValue('summary', '')
const ALLOW_MISSING = process.argv.includes('--allow-missing')

function collect(dir, out = []) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) {
      collect(path, out)
      continue
    }
    if (!entry.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf-8'))
      if (parsed !== null && typeof parsed === 'object' && parsed.tool === 'soak') out.push({ path, report: parsed })
    } catch {
      // Not a soak report (a Playwright artifact, a stray JSON): ignore it.
    }
  }
  return out
}

const found = collect(REPORTS_DIR)
if (found.length === 0) {
  console.error(`no soak reports were found under ${REPORTS_DIR}`)
  if (!ALLOW_MISSING) process.exit(1)
}

const shards = found
  .map(({ report }) => ({
    shard: report.shard ?? 0,
    shards: report.shards ?? found.length,
    seed: report.seed,
    minutes: report.minutes,
    channels: report.channels,
    voices: report.voices,
    passed: report.passed === true,
    failures: (report.failures ?? []).slice(0, 5),
    observedStarts: report.show?.observedStarts ?? 0,
    scheduledRuns: report.show?.scheduledRuns ?? 0,
    maxStartDelayMs: report.timing?.maxStartDelayMs ?? null,
    meanStartDelayMs: report.timing?.meanStartDelayMs ?? null,
    driftPct: report.clock?.driftPct ?? null,
    xruns: report.health?.xruns ?? 0,
    decodeUnderruns: report.health?.decodeUnderruns ?? 0,
    droppedFileChunks: report.health?.droppedFileChunks ?? 0,
    errorEvents: report.health?.errorEvents ?? 0,
    peakActiveVoices: report.health?.peakActiveVoices ?? 0,
    peakStreamingVoices: report.health?.peakStreamingVoices ?? 0
  }))
  .sort((a, b) => a.shard - b.shard)

const sum = (key) => shards.reduce((total, shard) => total + (shard[key] ?? 0), 0)
const max = (key) => shards.reduce((best, shard) => (shard[key] === null || shard[key] === undefined ? best : Math.max(best, shard[key])), 0)
const worstDrift = shards.reduce((best, shard) => (shard.driftPct === null ? best : Math.max(best, Math.abs(shard.driftPct))), 0)
const first = found[0]?.report ?? {}

const totals = {
  shards: shards.length,
  shardsPassed: shards.filter((shard) => shard.passed).length,
  showMinutes: sum('minutes'),
  cuesScheduled: sum('scheduledRuns'),
  cuesStarted: sum('observedStarts'),
  starts: sum('scheduledRuns'),
  xruns: sum('xruns'),
  decodeUnderruns: sum('decodeUnderruns'),
  droppedFileChunks: sum('droppedFileChunks'),
  errorEvents: sum('errorEvents'),
  maxStartDelayMs: max('maxStartDelayMs'),
  meanStartDelayMs: shards.length > 0 ? Number((shards.reduce((total, shard) => total + (shard.meanStartDelayMs ?? 0), 0) / shards.length).toFixed(2)) : 0,
  worstClockDriftPct: Number(worstDrift.toFixed(4)),
  peakActiveVoices: max('peakActiveVoices'),
  peakStreamingVoices: max('peakStreamingVoices'),
  startToleranceMs: first.tolerances?.startDelayMs ?? null,
  clockTolerancePct: first.tolerances?.clockDriftPct ?? null
}

const server = process.env.GITHUB_SERVER_URL ?? 'https://github.com'
const repository = process.env.GITHUB_REPOSITORY ?? ''
const runId = process.env.GITHUB_RUN_ID ?? ''
const report = {
  tool: 'soak-result',
  version: 1,
  generatedAt: new Date().toISOString(),
  run: {
    id: runId,
    url: runId !== '' && repository !== '' ? `${server}/${repository}/actions/runs/${runId}` : '',
    sha: process.env.GITHUB_SHA ?? '',
    ref: process.env.GITHUB_REF ?? '',
    repository
  },
  passed: shards.length > 0 && shards.every((shard) => shard.passed),
  totals,
  shards
}

mkdirSync(dirname(OUT_PATH), { recursive: true })
writeFileSync(OUT_PATH, `${JSON.stringify(report, null, 2)}\n`)

const lines = []
lines.push('# Soak')
lines.push('')
lines.push(
  report.passed
    ? `**Passed** — ${(totals.showMinutes / 60).toFixed(1)} hours of show on the silent pacer, ${totals.cuesStarted} cues, no xruns, no underruns.`
    : `**Failed** — ${totals.shardsPassed}/${totals.shards} shards passed.`
)
lines.push('')
lines.push('| Shard | Minutes | Cues started | Max start delay | Clock drift | xruns | Stream underruns | Voices (peak) |')
lines.push('|---|---|---|---|---|---|---|---|')
for (const shard of shards) {
  lines.push(
    `| ${shard.shard} | ${shard.minutes} | ${shard.observedStarts} | ${shard.maxStartDelayMs ?? '—'} ms | ${shard.driftPct ?? '—'}% | ${shard.xruns} | ${shard.decodeUnderruns} | ${shard.peakActiveVoices} (${shard.peakStreamingVoices} streaming) |`
  )
}
lines.push('')
lines.push(
  `Tolerances: a cue must begin within **${totals.startToleranceMs} ms** of its scheduled time on the sample clock; ` +
    `the engine clock must stay within **${totals.clockTolerancePct}%** of the wall clock.`
)
if (report.run.url !== '') lines.push('')
if (report.run.url !== '') lines.push(`Run: ${report.run.url}`)
const failed = shards.filter((shard) => !shard.passed)
if (failed.length > 0) {
  lines.push('')
  lines.push('## Failures')
  for (const shard of failed) {
    lines.push(`- shard ${shard.shard}: ${shard.failures.length > 0 ? shard.failures.join('; ') : 'no detail'}`)
  }
}
const summary = `${lines.join('\n')}\n`

if (SUMMARY_PATH !== '') writeFileSync(resolve(SUMMARY_PATH), summary)
console.log(summary)
console.log(`soak result written to ${OUT_PATH}`)
process.exit(0)
