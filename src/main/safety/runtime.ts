import { BrowserWindow } from 'electron'
import { sendToWindow } from '../ipc/broadcast'
import { PLAYBACK_CHANNELS } from '../../shared/ipc/playback'
import { audioEngine } from '../audio/AudioEngine'
import { midiFiles } from '../midi/midiFileRuntime'
import { PlaybackSafety } from './PlaybackSafety'
import type { PlaybackPanic } from '../../shared/playback'
import type { AudioEngineEvent } from '../../shared/audio'
import { panicLighting } from '../dmx/lighting'
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
  // The lights follow a panic someone asked for — the menu, a desk's OSC or MIDI — by the
  // show's own rule. A window that died or stopped answering is not one: the lights run in
  // this process and were never the window's, so they are not stopped for it.
  if (panic.source === 'menu' || panic.source === 'osc' || panic.source === 'midi') panicLighting()
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
  // The MIDI files main is playing go quiet with the audio: their ports are this process's
  // too, and a panic that left a sequence running would be half a panic. A panic says All
  // Notes Off on every channel they played on, as well as releasing each note.
  engine: {
    panic: fadeMs => {
      midiFiles.stopAll(true)
      return audioEngine.panic(fadeMs)
    }
  },
  // The engine's own last-known answer, read synchronously at the moment a heartbeat is
  // missed: it is `active` while any voice is scheduled, playing or fading. A renderer
  // that has stopped answering cannot be asked, and a stopped engine does not arm the
  // watchdog — which is what keeps an idle desk free of false panics. A MIDI file main is
  // playing counts the same way: it is sound this process owns.
  isPlaying: () => (audioEngine.snapshot()?.active ?? false) || midiFiles.isPlaying(),
  broadcast: broadcastPanic
})
