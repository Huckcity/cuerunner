import { useEffect } from 'react'
import { useStore, type LogEntry } from '../store'

/** How long lines gather before they go to main: a burst of a cue chain is one write. */
export const LOG_FLUSH_MS = 500

/** The most lines one write carries; main refuses a batch past its own bound. */
const BATCH = 400

/** One log line as the file holds it: level, the cue it is about, and what it says. */
export function logFileLine(entry: Pick<LogEntry, 'level' | 'message' | 'label'>): string {
  const label = entry.label ? `[${entry.label}] ` : ''
  return `${entry.level.toUpperCase()} ${label}${entry.message}`
}

/**
 * Writes the session log to the file on disk as the window writes it on screen, so the log of
 * a show outlives the window that ran it. Lines main reported itself are left to main, which
 * writes them even when there is no window to forward them. Gathered for half a second at a
 * time; the store's own bound on the log is not this one's business — what scrolled off the
 * screen has already been written.
 */
export function useLogFile(): void {
  useEffect(() => {
    let lastId = useStore.getState().log.at(-1)?.id ?? 0
    let pending: string[] = []
    let timer: ReturnType<typeof setTimeout> | null = null

    const flush = (): void => {
      timer = null
      while (pending.length > 0) {
        const batch = pending.slice(0, BATCH)
        pending = pending.slice(BATCH)
        void window.cuerunner.app.writeLog(batch).catch(() => {
          // A log that could not be written is not a show that stopped.
        })
      }
    }

    const unsubscribe = useStore.subscribe(state => {
      const log = state.log
      if (log.length === 0) { lastId = 0; return }
      const fresh = log.filter(entry => entry.id > lastId)
      if (fresh.length === 0) return
      lastId = fresh[fresh.length - 1].id
      for (const entry of fresh) {
        if (entry.origin !== 'main') pending.push(logFileLine(entry))
      }
      if (pending.length > 0 && timer === null) timer = setTimeout(flush, LOG_FLUSH_MS)
    })

    return () => {
      unsubscribe()
      if (timer !== null) clearTimeout(timer)
      flush()
    }
  }, [])
}

/** Opens the logs folder, and says on the notice bar when the machine would not. */
export async function openLogsFolder(): Promise<void> {
  const result = await window.cuerunner.app.openLogs()
  if (!result.ok) useStore.getState().setNotice(result.error)
}
