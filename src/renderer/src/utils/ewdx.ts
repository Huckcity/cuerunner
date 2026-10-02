import type { EwDxFound } from '../../../shared/ipc/show'
import type { TelemetrySource } from '../../../shared/show'

// What the window needs to know about a found receiver that main does not: what an address
// looks like once it is a source, and whether a source already is that receiver.

/** The address a source is given for a found receiver: bare unless it is on an unusual port. */
export function targetFor(found: Pick<EwDxFound, 'address' | 'port'>): string {
  return found.port === 443 ? found.address : `${found.address}:${found.port}`
}

/** `host` and `port` of whatever an operator typed, as the service reads it: https, 443 unless told. */
function hostAndPort(target: string): string | null {
  const typed = target.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0]
  if (typed === '') return null
  return typed.includes(':') ? typed : `${typed}:443`
}

/** Whether this source is already the receiver that was found, however its address was typed. */
export function isAdded(sources: TelemetrySource[], found: Pick<EwDxFound, 'address' | 'port'>): boolean {
  const wanted = `${found.address}:${found.port}`
  return sources.some(source => source.kind === 'ew-dx' && hostAndPort(source.target) === wanted)
}

/**
 * What to call a receiver's source: its model, and only when that would repeat a name already
 * in use, the tail of the name it announced — which is the end of its MAC, the part printed
 * on its label.
 */
export function labelFor(found: Pick<EwDxFound, 'model' | 'name'>, existing: string[]): string {
  if (!existing.includes(found.model)) return found.model
  const tail = found.name.slice(-4).toUpperCase()
  const tagged = `${found.model} ${tail}`
  return existing.includes(tagged) ? `${tagged} (2)` : tagged
}
