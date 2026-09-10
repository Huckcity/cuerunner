// Tests for scripts/check-electron.js — verifies electron binary detection
// and repair logic. Uses real tmpdir fixtures (no mocking needed for fs ops).

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// We import CJS module; vitest handles the interop.
// @ts-ignore — js file, no type declarations
const {
  getElectronBinaryState,
  ensureElectronBinary,
} = require('./check-electron.js')

function tmpdir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-electron-test-'))
}

function dirs(rootDir: string) {
  return {
    electronDir: path.join(rootDir, 'node_modules', 'electron'),
    distDir: path.join(rootDir, 'node_modules', 'electron', 'dist'),
    pathTxt: path.join(rootDir, 'node_modules', 'electron', 'path.txt'),
    binary: path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron'),
  }
}

function makeFixture(rootDir: string, setup: 'none' | 'dir-only' | 'path-txt-only' | 'full') {
  const d = dirs(rootDir)
  if (setup === 'none') return d
  fs.mkdirSync(d.distDir, { recursive: true })
  if (setup === 'dir-only') return d
  fs.writeFileSync(d.pathTxt, 'electron', 'utf8')
  if (setup === 'path-txt-only') return d
  fs.writeFileSync(d.binary, 'fake-binary-content', 'utf8')
  return d
}

describe('getElectronBinaryState', () => {
  let rootDir: string

  beforeEach(() => { rootDir = tmpdir() })
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }) })

  it('returns missing-module when node_modules/electron does not exist', () => {
    const { state, binaryPath } = getElectronBinaryState(rootDir)
    expect(state).toBe('missing-module')
    expect(binaryPath).toBeNull()
  })

  it('returns missing-path-file when electron dir exists but path.txt is missing', () => {
    makeFixture(rootDir, 'dir-only')
    const { state, binaryPath } = getElectronBinaryState(rootDir)
    expect(state).toBe('missing-path-file')
    expect(binaryPath).toBeNull()
  })

  it('returns missing-binary when path.txt exists but the binary file is absent', () => {
    makeFixture(rootDir, 'path-txt-only')
    const { state, binaryPath } = getElectronBinaryState(rootDir)
    expect(state).toBe('missing-binary')
    expect(binaryPath).toBe(dirs(rootDir).binary)
  })

  it('returns ok when path.txt and binary both exist', () => {
    makeFixture(rootDir, 'full')
    const { state, binaryPath } = getElectronBinaryState(rootDir)
    expect(state).toBe('ok')
    expect(binaryPath).toBe(dirs(rootDir).binary)
  })
})

describe('ensureElectronBinary', () => {
  let rootDir: string
  let logs: string[]

  beforeEach(() => {
    rootDir = tmpdir()
    logs = []
  })
  afterEach(() => { fs.rmSync(rootDir, { recursive: true, force: true }) })

  const logCapture = (msg: string) => { logs.push(msg) }

  it('returns ok when binary is present (skips repair)', () => {
    makeFixture(rootDir, 'full')
    const result = ensureElectronBinary({ rootDir, log: logCapture })
    expect(result).toBe('ok')
    // No diagnostic output when everything is fine
    expect(logs.filter((l) => l.includes('⚠'))).toHaveLength(0)
  })

  it('returns missing-module when electron package is not in deps', () => {
    const result = ensureElectronBinary({ rootDir, autoRepair: false, log: logCapture })
    expect(result).toBe('missing-module')
    // Should not print diagnostics for missing-module
    expect(logs.filter((l) => l.includes('⚠'))).toHaveLength(0)
  })

  it('returns missing-path-file when path.txt is missing and autoRepair fails', () => {
    makeFixture(rootDir, 'dir-only')
    const result = ensureElectronBinary({ rootDir, autoRepair: false, log: logCapture })
    expect(result).toBe('missing-path-file')
    expect(logs.some((l) => l.includes('Electron binary not found'))).toBe(true)
    expect(logs.some((l) => l.includes('path.txt is missing'))).toBe(true)
  })

  it('returns missing-binary when binary is absent and autoRepair fails', () => {
    makeFixture(rootDir, 'path-txt-only')
    const result = ensureElectronBinary({ rootDir, autoRepair: false, log: logCapture })
    expect(result).toBe('missing-binary')
    expect(logs.some((l) => l.includes('ZIP extraction'))).toBe(true)
  })

  it('includes manual recovery steps in output when repair is disabled', () => {
    makeFixture(rootDir, 'dir-only')
    ensureElectronBinary({ rootDir, autoRepair: false, log: logCapture })
    expect(logs.some((l) => l.includes('node scripts/postinstall.js'))).toBe(true)
    expect(logs.some((l) => l.includes('npx electron --version'))).toBe(true)
    expect(logs.some((l) => l.includes('npm install'))).toBe(true)
  })

  it('attempts auto-repair when binary is missing (by default)', () => {
    makeFixture(rootDir, 'dir-only')
    // autoRepair defaults to true; the install.js doesn't exist in our
    // fixture, so repairElectronBinary will return false.
    // Should log the attempt and fall through to manual steps.
    const result = ensureElectronBinary({ rootDir, log: logCapture })
    expect(result).toBe('missing-path-file')
    expect(logs.some((l) => l.includes('Attempting automatic repair'))).toBe(true)
    expect(logs.some((l) => l.includes('Automatic repair failed'))).toBe(true)
    expect(logs.some((l) => l.includes('Manual recovery steps'))).toBe(true)
  })
})