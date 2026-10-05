// The window's remembered place: the file is checked for size and shape before it is
// believed, and then against the displays the machine has now.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  MAX_WINDOW_STATE_BYTES,
  parseWindowState,
  placeWindow,
  readWindowState,
  saveWindowState,
  type Rect,
  type WindowState
} from './windowState'

const MINIMUM = { width: 1000, height: 500 }
const FALLBACK = { width: 1280, height: 800 }
const LAPTOP: Rect = { x: 0, y: 0, width: 1920, height: 1040 }
const BOOTH: Rect = { x: 1920, y: 0, width: 2560, height: 1400 }

const state = (overrides: Partial<WindowState> = {}): WindowState => ({
  x: 100, y: 80, width: 1400, height: 900, maximized: false, ...overrides
})

describe('reading the remembered window', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuerunner-window-state-'))
    file = path.join(dir, 'window-state.json')
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('gives back what was saved', () => {
    saveWindowState(file, state({ maximized: true }))
    expect(readWindowState(file)).toEqual(state({ maximized: true }))
  })

  it('has nothing to say on a first launch', () => {
    expect(readWindowState(file)).toBeNull()
  })

  it('refuses a file too large to be a window state, on its size', () => {
    // Valid JSON of the right shape, padded past the bound: it is the size that refuses it.
    const padded = JSON.stringify({ ...state(), padding: 'x'.repeat(MAX_WINDOW_STATE_BYTES) })
    fs.writeFileSync(file, padded)
    expect(parseWindowState(padded)).not.toBeNull()
    expect(readWindowState(file)).toBeNull()
  })

  it('reads nothing into text that is not a window state', () => {
    for (const text of ['', 'not json', '[]', 'null', '{"x":0,"y":0}',
      '{"x":0,"y":0,"width":"1280","height":800}',
      '{"x":0,"y":0,"width":0,"height":800}',
      '{"x":0,"y":0,"width":-5,"height":800}',
      '{"x":1e99,"y":0,"width":1280,"height":800}']) {
      expect(parseWindowState(text), text).toBeNull()
    }
  })

  it('takes whole pixels, and a maximised flag only when it is one', () => {
    expect(parseWindowState('{"x":10.4,"y":20.6,"width":1280.2,"height":800,"maximized":"yes"}'))
      .toEqual({ x: 10, y: 21, width: 1280, height: 800, maximized: false })
  })

  it('does not throw at a profile it cannot write to', () => {
    expect(() => saveWindowState(path.join(file, 'not-a-directory', 'state.json'), state())).not.toThrow()
  })
})

describe('placing the window', () => {
  it('opens where it always did when nothing is remembered', () => {
    expect(placeWindow(null, [LAPTOP], MINIMUM, FALLBACK)).toEqual({ ...FALLBACK, maximized: false })
  })

  it('puts the window back where it was, at the size it was', () => {
    expect(placeWindow(state(), [LAPTOP], MINIMUM, FALLBACK))
      .toEqual({ x: 100, y: 80, width: 1400, height: 900, maximized: false })
  })

  it('goes back to the second display, maximised, when that is where it was', () => {
    const remembered = state({ x: 2000, y: 40, maximized: true })
    expect(placeWindow(remembered, [LAPTOP, BOOTH], MINIMUM, FALLBACK))
      .toEqual({ x: 2000, y: 40, width: 1400, height: 900, maximized: true })
  })

  it('opens on the primary display when the one it was on has gone', () => {
    // The booth monitor is unplugged: the size is kept, the position is the OS's to choose,
    // and the window is not maximised onto a display nobody put it on.
    const remembered = state({ x: 2400, y: 40, maximized: true })
    expect(placeWindow(remembered, [LAPTOP], MINIMUM, FALLBACK))
      .toEqual({ width: 1400, height: 900, maximized: false })
  })

  it('does not count a sliver of the window as being on a display', () => {
    // Its left 20px are on the laptop and the rest is where the booth monitor used to be.
    const remembered = state({ x: 1900, y: 40 })
    expect(placeWindow(remembered, [LAPTOP], MINIMUM, FALLBACK)).not.toHaveProperty('x')
    // And a window dragged up until its title was off the top is not reachable either.
    expect(placeWindow(state({ y: -60 }), [LAPTOP], MINIMUM, FALLBACK)).not.toHaveProperty('y')
  })

  it('holds the size between the window’s minimum and the display it opens on', () => {
    const tiny = placeWindow(state({ width: 300, height: 200 }), [LAPTOP], MINIMUM, FALLBACK)
    expect(tiny).toMatchObject({ width: 1000, height: 500 })

    const huge = placeWindow(state({ x: 0, y: 0, width: 5000, height: 3000 }), [LAPTOP], MINIMUM, FALLBACK)
    expect(huge).toMatchObject({ width: 1920, height: 1040 })
  })

  it('still opens when the machine reports no display at all', () => {
    expect(placeWindow(state(), [], MINIMUM, FALLBACK)).toEqual({ width: 1400, height: 900, maximized: false })
  })
})
