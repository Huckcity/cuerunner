import { defineConfig } from '@playwright/test'

/**
 * The integration suite: WinsLab talking to the systems it meets in a venue, with a peer
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
  reporter: [['list']],
  // One at a time on CI, for the same reason the E2E lane is: several Electron instances
  // (and several peers on loopback ports) starve each other on a shared runner.
  workers: process.env.CI ? 1 : undefined,
  use: {
    trace: 'on-first-retry'
  }
})
