#!/usr/bin/env node
// Keeps a capture script off the developer's own display.
//
// The e2e suite pins Electron to Xvfb because the suite opens windows: on Linux, a run
// that is not under a virtual display puts them on the desk of whoever started it, taking
// focus for as long as it lasts. A capture script opens the same windows — two of them, for
// a pair of machines, and for minutes rather than seconds — so it is wrapped the same way,
// and by itself rather than by whoever remembers to type `xvfb-run`.
//
// Called at the top of a capture script:
//
//   await underVirtualDisplay()
//
// On Linux without a display of its own, it re-runs this script under `xvfb-run` and ends
// the original process with the child's exit code. Everywhere else — and inside the child —
// it does nothing, so the rest of the script reads as a script rather than as a wrapper.
//
// A developer who wants to watch the capture happen asks for it: WINSLAB_CAPTURE_HEADED=1
// runs it on the display they are using, the same deliberate opt-in as `test:e2e:headed`.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

/** The screen the captures are given. Matches the e2e runner's, for the same reason. */
const XVFB_SCREEN = '1600x1000x24'

/** Set in the child, so the re-run happens once and not for ever. */
const UNDER = 'WINSLAB_CAPTURE_VIRTUAL'

function findExecutable(name, pathEnv) {
  for (const dir of String(pathEnv || '').split(path.delimiter)) {
    if (!dir) continue
    const candidate = path.join(dir, name)
    try {
      if (fs.statSync(candidate).isFile()) return candidate
    } catch {
      // Not in this directory; keep looking.
    }
  }
  return null
}

export function underVirtualDisplay({ script = process.argv[1], argv = process.argv.slice(2) } = {}) {
  if (process.platform !== 'linux') return
  if (process.env[UNDER] === '1') return
  if (process.env.WINSLAB_CAPTURE_HEADED === '1') return

  const xvfbRun = findExecutable('xvfb-run', process.env.PATH)
  if (xvfbRun === null) {
    throw new Error(
      'xvfb-run is not installed, so this capture has no display to run on that is not yours.\n' +
        '  Install it (Debian/Ubuntu: sudo apt install xvfb), or run the capture on your own\n' +
        '  desktop on purpose with: WINSLAB_CAPTURE_HEADED=1 npm run <the capture script>'
    )
  }

  // WAYLAND_DISPLAY is dropped as well as DISPLAY being replaced: Electron 28+ prefers a
  // Wayland session's compositor over the X display it was handed, which is how a capture
  // ends up on the wrong screen with a correct-looking DISPLAY in its environment.
  const env = { ...process.env, [UNDER]: '1' }
  delete env.WAYLAND_DISPLAY

  const child = spawnSync(
    xvfbRun,
    ['-a', '-s', `-screen 0 ${XVFB_SCREEN}`, process.execPath, script, ...argv],
    { stdio: 'inherit', env }
  )
  if (child.error) throw child.error
  process.exit(child.status ?? 1)
}
