import { powerSaveBlocker } from 'electron'

// macOS naps an app that has no window on screen and is not playing audio, and a napped
// app's timers come back late: on the CI runners a three-second wait took eight. That is
// the show's own clock, not a benchmark — due cues are dispatched off a 25 ms renderer
// interval (audioEngineClient.ts), and the scheduler the cue stack runs on is built from
// it. `backgroundThrottling: false` covers Chromium's clamp for a window that is off
// screen; App Nap is the OS, and it takes an assertion to hold off.
//
// `prevent-app-suspension` is the assertion that fits: the app keeps its timers, and the
// operator's display is still allowed to sleep. Audio used to hold the app awake by
// itself, because Web Audio played in the renderer; the engine plays in its own process
// now, so nothing else does.
//
// Nothing releases the blocker. The process exiting releases it anyway, and a quit that
// the renderer cancels — the unsaved-changes prompt does exactly that — would otherwise
// leave the desk nappable for the rest of the session.

let blockerId: number | null = null

/** Asks the OS to keep this app's timers running. Display sleep is left alone. */
export function keepAwake(): void {
  if (blockerId !== null) return
  blockerId = powerSaveBlocker.start('prevent-app-suspension')
}

/**
 * Whether main is holding the OS off, as Electron itself reports it. Nothing in the
 * product reads this: the end-to-end suite asks it, because "the desk is never napped" is
 * a claim about this process, and an assertion against the page would prove the wrong
 * thing. The API's own answer, so a blocker that has been stopped is not reported held.
 */
export function keepAwakeHeld(): boolean {
  return blockerId !== null && powerSaveBlocker.isStarted(blockerId)
}