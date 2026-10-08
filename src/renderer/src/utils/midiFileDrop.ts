// MIDI files dropped on the cue list: one MIDI File cue each, in the order they were
// dropped, after the cue the operator is on — and each one's length read from its file, so
// the row says how long it runs before anybody opens its tab.

import { useStore } from '../store'
import { cueNameFromFile } from './cueDefaults'
import { midiFileOptionsOf, midiFileTotalMs } from '../../../shared/midiFile'
import type { MidiFileCue } from '../../../shared/cue'

export function addMidiFileCuesFromFiles(filePaths: string[], afterId?: string): void {
  let after = afterId
  for (const filePath of filePaths) {
    const store = useStore.getState()
    store.addCue('midiFile', after, { filePath, name: cueNameFromFile(filePath) })
    // The cue just added is the one selected; the next file goes after it.
    const id = useStore.getState().selectedId
    if (id === null) return
    after = id
    void window.cuerunner.midi.fileInspect({ filePath }).then(result => {
      if (!result.ok) return
      const cue = useStore.getState().cues.find(c => c.id === id)
      if (cue?.type !== 'midiFile') return
      const total = midiFileTotalMs(result.summary.durationMs, midiFileOptionsOf(cue as MidiFileCue))
      if (total !== null) useStore.getState().syncCueDuration(id, Math.round(total))
    })
  }
}
