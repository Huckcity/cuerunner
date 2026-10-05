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
 * process, where throwing is just a rejected promise again — one nobody logs. The refusal
 * crosses the context bridge as the value it is, and the window's engine client turns it
 * into the exception (`audioEngineError`): see `unwrapAudioResult` for why not here.
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
 * A refusal, handed on as itself.
 *
 * This runs in the preload, and what it throws has to cross the context bridge to reach
 * the window. The bridge copies a thrown `Error` by its message alone — a `code` or a
 * `name` set on it here arrives as `undefined` and `Error` — so an exception built on this
 * side reached every caller without the one field they branch on: a file the engine could
 * not read was indistinguishable from an engine that was not there, and the pass that
 * measures a show's files asked about it again on every write to the store. A plain value
 * is copied whole, so the refusal is thrown as the value it already is, and
 * `audioEngineError` gives it its class on the far side.
 */
export function unwrapAudioResult<T>(result: AudioResult<T>): T {
  if (result.ok) return result.value
  throw result
}

/** Whether something caught is the engine's refusal, as `unwrapAudioResult` hands it on. */
export function isAudioRefusal(thrown: unknown): thrown is AudioRefusal {
  if (typeof thrown !== 'object' || thrown === null) return false
  const candidate = thrown as Partial<AudioRefusal>
  return candidate.ok === false && typeof candidate.code === 'string' && typeof candidate.message === 'string'
}

/**
 * A refusal, back as the exception every caller already expects — built in the window,
 * where the caller is, so its `code` and its name are still on it when it is caught.
 * Anything that is not a refusal is handed back untouched: a fault is still the fault it
 * was.
 *
 * The name is deliberate: callers and logs read `AudioEngineError` today, and this is the
 * same thing arriving by a different road.
 */
export function audioEngineError(thrown: unknown): unknown {
  if (!isAudioRefusal(thrown)) return thrown
  const error = new Error(thrown.message) as Error & { code: string }
  error.name = 'AudioEngineError'
  error.code = thrown.code
  return error
}
