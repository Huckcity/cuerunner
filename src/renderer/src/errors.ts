import { useStore } from './store'

let installed = false

// Anything that escapes a React render and the engine's own error handling — a rejected
// promise nobody awaited, an error thrown by a timer — has to reach the operator.
// Packaged builds have no visible console, so the session log is the only surface.
export function installRuntimeErrorReporting(): void {
  if (installed) return
  installed = true

  window.addEventListener('error', (event) => {
    // Resource load failures (a missing image) surface here too, without an error.
    if (!event.error && !event.message) return
    report('Unhandled error', event.error ?? event.message)
  })

  window.addEventListener('unhandledrejection', (event) => {
    report('Unhandled rejection', event.reason)
  })
}

function report(prefix: string, cause: unknown): void {
  console.error(`${prefix}:`, cause)
  const detail = cause instanceof Error ? cause.message : String(cause)
  try {
    useStore.getState().appendLog([{ level: 'error', message: `${prefix}: ${detail}` }])
  } catch {
    // Reporting must never itself become the failure.
  }
}
