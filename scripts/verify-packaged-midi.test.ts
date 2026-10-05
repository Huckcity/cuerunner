// Tests for scripts/verify-packaged-midi.mjs — the check that stops a packaging job from
// publishing an app with no MIDI in it. It reads a directory, so these build the three
// platforms' layouts as fixtures and run the script itself against them.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
// @ts-ignore — mjs file, no type declarations
import { findPackagedMidi, missingMessage, PACKAGED_ADDON } from './verify-packaged-midi.mjs'

const SCRIPT = path.join(__dirname, 'verify-packaged-midi.mjs')

let dist: string

beforeEach(() => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-packaged-midi-'))
})
afterEach(() => fs.rmSync(dist, { recursive: true, force: true }))

/** A packaged app's resources directory, with its archive and — when asked — the unpacked addon. */
function packaged(resources: string[], options: { midi: boolean; empty?: boolean }): string {
  const dir = path.join(dist, ...resources)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'app.asar'), 'archive')
  const addon = path.join(dir, ...PACKAGED_ADDON)
  if (options.midi) {
    fs.mkdirSync(path.dirname(addon), { recursive: true })
    fs.writeFileSync(addon, options.empty === true ? '' : 'native addon')
  }
  return addon
}

const run = (): { status: number | null; stdout: string; stderr: string } => {
  const result = spawnSync(process.execPath, [SCRIPT, dist], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('the packaged MIDI addon', () => {
  it('is found in each platform’s layout', () => {
    const layouts = [
      ['win-unpacked', 'resources'],
      ['linux-unpacked', 'resources'],
      ['mac-universal', 'Cuerunner.app', 'Contents', 'Resources']
    ]
    for (const layout of layouts) {
      fs.rmSync(dist, { recursive: true, force: true })
      fs.mkdirSync(dist)
      const addon = packaged(layout, { midi: true })
      expect(findPackagedMidi(dist), layout.join('/')).toEqual([addon])
      expect(run().status, layout.join('/')).toBe(0)
    }
  })

  // What v0.16.0's Windows installer was: an app archive, the engine beside it, no addon.
  it('fails the job when the app was packaged without it, and says why nothing else did', () => {
    packaged(['win-unpacked', 'resources'], { midi: false })

    expect(findPackagedMidi(dist)).toEqual([])
    const result = run()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('::error::no packaged MIDI addon')
    expect(result.stderr).toContain('optional dependency')
    expect(result.stderr).toContain('Python')
  })

  it('does not take an empty file for an addon', () => {
    packaged(['win-unpacked', 'resources'], { midi: true, empty: true })
    expect(run().status).toBe(1)
  })

  it('fails on an output directory that is not there at all', () => {
    fs.rmSync(dist, { recursive: true, force: true })
    expect(run().status).toBe(1)
    expect(missingMessage(dist)).toContain(dist)
  })
})
