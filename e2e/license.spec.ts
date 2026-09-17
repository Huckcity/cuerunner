// Cuerunner Pro is a license, not a download: the panels are all there, and the license is
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
  await page.locator('.file-menu [data-action="settings"]').click()
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

  // The strips. The log and the monitor are not licensed; the two that read the Pro
  // services are.
  await page.locator('.btn-monitor').click()
  await expect(page.locator('.monitor-panel')).toHaveCount(1)
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

  // The cue stack is not licensed, and neither is being driven by one: a wait cue runs,
  // and its Triggers tab is free — a desk's key or a footswitch must not need a key.
  await page.locator('.toolbar-view-btn', { hasText: 'Cues' }).click()
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await expect(page.locator('.cue-row')).toHaveCount(1)
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await expect(page.locator('#trigger-osc-address')).toBeVisible()
  await expect(page.locator('.inspector .pro-lock')).toHaveCount(0)

  // And the process refuses the Pro services by name on its own account — the lock in
  // the window is an explanation, not the thing standing in the way.
  expect(await inRenderer("window.cuerunner.show.command('rf', 'repoll')"))
    .toEqual({ ok: false, error: 'Wireless is part of Cuerunner Pro' })
  expect(await inRenderer("window.cuerunner.script.readDocument('/etc/hosts', null)"))
    .toEqual({ ok: false, error: 'The script panel is part of Cuerunner Pro.' })

  // The Network tab says why its services are not listening, and leads to the tab that fixes
  // it — an operator who has configured a port and sees it stopped deserves the reason.
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(dialog.locator('.license-hint')).toContainText('Cuerunner Pro')
  await dialog.getByRole('button', { name: 'Enter a license key' }).click()
  await expect(dialog.locator('#license-key')).toBeVisible()

  // The second machine: the tab explains what a pair is, and the process that would open
  // the socket refuses to pair this machine on its own account. The dialog is already
  // open on the license tab — a lock's own button is the way in.
  await dialog.getByRole('button', { name: 'Backup machine', exact: true }).click()
  await expect(dialog.locator('.pro-lock[data-feature="Redundant playback"]')).toBeVisible()
  expect(await inRenderer("window.cuerunner.redundancy.configure({ enabled: true })"))
    .toMatchObject({ ok: false, error: 'Cuerunner Pro is required for the show services' })
  expect(await inRenderer('window.cuerunner.redundancy.settings()'))
    .toMatchObject({ enabled: false })

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

  // The Network tab stops explaining itself and starts reporting the services.
  await openSettings(page)
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
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
  await expect(page.locator('.license-error')).toContainText('not issued by Cuerunner')

  await page.locator('#license-key').fill('CRN1-ABCDEFGH-ABCDEFGH')
  await page.getByRole('button', { name: 'Activate' }).click()
  await expect(page.locator('.license-error')).toContainText('not a Cuerunner license key')

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

test('a key entered mid-session starts the show settings, not the defaults', async () => {
  test.setTimeout(60_000)
  const license = mintLicense()
  const { page } = await start({ trustPublicKey: license.publicKeyPem })

  // A show that does not listen for OSC at all, which is not the default.
  await openSettings(page)
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await dialog.locator('#settings-osc-in').uncheck()

  // Enter the key on the tab next door.
  await dialog.getByRole('button', { name: 'License', exact: true }).click()
  await dialog.locator('#license-key').fill(license.text)
  await dialog.getByRole('button', { name: 'Activate' }).click()
  await expect(dialog.locator('.settings-info', { hasText: 'Licensed to End to End Test' })).toBeVisible()

  // The service the show turned off is off: what came up was the workspace's settings,
  // not the defaults main holds for a launch, which would have opened port 53000 first.
  await dialog.getByRole('button', { name: 'Network', exact: true }).click()
  await expect(dialog.locator('.settings-service[data-service="osc-in"]'))
    .toHaveAttribute('data-state', 'stopped')
  await dialog.getByRole('button', { name: 'Close' }).click()

  await page.locator('.btn-monitor').click()
  await expect(page.locator('.monitor-panel')).toBeVisible()
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel .log-event[data-kind="service"]', { hasText: 'OSC input running' }))
    .toHaveCount(0)
  await expect(page.locator('.log-panel .log-message', { hasText: 'OSC input:' })).toHaveCount(0)
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

test('an unlicensed window marks each Pro feature once, quietly, where it opens', async () => {
  const { page } = await start()

  // One mark per press that opens a Pro feature, and none on the transport.
  await expect(page.locator('.transport-bar .pro-mark')).toHaveCount(0)
  await expect(page.locator('.toolbar-view-btn', { hasText: 'Scenes' }).locator('.pro-mark')).toHaveCount(1)
  await expect(page.locator('.dock-tab .pro-mark')).toHaveCount(2)

  // Quiet: the amber belongs to the lock the press leads to, not to the chrome.
  const amber = 'rgb(224, 160, 32)'
  const colors = await page.locator('.pro-mark').evaluateAll(marks =>
    marks.map(mark => getComputedStyle(mark).color))
  expect(colors.every(color => color !== amber)).toBe(true)

  // A cue carries no lock anywhere: firing it by hand, from the desk's key or from a
  // footswitch is the free half of the app. What carries a mark is the Scenes view,
  // Wireless and the script panel.
  await page.locator('.toolbar-cue-btn', { hasText: 'Wait' }).click()
  await expect(page.locator('.inspector .pro-lock')).toHaveCount(0)
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
  await expect(page.locator('.inspector .pro-lock')).toHaveCount(0)
  await expect(page.locator('#trigger-osc-address')).toBeVisible()
})
