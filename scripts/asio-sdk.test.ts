// Tests for scripts/asio-sdk.mjs. The resolution is what decides whether a Windows build
// compiles ASIO at all, and its state string is what ensure-native.mjs compares against a
// stamp: an "enabled" the SDK cannot back would fail the build on a missing header, and a
// fingerprint that moved on its own would rebuild the engine on every developer command.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'

// @ts-ignore — js file, no type declarations
import { describeAsioState, resolveAsioSdk } from './asio-sdk.mjs'

describe('resolveAsioSdk', () => {
  let rootDir: string
  let sdkDir: string

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asio-sdk-test-'))
    sdkDir = path.join(rootDir, 'ASIOSDK')
    fs.mkdirSync(path.join(sdkDir, 'common'), { recursive: true })
    fs.writeFileSync(path.join(sdkDir, 'common', 'asio.h'), '', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('is "not configured" when the variable is unset or empty — not an error', () => {
    expect(resolveAsioSdk({})).toEqual({ enabled: false, dir: null, reason: 'not configured' })
    expect(resolveAsioSdk({ CUERUNNER_ASIO_SDK: '   ' })).toEqual({
      enabled: false,
      dir: null,
      reason: 'not configured'
    })
  })

  it('resolves a directory that holds common/asio.h', () => {
    const sdk = resolveAsioSdk({ CUERUNNER_ASIO_SDK: sdkDir })
    expect(sdk.enabled).toBe(true)
    expect(sdk.dir).toBe(sdkDir)
  })

  it('disables itself with a reason naming the path when the variable is not an SDK root', () => {
    const sdk = resolveAsioSdk({ CUERUNNER_ASIO_SDK: rootDir })
    expect(sdk.enabled).toBe(false)
    // The build script fails on this reason, so it has to say which path and what was
    // missing — and it must not read as the ordinary "nobody asked for ASIO".
    expect(sdk.reason).toContain(rootDir)
    expect(sdk.reason).toContain('asio.h')
    expect(sdk.reason).not.toBe('not configured')
  })
})

describe('describeAsioState', () => {
  let rootDir: string
  let sdkDir: string

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asio-state-test-'))
    sdkDir = path.join(rootDir, 'ASIOSDK')
    fs.mkdirSync(path.join(sdkDir, 'common'), { recursive: true })
    fs.writeFileSync(path.join(sdkDir, 'common', 'asio.h'), '', 'utf8')
  })

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true })
  })

  it('is off on a platform that does not build ASIO, whatever the variable holds', () => {
    const sdk = resolveAsioSdk({ CUERUNNER_ASIO_SDK: sdkDir })
    expect(describeAsioState(sdk, 'linux')).toBe('off (Windows only)')
    expect(describeAsioState(sdk, 'darwin')).toBe('off (Windows only)')
  })

  it('separates a configured SDK from a misconfigured one on Windows', () => {
    expect(describeAsioState(resolveAsioSdk({}), 'win32')).toBe('off (not configured)')
    expect(describeAsioState(resolveAsioSdk({ CUERUNNER_ASIO_SDK: rootDir }), 'win32')).not.toBe(
      'off (not configured)'
    )
  })

  it('records the SDK directory with a fingerprint that holds still and notices the SDK change', () => {
    const sdk = resolveAsioSdk({ CUERUNNER_ASIO_SDK: sdkDir })
    const state = describeAsioState(sdk, 'win32')
    expect(state.startsWith(`${sdkDir} `)).toBe(true)
    // Unchanged tree, unchanged state: this is what keeps every developer command from
    // rebuilding the engine.
    expect(describeAsioState(sdk, 'win32')).toBe(state)
    // A different SDK in the same directory is a different state: this is what makes the
    // next build compile it.
    fs.writeFileSync(path.join(sdkDir, 'common', 'asio.cpp'), '', 'utf8')
    expect(describeAsioState(sdk, 'win32')).not.toBe(state)
  })
})
