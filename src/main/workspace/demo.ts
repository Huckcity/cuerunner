// The demo show that ships with the app: a complete little workspace a new user can
// open from the File menu or the empty cue list.
//
// The bundled .cuerunner stores its audio paths relative ("walk-in.wav") so the same file
// works from the source tree, an AppImage, and a Program Files install. Audio cues only
// ever read absolute paths, so those are resolved at load time — not against the app
// bundle, which may be read-only, and instead against a copy in the user-data folder,
// which survives an app update or a move. The workspace opens with no path of its own,
// so saving it asks where to put a copy rather than writing over the bundle.
import { app } from 'electron'
import { copyFile, mkdir, readFile } from 'fs/promises'
import { basename, isAbsolute, join } from 'path'
import { Refusal } from '../ipc/refusal'
import { hasCueList, type Workspace } from '../../shared/workspace'
import { migrateWorkspace } from './WorkspaceManager'

export const DEMO_WORKSPACE_FILE = 'Demo Show.cuerunner'

// Packaged builds carry the demo in extraResources; dev, E2E, and the screenshot script
// run the app from the repository (out/main/index.js → repository root).
export function demoSourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'demo')
    : join(__dirname, '../../resources/demo')
}

// Copies the demo's audio out of the app and rewrites the cue paths to the copies.
// Assets are re-copied on every open so an updated build never hands out a stale file;
// nothing the user authored lives in there.
export async function materialiseDemoAssets(
  workspace: Workspace,
  sourceDir: string,
  destDir: string
): Promise<Workspace> {
  const copied = new Map<string, string>()

  for (const cue of workspace.cues) {
    if (cue.type !== 'audio' || cue.filePath === '' || isAbsolute(cue.filePath)) continue
    let destination = copied.get(cue.filePath)
    if (!destination) {
      destination = join(destDir, basename(cue.filePath))
      await mkdir(destDir, { recursive: true })
      await copyFile(join(sourceDir, cue.filePath), destination)
      copied.set(cue.filePath, destination)
    }
    cue.filePath = destination
  }

  return workspace
}

/**
 * The demo as the window opens it: the shipped file, put through the same funnel every
 * other file goes through — this one is no more trusted than an operator's, because a
 * shape this build cannot read is one it cannot read wherever it sits.
 *
 * `file` is the show to open instead of the shipped one, for the tests: the shipped file's
 * own path is what the app passes, and a test hands in a fixture to drive this path with
 * bytes this build refuses. The audio still comes out of the app's own demo folder.
 */
export async function openDemoWorkspace(file?: string): Promise<Workspace> {
  const source = demoSourceDir()
  const showFile = file ?? join(source, DEMO_WORKSPACE_FILE)
  const raw = await readFile(showFile, 'utf-8')
  const parsed = JSON.parse(raw) as Workspace
  // The same guard the other three load funnels put in front of the funnel, and for the same
  // reason: a document that parses and is not a show would otherwise be walked by the
  // funnel's first read of the cue list and reach the window as V8's own text — a fault,
  // where the demo channel declares a refusal. The sentence names the file, as theirs do.
  if (!hasCueList(parsed)) {
    throw new Refusal(`that file is not a show — ${showFile} holds no cue list`)
  }
  const workspace = migrateWorkspace(parsed, showFile)
  return materialiseDemoAssets(workspace, source, join(app.getPath('userData'), 'demo'))
}
