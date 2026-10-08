// The output windows' preload: the door a page that only draws is given.
//
// An output reads what it is and what it should be showing, reads the engine's clock to keep
// its pictures on, and reports what it did. It runs no cue, opens no file and has no other
// verb: the commands come to it from main, and everything it is told is already decided.
// Sandboxed like the control window's, and asking `electron` for nothing else.

import { contextBridge, ipcRenderer } from 'electron'
import {
  OUTPUT_WINDOW_CHANNELS,
  type OutputWindowBridge,
  type OutputWindowCommand,
  type OutputWindowInit,
  type OutputWindowReport
} from '../shared/ipc/output'
import type { AudioClockReading } from '../shared/audio'

contextBridge.exposeInMainWorld('cuerunnerOutput', {
  ready: (): Promise<OutputWindowInit> =>
    ipcRenderer.invoke(OUTPUT_WINDOW_CHANNELS.ready) as Promise<OutputWindowInit>,
  clock: (): Promise<AudioClockReading | null> =>
    ipcRenderer.invoke(OUTPUT_WINDOW_CHANNELS.clock) as Promise<AudioClockReading | null>,
  report: (report: OutputWindowReport): Promise<void> =>
    ipcRenderer.invoke(OUTPUT_WINDOW_CHANNELS.report, report) as Promise<void>,
  onCommands: (callback: (commands: OutputWindowCommand[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, commands: OutputWindowCommand[]): void => callback(commands)
    ipcRenderer.on(OUTPUT_WINDOW_CHANNELS.commands, listener)
    return () => ipcRenderer.off(OUTPUT_WINDOW_CHANNELS.commands, listener)
  }
} satisfies OutputWindowBridge)
