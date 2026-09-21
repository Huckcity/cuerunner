// The one home for what a run says about the lanes it ran.
//
// A green build does not say which claims today's run supported. The integration suite's skips
// — `@vendor` with no console named, `@ah` with no MIDI Control port, `@hardware` with no desk
// and no cable — survive inside a green job as Playwright's own list lines with nothing
// counting them, and the ASIO lane's note about a machine with no driver reads the same whether
// or not it hosted one, so a reader has to reconstruct from an exit code what was proved. This
// module is the vocabulary both producers state their statuses in, and the shape of the report
// each of them leaves behind, so the two cannot drift apart:
//
//   - the suite's reporter (`integration/lane-status.reporter.ts`) derives each lane's status
//     from the run's own tests, prints it, writes `test-results/lane-status.json` and appends
//     the job summary;
//   - the ASIO lane (`native/audio/tests/asio-smoke.mjs`) states its claim's status for the
//     machine it ran on in its own note and in the report it was asked for.
//
// A lane's status is about the run (AD-24): `passed` when everything of that lane the job
// selected ran and passed, `skipped` when the lane did not run — nothing of it ran, or what ran
// did not pass. That is deliberately *not* the record's claim vocabulary (`proved`, `unproven`,
// `unclaimed`; `_bmad-output/specs/spec-cuerunner/quality-and-proof.md`): a run says what it
// did, the record says what may be claimed, and a lane that skipped leaves its claim standing
// exactly where the record left it.
//
// Nothing here imports the app, the renderer or Electron, and the only imports are `node:fs`
// and `node:path` — what writes the report and the job summary — so a native `.mjs` lane can
// import this module the way `scripts/soak-report.mjs` writes its own summary.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The tool name every report carries, and the first thing a reader of one sees. */
export const TOOL = 'lane-status'

/**
 * Every lane a run can report, by the name the record's lanes table gives it. `scripts/
 * lane-claims.test.ts` holds this list to that table both ways: a lane the record declares is
 * one a report can speak about, and a lane a report names is one the record declares.
 */
export const LANES = ['peers', 'vendor', 'hardware', 'asio']

/**
 * The lane each tag binds to, as the record's lanes table holds it: `@vendor` and `@ah` are the
 * vendor lane's two halves (`eos-windows` and `ah-windows`), and `@hardware` is the hardware
 * lane. The binding is a tag because that is what a job selects with `--grep` and what a test
 * carries; the lane is what the record gives a claim to.
 */
export const TAG_LANES = { '@vendor': 'vendor', '@ah': 'vendor', '@hardware': 'hardware' }

/**
 * Where a test with no tag the binding knows belongs: the peers lane is the one job that runs
 * the suite with no `--grep`, so the untagged tests are its own.
 */
export const UNTAGGED_LANE = 'peers'

/**
 * The two words a lane's run status may hold. There is no third: a lane that is not `passed`
 * is a lane whose claim stands where the record left it, which is the whole point of saying so.
 */
export const LANE_STATUSES = ['passed', 'skipped']

/**
 * The record's own words for what may be claimed. The ASIO lane states one of the first two for
 * the machine it ran on; the record states the standing status. Declared here so the words have
 * one home the suite and the lane both read, and held to the record by the guard.
 */
export const CLAIM_STATUSES = ['proved', 'unproven', 'unclaimed']

/** The claim the ASIO lane's report states — the record's own row name for it. */
export const ASIO_CLAIM = 'ASIO hosting'

/** The lane that reports it: the native smoke's own, and the lane the record's row names. */
export const ASIO_LANE = 'asio'

/** The report path the suite writes by default, relative to the checkout: what the workflows upload. */
export const SUITE_REPORT = 'test-results/lane-status.json'

/** What a run that saw no test says, in all three surfaces: the line, the summary and the report. */
export const NO_LANES = 'no test ran, so no lane has a status'

/**
 * The run a report came from, as GitHub's environment names it — empty parts where nothing is
 * set, which is a developer's own run. A status that cannot say which job produced it is a status
 * a reader can file under the wrong lane: the peers job runs the `@vendor` tests too, and only
 * the job's own name says whether the vendor lane or a replay of its fixture put them there.
 */
export function runIdentity(env = process.env) {
  return {
    workflow: env.GITHUB_WORKFLOW ?? '',
    job: env.GITHUB_JOB ?? '',
    run: env.GITHUB_RUN_ID ?? '',
    sha: env.GITHUB_SHA ?? '',
    ref: env.GITHUB_REF ?? ''
  }
}

/** The run, as one line: the parts the environment set, and nothing at all when it set none. */
export function runLine(run) {
  const said = [
    run.workflow,
    run.job,
    run.run === '' ? '' : `run ${run.run}`,
    run.sha === '' ? '' : run.sha.slice(0, 12),
    run.ref
  ].filter((part) => part !== '')
  return said.join(' · ')
}

/**
 * The tag a test's own tags bind to, and the lane that tag belongs to — nothing when no tag
 * binds, which is the untagged lane's own. The first tag the binding knows wins: a test carries
 * one lane.
 */
export function laneBinding(tags) {
  for (const tag of tags ?? []) {
    const lane = TAG_LANES[tag]
    if (lane !== undefined) return { tag, lane }
  }
  return { tag: null, lane: UNTAGGED_LANE }
}

/**
 * One test as the derivation reads it: what it is called, what the run did with it, and — for a
 * test that did not run — the reason it gave.
 */
export function seenTest(title, status, reason = null) {
  return { title, status, reason }
}

/**
 * A lane's status from the tests the run saw under it. `passed` needs every one of them: a test
 * that skipped is a test that did not run, and a test that failed is a test the lane did not
 * carry, so either leaves the lane `skipped` — which is the word that keeps a claim where it
 * stands. The counts and the reasons are what tell the three apart.
 */
export function laneStatus({ passed = 0, skipped = 0, failed = 0 }) {
  return skipped === 0 && failed === 0 && passed > 0 ? 'passed' : 'skipped'
}

/**
 * One lane-and-tag group's entry: the tag the job selected it by (`null` for the untagged
 * lane), the lane the record gives it, the run's status, the counts behind it, and the reasons
 * the run gave — the skip annotations' own words, and the tests that failed, by title. A lane
 * that carries a claim (the ASIO lane) fills `claim`, `claimStatus` and, when it hosted one,
 * `driver`.
 */
export function laneEntry(lane, tag, tests) {
  const counts = { passed: 0, skipped: 0, failed: 0 }
  const reasons = new Set()
  const failures = []
  for (const test of tests) {
    if (test.status === 'passed') {
      counts.passed += 1
    } else if (test.status === 'skipped') {
      counts.skipped += 1
      reasons.add(test.reason ?? `"${test.title}" skipped`)
    } else {
      counts.failed += 1
      failures.push(test.title)
    }
  }
  return { tag, lane, status: laneStatus(counts), ...counts, reasons: [...reasons], failures }
}

/**
 * The ASIO lane's entry: one thing — the driver smoke — and the claim this run gave it, on the
 * machine that ran it. The claim is `proved` only when the smoke hosted a driver and passed;
 * every other path leaves it `unproven` with the machine's state as the reason, because a machine
 * that hosted nothing has proved nothing, and the lane's own note is what says so. `machine` is
 * the platform, so the entry says *which* machine's status this is even where the reason does not
 * name it — the ASIO claim is per machine, never a standing one.
 */
export function asioEntry({ claimStatus, reason = null, driver = null, machine = null }) {
  const proved = claimStatus === 'proved'
  return {
    ...laneEntry(ASIO_LANE, null, [seenTest('the driver smoke', proved ? 'passed' : 'skipped', reason)]),
    machine,
    driver,
    claim: ASIO_CLAIM,
    claimStatus
  }
}

/**
 * What a finished driver smoke says about the claim, from the driver it was run against and the
 * exit code it left: `proved`, with the driver named, only when the smoke passed; `unproven`
 * with the failure as the reason otherwise — a lane that hosted a driver and did not get through
 * it has proved nothing either. The proved half is only reachable on a machine with a driver,
 * so the rule lives here rather than in the branch a runner without one never takes.
 */
export function smokeOutcome(driver, status) {
  return status === 0
    ? { claimStatus: 'proved', reason: null, driver }
    : { claimStatus: 'unproven', reason: `the driver smoke against "${driver}" did not pass (exit ${status})`, driver: null }
}

/** One lane's line, as the suite's own output and the job summary carry it, both producers alike. */
export function laneLine(entry) {
  const counts = `${entry.passed} passed, ${entry.skipped} skipped${entry.failed > 0 ? `, ${entry.failed} failed` : ''}`
  const said = [
    ...(entry.claim === undefined ? [] : [`${entry.claim}: ${entry.claimStatus}`]),
    ...(entry.machine === null || entry.machine === undefined ? [] : [`on ${entry.machine}`]),
    ...(entry.driver === null || entry.driver === undefined ? [] : [`hosted the driver "${entry.driver}"`]),
    ...entry.reasons,
    ...entry.failures.map(title => `"${title}" failed`)
  ]
  return `${entry.tag ?? entry.lane}: ${entry.status} (${counts})${said.length === 0 ? '' : ` — ${said.join('; ')}`}`
}

/**
 * A report, as both producers write it: the tool name, the run it came from, the producer, and
 * one entry per lane the run saw. `lanes` is the whole of it — the JSON a workflow uploads and a
 * reader opens months later says exactly what the job summary said, which run of which job it
 * was, and, when no test ran, that no lane has a status rather than nothing at all.
 */
export function reportOf(source, lanes, run = runIdentity()) {
  const report = { tool: TOOL, source, run, lanes }
  return lanes.length === 0 ? { ...report, note: NO_LANES } : report
}

/**
 * The job-summary block a run appends: the run's own name, then the same lines a reader sees in
 * the output — the surface a maintainer reads a finished run on, where a status filed under
 * another job's lane is the mistake this block exists to prevent.
 */
export function summaryBlock(lanes, run = null) {
  const said = run === null ? '' : runLine(run)
  return [
    '## Lane status',
    '',
    ...(said === '' ? [] : [said]),
    ...(lanes.length === 0 ? [NO_LANES] : lanes.map(entry => `- ${laneLine(entry)}`)),
    ''
  ].join('\n')
}

/**
 * The report, left where it was asked for: `mkdir -p` first, because a lane that ran before its
 * job created anything still has a status worth keeping.
 */
export function writeReport(at, report) {
  mkdirSync(dirname(at), { recursive: true })
  writeFileSync(at, `${JSON.stringify(report, null, 2)}\n`)
  return at
}

/**
 * The job summary, appended to — `GITHUB_STEP_SUMMARY` when the environment names one, the way
 * `scripts/soak-report.mjs` writes it, and nothing at all when it does not, because a
 * developer's run has no job summary to append to. Returns whether anything was written.
 */
export function appendSummary(block, at = process.env.GITHUB_STEP_SUMMARY ?? '') {
  if (at === '') return false
  appendFileSync(at, block.endsWith('\n') ? block : `${block}\n`)
  return true
}
