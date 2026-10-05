// What the window is allowed to load and run.
//
// The window draws a show somebody else may have written: cue names, notes, a script's
// output, text a console sent in. All of it is rendered as text, and that is the defence
// that matters. This is the one behind it: if something ever did get markup onto the page,
// the page would still refuse to run a script that did not come from the app's own files,
// or to load anything from anywhere else.
//
// It is written into the built page (`electron.vite.config.ts`) rather than the source
// one, because the development server works by exactly what it forbids — an inline
// preamble and a socket for hot reload.
//
// What each line allows, and why it is no wider:
//   default-src 'self'      the app's own files, and nothing it did not ship with.
//   script-src 'self'       no inline script and no eval in the page. A script cue's code
//                           is run in a worker, which is its own context, loaded from the
//                           app's files.
//   style-src … unsafe-inline   the stylesheet is a file; inline styles are what React
//                           writes for a width or a colour, and carry no code.
//   img-src / font-src data:    small assets the build inlines.
//   connect-src 'self'      the window makes no requests of its own: network cues, OSC and
//                           MIDI all leave from the main process.
//   object-src, base-uri, form-action 'none'   nothing the app uses, so nothing is allowed.
export const RENDERER_CONTENT_POLICY_DIRECTIVES: Readonly<Record<string, string>> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' data:",
  'font-src': "'self' data:",
  'connect-src': "'self'",
  'worker-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'"
}

/** The policy as the page's own meta tag carries it. */
export const RENDERER_CONTENT_POLICY = Object.entries(RENDERER_CONTENT_POLICY_DIRECTIVES)
  .map(([directive, sources]) => `${directive} ${sources}`)
  .join('; ')
