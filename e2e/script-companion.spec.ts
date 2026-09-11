// The script panel and the tablet companion: the two halves of "the script reader on the
// music stand". The panel reads a real file from disk and pins cues to its lines; the
// companion serves the same show over HTTP to anything on the network that has the token.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page
const tempDirs: string[] = []

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

test.afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true })
})

function scriptFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-script-'))
  tempDirs.push(dir)
  const file = path.join(dir, 'act1.txt')
  fs.writeFileSync(file, 'ACT ONE\n\nALDonza enters downstage.\nSANCHO: I am Sancho.\n')
  return file
}

/**
 * The file dialog belongs to the OS, not the app: it cannot be driven from a test. The
 * dialog is answered in the main process and everything after it — reading the file,
 * rendering the lines, pinning a cue — runs for real.
 */
async function pickScript(file: string): Promise<void> {
  await app.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, file)
  await page.locator('.btn-script').click()
  await page.locator('.script-choose').click()
}

async function chooseScript(file: string): Promise<void> {
  await pickScript(file)
  await expect(page.locator('.script-line')).toHaveCount(4)
}

test('the script panel opens, reads the document and pins a cue to a line', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await chooseScript(scriptFile())

  await expect(page.locator('.script-line[data-line="3"] .script-line-text'))
    .toHaveText('ALDonza enters downstage.')
  await expect(page.locator('.script-path')).toContainText('act1.txt')

  // Clicking a line number pins the selected cue there, and clicks again to unpin.
  await page.locator('.script-line[data-line="3"] .script-line-no').click()
  await expect(page.locator('.script-line[data-line="3"] .script-pin')).toHaveAttribute('data-cues', '1')

  await page.locator('.script-line[data-line="3"] .script-line-no').click()
  await expect(page.locator('.script-line[data-line="3"] .script-pin')).toHaveCount(0)
})

test('the script follows the cue the operator would fire next', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await chooseScript(scriptFile())

  await page.locator('.script-line[data-line="2"] .script-line-no').click()
  await expect(page.locator('.script-line[data-line="2"]')).toHaveAttribute('data-current', 'true')

  // A second cue, pinned further down: selecting it moves the current line with it.
  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.script-line[data-line="4"] .script-line-no').click()
  await expect(page.locator('.script-line[data-line="4"]')).toHaveAttribute('data-current', 'true')
  await expect(page.locator('.script-line[data-line="2"]')).not.toHaveAttribute('data-current', 'true')
})

test('a document that is not a script is refused without taking the window down', async () => {
  // This is the crash: a PDF opened as a script became a million-line document, the
  // panel rendered every line, and the window's process reached 3 GB and stopped
  // answering. Both guards are exercised here, because both were reachable.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'winslab-not-a-script-'))
  tempDirs.push(dir)

  const binary = path.join(dir, 'libretto.pdf')
  fs.writeFileSync(binary, Buffer.concat([
    Buffer.from('%PDF-1.7\n'),
    Buffer.from([0x00, 0x01, 0x02, 0x03])
  ]))

  await toolbarCueBtn(page, 'Wait').click()
  await pickScript(binary)

  const refusal = page.locator('.script-error')
  await expect(refusal).toContainText('not a text file')
  await expect(page.locator('.script-line')).toHaveCount(0)

  // The window is still a window: another panel opens and the transport still answers.
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toBeVisible()
  await page.locator('.btn-log').click()
  await expect(page.locator('.btn-go')).toBeEnabled()

  // And the size guard, on a text file that is simply too big to be a script.
  const enormous = path.join(dir, 'endless.txt')
  fs.writeFileSync(enormous, 'line\n'.repeat(400_000))

  await pickScript(enormous)

  await expect(refusal).toContainText('the script panel opens documents up to')
})

test('the companion serves the show to a tablet, and only with the token', async () => {
  // Somewhere nothing else in the run is listening.
  const port = 53200 + Math.floor(Math.random() * 3000)
  const token = 'e2e-tablet-token'

  await toolbarCueBtn(page, 'Wait').click()
  await page.locator('.cue-row').first().click()

  await page.locator('.toolbar-brand').click()
  await page.getByRole('button', { name: /Settings/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await dialog.getByRole('button', { name: 'Show', exact: true }).click()
  await dialog.locator('#settings-companion-token').fill(token)
  await dialog.locator('#settings-companion').check()
  await dialog.locator('#settings-companion-port').fill(String(port))
  await dialog.locator('#settings-companion-port').blur()
  await expect(dialog.locator('.settings-service[data-service="companion"]'))
    .toHaveAttribute('data-state', 'running', { timeout: 15_000 })
  await dialog.getByRole('button', { name: 'Close' }).click()

  // The page a tablet opens, and the state it renders from.
  const home = await fetch(`http://127.0.0.1:${port}/?token=${token}`)
  expect(home.status).toBe(200)
  expect(await home.text()).toContain('WinsLab')

  const state = await fetch(`http://127.0.0.1:${port}/state?token=${token}`)
  expect(state.status).toBe(200)

  // The renderer publishes as the show changes, so the tablet's view arrives a moment
  // after the service starts serving it.
  await expect.poll(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/state?token=${token}`)
    const body = await response.json() as { cues: unknown[] }
    return body.cues.length
  }).toBeGreaterThan(0)

  const published = await fetch(`http://127.0.0.1:${port}/state?token=${token}`)
  const body = await published.json() as { nextCue: { number: string } | null }
  expect(body.nextCue?.number).toBe('1')

  // Without the token there is no show to read, and nothing to guess.
  const refused = await fetch(`http://127.0.0.1:${port}/state`)
  expect(refused.status).toBe(403)
  const wrong = await fetch(`http://127.0.0.1:${port}/state?token=not-the-token`)
  expect(wrong.status).toBe(403)
})
