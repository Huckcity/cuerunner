// The suite's lane statuses, derived from the run's own tests.
//
// A green integration job does not say which of its lanes ran: `@vendor` with no console named,
// `@ah` with no MIDI Control port and `@hardware` with no desk each skip inside a job that
// exits 0, and Playwright's own list lines are all that says so. This reporter reads the run's
// test events and reports each lane in the vocabulary `scripts/lane-status.mjs` owns — `passed`
// when everything of that lane this job selected ran and passed, `skipped` when the lane did not
// run — with the counts behind it and the skip annotations' own reasons, so a maintainer reading
// a finished run knows which claims it supported (AD-24).
//
// The statuses come from test *events* rather than from a JSON report file, and that is the
// point: `--grep` removes a test this job did not select before any reporter sees it, so a file
// cannot tell "this job does not run that lane" from "that lane skipped here" — and the two must
// not be confused, because only the second one is a lane whose claim stands where it was. A lane
// with no events at all is simply not reported.
//
// Every line names the run it came from, too (`GITHUB_WORKFLOW`, `GITHUB_JOB`, the run id, the
// sha and the ref): the peers job runs the `@vendor` tests as a replay of the vendor lane's own
// fixture, so a status that does not say which job produced it lets a replay read as the lane.
//
// The report goes where the options say — `test-results/lane-status.json` and the job summary by
// default, and the scratch paths a test hands it, so a test never writes a run's real surfaces.
import type { Reporter } from '@playwright/test/reporter'

// @ts-ignore — js file, no type declarations
import {
  appendSummary,
  laneBinding,
  laneEntry,
  laneLine,
  NO_LANES,
  reportOf,
  runIdentity,
  SUITE_REPORT,
  summaryBlock,
  writeReport,
  seenTest
} from '../scripts/lane-status.mjs'

/** The parts of a Playwright test this reporter reads: what it is called, its id, and its tags. */
interface RanTest {
  id: string
  title: string
  tags: string[]
}

/** The parts of a result it reads: what the run did with the test, and the annotations that say why. */
interface TestOutcome {
  status: string
  annotations: { type: string; description?: string }[]
}

/** Where this reporter leaves what it writes: the run's own paths unless a caller says otherwise. */
export interface LaneStatusOptions {
  report?: string
  summary?: string
}

/** One lane-and-tag group as it accumulates: tests keyed by id, so a retry is one test, the last attempt. */
interface Group {
  lane: string
  tag: string | null
  tests: Map<string, { title: string; status: string; reason: string | null }>
}

/** The reason a skipped test gave, exactly as the annotation carries it — `test.skip(cond, reason)`. */
function skipReason(annotations: TestOutcome['annotations']): string | null {
  const skip = annotations.find(entry => entry.type === 'skip' && (entry.description ?? '') !== '')
  return skip?.description ?? null
}

/**
 * What a run's lanes did, in the vocabulary `scripts/lane-status.mjs` owns, printed and left in
 * the report and the job summary. One entry per tag the job selected — the two halves of the
 * vendor lane are two entries, because that is how their jobs select them — plus the untagged
 * lane, whose entry the module names.
 */
export default class LaneStatusReporter implements Reporter {
  private readonly groups = new Map<string, Group>()
  private readonly reportPath: string
  private readonly summaryPath: string

  constructor(options: LaneStatusOptions = {}) {
    this.reportPath = options.report ?? SUITE_REPORT
    this.summaryPath = options.summary ?? (process.env.GITHUB_STEP_SUMMARY ?? '')
  }

  onTestEnd(test: RanTest, result: TestOutcome): void {
    const { tag, lane } = laneBinding(test.tags)
    const key = tag ?? lane
    const group = this.groups.get(key) ?? { lane, tag, tests: new Map() }
    group.tests.set(test.id, seenTest(test.title, result.status, skipReason(result.annotations)))
    this.groups.set(key, group)
  }

  onEnd(): void {
    const entries = [...this.groups.values()]
      .map(group => laneEntry(group.lane, group.tag, [...group.tests.values()]))
      .sort((one, other) => (one.tag ?? one.lane).localeCompare(other.tag ?? other.lane))
    const run = runIdentity()
    console.log('lane status: what this run supported')
    for (const entry of entries.length === 0 ? [NO_LANES] : entries.map(laneLine)) {
      console.log(`  ${entry}`)
    }
    writeReport(this.reportPath, reportOf('integration', entries, run))
    console.log(`lane status written to ${this.reportPath}`)
    appendSummary(summaryBlock(entries, run), this.summaryPath)
  }
}
