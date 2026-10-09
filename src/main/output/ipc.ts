// The output domain's two doors, registered here so the manager and its channels are one
// module's business.
//
// `registerOutputHandlers` is the control window's (`window.cuerunner.output`) and is called
// from `registerIpcHandlers` with every other domain, so the parity gate holds it with them.
// `registerOutputWindowHandlers` is the output windows' own, smaller door; it is called from
// `src/main/index.ts` beside the window pair, and held to the output preload by
// `./parity.test.ts`.

import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { sendToWindow } from '../ipc/broadcast'
import { audioEngine } from '../audio/AudioEngine'
import { OutputManager, isOutputWindow } from './OutputManager'
import { createMachinePlacements } from './placements'
import { createMachineCameraChoices } from './cameraChoices'
import { StreamAllowance } from './streamProtocol'
import type { CameraDevice } from '../../shared/camera'
import { OUTPUT_WINDOW_CHANNELS } from '../../shared/ipc/outputWindow'
import {
  OUTPUT_CHANNELS,
  type ChooseCameraPayload,
  type LayerCommand,
  type OutputEvent,
  type OutputPlacePayload,
  type OutputPlaceResult,
  type OutputTestPatternPayload,
  type OutputWindowReport,
  type TimerFeed,
  type TimerWindowState
} from '../../shared/ipc/output'
import type { VideoOutput } from '../../shared/visual'

let manager: OutputManager | null = null

/**
 * The network streams main may fetch for a camera picture: one allowance, shared by the
 * manager (which allows an origin when a cue naming it goes up) and the scheme's handler.
 */
export const streamAllowance = new StreamAllowance()

/**
 * The one manager, made the first time anything asks for it rather than when this module is
 * imported: the placements file is read from userData, which only a ready app can name.
 */
export function outputManager(): OutputManager {
  if (manager === null) {
    manager = new OutputManager({
      placements: createMachinePlacements({ filePath: join(app.getPath('userData'), 'video-outputs.json') }),
      cameraChoices: createMachineCameraChoices({ filePath: join(app.getPath('userData'), 'camera-devices.json') }),
      streams: streamAllowance,
      clock: () => audioEngine.clock().catch(() => null),
      publish: events => publishToControl(events)
    })
  }
  return manager
}

/** The manager if anything has made it — a panic before the show declared an output has nothing to clear. */
export function existingOutputManager(): OutputManager | null {
  return manager
}

/** Events for the control window: every window that is not an output. */
function publishToControl(events: OutputEvent[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (isOutputWindow(win)) continue
    sendToWindow(win, OUTPUT_CHANNELS.events, events)
  }
}

function senderWindow(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender) ?? null
}

export function registerOutputHandlers(): void {
  ipcMain.handle(OUTPUT_CHANNELS.configure, (_, outputs: VideoOutput[]) => {
    outputManager().configure(Array.isArray(outputs) ? outputs : [])
  })
  ipcMain.handle(OUTPUT_CHANNELS.snapshot, () => outputManager().snapshot())
  ipcMain.handle(OUTPUT_CHANNELS.place, async (_, payload: OutputPlacePayload): Promise<OutputPlaceResult> => {
    const status = await outputManager().place(payload.outputId, payload.placement)
    return status === null ? { ok: false, error: 'that output is not in the show' } : { ok: true, status }
  })
  ipcMain.handle(OUTPUT_CHANNELS.layer, (_, command: LayerCommand) => outputManager().layer(command))
  ipcMain.handle(OUTPUT_CHANNELS.identify, () => outputManager().identify())
  ipcMain.handle(OUTPUT_CHANNELS.testPattern, (_, payload: OutputTestPatternPayload) =>
    outputManager().testPattern(payload.outputId, payload.on))
  ipcMain.handle(OUTPUT_CHANNELS.preview, (_, outputId: string) => outputManager().preview(outputId))
  ipcMain.handle(OUTPUT_CHANNELS.timer, (_, feed: TimerFeed) => outputManager().timer(feed))
  ipcMain.handle(OUTPUT_CHANNELS.timerWindow, (_, state: TimerWindowState) => outputManager().timerWindow(state))
  ipcMain.handle(OUTPUT_CHANNELS.pickFile, (event, kind: 'video' | 'image') =>
    outputManager().pickFile(senderWindow(event), kind === 'image' ? 'image' : 'video'))
  ipcMain.handle(OUTPUT_CHANNELS.cameras, () => outputManager().cameras())
  ipcMain.handle(OUTPUT_CHANNELS.chooseCamera, (_, payload: ChooseCameraPayload) =>
    outputManager().chooseCamera(String(payload?.cueId ?? ''), (payload?.device ?? null) as CameraDevice | null))
  ipcMain.handle(OUTPUT_CHANNELS.pickMask, event => outputManager().pickMask(senderWindow(event)))
}

export function registerOutputWindowHandlers(): void {
  ipcMain.handle(OUTPUT_WINDOW_CHANNELS.ready, event => outputManager().windowReady(event.sender))
  ipcMain.handle(OUTPUT_WINDOW_CHANNELS.clock, () => outputManager().clock())
  ipcMain.handle(OUTPUT_WINDOW_CHANNELS.report, (event, report: OutputWindowReport) =>
    outputManager().windowReport(event.sender, report))
}
