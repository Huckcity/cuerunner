// Tests for e2e/display.ts — the virtual display each Playwright worker's apps open on.
// What the server is for is measured by the suite itself (the file's header has the
// numbers); what is held here is the part a run depends on without noticing: that a
// worker gets a server, keeps the one it got, and does not leave it behind.

import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { closeWorkerDisplay, displayFrom, SCREEN_ENV, workerDisplay } from '../e2e/display'

// @ts-ignore — js file, no type declarations
const { findExecutable, XVFB_SCREEN } = require('./run-e2e.js')

/** Whether this machine can start a server at all: only the Linux lanes that run the suite can. */
const canStart = process.platform === 'linux' && findExecutable('Xvfb', process.env.PATH) !== null

/** Where an X server listens: there while it is up, gone when it is not. */
const socketOf = (display: string): string => path.join('/tmp/.X11-unix', `X${display.slice(1)}`)

async function until(condition: () => boolean, ms = 5000): Promise<boolean> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (condition()) return true
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  return condition()
}

afterEach(async () => {
  await closeWorkerDisplay()
})

describe('the display a worker reports', () => {
  it('is read once the server has finished saying its number', () => {
    expect(displayFrom('107\n')).toBe(':107')
    // Half a line is not an answer yet: the number may have more digits to come.
    expect(displayFrom('10')).toBeNull()
    expect(displayFrom('')).toBeNull()
  })
})

describe('a worker’s display', () => {
  it('is not started for a run that is not on virtual displays', async () => {
    expect(await workerDisplay({})).toBeNull()
    expect(await workerDisplay({ [SCREEN_ENV]: '' })).toBeNull()
  })

  it.skipIf(!canStart)('is a server of the worker’s own, the same one each time, gone when the worker is', async () => {
    const env = { ...process.env, [SCREEN_ENV]: XVFB_SCREEN as string }

    const display = await workerDisplay(env)
    expect(display).toMatch(/^:\d+$/)
    // Not the display this process is itself on, when it is on one.
    expect(display).not.toBe(process.env.DISPLAY)
    expect(fs.existsSync(socketOf(display!))).toBe(true)

    // Every app a worker launches goes to the one server.
    expect(await workerDisplay(env)).toBe(display)

    await closeWorkerDisplay()
    expect(await until(() => !fs.existsSync(socketOf(display!)))).toBe(true)
  })
})
