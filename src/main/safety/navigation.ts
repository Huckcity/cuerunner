// The window is the show, and it stays on the page it was given.
//
// A file dropped on a page that does not take the drop is, to Chromium, a request to open
// that file in place of the page: the window leaves the app for the file, and the show —
// the cue list, the unsaved edits, the runner holding the clock — goes with the renderer
// that was drawing it. What is left cannot even be closed, because closing asks the page
// whether there is unsaved work and the page that would answer is gone.
//
// The window refuses the drop where it lands (`utils/dropGuard.ts` in the renderer), which
// is what the operator sees. This is the half that does not depend on the page behaving:
// whatever asks the window to go somewhere else — a drop the page missed, a link, a script —
// is refused here, in the process that owns the window.

/** What a navigation attempt carries: where it is going, and the way to refuse it. */
export interface NavigationAttempt {
  url: string
  preventDefault(): void
}

/** The slice of a window's webContents this needs, so a test can stand in for one. */
export interface NavigableContents {
  on(event: 'will-navigate', listener: (details: NavigationAttempt) => void): unknown
  getURL(): string
}

/** A URL without its fragment: the page it names, wherever on it. */
function pageOf(url: string): string {
  const hash = url.indexOf('#')
  return hash < 0 ? url : url.slice(0, hash)
}

/**
 * Keeps a window on the page it loaded. A navigation to the page that is already open is
 * a reload — the development server asks for one when a file it cannot hot-swap changes —
 * and is let through; anything else is refused.
 */
export function refuseNavigation(contents: NavigableContents): void {
  contents.on('will-navigate', details => {
    if (pageOf(details.url) === pageOf(contents.getURL())) return
    details.preventDefault()
  })
}
