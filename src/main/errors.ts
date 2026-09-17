// Main-process failures have no console a packaged build can show, so they are held
// here until something asks for them.
//
// The backlog exists because of a race that used to lose errors outright: the window
// subscribes a moment after it loads, and a failure during startup — a native module
// that will not load, a port already taken — is reported before the listener exists.
// A message pushed to nobody is gone; one put in the backlog is still there when the
// renderer asks on mount.
//
// A report is keyed by the fact it names: the same thing going wrong in a loop raises one
// entry's count instead of filling the backlog, while every occurrence still reaches the
// live listeners — a repeat's text carries its count, which is what an operator sees
// climbing in the log, and no IPC payload has to change shape.

type Listener = (message: string) => void

/** One reported fact: what it is about, how it reads, and how often it has arrived. */
interface BacklogEntry {
  /** The fact, as the caller names it. A repeat finds this entry and raises it in place. */
  key: string
  /** The report as written, before its count is put in the text. */
  message: string
  count: number
}

// Enough to explain a startup that went wrong several times over, and short enough
// that a failure loop cannot pin memory.
const BACKLOG_LIMIT = 20

const backlog: BacklogEntry[] = []
const listeners = new Set<Listener>()

/** The text a listener and the drain are handed: the report as written, with its count
 *  once it has repeated. A single occurrence reads exactly as the caller wrote it. */
function reportText(entry: BacklogEntry): string {
  return entry.count > 1 ? `${entry.message} (×${entry.count})` : entry.message
}

/** Records a failure, and hands it to every live listener.
 *
 *  `key` is the fact the report is about, taken from `message` when the caller names no
 *  separate one. A key's message is fixed at its first report — later occurrences re-render
 *  that same text with the raised count — so a caller whose text varies from occurrence to
 *  occurrence must pass the stable message, the part the count does not carry. */
export function reportMainError(message: string, key: string = message): void {
  const entry = backlog.find(candidate => candidate.key === key)
  if (entry !== undefined) {
    entry.count += 1
    deliver(reportText(entry))
    return
  }
  const first: BacklogEntry = { key, message, count: 1 }
  backlog.push(first)
  if (backlog.length > BACKLOG_LIMIT) backlog.splice(0, backlog.length - BACKLOG_LIMIT)
  deliver(reportText(first))
}

function deliver(text: string): void {
  console.error(text)
  for (const listener of [...listeners]) {
    try {
      listener(text)
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
  const messages = backlog.map(reportText)
  backlog.length = 0
  return messages
}
