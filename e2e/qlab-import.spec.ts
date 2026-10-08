// A QLab show, brought across from the File menu: from its workspace file, and from a QLab
// that is running.
//
// The file is built by the import's own test helper — a real NSKeyedArchiver archive in a
// real binary plist, holding one of nearly every QLab cue type — and written beside the
// audio it names, all but one file. The OS dialogs belong to the OS and are answered in
// the main process; the reading, the conversion, the report and the show the window then
// holds are all the app's own. The running QLab is a fake that speaks QLab's documented
// OSC over TCP on a port of its own.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'
import { pressNightWorkspace } from '../src/main/import/archiveFixture'
import { startFakeQLab, type FakeQLab } from '../src/main/import/fakeQLab'

let app: ElectronApplication | undefined
let qlab: FakeQLab | undefined
let root: string

function writeWav(filePath: string): void {
  const sampleRate = 48000
  const frames = sampleRate / 4
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + dataBytes, 4); buffer.write('WAVE', 8); buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24); buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(dataBytes, 40)
  fs.writeFileSync(filePath, buffer)
}

async function start(): Promise<Page> {
  const userDataDir = path.join(root, 'userdata')
  fs.mkdirSync(userDataDir, { recursive: true })
  const launched = await launchApp({ userDataDir })
  app = launched.app
  return launched.page
}

/** The next OS open dialog answers with this path. */
async function nextPick(target: string): Promise<void> {
  await app!.evaluate(async ({ dialog }, picked) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [picked] })
  }, target)
}

async function openImport(page: Page): Promise<void> {
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="import-qlab"]').click()
  await expect(page.getByRole('dialog', { name: 'Import QLab Workspace' })).toBeVisible()
}

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-feat-qlab-import-'))
})

test.afterEach(async () => {
  if (app) await closeApp(app)
  app = undefined
  await qlab?.close()
  qlab = undefined
  fs.rmSync(root, { recursive: true, force: true })
})

test('a QLab workspace file becomes a new show, with a report on every cue and the audio that was not there', async () => {
  test.setTimeout(90_000)
  const show = path.join(root, 'Press Night')
  fs.mkdirSync(path.join(show, 'audio'), { recursive: true })
  writeWav(path.join(show, 'audio', 'walk-in.wav'))
  writeWav(path.join(show, 'audio', 'bows.wav'))
  const workspaceFile = path.join(show, 'Press Night.qlab5')
  fs.writeFileSync(workspaceFile, pressNightWorkspace())

  const page = await start()
  await openImport(page)
  await nextPick(workspaceFile)
  await page.locator('[data-action="qlab-file"]').click()

  const report = page.getByRole('dialog', { name: 'QLab import report' })
  await expect(report).toBeVisible()
  expect(await page.locator('.app-notice').allTextContents(), 'the app reported an error').toEqual([])
  await expect(report.getByTestId('qlab-summary')).toContainText(
    'Press Night: 30 cues in 2 cue lists came across from Press Night.qlab5; 7 are placeholders.'
  )

  // Every QLab type, and what it became.
  const row = (type: string, became: string) => report.locator(`tr[data-qlab-type="${type}"][data-became="${became}"] .qlab-count`)
  await expect(row('Audio', 'audio')).toHaveText('6')
  await expect(row('Fade', 'fade')).toHaveText('1')
  await expect(row('Group', 'group')).toHaveText('5')
  await expect(row('MIDI', 'msc')).toHaveText('1')
  await expect(row('Network', 'osc')).toHaveText('2')
  await expect(row('Video', 'placeholder')).toHaveText('1')
  await expect(report.locator('[data-notes="placeholder"] li')).toHaveCount(7)
  await expect(report.locator('[data-notes="retimed"]')).toContainText('Fade walk-in')

  // Two files are not where QLab said: one never existed here, one is on a stick.
  await expect(report.getByTestId('qlab-media-missing')).toContainText('2 files are not where QLab said')
  const stick = path.join(root, 'stick')
  fs.mkdirSync(path.join(stick, 'audio'), { recursive: true })
  writeWav(path.join(stick, 'audio', 'door.wav'))
  writeWav(path.join(stick, 'audio', 'gone.wav'))
  await nextPick(stick)
  await report.locator('[data-action="qlab-find-media"]').click()
  await expect(report.getByTestId('qlab-media-ok')).toBeVisible()
  await expect(report).toContainText('Found 2 files in that folder.')
  await report.locator('[data-action="qlab-done"]').click()
  await expect(report).toHaveCount(0)

  // The show the window now holds, unsaved: nothing has been written beside the QLab
  // workspace. The list is virtualised, so what it holds is read from the file Save As
  // writes rather than from the rows on screen.
  await expect(page.locator('.cue-row').filter({ hasText: 'Walk-in' }).first()).toBeVisible()
  // Each QLab list is a tab: the main sequence in front, the cart beside it.
  await expect(page.locator('.cue-list-tab .cue-list-tab-name')).toHaveText(['Main Cue List', 'Sound FX'])
  await expect(page.locator('.cue-list-tab').nth(1)).toHaveAttribute('data-cart', 'true')
  await expect(page).toHaveTitle(/Press Night ● — Cuerunner/)
  expect(fs.readdirSync(show).sort()).toEqual(['Press Night.qlab5', 'audio'])

  const saved = path.join(root, 'Press Night.cuerunner')
  await app!.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, saved)
  await page.locator('.toolbar-brand').click()
  await page.locator('.file-menu button[data-action="save-as"]').click()
  await expect.poll(() => fs.existsSync(saved), { message: 'the saved show' }).toBe(true)
  await expect(page).toHaveTitle(/^Press Night — Cuerunner/)

  const stored = JSON.parse(fs.readFileSync(saved, 'utf-8')) as {
    cueLists?: Array<{ id: string; name: string; cart?: boolean }>
    cues: Array<{
      id: string; number: string; type: string; isArmed: boolean; parentId: string | null; filePath?: string
      mode?: string; listId?: string
    }>
  }
  // QLab's numbers in QLab's order, children after their groups, the second list last.
  expect(stored.cues.map(cue => cue.number)).toEqual([
    '1', '2', '3', '4', '4.1', '4.2', '5', '5.1', '5.2', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
    '16', '17', '18', '19', '19.1', '19.2', '20', '20.1', '21', '21.1', 'FX1'
  ])
  // The cart is a cart list of its own, its cue in it and armed: not a disarmed group in the main list.
  expect(stored.cueLists?.map(list => [list.name, list.cart === true])).toEqual([['Main Cue List', false], ['Sound FX', true]])
  expect(stored.cues.find(entry => entry.number === 'FX1')).toMatchObject({ listId: stored.cueLists?.[1].id, isArmed: true })
  const cue = (number: string) => stored.cues.find(entry => entry.number === number)!
  expect([cue('1').type, cue('2').type, cue('3').type, cue('9').type, cue('11').type, cue('16').type])
    .toEqual(['audio', 'fade', 'stop', 'msc', 'osc', 'devamp'])
  expect([cue('4').mode, cue('5').mode, cue('19').mode, cue('20').mode, cue('21').mode])
    .toEqual(['timeline', 'random', 'timeline', 'sequence', 'playlist'])
  expect(['10', '12', '13', '14', '15', '17', '18'].map(number => [cue(number).type, cue(number).isArmed]))
    .toEqual(Array(7).fill(['wait', false]))
  expect(cue('4.1').parentId).toBe(cue('4').id)
  // The file found on the stick is the file the saved show plays.
  expect(cue('FX1').filePath).toBe(path.join('stick', 'audio', 'door.wav'))
})

test('a running QLab is read over OSC: its workspaces listed, one picked, its cues brought across', async () => {
  test.setTimeout(90_000)
  qlab = await startFakeQLab({
    workspaces: [{
      id: 'WS-TOUR', name: 'Tour.qlab5', version: '5.4.1', lists: [{
        uniqueID: 'L1', name: 'Main Cue List', cues: [
          { uniqueID: 'A1', number: '1', name: 'Overture', type: 'Audio', values: { fileTarget: '/Users/fm/Tour/audio/overture.wav', continueMode: 2 } },
          { uniqueID: 'F2', number: '2', name: 'Fade overture', type: 'Fade', values: { cueTargetID: 'A1', duration: 3, sliderLevels: [-120], stopTargetWhenDone: true } },
          { uniqueID: 'C3', number: '3', name: 'Live feed', type: 'Camera' }
        ]
      }]
    }]
  })

  const page = await start()
  await openImport(page)
  await page.locator('#qlab-port').fill(String(qlab.port))
  await page.locator('[data-action="qlab-find"]').click()
  await expect(page.locator('#qlab-workspace')).toHaveValue('WS-TOUR')
  await page.locator('[data-action="qlab-live"]').click()

  const report = page.getByRole('dialog', { name: 'QLab import report' })
  await expect(report.getByTestId('qlab-summary')).toContainText(`3 cues in 1 cue list came across from QLab at 127.0.0.1:${qlab.port}; 1 is a placeholder.`)
  // The audio is on the Mac QLab runs on, so the report says where to look for it.
  await expect(report.getByTestId('qlab-media-missing')).toContainText('1 file is not where QLab said')
  await expect(report.locator('.qlab-missing')).toContainText('/Users/fm/Tour/audio/overture.wav')
  await report.locator('[data-action="qlab-done"]').click()

  await expect(page.locator('.cue-row .cue-number')).toHaveText(['1', '2', '3'])
  expect(qlab.requests.slice(0, 3)).toEqual(['/workspaces', '/workspaces', '/workspace/WS-TOUR/connect'])
})
