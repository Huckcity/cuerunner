// Where the session log lives on this machine, and the verb that shows it to the operator.

import { app, shell } from 'electron'
import { mkdir } from 'node:fs/promises'
import { Refusal } from '../ipc/refusal'
import { SessionLogFile } from './sessionLogFile'

let file: SessionLogFile | null = null

/**
 * The log file, made on first use: the app's logs folder is only asked for once the app
 * can answer, which is not at import. Inside the user-data folder on Windows and Linux, and
 * in `~/Library/Logs` on a Mac, which is where each platform's own tools look.
 */
export function sessionLogFile(): SessionLogFile {
  if (file === null) file = new SessionLogFile(app.getPath('logs'))
  return file
}

/**
 * Opens the logs folder in the file manager. A folder the OS will not open is said in a
 * sentence — the window shows it — rather than thrown: the operator asked for a folder, and
 * "it could not be opened, it is here" is an answer they can act on.
 */
export async function openLogsFolder(): Promise<{ ok: true; path: string }> {
  const dir = sessionLogFile().dir
  // A machine that has not logged anything yet has no folder to open; it is made, empty,
  // so the press shows where the log will be rather than failing.
  await mkdir(dir, { recursive: true })
  const failure = await shell.openPath(dir)
  if (failure !== '') throw new Refusal(`The logs folder could not be opened (${failure}). It is at ${dir}`)
  return { ok: true, path: dir }
}
