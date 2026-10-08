// The output windows' own channels: their preload calls these, and main pushes on `commands`.
//
// A module of its own, apart from ./output.ts, so the output windows' preload and the control
// window's import no value in common: each preload is bundled as one file (a sandboxed preload
// can require nothing but `electron`), and a module both imported would be split into a chunk
// neither could load. The shapes these channels carry are declared in ./output.ts.

export const OUTPUT_WINDOW_CHANNELS = {
  /** The window has loaded: main answers with what it is and what it should be showing. */
  ready: 'outputWindow:ready',
  /** One reading of the engine's sample clock, for the window to keep its pictures on. */
  clock: 'outputWindow:clock',
  /** What the window did, for main to pass on. */
  report: 'outputWindow:report',
  /** Commands from main, pushed. */
  commands: 'outputWindow:commands'
} as const
