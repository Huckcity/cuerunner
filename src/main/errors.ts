// Main-process failures have no console a packaged build can show, so they are held
// here until something asks for them.
//
// The backlog exists because of a race that used to lose errors outright: the window
// subscribes a moment after it loads, and a failure during startup — a native module
// that will not load, a port already taken — is reported before the listener exists.
// A message pushed to nobody is gone; one put in the backlog is still there when the
// renderer asks on mount.

type Listener = (message: string) => void

// Enough to explain a startup that went wrong several times over, and short enough
// that a failure loop cannot pin memory.
const BACKLOG_LIMIT = 20

const backlog: string[] = []
const listeners = new Set<Listener>()

/** Records a failure, and hands it to every live listener. */
export function reportMainError(message: string): void {
  console.error(message)
  backlog.push(message)
  if (backlog.length > BACKLOG_LIMIT) backlog.splice(0, backlog.length - BACKLOG_LIMIT)

  for (const listener of [...listeners]) {
    try {
      listener(message)
    } catch {
      // A window dying mid-send must not take the reporter, and with it the main
      // process's only account of what went wrong, down too.
    }
  }
}

/** Registers a live listener; the returned function unregisters it. */
export function onMainError(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Hands over everything reported so far and empties the backlog. */
export function drainMainErrors(): string[] {
  const messages = [...backlog]
  backlog.length = 0
  return messages
}
