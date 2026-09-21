// The Playwright run that holds the suite's reporter to what Playwright actually hands it.
//
// `scripts/lane-status.test.ts` drives this config through the real Playwright CLI:
// `integration/lane-status.reporter.ts` only ever sees the events the runner fires, so a change
// in what a test carries — its tags, what the run did with it, the annotation a skip leaves — is
// only visible through those events. Hand-built objects would keep the derivation green while the
// artifact named the wrong lanes, which is why there is a run behind the check. No browser is
// involved: the fixture spec's tests open no page.
import { defineConfig } from '@playwright/test'

/**
 * Where the run under test leaves its report. The test that drives this config sets it to a
 * scratch path; a config run by hand without one is told so rather than writing over a real
 * run's report.
 */
const report = process.env.LANE_STATUS_FIXTURE_REPORT
if (report === undefined || report === '') {
  throw new Error(
    'scripts/lane-status.fixture.config.ts is driven by scripts/lane-status.test.ts, which sets LANE_STATUS_FIXTURE_REPORT to the path the report under test is read from'
  )
}

export default defineConfig({
  testDir: '.',
  testMatch: 'lane-status.fixture.spec.ts',
  workers: 1,
  reporter: [['null'], ['../integration/lane-status.reporter.ts', { report, summary: '' }]]
})
