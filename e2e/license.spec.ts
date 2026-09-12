// WinsLab Pro is a license, not a download: the panels are all there, and the license is
// what turns them on. These tests hold both halves of that — the window that draws the
// lock, and the main process that owns the sockets and refuses the work anyway — and both
// ways a key arrives: pasted into Settings, or already on the machine at launch.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, mintLicense, type TestLicense } from './helpers'

let app: ElectronApplication | undefined

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
})

async function start(
  options: { license?: TestLicense; trustPublicKey?: string; userDataDir?: string } = {}
): Promise<{ page: Page; userDataDir: string }> {
  const launched = await launchApp(options)
  app = launched.app
  return { page: launched.page, userDataDir: launched.userDataDir }
}

/** Runs an expression in the renderer and gives back what it answered. */
async function inRenderer(expression: string): Promise<unknown> {
  return app!.evaluate(({ BrowserWindow }, code) =>
    BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(code), expression)
}

async function openSettings(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.getByRole('button', { name: /Settings/ }).click()
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
}

async function openLicenseTab(page: Page): Promise<void> {
  await openSettings(page)
  await page.getByRole('dialog', { name: 'Settings' })
    .getByRole('button', { name: 'License', exact: true })
    .click()
}

test('a machine with no key runs the free half and locks the rest', async () => {
  const { page } = await start()

  // The strips. The log is not licensed; the three that read the show services are.
  await page.locator('.btn-monitor').click()
  await expect(page.locator('.pro-lock[data-feature="Show monitor"]')).toBeVisible()
  await expect(page.locator('.monitor-panel')).toHaveCount(0)
  await page.locator('.pro-lock-close').click()
  await expect(page.locator('.pro-lock')).toHaveCount(0)

  await page.locator('.btn-rf').click()
  await expect(page.locator('.pro-lock[data-feature="Wireless"]')).toBeVisible()
  await page.locator('.btn-script').click()
  await expect(page.locator('.pro-lock[data-feature="Script panel"]')).toBeVisible()
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toBeVisible()

  // The view the show is run from.
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.pro-lock[data-feature="Scenes"]')).toBeVisible()
  await expect(page.locator('.scenes-view')).toHaveCount(0)

  // The cue stack is not licensed, and neither is firing it: a wait cue still runs, and
  // the Triggers section of its Basics tab is what carries the lock.
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(1)
  await expect(page.locator('.pro-lock[data-feature="Triggers"]')).toBeVisible()

  // And the process that would open the socket refuses on its own account — the lock in
  // the window is an explanation, not the thing standing in the way.
  expect(await inRenderer("window.winslab.show.command('rf', 'repoll')"))
    .toEqual({ ok: false, error: 'WinsLab Pro is required for the show services' })
  expect(await inRenderer("window.winslab.script.readDocument('/etc/hosts', null)"))
    .toEqual({ ok: false, error: 'The script panel is part of WinsLab Pro.' })

  // The Show tab says why its services are not listening, and leads to the tab that fixes
  // it — an operator who has configured a port and sees it stopped deserves the reason.
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(dialog.locator('.license-hint')).toContainText('WinsLab Pro')
  await dialog.getByRole('button', { name: 'Enter a license key' }).click()
  await expect(dialog.locator('#license-key')).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()
})

test('a key pasted into Settings unlocks without a restart, and stays put', async () => {
  test.setTimeout(60_000)
  const license = mintLicense()

  const first = await start({ trustPublicKey: license.publicKeyPem })
  let page = first.page
  await page.locator('.btn-rf').click()
  await expect(page.locator('.pro-lock[data-feature="Wireless"]')).toBeVisible()

  // The lock is the way in: its button opens Settings on the license tab, because that
  // is where the thing it is asking for goes.
  await page.locator('.pro-lock-unlock').click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog).toBeVisible()
  await dialog.locator('#license-key').fill(license.text)
  await dialog.getByRole('button', { name: 'Activate' }).click()
  await expect(dialog.locator('.settings-info', { hasText: 'Licensed to End to End Test' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Close' }).click()

  // No reload: the panel that was locked is now the panel.
  await expect(page.locator('.rf-panel')).toBeVisible()
  await expect(page.locator('.pro-mark')).toHaveCount(0)

  // The Show tab stops explaining itself and starts reporting the services.
  await openSettings(page)
  await dialog.getByRole('button', { name: 'Show', exact: true }).click()
  await expect(page.locator('.license-hint')).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Close' }).click()

  // The next launch reads the key the app wrote for itself. The public half is handed
  // over again only because the test's issuer is not the product's.
  await closeApp(app!)
  app = undefined
  const relaunched = await start({
    userDataDir: first.userDataDir,
    trustPublicKey: license.publicKeyPem
  })
  page = relaunched.page
  await page.locator('.btn-rf').click()
  await expect(page.locator('.rf-panel')).toBeVisible()
})

test('a key issued to somebody else, or mistyped, changes nothing', async () => {
  const trusted = mintLicense()
  const stranger = mintLicense()
  const { page } = await start({ trustPublicKey: trusted.publicKeyPem })

  await openLicenseTab(page)
  await page.locator('#license-key').fill(stranger.text)
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.locator('.license-error')).toContainText('not issued by WinsLab')

  await page.locator('#license-key').fill('WSL1-ABCDEFGH-ABCDEFGH')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.locator('.license-error')).toContainText('not a WinsLab license key')

  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.pro-lock[data-feature="Scenes"]')).toBeVisible()
})

test('a key that has run out unlocks nothing, and says when it did', async () => {
  const issuer = mintLicense()
  const expired = mintLicense({ expires: '2026-02-01', issuer })
  const { page } = await start({ trustPublicKey: issuer.publicKeyPem })

  await openLicenseTab(page)
  await page.locator('#license-key').fill(expired.text)
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.locator('.license-error')).toContainText('expired on 2026-02-01')

  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.pro-lock[data-feature="Scenes"]')).toBeVisible()
})

test('deactivating gives the free half back', async () => {
  const { page } = await start({ license: mintLicense() })

  await openLicenseTab(page)
  await page.getByRole('button', { name: 'Deactivate' }).click()
  // The tab turns back into the field that asks for a key, on the same machine.
  await expect(page.locator('#license-key')).toBeVisible()

  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click()
  await page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).click()
  await expect(page.locator('.pro-lock[data-feature="Scenes"]')).toBeVisible()
  await page.locator('.btn-rf').click()
  await expect(page.locator('.pro-lock[data-feature="Wireless"]')).toBeVisible()
})
