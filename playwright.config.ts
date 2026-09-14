import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 20_000,
  // One retry, on CI only. Shared runners starve an Electron app hard enough that a
  // single spec can miss a transient state — the ubuntu lane has failed four different
  // specs across runs (main-safety:358, network-script-inspectors:107, scenes-view:109,
  // scenes-view:49), each one green in the runs either side of it and green on Linux/Xvfb
  // locally. The retry keeps the lane usable on runners like these, and it is not silent:
  // Playwright reports the spec as flaky rather than passed, and keeps the trace from the
  // first attempt. It is not a licence to leave a race in the product — a systematic
  // failure fails every attempt, and an intermittent one still shows up in the flaky
  // tally. Locally there are still no retries: a flake is worth seeing.
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  // CI runners are small and shared, and several Electron instances at once starve each
  // other: a renderer that is only short of CPU looks, to Chromium's hang monitor, just
  // like one that is stuck, and it is killed mid-boot. One at a time; locally, as many
  // as the machine can take.
  workers: process.env.CI ? 1 : undefined,
  use: {
    trace: 'on-first-retry',
  },
})
