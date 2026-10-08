// The bytes of a saved workspace: the runtime show, turned into the document on disk.
//
// Nothing here reaches Electron, the filesystem or the clock — the bytes are a function of
// the show and the folder it is saved into, and of nothing else — which is why the module
// is separate from the file operations around it (`WorkspaceManager.ts`). It is also why
// the imports below carry their `.ts` extensions: the tools that must produce the same
// bytes run this module under plain Node, with no bundler and no Electron in the graph.
// `scripts/regenerate-demo.ts` is the one that ships; the recipes in the tests are the
// others.
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { savedShape } from '../../shared/workspaceSections.ts'
import type { AudioCue, Cue } from '../../shared/cue.ts'
import type { MediaReference } from '../../shared/media.ts'
import type { Workspace } from '../../shared/workspace.ts'
import { carriesMediaFile } from '../../shared/visual'

// ─── The route a save writes for one cue ──────────────────────────────────────

// A cue on disk carries fields the runtime cue type does not declare — `media` is the
// one left — so they are read through the cast, through here.
function legacyFields(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>
}

/** Where a workspace says a cue's media is, before anything has been looked for. */
export interface MediaReferenceLike {
  path: string
  originalPath?: string | null
}

/**
 * The route pair a cue came with, or null when it carries none — a blank cue, a file
 * dropped into this session, a workspace saved before the pair existed. Read through the
 * cast for the same reason it always was: `media` is a disk shape, and the runtime cue
 * type declares only `filePath`.
 */
export function mediaOf(cue: AudioCue): MediaReferenceLike | null {
  const media = legacyFields(cue).media as Partial<MediaReference> | undefined
  if (!media || typeof media.path !== 'string' || media.path === '') return null
  return media as MediaReferenceLike
}

/**
 * The pair a save may write back: a cue's own record only when the file holds both
 * halves. Half a pair is not written back as half a pair — the file would carry a route
 * whose last-known absolute was never recorded, and the cue's own path is then the better
 * record of where the file is — so such a cue is saved the way a cue with no pair is.
 */
function storedPairOf(cue: AudioCue): MediaReference | null {
  const media = mediaOf(cue)
  if (media === null || typeof media.originalPath !== 'string') return null
  return { path: media.path, originalPath: media.originalPath }
}

/**
 * The path to store for a file: relative to the workspace folder when it really lives
 * inside that folder, absolute when it does not. Compared with `relative` rather than a
 * string prefix, so a sibling folder whose name merely starts with the folder's is not
 * mistaken for being inside it.
 */
export function storedMediaPath(absolutePath: string, workspaceDir: string): string {
  const fromFolder = relative(workspaceDir, absolutePath)
  const outside =
    fromFolder === '' ||
    fromFolder === '..' ||
    fromFolder.startsWith(`..${sep}`) ||
    isAbsolute(fromFolder)
  return outside ? absolutePath : fromFolder
}

/**
 * The route a save writes for one cue, and the absolute path the file was last seen at.
 *
 * A file this session resolved to a path inside the folder being saved into is this
 * folder's own — the path is the proof — so the route is written from where the file now
 * sits, relative to that folder.
 *
 * Everywhere else the route the show came with is the one that travels: it presumes the
 * media moves with the show, and the absolute half is the fallback for the machine where
 * the media stayed put, tried only where nothing sits at the route. So the pair is
 * written back as the file carried it — the relative route kept, the last-known absolute
 * kept with it — which is what a save over a folder that does not hold the media does.
 * Deriving a route from the path this session tried instead would replace a portable
 * route with one machine's absolute path, and the copy the show was made for would open
 * missing its media.
 *
 * A cue whose own path the stored pair does not name has no route of its own to keep —
 * the session was pointed at another file after that pair was read — so one is derived
 * from the path the cue holds now, exactly as for a cue that never carried a pair.
 *
 * The pair wins over the resolution when the pair's own route names the very file this
 * session resolved: the show still points where it pointed, so the absolute half is the
 * file's record rather than this machine's path — which is what keeps a show that ships
 * beside its media byte-identical on every machine it is opened on, the demo included.
 * That is only so while the pair's route is the route this save would write; a pair naming
 * an absolute path for a file the folder being saved into holds is not written back, because
 * `storedMediaPath` has the portable answer for exactly that file.
 */
function savedMedia(cue: AudioCue, workspaceDir: string): MediaReference {
  const held = cue.filePath
  const stored = storedPairOf(cue)
  if (isAbsolute(held)) {
    const route = storedMediaPath(held, workspaceDir)
    if (route !== held) {
      // A pair whose own route names the very file this session resolved is kept — the pair
      // is the show's record, which is what keeps a show that ships beside its media
      // byte-identical on every machine — but only while that route is a route *into this
      // folder*: a pair recording an absolute path for a file the folder being saved into
      // holds is not, because `storedMediaPath` has the portable answer for exactly that
      // file, and writing the pair back would turn it into one machine's path.
      //
      // The route is resolved rather than compared as text. A show written elsewhere may
      // spell the same route `./walk-in.wav`, with a doubled separator, or with the other
      // platform's separator, and all three name the file this session resolved: comparing
      // the text would call that a route this save would not write and replace the show's
      // own record — the absolute half included — with this machine's path, on the first
      // save of a file that had not been touched.
      if (stored && !isAbsolute(stored.path) && resolve(workspaceDir, stored.path) === held) return stored
      return { path: route, originalPath: held }
    }
  }
  if (stored && (held === stored.path || held === stored.originalPath)) return stored
  const absolutePath = isAbsolute(held) ? held : resolve(workspaceDir, held)
  return { path: storedMediaPath(absolutePath, workspaceDir), originalPath: absolutePath }
}

// ─── The document ─────────────────────────────────────────────────────────────

// The on-disk form: the runtime workspace, with each named file's location written as
// both its route — relative to the folder being saved into when the media lives inside
// it — and the absolute path it was last seen at. A cue whose file this session resolved
// inside that folder is refreshed from that path; otherwise the pair the show came with
// is written back, which is what keeps a route that has moved portable. The caller's
// object is left alone.
//
// The bytes are a function of the show's state and the folder it is saved into — nothing
// else, and in particular not the clock. The show's id and createdAt arrive in the
// workspace object and are written back as they came; the renderer owns them
// (`buildWorkspace`) and only mints them for a new show. That is what makes a showfile
// diffable: saving a show that has not changed puts the same bytes back.
//
// The key order is the saved form's own declaration, not whichever object the caller
// built: a format whose bytes depend on the order somebody happened to assign fields in
// is a format that will eventually churn for a reason nobody can find. `savedShape`
// writes the declared order; adding or moving a key means editing the declaration
// (`src/shared/workspaceSections.ts`), and the declaration is also what the settings diff
// and the merge walk.
// Held by src/main/workspace/savedShape.test.ts, determinism.test.ts and e2e/showfile.spec.ts.
//
// `references` is for the one caller that stores a show somewhere other than the folder
// its media lives in: a bundle records each cue's entry inside the bundle and the
// absolute path the file had where it came from, neither of which can be derived from
// the folder the bundle is written into.
export function serialiseWorkspace(
  workspace: Workspace,
  workspaceDir: string,
  references?: Map<string, MediaReference>
): string {
  const cues = workspace.cues.map(cue => {
    const recorded = references?.get(cue.id)
    // A recorded pair is the bundle's own route to the file, so it is the cue's written
    // path too: no caller has to have set one first for the rule to hold.
    if (recorded) return { ...cue, filePath: recorded.path, media: recorded }
    if (!carriesMediaFile(cue) || cue.filePath === '') {
      // A cue with no file has no route to record. A pair a file left on one — a
      // hand-edited show, where the path was blanked but the record was not — names a
      // file this cue does not play, so it is not written back.
      const pairless = { ...cue } as Cue & { media?: unknown }
      delete pairless.media
      return pairless
    }
    const media = savedMedia(cue as unknown as AudioCue, workspaceDir)
    // The written `filePath` is the route, never the path this machine resolved: a path
    // a workspace-relative route can describe has no business on disk (AD-10).
    return { ...cue, filePath: media.path, media }
  })
  return JSON.stringify(savedShape({ ...workspace, cues }), null, 2)
}
