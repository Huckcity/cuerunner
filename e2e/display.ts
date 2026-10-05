// A display of its own for each Playwright worker.
//
// On Linux the suite runs under Xvfb (scripts/run-e2e.js), and for a long time every
// worker's windows opened on the one server that gave it. They are not independent there.
// A test that drags with the pointer — the dock's edge, a timeline block, a cue row — lost
// its drag part-way when another worker's app was dragging at the same moment: the dock
// stayed the height it was, a snap guide stayed up after the button was released, a row
// landed where it started. Run alone, each of those specs passed every time; run together
// on eight workers, three to six tests in three hundred failed, in a different place each
// run. With a server per worker the same three hundred pass. What the windows contend for
// on a shared server was not pinned down further than that — the pointer is the obvious
// suspect, since one X server has one — and it does not need to be for the cure to hold.
//
// CI runs one worker, so it never saw this; a developer's own run, which is the one this
// repository asks for before a push, saw it about one time in three.
//
// The server is started on first use and belongs to the worker: it is taken down when the
// worker goes, however it goes.
import { spawn, type ChildProcess } from 'child_process'

/** Set by scripts/run-e2e.js for a run on virtual displays: the screen each one is given. */
export const SCREEN_ENV = 'CUERUNNER_E2E_SCREEN'

/** How long a server may take to say which display it took. It answers in tens of milliseconds. */
const START_TIMEOUT_MS = 15_000

/**
 * Starts the server and stays with it. `-displayfd` has Xvfb pick a free display and
 * write its number where it is told to — no guessing at one, and no race with the worker
 * beside this one. The shell is there for the ending: it reads its stdin, which is a pipe
 * this process holds, so when the worker exits — or is killed, which no handler here would
 * hear — the read ends and the server is told to go. An orphaned server per killed worker
 * is what that prevents.
 */
const KEEPER = 'Xvfb -displayfd 3 -screen 0 "$1" -nolisten tcp & server=$!; cat >/dev/null; kill "$server" 2>/dev/null'

interface WorkerDisplay {
  name: string
  keeper: ChildProcess
}

let started: Promise<WorkerDisplay> | null = null

/** The `:N` a server reported on its display descriptor, or null while it has not finished saying. */
export function displayFrom(reported: string): string | null {
  const line = /^(\d+)\n/.exec(reported)
  return line === null ? null : `:${line[1]}`
}

function start(screen: string): Promise<WorkerDisplay> {
  return new Promise((resolve, reject) => {
    const keeper = spawn('sh', ['-c', KEEPER, 'sh', screen], { stdio: ['pipe', 'ignore', 'ignore', 'pipe'] })
    const fail = (reason: string): void => {
      clearTimeout(deadline)
      keeper.stdin?.end()
      reject(new Error(
        `e2e: could not start a virtual display for this worker (${reason}).\n` +
          '  Xvfb is what xvfb-run runs; it has to be on PATH beside it.'
      ))
    }
    const deadline = setTimeout(() => fail(`no display after ${START_TIMEOUT_MS} ms`), START_TIMEOUT_MS)
    let reported = ''
    keeper.stdio[3]?.on('data', (chunk: Buffer) => {
      reported += chunk.toString('utf8')
      const name = displayFrom(reported)
      if (name === null) return
      clearTimeout(deadline)
      resolve({ name, keeper })
    })
    keeper.once('error', error => fail(error.message))
    keeper.once('exit', code => fail(`the server exited with ${code ?? 'a signal'}`))
  })
}

/**
 * The display this worker's apps open on, or null when the run is not on virtual displays
 * — a headed run, or a platform with no Xvfb to borrow — and the app should open wherever
 * the run itself is.
 */
export async function workerDisplay(env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const screen = env[SCREEN_ENV]
  if (process.platform !== 'linux' || screen === undefined || screen === '') return null
  started ??= start(screen)
  return (await started).name
}

/** Takes this worker's server down. A worker's exit does the same; a test of this module asks. */
export async function closeWorkerDisplay(): Promise<void> {
  const pending = started
  started = null
  if (pending === null) return
  const display = await pending.catch(() => null)
  if (display === null) return
  await new Promise<void>(resolve => {
    display.keeper.once('exit', () => resolve())
    display.keeper.stdin?.end()
  })
}
