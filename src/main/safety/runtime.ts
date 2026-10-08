import { BrowserWindow } from 'electron'
import { sendToWindow } from '../ipc/broadcast'
import { PLAYBACK_CHANNELS } from '../../shared/ipc/playback'
import { audioEngine } from '../audio/AudioEngine'
import { PlaybackSafety } from './PlaybackSafety'
import type { PlaybackPanic } from '../../shared/playback'
import type { AudioEngineEvent } from '../../shared/audio'
import { panicOutputs } from '../output/panic'

// The one place the safety net is wired to the two things it protects: the native audio
// service in this process, and every window that may still be there to be told. Nothing
// here waits for the renderer — a panic that had to ask the window first would be no use
// in the only situation it exists for.

// The guard matters most on this path: the panic that follows a renderer dying is sent to
// windows that are, by definition, the ones that just died — and the send throws when the
// frame is already disposed, which is a fact about the window rather than a failure of the
// panic. `sendToWindow` skips those and survives the race either way.
function broadcastPanic(panic: PlaybackPanic): void {
  for (const win of BrowserWindow.getAllWindows()) sendToWindow(win, PLAYBACK_CHANNELS.panic, panic)
  // The pictures go with the sound: a panic takes every output down over the same fade,
  // whether or not the control window is alive to ask for it.
  panicOutputs(panic.fadeMs)
}

/** How many engine events are kept for the dev harness, newest last. */
const EVENT_LOG_LIMIT = 200

const engineEventLog: AudioEngineEvent[] = []

/** Every engine event passes through here, on its way to the renderer. */
export function noteEngineEvents(events: AudioEngineEvent[]): void {
  for (const event of events) {
    engineEventLog.push(event)
  }
  if (engineEventLog.length > EVENT_LOG_LIMIT) {
    engineEventLog.splice(0, engineEventLog.length - EVENT_LOG_LIMIT)
  }
}

/** What the engine has said recently, for the acceptance tests in e2e/main-safety.spec.ts. */
export function recentEngineEvents(): AudioEngineEvent[] {
  return [...engineEventLog]
}

export const playbackSafety = new PlaybackSafety({
  engine: audioEngine,
  // The engine's own last-known answer, read synchronously at the moment a heartbeat is
  // missed: it is `active` while any voice is scheduled, playing or fading. A renderer
  // that has stopped answering cannot be asked, and a stopped engine does not arm the
  // watchdog — which is what keeps an idle desk free of false panics.
  isPlaying: () => audioEngine.snapshot()?.active ?? false,
  broadcast: broadcastPanic
})
