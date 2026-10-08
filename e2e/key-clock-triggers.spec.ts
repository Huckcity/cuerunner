// A key and a time of day as cue triggers. The key: added on the Triggers tab, refused where the
// app already answers it, and firing its cue from the list. The time of day: the window's clock
// is handed in (`window.__cuerunnerClock`), so the spec decides what time it is — on time, and
// a time that went by while the machine was asleep, skipped or fired late by the trigger's policy.
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, launchApp, toolbarCueBtn } from './helpers'

let app: ElectronApplication
let page: Page

test.beforeEach(async () => {
  ;({ app, page } = await launchApp())
})

test.afterEach(async () => {
  await closeApp(app)
})

function row(number: string) {
  return page.locator('.cue-row').filter({ has: page.locator('.cue-number', { hasText: new RegExp(`^${number}$`) }) })
}

async function triggersOf(number: string): Promise<void> {
  await row(number).click()
  await page.locator('.inspector-tab', { hasText: 'Triggers' }).click()
}

test('a key fires its cue, and a key the app answers is refused with what it does', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  await triggersOf('2')

  // Space is GO: a trigger on it would fire twice.
  await page.locator('#trigger-hotkey').fill('Space')
  await expect(page.locator('.trigger-hotkey-hint')).toHaveText('Taken: Space is the app’s key for GO.')
  await expect(page.locator('.trigger-hotkey-add')).toBeDisabled()

  // Recorded off the keyboard, the way an operator sets one.
  await page.locator('.trigger-hotkey-record').click()
  await page.keyboard.press('Shift+F7')
  await expect(page.locator('#trigger-hotkey')).toHaveValue('Shift+F7')
  await page.locator('.trigger-hotkey-add').click()
  await expect(page.locator('.trigger-row[data-kind="hotkey"]')).toContainText('Key Shift+F7')

  // From the list, not from a field: the key fires cue 2 and GO's place is left alone.
  await row('1').click()
  await page.keyboard.press('Shift+F7')
  await expect(row('2')).toHaveAttribute('data-running', 'true')
  await expect(row('1')).toHaveAttribute('data-running', 'false')
  await expect(row('1')).toHaveAttribute('data-selected', 'true')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Triggered by the key Shift+F7')
})

test('a key is not taken from a field being typed in', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await triggersOf('1')
  await page.locator('#trigger-hotkey').fill('F8')
  await page.locator('.trigger-hotkey-add').click()
  await page.locator('#trigger-osc-address').focus()
  await page.keyboard.press('F8')
  await page.waitForTimeout(300)
  await expect(row('1')).toHaveAttribute('data-running', 'false')
})

/** Hands the window a clock that starts at `startMs` today, and returns how to move it. */
async function clockAt(hours: number, minutes: number, seconds: number): Promise<(ms: number) => Promise<void>> {
  await page.evaluate(([h, m, s]) => {
    const start = new Date()
    start.setHours(h, m, s, 0)
    const state = { at: start.getTime(), from: Date.now() }
    const w = window as unknown as { __cuerunnerClock: () => number; __cuerunnerClockState: typeof state }
    w.__cuerunnerClockState = state
    w.__cuerunnerClock = () => state.at + (Date.now() - state.from)
  }, [hours, minutes, seconds])
  return async (ms: number) => {
    await page.evaluate(jump => {
      const w = window as unknown as { __cuerunnerClockState: { at: number } }
      w.__cuerunnerClockState.at += jump
    }, ms)
  }
}

async function addClock(time: string, missed: 'skip' | 'fire' = 'skip', grace = 5): Promise<void> {
  await page.locator('#trigger-clock-time').fill(time)
  await page.locator('#trigger-clock-missed').selectOption(missed)
  if (missed === 'fire') await page.locator('#trigger-clock-grace').fill(String(grace))
  await page.locator('.trigger-clock-add').click()
}

test('a time of day fires its cue when the clock runs through it', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  // Two seconds before the time, whatever time the machine running the spec thinks it is.
  await clockAt(3, 29, 58)
  await triggersOf('2')
  await addClock('03:30')
  await expect(page.locator('.trigger-row[data-kind="clock"]')).toContainText('Clock 03:30 every day')

  await expect(row('2')).toHaveAttribute('data-running', 'true', { timeout: 6000 })
  await expect(row('1')).toHaveAttribute('data-running', 'false')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('Triggered by the clock at 03:30:00')
})

test('a time the machine slept through is skipped and said, or fired late within its grace', async () => {
  await toolbarCueBtn(page, 'Wait').click()
  await toolbarCueBtn(page, 'Wait').click()
  const jump = await clockAt(4, 0, 0)
  await triggersOf('1')
  await addClock('04:10', 'skip')
  await triggersOf('2')
  await addClock('04:10', 'fire', 15)
  await page.waitForTimeout(1200)

  // Asleep for a quarter of an hour: one check, fifteen minutes on.
  await jump(15 * 60_000)
  await expect(row('2')).toHaveAttribute('data-running', 'true', { timeout: 6000 })
  await expect(row('1')).toHaveAttribute('data-running', 'false')
  await page.locator('.btn-log').click()
  await expect(page.locator('.log-panel')).toContainText('missed its 04:10:00 time while the show was closed or the machine asleep — not fired')
  await expect(page.locator('.log-panel')).toContainText('Triggered late by the clock: 04:10:00')
})
