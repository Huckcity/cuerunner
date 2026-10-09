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
/** Of those, the ones that are held. Who holds a cue is the runner's record; this is main's. */
const held = new Set<string>()

/** Plays a cue's file to `portName`, `offsetMs` of played time in. */
export function playMidiFile(cue: MidiFileCue, portName: string, offsetMs: number): Promise<MidiFilePlayResult> {
  playing.add(cue.id)
  held.delete(cue.id)
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
  held.delete(cueId)
  void window.cuerunner.midi.fileStop({ cueId }).catch(() => {
    // A main that cannot be asked has its own panic path for what it holds.
  })
}

/** Holds a cue's file where it is. */
export function pauseMidiFile(cueId: string): void {
  if (!playing.has(cueId) || held.has(cueId)) return
  held.add(cueId)
  void window.cuerunner.midi.filePause({ cueId }).catch(() => {})
}

/** Plays a held file on, and says how long it has left. */
export function resumeMidiFile(cueId: string): Promise<MidiFileResumeResult> {
  held.delete(cueId)
  return window.cuerunner.midi.fileResume({ cueId })
}

/** Moves a cue's file to `positionMs` of played time, held or not, and says what is left. */
export function seekMidiFile(cueId: string, positionMs: number): Promise<MidiFileResumeResult> {
  return window.cuerunner.midi.fileSeek({ cueId, positionMs })
}

