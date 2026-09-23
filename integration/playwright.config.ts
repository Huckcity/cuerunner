import { defineConfig } from '@playwright/test'

/**
 * The integration suite: Cuerunner talking to the systems it meets in a venue, with a peer
 * standing in for the console or the desk.
 *
 * Separate from `playwright.config.ts` because the two suites answer different questions
 * and have different failure modes. E2E drives the app's own surfaces with everything
 * else faked at the edges; this one drives real sockets, so a spec's first mistake is
 * usually in the peer rather than in the app. The peers are also runnable on their own —
 * `npm run peer:eos`, `npm run peer:desk` — which is what makes them a tool rather than a
 * fixture, and `harness-*.spec.ts` holds them to the vendor documents with no app
 * running at all.
 */
export default defineConfig({
  testDir: './specs',
  // A spec here can be waiting on a console's answer, a socket's connect deadline or an
  // Electron launch, and the app-driving specs do all three in one test.
  timeout: 45_000,
  retries: process.env.CI ? 1 : 0,
  // `list` says what each test did; the lane reporter says what the run's lanes did — which of
  // them ran, which skipped and why — because a green job's list lines are the only other place
  // a skip is visible (`lane-status.reporter.ts`, AD-24).
  reporter: [['list'], ['./lane-status.reporter.ts', {}]],
  // One file at a time, everywhere, and every lane's desk is on its own loopback address.
  // Both rules exist because the desk's ports are the *machine's* rather than a worker's:
  // several Electron instances (and several peers on loopback ports) starve each other on a
  // shared runner, the app dials 51326 for any SQ show, and the unit job binds the same three
  // ports on 0.0.0.0 — so a peer bound in one worker could otherwise be reached by another
  // worker's app, or by an app from a job running beside this one. `desk-sq.spec.ts` therefore
  // runs its peers and its show on 127.0.0.2, and a file that cannot take a port it needs
  // reports itself skipped rather than comparing somebody else's frames.
  workers: 1,
  use: {
    trace: 'on-first-retry'
  }
})
