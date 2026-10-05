import { describe, expect, it, vi } from 'vitest'
import { refuseNavigation, type NavigationAttempt } from './navigation'

const APP = 'file:///opt/Cuerunner/resources/app.asar/out/renderer/index.html'

/** A window's contents, as far as the guard reads them: one page, one listener. */
function contentsAt(url: string) {
  let listener: ((details: NavigationAttempt) => void) | null = null
  return {
    on: (_event: 'will-navigate', registered: (details: NavigationAttempt) => void) => {
      listener = registered
    },
    getURL: () => url,
    /** Asks the window to go somewhere, and says whether it was refused. */
    navigate(target: string): boolean {
      const preventDefault = vi.fn()
      listener?.({ url: target, preventDefault })
      return preventDefault.mock.calls.length > 0
    }
  }
}

describe('refuseNavigation', () => {
  it('refuses a dropped file: the window does not leave the app for it', () => {
    const contents = contentsAt(APP)
    refuseNavigation(contents)
    expect(contents.navigate('file:///home/op/Music/walk-in.wav')).toBe(true)
  })

  it('refuses a web address and any other page', () => {
    const contents = contentsAt(APP)
    refuseNavigation(contents)
    expect(contents.navigate('https://example.com/')).toBe(true)
    expect(contents.navigate('file:///opt/Cuerunner/resources/app.asar/out/renderer/other.html')).toBe(true)
  })

  it('lets the page that is open reload, with or without a fragment', () => {
    const dev = contentsAt('http://localhost:5173/')
    refuseNavigation(dev)
    expect(dev.navigate('http://localhost:5173/')).toBe(false)
    expect(dev.navigate('http://localhost:5173/#cue')).toBe(false)

    const packaged = contentsAt(`${APP}#top`)
    refuseNavigation(packaged)
    expect(packaged.navigate(APP)).toBe(false)
  })
})
