// The window opens where the operator left it.
//
// It used to open at one size in the middle of the primary display at every launch, so a
// window arranged for the booth — maximised, on the second monitor — was arranged again
// each time the app was started. Its place is the machine's and is kept in the profile:
// this is that file being written by a real window and believed by the next one, and a
// file that is not a window state being ignored rather than obeyed.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { closeApp, launchApp } from './helpers'

interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

test('a window that was moved and resized opens there again', async () => {
  let { app, page, userDataDir } = await launchApp()
  const stateFile = path.join(userDataDir, 'window-state.json')
  let placed: Bounds
  try {
    await expect(page.locator('.toolbar')).toBeVisible()
    // Not where or what the window opens at by itself. What is compared after the
    // relaunch is what the window says it became, which is the operating system's answer
    // to the request rather than the request.
    placed = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      win.setBounds({ x: 48, y: 56, width: 1040, height: 560 })
      return win.getNormalBounds()
    })
    expect(placed.width).not.toBe(1280)

    // The artifact, not a pause: the place is written once the window has stopped moving.
    await expect.poll(() => {
      try {
        return (JSON.parse(fs.readFileSync(stateFile, 'utf-8')) as Bounds).width
      } catch {
        return null
      }
    }).toBe(placed.width)
  } finally {
    await closeApp(app)
  }

  ;({ app, page } = await launchApp({ userDataDir }))
  try {
    await expect(page.locator('.toolbar')).toBeVisible()
    const reopened = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds())
    expect(reopened).toEqual(placed)
  } finally {
    await closeApp(app)
  }
})

test('a file in the profile that is not a window state is ignored, and the window opens', async () => {
  const first = await launchApp()
  const opensAt = await first.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
  await closeApp(first.app)

  // Whatever is in the file — half a write, another program's, somebody's edit.
  fs.writeFileSync(path.join(first.userDataDir, 'window-state.json'), '{"x":"left","width":99999999999,')
  const { app, page } = await launchApp({ userDataDir: first.userDataDir })
  try {
    await expect(page.locator('.toolbar')).toBeVisible()
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize())
    expect(size).toEqual(opensAt)
  } finally {
    await closeApp(app)
  }
})
