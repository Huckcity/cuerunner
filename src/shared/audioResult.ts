/**
 * The audio engine's refusals, as values rather than exceptions.
 *
 * The engine speaks `{ ok, error }` over its socket, and everything it can refuse is an
 * ordinary state rather than a fault: the silent backend has no devices to configure, and
 * the show clock is read forty times a second, so the second or so after the engine is
 * restarted is a run of refusals by design.
 *
 * That shape stops at the main process today, because the IPC handler turns it into a
 * rejection — and Electron logs every rejected `ipcMain.handle` to stderr with a stack.
 * On Windows, where the E2E harness tees the app's stdio so that a real engine failure is
 * visible, that is hundreds of lines of noise per run and a real failure would be invisible
 * in it.
 *
 * So: handlers answer with this envelope, and the preload unwraps it in the renderer
 * process, where throwing is just a rejected promise again — one nobody logs.
 */

export type AudioRefusal = {
  ok: false
  /** The engine's own code — `device` for a refusal, `engine` for an engine that is not there. */
  code: string
  message: string
}

export type AudioResult<T> = { ok: true; value: T } | AudioRefusal

/** The engine's refusal, from whatever was thrown in its name. */
export function refusalFrom(error: unknown): AudioRefusal {
  const code = (error as { code?: unknown } | null)?.code
  return {
    ok: false,
    code: typeof code === 'string' ? code : 'engine',
    message: error instanceof Error ? error.message : String(error)
  }
}

/**
 * A refusal, back as the exception every caller already expects.
 *
 * The name is deliberate: callers and logs read `AudioEngineError` today, and this is the
 * same thing arriving by a different road.
 */
export function unwrapAudioResult<T>(result: AudioResult<T>): T {
  if (result.ok) return result.value
  const error = new Error(result.message) as Error & { code: string }
  error.name = 'AudioEngineError'
  error.code = result.code
  throw error
}
