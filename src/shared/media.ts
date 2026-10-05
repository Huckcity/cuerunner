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

// What the engine can play, by the extension a file of that kind carries.
//
// The engine itself goes by the bytes — it reads a file's first sixteen and never its
// name — so this is not what decides whether a file plays. It is what the window offers:
// which dropped files become cues, and which files a file dialog shows. Those were three
// lists that had drifted apart: a drop took `.opus`, `.wma` and `.aac`, which the engine
// has no decoder for, and made cues that could never sound; the dialogs listed `.aiff` and
// not `.aif`, which is what most AIFF files are called. One list, read by all three.
//
// WAV in the three headers the engine reads (RIFF, RF64, Wave64), AIFF and AIFF-C, FLAC,
// MP3, M4A (AAC or ALAC in an MP4 container) and Ogg Vorbis.
export const AUDIO_FILE_EXTENSIONS = [
  'wav', 'wave', 'rf64', 'w64',
  'aif', 'aiff', 'aifc',
  'flac',
  'mp3',
  'm4a',
  'ogg'
] as const

/** The formats as an operator is told them: the same words the guide uses. */
export const AUDIO_FORMATS_SENTENCE = 'WAV, AIFF, FLAC, MP3, M4A and OGG'

/** Whether a file's name says it is a kind of audio the engine plays. */
export function isPlayableAudioFile(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return false
  const extension = fileName.slice(dot + 1).toLowerCase()
  return (AUDIO_FILE_EXTENSIONS as readonly string[]).includes(extension)
}
