// How a workspace points at its media files on disk.
//
// A show is a folder an operator copies to the machine driving it, so the path written
// for a file inside that folder must survive the move. Every audio cue with a file is
// written with both halves: `path` is the one playback reads — relative to the folder
// when the media lives inside it, absolute when it does not — and `originalPath` is the
// absolute location the file had at the last save, kept so a workspace that has moved
// can still find media that stayed where it was.

/** A media file as a workspace stores it. */
export interface MediaReference {
  /** Workspace-relative when the file sits at or below the workspace folder, absolute otherwise. */
  path: string
  /** The absolute path the file had when the workspace was last saved. */
  originalPath: string
}

/** An audio cue whose file was not where the workspace said it would be. */
export interface MissingMedia {
  cueId: string
  /** What the workspace stored: workspace-relative when the file belonged to the folder. */
  path: string
  /** The absolute path the file had when the workspace was last saved. */
  originalPath: string
}
