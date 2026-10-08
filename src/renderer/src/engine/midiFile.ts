// The window's half of a MIDI File cue: asking main to play, hold, resume and stop a cue's
// file. The file is played in main, where the port is (src/main/midi/midiFileService.ts);
// what is kept here is which cues have a file going, so that taking any run away — STOP, a
// stop cue, a panic, a restart — can stop the file of a run that has one without sending a
// message for every run that has not.

import type { MidiFileCue } from '../../../shared/cue'
import { midiFileOptionsOf } from '../../../shared/midiFile'
import type { MidiFilePlayResult, MidiFileResumeResult } from '../../../shared/ipc/midi'

/** What a GO says for a MIDI File cue with no file: it ran, and nothing was sent. */
export const NO_MIDI_FILE_SELECTED = 'no MIDI file selected — nothing played'

/** Cues whose file main was asked to play and has not been asked to stop. */
const playing = new Set<string>()
/** Of those, the ones that are held. */
const held = new Set<string>()
const heldListeners = new Set<() => void>()

function heldChanged(): void {
  for (const listener of heldListeners) listener()
}

/** Plays a cue's file to `portName`, `offsetMs` of played time in. */
export function playMidiFile(cue: MidiFileCue, portName: string, offsetMs: number): Promise<MidiFilePlayResult> {
  playing.add(cue.id)
  if (held.delete(cue.id)) heldChanged()
  return window.cuerunner.midi.filePlay({
    cueId: cue.id,
    filePath: cue.filePath,
    portName,
    options: midiFileOptionsOf(cue),
    offsetMs
  })
}

/** Stops a cue's file, if it has one going. Every note it started is released by main. */
export function stopMidiFile(cueId: string): void {
  if (!playing.delete(cueId)) return
  if (held.delete(cueId)) heldChanged()
  void window.cuerunner.midi.fileStop({ cueId }).catch(() => {
    // A main that cannot be asked has its own panic path for what it holds.
  })
}

/** Holds a cue's file where it is. */
export function pauseMidiFile(cueId: string): void {
  if (!playing.has(cueId) || held.has(cueId)) return
  held.add(cueId)
  heldChanged()
  void window.cuerunner.midi.filePause({ cueId }).catch(() => {})
}

/** Plays a held file on, and says how long it has left. */
export function resumeMidiFile(cueId: string): Promise<MidiFileResumeResult> {
  if (held.delete(cueId)) heldChanged()
  return window.cuerunner.midi.fileResume({ cueId })
}

/** Whether a cue's file is being held. */
export function isMidiFileHeld(cueId: string): boolean {
  return held.has(cueId)
}

/** Called when any cue's file is held or let go; returns the unsubscribe function. */
export function onMidiFileHeldChange(listener: () => void): () => void {
  heldListeners.add(listener)
  return () => { heldListeners.delete(listener) }
}
