// The script panel and the script cues: read a file's includes, read a document the panel
// can draw, pick one off disk, and run a shell command. The panel is the Pro surface; the
// includes a script cue reads are not, so the refusal for a locked app lives with the two
// channels that are the panel rather than on the namespace.

import type { ScriptDocument } from '../show'

/** The IPC channels. Main owns the handlers; preload owns the bridge to them. */
export const SCRIPT_CHANNELS = {
  readFile: 'script:readFile',
  pickFile: 'script:pickFile',
  readDocument: 'script:readDocument',
  shell: 'script:shell'
} as const

/**
 * One `include()`, resolved against the file that is doing the including — or against
 * the workspace directory for the script body itself, when there is no including file.
 */
export interface ScriptReadFilePayload {
  relativePath: string
  workspacePath: string | null
  /** The file the include was written in; its directory is what a relative path means. */
  base?: string
}

export interface ScriptReadFileResult {
  code: string
  /** Where the include resolved to, so its own includes resolve from there. */
  path: string
}

export interface ScriptReadDocumentPayload {
  filePath: string
  workspacePath: string | null
}

/** Bounds and the working directory for one shell command. */
export interface ScriptShellOptions {
  timeout?: number
  cwd?: string
  env?: Record<string, string>
}

export interface ScriptShellPayload {
  command: string
  options?: ScriptShellOptions
}

export interface ScriptShellResult {
  stdout: string
  stderr: string
  /** The exit code, or null when a signal ended the process. */
  code: number | null
  signal: string | null
}

/** The script panel, as the renderer reads it (`window.cuerunner.script`). */
export interface ScriptBridge {
  /**
   * Resolves one include. The resolved path goes back so the file's own includes can be
   * resolved against it.
   */
  readFile(relativePath: string, workspacePath: string | null, base?: string): Promise<ScriptReadFileResult>
  /** The panel's picker; null is a cancel, which is a normal answer. */
  pickFile(): Promise<string | null>
  readDocument(filePath: string, workspacePath: string | null): Promise<ScriptDocument>
  shell(command: string, options?: ScriptShellOptions): Promise<ScriptShellResult>
}
