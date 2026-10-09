// The master level, in dB: this machine's (the level a room wants is the room's, not the
// show's), kept beside the window's other places, and shared by every control that moves it —
// the output strip in the transport and the master strip in the mixer — so the two can never
// disagree about where it is. The stored value is the one truth: it is read where it is
// asked for, so nothing caches a level the storage no longer holds.

const STORAGE_KEY = 'cuerunner.master.db'
/** The floor and top of the master, dB: below the floor is silence, and the engine holds +6. */
export const MASTER_FLOOR_DB = -60
export const MASTER_TOP_DB = 6

let fallback = 0
const listeners = new Set<() => void>()

export function masterDb(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const value = Number(raw)
    return raw !== null && Number.isFinite(value) ? Math.min(MASTER_TOP_DB, Math.max(MASTER_FLOOR_DB, value)) : 0
  } catch {
    return fallback
  }
}

export function setMasterDb(db: number): void {
  const next = Math.min(MASTER_TOP_DB, Math.max(MASTER_FLOOR_DB, db))
  if (next === masterDb()) return
  fallback = next
  try { localStorage.setItem(STORAGE_KEY, String(next)) } catch { /* the fallback holds it */ }
  for (const listener of listeners) listener()
}

export function subscribeMaster(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
