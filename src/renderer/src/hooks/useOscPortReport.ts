import { useEffect } from 'react'
import { useStore } from '../store'
import type { ServiceStatus } from '../../../shared/show'

/**
 * The line the log gets for a status worth a line: the OSC listener refused its port. Null for
 * every other status — running, stopped, starting, or a socket that stopped after it bound,
 * which main raises as an alarm of its own.
 */
export function oscPortReport(status: ServiceStatus | undefined): string | null {
  if (status === undefined || status.state !== 'degraded') return null
  if (!/\((EADDRINUSE|EACCES|EADDRNOTAVAIL)\)$/.test(status.detail)) return null
  return `OSC input: ${status.detail}`
}

/**
 * Writes the OSC listener's refusal of its port to the session log, once per refusal, at the
 * info level. The listener reports a refused port as its status rather than as an alarm — a
 * second show on the machine, or a CI host's parallel jobs, each find 53000 taken, and that is
 * not something on stage going wrong — so the line in the log is written here, from the status
 * the Settings row and the Monitor already show.
 */
export function useOscPortReport(): void {
  const line = useStore(s => oscPortReport(s.showServices.find(service => service.id === 'osc-in')))
  useEffect(() => {
    if (line === null) return
    useStore.getState().appendLog([{ level: 'info', message: line, label: 'osc-in' }])
  }, [line])
}
