// Where the window was, so it can be put back there.
//
// The window used to open at 1280x800 in the middle of the primary display every time: an
// operator who runs the show maximised on the booth's second monitor arranged it again at
// every launch. What is remembered is the machine's, not the show's — it lives in the
// profile beside the recent list, and never travels in a workspace.
//
// The file is the app's own and still is not trusted: it is read with a bound, checked for
// shape, and then checked against the displays this machine has *now*. A laptop that was
// docked yesterday must not open its window on a monitor that is not there.
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** What a `BrowserWindow` is told about where to open; no position means "wherever the OS puts it". */
export interface WindowPlacement {
  width: number
  height: number
  x?: number
  y?: number
  maximized: boolean
}

/**
 * The file is five numbers and a flag. Anything larger is not a window state, and is not
 * read to find out what it is instead.
 */
export const MAX_WINDOW_STATE_BYTES = 4096

/**
 * How much of the window has to be on a display for it to count as being there: enough of
 * its top edge to see it and take hold of it.
 */
const REACHABLE = { width: 120, height: 40 }

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000

/** A window state from the file's text, or null when the text is not one. */
export function parseWindowState(text: string): WindowState | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { x, y, width, height, maximized } = parsed as Record<string, unknown>
  if (!isCount(x) || !isCount(y) || !isCount(width) || !isCount(height)) return null
  if (width <= 0 || height <= 0) return null
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: maximized === true
  }
}

/** The remembered state, or null when there is none worth having. Never throws. */
export function readWindowState(file: string): WindowState | null {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    // The bound comes before the read: a file that is not ours to read whole is refused
    // on its size, not after it has been allocated for.
    if (fstatSync(fd).size > MAX_WINDOW_STATE_BYTES) return null
    const buffer = Buffer.alloc(MAX_WINDOW_STATE_BYTES)
    const read = readSync(fd, buffer, 0, MAX_WINDOW_STATE_BYTES, 0)
    return parseWindowState(buffer.toString('utf-8', 0, read))
  } catch {
    // No file yet, or one that cannot be read: the window opens where it always did.
    return null
  } finally {
    if (fd !== null) closeSync(fd)
  }
}

/** Writes the state down. A failure is not worth a word: the window still opens, at its default. */
export function saveWindowState(file: string, state: WindowState): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state), 'utf-8')
  } catch {
    // A profile that cannot be written to loses the window's place and nothing else.
  }
}

function overlap(a: Rect, b: Rect): { width: number; height: number } {
  return {
    width: Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    height: Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  }
}

/**
 * Where the window opens, given what was remembered and the displays there are now.
 *
 * The size is kept, held between the window's own minimum and the display it is going to.
 * The position is kept only while the top of the window is still on a display: one saved
 * on a monitor that has since gone opens on the primary instead, at the size it had, and
 * is not maximised onto a display the operator did not choose.
 *
 * `workAreas` are the displays' usable rectangles, primary first; `fallback` is the size a
 * window with nothing remembered opens at.
 */
export function placeWindow(
  state: WindowState | null,
  workAreas: Rect[],
  minimum: { width: number; height: number },
  fallback: { width: number; height: number }
): WindowPlacement {
  if (state === null) return { ...fallback, maximized: false }
  // The strip along the window's top edge: what has to be visible to drag it anywhere else.
  const top: Rect = { x: state.x, y: state.y, width: state.width, height: REACHABLE.height }
  const home = workAreas.find(area => {
    const shared = overlap(top, area)
    return shared.width >= REACHABLE.width && shared.height >= REACHABLE.height
  })
  const area = home ?? workAreas[0]
  const fit = (wanted: number, least: number, most: number | undefined): number =>
    Math.max(least, most === undefined ? wanted : Math.min(wanted, Math.max(least, most)))
  const size = {
    width: fit(state.width, minimum.width, area?.width),
    height: fit(state.height, minimum.height, area?.height)
  }
  if (home === undefined) return { ...size, maximized: false }
  return { ...size, x: state.x, y: state.y, maximized: state.maximized }
}
