import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 20_000,
  retries: 0,
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
