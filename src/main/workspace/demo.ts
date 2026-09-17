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
import { migrateWorkspace } from './WorkspaceManager'
import type { Workspace } from '../../shared/workspace'

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

export async function openDemoWorkspace(): Promise<Workspace> {
  const source = demoSourceDir()
  const raw = await readFile(join(source, DEMO_WORKSPACE_FILE), 'utf-8')
  const workspace = migrateWorkspace(JSON.parse(raw) as Workspace)
  return materialiseDemoAssets(workspace, source, join(app.getPath('userData'), 'demo'))
}
