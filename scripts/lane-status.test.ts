// The run's lane statuses: the vocabulary, the derivation and the report both producers write.
//
// `scripts/lane-status.mjs` is the one home for what a run says about its lanes, and the record
// is the one home for what may be claimed (`_bmad-output/specs/spec-cuerunner/quality-and-proof.md`,
// held to the module by `scripts/lane-claims.test.ts`). This guard is the other half: it holds
// the module to its own promises — the two words a lane's status may hold, the binding from a
// test's tag to the lane the record gives a claim to, the line and the report shape — and runs
// the derivation `integration/lane-status.reporter.ts` uses against the run shapes Playwright
// produces, including the ones a green job hides: a lane that ran nothing, a lane that partly
// ran, and a lane something went wrong in.
//
// The native lane's describe runs the ASIO step itself, on the machine the suite is running on:
// that note is the one place `ASIO hosting` is stated per run, and a claim that read as proved
// on a machine with no driver is the failure this story exists to prevent.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import {
  appendSummary,
  ASIO_CLAIM,
  ASIO_LANE,
  asioEntry,
  CLAIM_STATUSES,
  LANES,
  LANE_STATUSES,
  laneBinding,
  laneEntry,
  laneLine,
  laneStatus,
  NO_LANES,
  reportOf,
  runIdentity,
  runLine,
  seenTest,
  smokeOutcome,
  SUITE_REPORT,
  summaryBlock,
  TAG_LANES,
  TOOL,
  UNTAGGED_LANE,
  writeReport
} from './lane-status.mjs'
import LaneStatusReporter from '../integration/lane-status.reporter'

/** A temp directory for the runs that leave a file behind, removed with the test file. */
const scratch = mkdtempSync(join(tmpdir(), 'lane-status-'))

afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** One test as Playwright hands it to `onTestEnd`, with the result that goes with it. */
interface TestEvent {
  test: { id: string; title: string; tags: string[] }
  result: { status: string; annotations: { type: string; description?: string }[] }
}

/** One event, as the runner reports it: the test, and what the run did with it. */
function event(id: string, title: string, tags: string[], status: string, description?: string): TestEvent {
  return {
    test: { id, title, tags },
    result: { status, annotations: description === undefined ? [] : [{ type: 'skip', description }] }
  }
}

/** The report a reporter writes when it is handed a scratch path and no summary to append to. */
const EVENTS_REPORT = join(scratch, 'events-lanes.json')

/**
 * Every entry the reporter derives from a list of events, read off the report it writes: `onEnd`
 * is the only public seam, and the file it leaves is what a workflow and a reader both see. The
 * paths are the scratch ones — a test that wrote `test-results/lane-status.json` and appended to
 * `GITHUB_STEP_SUMMARY` would put made-up statuses on a real run's own surfaces.
 */
function entriesOf(events: TestEvent[]): Map<string, { lane: string; status: string; failures: string[] }> {
  const reporter = new LaneStatusReporter({ report: EVENTS_REPORT, summary: '' })
  for (const entry of events) reporter.onTestEnd(entry.test, entry.result)
  reporter.onEnd()
  return lanesOf(EVENTS_REPORT)
}

/** The lanes a report holds, by the tag or lane each is filed under. */
function lanesOf(at: string): Map<string, { lane: string; status: string; failures: string[] }> {
  const said = new Map<string, { lane: string; status: string; failures: string[] }>()
  for (const lane of JSON.parse(readFileSync(at, 'utf-8')).lanes) said.set(lane.tag ?? lane.lane, lane)
  return said
}

describe('the vocabulary a run states its lanes in', () => {
  it('holds two lane words and the record three claim words, and never confuses them', () => {
    expect(LANE_STATUSES).toEqual(['passed', 'skipped'])
    expect(CLAIM_STATUSES).toEqual(['proved', 'unproven', 'unclaimed'])
    expect(LANE_STATUSES.filter((word: string) => CLAIM_STATUSES.includes(word))).toEqual([])
  })

  it('names the lane the ASIO claim is reported on', () => {
    expect(ASIO_LANE).toBe('asio')
    expect(LANES).toContain(ASIO_LANE)
    expect(ASIO_CLAIM).toBe('ASIO hosting')
  })

  it('binds each tag to its lane, and an untagged test to the peers lane', () => {
    expect(TAG_LANES).toEqual({ '@vendor': 'vendor', '@ah': 'vendor', '@hardware': 'hardware' })
    expect(UNTAGGED_LANE).toBe('peers')
    expect(laneBinding(['@ah'])).toEqual({ tag: '@ah', lane: 'vendor' })
    expect(laneBinding(['@vendor'])).toEqual({ tag: '@vendor', lane: 'vendor' })
    expect(laneBinding(['@hardware'])).toEqual({ tag: '@hardware', lane: 'hardware' })
    expect(laneBinding(['@something-else'])).toEqual({ tag: null, lane: 'peers' })
    expect(laneBinding([])).toEqual({ tag: null, lane: 'peers' })
  })

  it('names every lane a tag binds, so no tag is filed under a lane nothing declares', () => {
    for (const lane of Object.values(TAG_LANES)) expect(LANES).toContain(lane)
  })
})

describe("a lane's status, derived from what the run did", () => {
  it('is passed only when every test of the lane ran and passed', () => {
    expect(laneStatus({ passed: 3 })).toBe('passed')
    expect(laneEntry('peers', null, [seenTest('one', 'passed'), seenTest('two', 'passed')]).status).toBe('passed')
  })

  it('is skipped when nothing of the lane ran — never passed over an empty run', () => {
    expect(laneStatus({})).toBe('skipped')
    expect(laneStatus({ passed: 0, skipped: 4, failed: 0 })).toBe('skipped')
    const entry = laneEntry('hardware', '@hardware', [
      seenTest('the desk answers for itself', 'skipped', 'no desk named — set DESK_HOST=host:port for a real SQ or Avantis'),
      seenTest('a scene recall moves the desk', 'skipped', 'no desk named — set DESK_HOST=host:port for a real SQ or Avantis')
    ])
    expect(entry.status).toBe('skipped')
    expect(entry).toMatchObject({ passed: 0, skipped: 2, failed: 0 })
    expect(entry.reasons).toEqual(['no desk named — set DESK_HOST=host:port for a real SQ or Avantis'])
  })

  it('is skipped when part of the lane ran and part did not', () => {
    const entry = laneEntry('hardware', '@hardware', [
      seenTest('the desk answers for itself', 'passed'),
      seenTest('a scene recall moves the desk', 'passed'),
      seenTest('a console transmitting show control fires it', 'skipped', 'no console named — set MSC_HOST')
    ])
    expect(entry.status).toBe('skipped')
    expect(entry).toMatchObject({ passed: 2, skipped: 1, failed: 0 })
    expect(entry.reasons).toEqual(['no console named — set MSC_HOST'])
  })

  it('is skipped when something failed, and names what failed rather than the status', () => {
    const entry = laneEntry('vendor', '@vendor', [
      seenTest('the console answers for itself', 'passed'),
      seenTest('the show fires a cue in the console', 'failed')
    ])
    expect(entry.status).toBe('skipped')
    expect(entry).toMatchObject({ passed: 1, skipped: 0, failed: 1 })
    expect(entry.failures).toEqual(['the show fires a cue in the console'])
  })

  it('counts a test that neither passed nor was skipped as a failure, whatever the runner called it', () => {
    expect(laneEntry('peers', null, [seenTest('a slow case', 'timedOut')])).toMatchObject({ failed: 1, skipped: 0 })
  })

  it('reasons a skip that carried none by its own title, so a lane never skips silently', () => {
    expect(laneEntry('peers', null, [seenTest('an unmarked case', 'skipped')]).reasons).toEqual([
      '"an unmarked case" skipped'
    ])
  })
})

describe('the line and the report both producers leave behind', () => {
  it('says the lane, the status, the counts and the reasons', () => {
    expect(laneLine(laneEntry('peers', null, [seenTest('one', 'passed')]))).toBe('peers: passed (1 passed, 0 skipped)')
    expect(
      laneLine(
        laneEntry('vendor', '@ah', [
          seenTest('a scene recall reaches the desk', 'skipped', 'no MIDI Control port named — set AH_MIDI_PORT')
        ])
      )
    ).toBe('@ah: skipped (0 passed, 1 skipped) — no MIDI Control port named — set AH_MIDI_PORT')
    expect(laneLine(laneEntry('vendor', '@vendor', [seenTest('a case', 'failed')]))).toBe(
      '@vendor: skipped (0 passed, 0 skipped, 1 failed) — "a case" failed'
    )
  })

  it('states the claim proved only when the driver smoke passed, naming the driver it hosted', () => {
    expect(smokeOutcome('Focusrite USB ASIO', 0)).toEqual({
      claimStatus: 'proved',
      reason: null,
      driver: 'Focusrite USB ASIO'
    })
    expect(smokeOutcome('Focusrite USB ASIO', 3)).toEqual({
      claimStatus: 'unproven',
      reason: 'the driver smoke against "Focusrite USB ASIO" did not pass (exit 3)',
      driver: null
    })
    expect(asioEntry(smokeOutcome('Focusrite USB ASIO', 0))).toMatchObject({
      lane: 'asio',
      status: 'passed',
      claim: ASIO_CLAIM,
      claimStatus: 'proved',
      driver: 'Focusrite USB ASIO'
    })
    expect(asioEntry(smokeOutcome('Focusrite USB ASIO', 1))).toMatchObject({ status: 'skipped', claimStatus: 'unproven' })
  })

  it("states the ASIO claim and the driver it hosted, in the run's own words", () => {
    const unproven = laneEntry('asio', null, [seenTest('the driver smoke', 'skipped', 'no driver')])
    expect(laneLine({ ...unproven, claim: ASIO_CLAIM, claimStatus: 'unproven' })).toBe(
      'asio: skipped (0 passed, 1 skipped) — ASIO hosting: unproven; no driver'
    )
    const proved = laneEntry('asio', null, [seenTest('the driver smoke', 'passed')])
    expect(
      laneLine({ ...proved, driver: 'Focusrite USB ASIO', claim: ASIO_CLAIM, claimStatus: 'proved' })
    ).toBe('asio: passed (1 passed, 0 skipped) — ASIO hosting: proved; hosted the driver "Focusrite USB ASIO"')
  })

  it('writes a report under the tool name, with one entry per lane', () => {
    const report = reportOf('integration', [laneEntry('peers', null, [seenTest('one', 'passed')])])
    expect(report.tool).toBe(TOOL)
    expect(report.source).toBe('integration')
    expect(report.lanes).toHaveLength(1)
    const at = join(scratch, 'nested', 'lane-status.json')
    expect(writeReport(at, report)).toBe(at)
    expect(JSON.parse(readFileSync(at, 'utf-8'))).toEqual(report)
  })

  it('names the run a report came from, so a lane is never filed under another job', () => {
    expect(
      runIdentity({
        GITHUB_WORKFLOW: 'CI',
        GITHUB_JOB: 'integration',
        GITHUB_RUN_ID: '4242',
        GITHUB_SHA: 'a'.repeat(40),
        GITHUB_REF: 'refs/heads/main'
      })
    ).toEqual({ workflow: 'CI', job: 'integration', run: '4242', sha: 'a'.repeat(40), ref: 'refs/heads/main' })
    expect(runIdentity({})).toEqual({ workflow: '', job: '', run: '', sha: '', ref: '' })
    expect(runLine(runIdentity({ GITHUB_WORKFLOW: 'CI', GITHUB_JOB: 'integration', GITHUB_SHA: 'b'.repeat(40) }))).toBe(
      `CI · integration · ${'b'.repeat(12)}`
    )
    // A developer's run names no run, and the block says so by carrying no line at all.
    expect(runLine(runIdentity({}))).toBe('')
  })

  it('says no lane has a status when no test ran, in the report and the summary too', () => {
    const report = reportOf('integration', [], runIdentity({}))
    expect(report.lanes).toEqual([])
    expect(report.note).toBe(NO_LANES)
    expect(summaryBlock([])).toBe(`## Lane status\n\n${NO_LANES}\n`)
  })

  it('carries the run into the summary block, above the lanes it names', () => {
    const run = runIdentity({ GITHUB_WORKFLOW: 'CI', GITHUB_JOB: 'e2e', GITHUB_RUN_ID: '7' })
    expect(summaryBlock([laneEntry('peers', null, [seenTest('one', 'passed')])], run)).toBe(
      '## Lane status\n\nCI · e2e · run 7\n- peers: passed (1 passed, 0 skipped)\n'
    )
  })

  it('appends the job summary when the environment names one, and writes nothing when it does not', () => {
    const block = summaryBlock([laneEntry('peers', null, [seenTest('one', 'passed')])])
    expect(block).toBe('## Lane status\n\n- peers: passed (1 passed, 0 skipped)\n')
    const at = join(scratch, 'summary.md')
    expect(appendSummary(block, at)).toBe(true)
    appendSummary(block, at)
    expect(readFileSync(at, 'utf-8')).toBe(`${block}${block}`)
    expect(appendSummary(block, '')).toBe(false)
  })
})

describe("the suite's reporter, on the run shapes a green job hides", () => {
  it('reports every test of a lane that ran', () => {
    const entries = entriesOf([
      event('1', 'answers /eos/ping', [], 'passed'),
      event('2', 'answers /eos/get/version', [], 'passed')
    ])
    expect(entries.get('peers')).toMatchObject({ lane: 'peers', status: 'passed', passed: 2, skipped: 0 })
  })

  it('reports a lane that skipped with the annotation own reason', () => {
    const entries = entriesOf([
      event('1', 'a scene recall reaches the desk', ['@ah'], 'skipped', 'no MIDI Control port named — set AH_MIDI_PORT'),
      event('2', 'the close is the same message', ['@ah'], 'skipped', 'no MIDI Control port named — set AH_MIDI_PORT')
    ])
    expect(entries.size).toBe(1)
    expect(entries.get('@ah')).toMatchObject({
      tag: '@ah',
      lane: 'vendor',
      status: 'skipped',
      passed: 0,
      skipped: 2,
      reasons: ['no MIDI Control port named — set AH_MIDI_PORT']
    })
  })

  it('reports the two halves of the vendor lane apart, though the record gives them one lane', () => {
    const entries = entriesOf([
      event('1', 'the console answers for itself', ['@vendor'], 'passed'),
      event('2', 'a scene recall reaches the desk', ['@ah'], 'skipped', 'no MIDI Control port named')
    ])
    expect([...entries.keys()].sort()).toEqual(['@ah', '@vendor'])
    expect(entries.get('@vendor')).toMatchObject({ lane: 'vendor', status: 'passed', passed: 1 })
    expect(entries.get('@ah')).toMatchObject({ lane: 'vendor', status: 'skipped', skipped: 1 })
  })

  it('reports a lane that partly ran as skipped, with the counts that say which half', () => {
    const entries = entriesOf([
      event('1', 'the desk answers for itself', ['@hardware'], 'passed'),
      event('2', 'a console transmitting show control fires it', ['@hardware'], 'skipped', 'no console named')
    ])
    expect(entries.get('@hardware')).toMatchObject({ status: 'skipped', passed: 1, skipped: 1, failed: 0 })
  })

  it('reports a lane something failed in as skipped, never as passed', () => {
    const entries = entriesOf([
      event('1', 'the console answers for itself', ['@vendor'], 'passed'),
      event('2', 'the show fires a cue in the console', ['@vendor'], 'failed')
    ])
    expect(entries.get('@vendor')).toMatchObject({ status: 'skipped', failed: 1 })
    expect(entries.get('@vendor')?.failures).toEqual(['the show fires a cue in the console'])
  })

  it('counts a retried test once, as the last attempt it made', () => {
    const entries = entriesOf([
      event('1', 'a case that came good', ['@hardware'], 'failed'),
      event('1', 'a case that came good', ['@hardware'], 'passed')
    ])
    expect(entries.get('@hardware')).toMatchObject({ status: 'passed', passed: 1, failed: 0 })
  })

  it('holds a lane with no events out of the report rather than calling it skipped', () => {
    const entries = entriesOf([event('1', 'the console answers for itself', ['@vendor'], 'passed')])
    expect(entries.has('@ah')).toBe(false)
    expect(entries.has('peers')).toBe(false)
  })
})

describe('the suite reporter, driven by a real Playwright run', () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

  /**
   * The reporter is only ever handed the events the runner fires, so the derivation is held by a
   * run of the real thing: `scripts/lane-status.fixture.config.ts` registers this reporter, runs
   * `scripts/lane-status.fixture.spec.ts` — three tests, no browser — and writes where
   * `LANE_STATUS_FIXTURE_REPORT` says. Hand-built events alone would keep this green while the
   * artifact named lanes the runner never reported.
   */
  it('reads the lanes off the events Playwright fires, and names the run it came from', () => {
    const at = join(scratch, 'playwright-lanes.json')
    const cli = createRequire(import.meta.url).resolve('@playwright/test/cli')
    const said = spawnSync(
      process.execPath,
      [cli, 'test', '--config', join(root, 'scripts', 'lane-status.fixture.config.ts')],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          LANE_STATUS_FIXTURE_REPORT: at,
          GITHUB_STEP_SUMMARY: '',
          GITHUB_WORKFLOW: 'CI',
          GITHUB_JOB: 'integration',
          GITHUB_RUN_ID: '4242',
          GITHUB_SHA: 'f'.repeat(40),
          GITHUB_REF: 'refs/heads/main'
        }
      }
    )
    expect(said.status, `${said.stdout}\n${said.stderr}`).toBe(0)
    const report = JSON.parse(readFileSync(at, 'utf-8'))
    expect(report.run).toEqual({
      workflow: 'CI',
      job: 'integration',
      run: '4242',
      sha: 'f'.repeat(40),
      ref: 'refs/heads/main'
    })
    const lanes = lanesOf(at)
    expect([...lanes.keys()].sort()).toEqual(['@ah', '@vendor', 'peers'])
    expect(lanes.get('@vendor')).toMatchObject({ lane: 'vendor', status: 'passed', passed: 1 })
    expect(lanes.get('@ah')).toMatchObject({
      lane: 'vendor',
      status: 'skipped',
      skipped: 1,
      reasons: [
        'no MIDI Control port named — set AH_MIDI_PORT to the virtual port A&H MIDI Control creates on this machine'
      ]
    })
    expect(lanes.get('peers')).toMatchObject({ lane: 'peers', status: 'passed', passed: 1 })
    // The runner boots a real Playwright process, so the default 5 s budget measures this
    // machine's load rather than the reporter: a loaded runner reports a slow run as a
    // failure. 60 s is headroom over the seconds this takes on an idle machine, and the
    // case still fails, by name, on the assertions above.
  }, 60_000)
})

describe('the native lane, run as the workflow runs it', () => {
  const smoke = 'native/audio/tests/asio-smoke.mjs'

  /**
   * The lane, run for real, with the environment a workflow gives it. `GITHUB_STEP_SUMMARY` is
   * always set by this test — to the caller's scratch path, or to nothing at all — so a run made
   * here never appends its statuses to a real job's summary.
   */
  function run(args: string[], at: string | null, job = '') {
    return spawnSync(process.execPath, [smoke, ...args], {
      encoding: 'utf8',
      env: { ...process.env, GITHUB_STEP_SUMMARY: at ?? '', GITHUB_JOB: job, GITHUB_WORKFLOW: job === '' ? '' : 'CI' }
    })
  }

  it('states ASIO hosting unproven, with the machine state as the reason, and leaves the report', () => {
    const report = join(scratch, 'asio-lane.json')
    const summary = join(scratch, 'asio-summary.md')
    const said = run(
      ['--no-driver', 'no ASIO SDK on this runner: the engine is built without ASIO', '--report', report],
      summary,
      'e2e (windows)'
    )
    expect(said.status, said.stderr).toBe(0)
    expect(said.stdout).toContain('ASIO hosting: unproven')
    expect(said.stdout).toContain('no ASIO SDK on this runner: the engine is built without ASIO')
    const parsed = JSON.parse(readFileSync(report, 'utf-8'))
    expect(parsed.tool).toBe(TOOL)
    // The run's own identity, and the machine the status is about: an ASIO status with neither
    // is a status a reader can file under another lane, or another machine.
    expect(parsed.run).toMatchObject({ workflow: 'CI', job: 'e2e (windows)' })
    expect(parsed.lanes[0]).toMatchObject({
      lane: ASIO_LANE,
      status: 'skipped',
      machine: process.platform,
      claim: ASIO_CLAIM,
      claimStatus: 'unproven',
      reasons: ['no ASIO SDK on this runner: the engine is built without ASIO']
    })
    const block = readFileSync(summary, 'utf-8')
    expect(block).toContain('CI · e2e (windows)')
    expect(block).toContain('ASIO hosting: unproven')
  })

  it('never states proved for a machine that hosted nothing', () => {
    const said = run(['--no-driver', 'nothing to host here'], null)
    expect(said.stdout).not.toContain('proved')
  })

  // The four ways the lane can fail before it has a driver to smoke are the engine's own, and
  // they are reachable only where the engine has an ASIO backend: Windows. The case runs there,
  // and everywhere else the platform note above is the whole of the ladder.
  it.skipIf(process.platform !== 'win32')('fails a run it cannot ask, and states the claim unproven all the same', () => {
    const said = run(['--device', 'no such driver', '--report', join(scratch, 'asio-unasked.json')], null)
    expect(said.status, 'a lane that could not smoke a driver is a failure').not.toBe(0)
    expect(said.stdout).toContain('ASIO hosting: unproven')
  })

  // The rest of the ladder is this machine's own: off Windows the lane says why it cannot host a
  // driver at all. On Windows the same run would reach for the engine, so the case is only
  // asserted where the platform is what decides — a lane that fails for want of a binary is not
  // what this guard is about.
  it.skipIf(process.platform === 'win32')(
    'reports the not-Windows note as unproven, and fails under --require',
    () => {
      const said = run([], null)
      expect(said.status, said.stderr).toBe(0)
      expect(said.stdout).toContain('ASIO hosting: unproven')
      expect(said.stdout).toContain(`not Windows (${process.platform})`)
      const required = run(['--require'], null)
      expect(required.status).not.toBe(0)
      expect(required.stderr).toContain('--require was asked for')
    }
  )
})

describe('the report path the workflows upload', () => {
  it('is the one the suite writes', () => {
    expect(SUITE_REPORT).toBe('test-results/lane-status.json')
  })
})
