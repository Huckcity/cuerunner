// Tests for scripts/run-e2e.js — the wrapper that keeps the Electron windows off the
// developer's desktop. The decision is pure given (platform, argv, PATH), so these run
// against fixture directories rather than the machine's real PATH.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// @ts-ignore — js file, no type declarations
const { findExecutable, resolveE2eRun, XVFB_SCREEN, SCREEN_ENV } = require('./run-e2e.js')
import { SCREEN_ENV as DISPLAY_SCREEN_ENV } from '../e2e/display'

let rootDir: string
let binDir: string

beforeEach(() => {
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-e2e-test-'))
  binDir = path.join(rootDir, 'bin')
  fs.mkdirSync(binDir)
})

afterEach(() => {
  fs.rmSync(rootDir, { recursive: true, force: true })
})

/** Put a fake executable on the fixture PATH. */
function installFake(name: string): string {
  const file = path.join(binDir, name)
  fs.writeFileSync(file, '#!/bin/sh\n', 'utf8')
  return file
}

describe('findExecutable', () => {
  it('finds a file on PATH and returns its full path', () => {
    const installed = installFake('xvfb-run')
    expect(findExecutable('xvfb-run', binDir)).toBe(installed)
  })

  it('returns null when nothing on PATH matches', () => {
    expect(findExecutable('xvfb-run', binDir)).toBeNull()
  })

  it('skips a directory that happens to share the name', () => {
    fs.mkdirSync(path.join(binDir, 'xvfb-run'))
    expect(findExecutable('xvfb-run', binDir)).toBeNull()
  })

  it('searches every PATH entry, ignoring the empty ones', () => {
    const installed = installFake('xvfb-run')
    const pathEnv = `:${path.delimiter}${path.join(rootDir, 'missing')}${path.delimiter}${binDir}`
    expect(findExecutable('xvfb-run', pathEnv)).toBe(installed)
  })
})

describe('resolveE2eRun', () => {
  it('runs the suite under xvfb on Linux when xvfb-run is available', () => {
    const xvfbRun = installFake('xvfb-run')
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: [], node: '/node', cli: '/pw/cli.js' })

    expect(run.mode).toBe('virtual')
    expect(run.command).toBe(xvfbRun)
    expect(run.args).toEqual(['-a', '-s', `-screen 0 ${XVFB_SCREEN}`, '/node', '/pw/cli.js', 'test'])
  })

  it('runs the installed Playwright CLI under this node, not through a shell', () => {
    // `npx` is a .cmd on Windows, which Node will not spawn without a shell — the whole
    // suite then fails with EINVAL instead of running.
    const run = resolveE2eRun({ platform: 'darwin', argv: [] })

    expect(run.command).toBe(process.execPath)
    expect(run.args[0]).toMatch(/playwright[\\/]cli\.js$/)
    expect(run.args.slice(1)).toEqual(['test'])
  })

  it('passes spec filters through to Playwright', () => {
    installFake('xvfb-run')
    const argv = ['e2e/demo-workspace.spec.ts', '-g', 'walk-in']
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv })

    expect(run.args.slice(-argv.length)).toEqual(argv)
  })

  it('uses the real display when the run asked to be watched', () => {
    installFake('xvfb-run')
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: ['--headed'], node: '/node', cli: '/pw/cli.js' })

    expect(run.mode).toBe('direct')
    expect(run.command).toBe('/node')
    expect(run.args).toEqual(['/pw/cli.js', 'test', '--headed'])
  })

  it('honours an explicit headed flag over argv', () => {
    installFake('xvfb-run')
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: [], headed: true })

    expect(run.mode).toBe('direct')
  })

  it('runs directly on platforms without xvfb', () => {
    for (const platform of ['darwin', 'win32'] as NodeJS.Platform[]) {
      const run = resolveE2eRun({ platform, pathEnv: binDir, argv: [] })
      expect(run.mode).toBe('direct')
    }
  })

  it('takes the Wayland socket out of an isolated run’s environment', () => {
    installFake('xvfb-run')
    const env = { PATH: binDir, WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland', HOME: '/home/tester' }
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: [], env })

    // Nothing spawned by the run can reach the compositor the operator is sitting at.
    // The surface itself is pinned by --ozone-platform=x11 in e2e/helpers.ts.
    expect(run.env).not.toHaveProperty('WAYLAND_DISPLAY')
    expect(run.env.XDG_SESSION_TYPE).toBe('wayland')
    expect(run.env.HOME).toBe('/home/tester')
    // The caller's environment is a value, not something to edit underneath them.
    expect(env.WAYLAND_DISPLAY).toBe('wayland-0')
  })

  // One X server has one pointer, and workers that shared the run's server lost pointer
  // drags to each other. A virtual run says so to the launch helper, which gives each
  // worker a server of its own at the same size (e2e/display.ts).
  it('tells a virtual run’s workers the screen to give their own displays', () => {
    installFake('xvfb-run')
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: [], env: { PATH: binDir } })

    expect(run.mode).toBe('virtual')
    expect(run.env[SCREEN_ENV]).toBe(XVFB_SCREEN)
    // The two files that name the variable name the same one.
    expect(SCREEN_ENV).toBe(DISPLAY_SCREEN_ENV)
  })

  it('asks for no displays for a run that is on a real one', () => {
    installFake('xvfb-run')
    const headed = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: ['--headed'], env: { PATH: binDir } })
    expect(headed.env).not.toHaveProperty(SCREEN_ENV)
    for (const platform of ['darwin', 'win32'] as NodeJS.Platform[]) {
      const run = resolveE2eRun({ platform, pathEnv: binDir, argv: [], env: { PATH: binDir } })
      expect(run.env).not.toHaveProperty(SCREEN_ENV)
    }
  })

  it('leaves the environment alone for a run on the developer’s own display', () => {
    const env = { PATH: binDir, WAYLAND_DISPLAY: 'wayland-0' }
    const run = resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: ['--headed'], env })

    expect(run.mode).toBe('direct')
    expect(run.env).toBe(env)
  })

  it('refuses to take over the desktop when Linux has no xvfb-run', () => {
    expect(() => resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: [] })).toThrow(/xvfb-run is not installed/)
    expect(() => resolveE2eRun({ platform: 'linux', pathEnv: binDir, argv: [] })).toThrow(/test:e2e:headed/)
  })

  it('does not consult PATH on other platforms', () => {
    const run = resolveE2eRun({ platform: 'darwin', pathEnv: '', argv: [] })
    expect(run.mode).toBe('direct')
  })
})
