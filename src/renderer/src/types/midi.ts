/**
 * MIDI availability, as the main process reports it and the window shows it.
 *
 * This is not "is a device plugged in": a machine with the module and no interfaces has
 * working MIDI, it just has nothing to talk to. It answers the other question — the one
 * that used to be invisible — because `midi` is an optional native dependency, and a
 * build without it silently sent nothing at all.
 */
export interface MidiAvailability {
  available: boolean
  /** Why MIDI cannot work, in words an operator can act on. Null when it is available. */
  error: string | null
}
