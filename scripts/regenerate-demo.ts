// The demo show's writer.
//
//   npm run demo:write    put resources/demo/Demo Show.cuerunner through the serialiser
//   npm run demo:check    say whether it is that already, and exit 1 when it is not
//
// The demo is a real showfile rather than a hand-written example: it is the serialiser's
// own output for the content it holds, and `src/main/workspace/demo.test.ts` holds a save
// of the freshly opened demo to exactly those bytes. What this keeps true is the *form* —
// this build's settings defaults filled in for the sections the document leaves out, every
// audio cue's route pair re-derived against the folder the show ships in, and the keys in
// the saved form's declared order. The content is the file's own business: its cues, its
// scenes and its cast are edited in the document itself, and a demo whose content changed
// is usually already the serialiser's output, which is what `demo:check` will say. What it
// catches is a form the writer would not have produced — a section hand-taken out, a route
// pair hand-written, keys moved — which is the state a shape change leaves the file in, and
// the state `npm run demo:check` goes red on until `npm run demo:write` has been run.
//
// Node runs the TypeScript directly (type stripping), and the module this reaches —
// `src/main/workspace/serialise.ts` — imports nothing but `node:path` and the shared
// declarations, so the tool and the app share one implementation of the bytes rather than
// two. Nothing here ships: it is a repository tool, run by whoever changed the demo.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { heldShowSettings } from '../src/shared/show.ts'
import { serialiseWorkspace } from '../src/main/workspace/serialise.ts'
import type { Workspace } from '../src/shared/workspace.ts'

/**
 * The folder the demo ships in, resolved the way the recipes that need it already do
 * (`src/main/workspace/demo.test.ts`): npm runs the script from the package root and
 * vitest runs from the repository root, so the path is the one the repository is laid out
 * with — which is also the only one available under a runner that serves this module from
 * a URL that is not a path.
 */
const DEMO_DIR = join(process.cwd(), 'resources/demo')

/** The shipped show, as the File menu and the tests name it. */
export const DEMO_FILE = join(DEMO_DIR, 'Demo Show.cuerunner')

/**
 * The demo's bytes as this build writes them: the document read, its show settings
 * completed with this build's defaults, and the whole put through the serialiser against
 * the folder the show ships in — which is what keeps its audio routes relative
 * (`walk-in.wav`) and its bytes the same on every machine that regenerates it.
 */
export function demoBytes(shipped: string): string {
  const document = JSON.parse(shipped) as Workspace
  return serialiseWorkspace(
    { ...document, showSettings: heldShowSettings(document.showSettings) },
    DEMO_DIR
  )
}

/** The first line two documents differ at, 1-based, or null when the two are the same. */
function firstDifference(before: string, after: string): number | null {
  const was = before.split('\n')
  const is = after.split('\n')
  for (let line = 0; line < Math.max(was.length, is.length); line++) {
    if (was[line] !== is[line]) return line + 1
  }
  return null
}

/**
 * What a run found and what it did. `difference` is the line the file first differs at
 * when it is not the serialiser's own output, for a message somebody can act on.
 */
export interface DemoRun {
  path: string
  /** Whether the file on disk is already the bytes the serialiser writes. */
  current: boolean
  /** The first line the two differ at, or null when they do not. */
  difference: number | null
  /** Whether the bytes were written: every run but a check writes them. */
  written: boolean
}

/**
 * The recipe: read the demo, write it back if it is not already those bytes. A `--check`
 * run reports instead of writing, so a reviewer can ask the question without touching the
 * file. Anything else on the command line is refused rather than ignored — a typo that
 * made a write look like a check is a write nobody asked for.
 */
export async function runDemo(args: string[]): Promise<DemoRun> {
  const check = args.includes('--check')
  const unknown = args.filter(arg => arg !== '--check')
  if (unknown.length > 0) throw new Error(`unknown option "${unknown[0]}" — the only one is --check`)

  const shipped = await readFile(DEMO_FILE, 'utf-8')
  const bytes = demoBytes(shipped)
  const difference = firstDifference(shipped, bytes)
  if (difference === null) return { path: DEMO_FILE, current: true, difference: null, written: false }
  if (!check) await writeFile(DEMO_FILE, bytes, 'utf-8')
  return { path: DEMO_FILE, current: false, difference, written: !check }
}

// Only when run as a program: the tests import `demoBytes`, and the app imports nothing here.
if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const run = await runDemo(process.argv.slice(2))
    if (run.current) {
      console.log(`${run.path} is already the serialiser's output — nothing to write.`)
    } else if (run.written) {
      console.log(`wrote ${run.path} (the file differed from line ${run.difference})`)
    } else {
      console.error(
        `${run.path} is not what the serialiser writes — the file differs from line ${run.difference}.\n`
        + 'Run `npm run demo:write` to write it back through the serialiser.'
      )
      process.exitCode = 1
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
