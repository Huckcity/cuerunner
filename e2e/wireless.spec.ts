// The wireless panel: the mic plot joined to live telemetry, from the demo rack so the
// whole path — source, poll, alarm, panel — runs without a receiver on the bench.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, mintLicense } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  // The show services, the scenes view, the panels that read them: everything this spec
  // is about is the licensed half of the app.
  ;({ app, page } = await launchApp({ license: mintLicense() }))
})

test.afterEach(async () => {
  await closeApp(app)
})

function panel(page: Page) {
  return page.locator('.rf-panel')
}

async function openWireless(page: Page): Promise<void> {
  await page.locator('.btn-rf').click()
  await expect(panel(page)).toBeVisible()
}

/** The demo rack is the only source, so twelve packs appear within a poll. */
async function loadDemoRack(page: Page): Promise<void> {
  await openWireless(page)
  await page.locator('.rf-demo-btn').click()
  await expect(panel(page).locator('.rf-row')).toHaveCount(12)
}

test('the bottom strips are exclusive, and the wireless one opens on its empty state', async () => {
  await expect(panel(page)).toHaveCount(0)

  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toBeVisible()

  await openWireless(page)
  await expect(page.locator('.log-panel')).toHaveCount(0)
  await expect(page.locator('.btn-rf')).toHaveAttribute('data-active', 'true')
  await expect(panel(page).locator('.rf-empty')).toBeVisible()

  await page.locator('.btn-monitor').click()
  await expect(panel(page)).toHaveCount(0)
  await expect(page.locator('.monitor-panel')).toBeVisible()
})

test('the demo rack fills the plot and the pack in trouble is the one at the top', async () => {
  await loadDemoRack(page)

  const first = panel(page).locator('.rf-row').first()
  await expect(first).toHaveAttribute('data-state', 'critical')
  await expect(first.locator('.rf-name')).toHaveText('Pack 1')
  await expect(first.locator('.rf-performer')).toHaveText('Aldonza')

  // The pack the lead is wearing is the one the panel puts first, and the reading
  // behind that verdict comes from the source rather than the plot.
  await expect(first.locator('.rf-battery')).toContainText('%')
  await expect(first.locator('.rf-rf')).toContainText('dBm')

  // Every pack in the plot is on the panel, and none of them is guessed at.
  await expect(panel(page).locator('.rf-row[data-state="unpatched"]')).toHaveCount(0)
})

test('a pack in trouble raises an alarm against the performer wearing it', async () => {
  await loadDemoRack(page)

  // The service names the performer from the plot, so the alarm reads as a person
  // rather than a channel number.
  await expect(panel(page).locator('.rf-alert-message', { hasText: /Aldonza/ })).toBeVisible()
  await expect(panel(page).locator('.rf-alert-message', { hasText: /battery critical/ })).toBeVisible()

  // The same alarm is in the session log, where it survives the panel being closed.
  await panel(page).locator('.rf-btn', { hasText: '✕' }).click()
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText(/Aldonza.*battery critical/)
})

test('a channel that never reports goes offline and says so', async () => {
  // Pack 7 is in the plot but never appears in the demo rack's document, so it has to
  // age out: the plot is the expectation, and a silent pack is the dangerous case.
  test.setTimeout(45_000)
  await loadDemoRack(page)

  // The panel's last row is the one with nothing to say; it starts out merely unpatched
  // by telemetry and becomes a silent pack once the threshold has passed.
  const quiet = panel(page).locator('.rf-row', { hasText: 'Pack 7' })
  await expect(quiet).toHaveAttribute('data-state', 'offline', { timeout: 30_000 })
  await expect(quiet).toContainText('Antonia')
  await expect(panel(page).locator('.rf-alert-message', { hasText: /went quiet/ })).toBeVisible()
})

test('an alarm stays on screen with every panel closed, and leads back to its panel', async () => {
  await loadDemoRack(page)
  await panel(page).locator('.rf-btn', { hasText: '✕' }).click()
  await expect(panel(page)).toHaveCount(0)

  // Nothing is open along the bottom, and the worst alarm is still in front of the
  // operator — the pack the lead is wearing, not the merely low one.
  const chip = page.locator('.transport-bar .alert-chip')
  await expect(chip).toHaveAttribute('data-level', 'critical')
  await expect(chip).toContainText(/Aldonza.*battery critical/)
  await expect(chip.locator('.alert-chip-more')).toBeVisible()

  // The answer to an alarm is in the panel that raised it.
  await chip.click()
  await expect(panel(page)).toBeVisible()
  await expect(page.locator('.btn-rf')).toHaveAttribute('data-active', 'true')

  // Dismissed there, gone here.
  const alerts = panel(page).locator('.rf-alert-dismiss')
  const count = await alerts.count()
  for (let i = 0; i < count; i++) await alerts.first().click()
  await expect(chip).toHaveCount(0)
})

test('the demo rack is offered while the plot is empty, and not in the header of a real one', async () => {
  await openWireless(page)
  await expect(panel(page).locator('.rf-demo-btn')).toBeVisible()
  await expect(panel(page).locator('.rf-header button', { hasText: 'Demo' })).toHaveCount(0)

  await page.locator('.rf-demo-btn').click()
  await expect(panel(page).locator('.rf-row')).toHaveCount(12)
  await expect(panel(page).locator('.rf-demo-btn')).toHaveCount(0)
  await expect(panel(page).locator('.rf-header button', { hasText: 'Demo' })).toHaveCount(0)
})
