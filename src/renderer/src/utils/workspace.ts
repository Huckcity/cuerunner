import type { Workspace } from '../types/workspace'

// The saved form of the current session. A real save and an autosave snapshot are built
// the same way, so a recovered workspace has the shape a saved one does.
export function buildWorkspace(
  name: string,
  cues: Workspace['cues'],
  audioSettings: Workspace['audioSettings'],
  midiSettings: Workspace['midiSettings'],
  showSettings: Workspace['showSettings'],
): Workspace {
  return {
    version: 1,
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
    audioSettings,
    midiSettings,
    showSettings,
    cues
  }
}
