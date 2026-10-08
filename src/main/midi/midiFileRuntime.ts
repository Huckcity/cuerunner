// The process's one set of MIDI file players, on the process's one high-resolution clock.
//
// A module of its own so the two places that have to reach it can: the IPC handlers, which
// bind it to the MIDI engine's ports and answer the window, and the safety net, which stops
// it on a panic the window may not be alive to ask for.

import { createHighResolutionClock } from './midiFileClock'
import { MidiFileService } from './midiFileService'

export const midiFiles = new MidiFileService({ clock: createHighResolutionClock() })
