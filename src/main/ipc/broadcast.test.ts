import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { AUDIO_CHANNELS } from '../../shared/audio'
import { SHOW_CHANNELS } from '../../shared/ipc/show'
import { liveWindow, sendToWindow } from './broadcast'

/** The two things the guard reads, and nothing else. */
function windowLike(options: { destroyed?: boolean; contentsDestroyed?: boolean; crashed?: boolean } = {}) {
  const send = vi.fn()
  const win = {
    isDestroyed: () => options.destroyed ?? false,
    webContents: {
      isDestroyed: () => options.contentsDestroyed ?? false,
      isCrashed: () => options.crashed ?? false,
      send
    }
  }
  return { win: win as unknown as BrowserWindow, send }
}

describe('sending to a window that may have gone', () => {
  it('sends when the window and its renderer are both there', () => {
    const { win, send } = windowLike()
    sendToWindow(win, AUDIO_CHANNELS.events, [{ id: 1 }])
    expect(send).toHaveBeenCalledWith(AUDIO_CHANNELS.events, [{ id: 1 }])
  })

  it('survives a frame that goes away between the check and the send', () => {
    const win = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        isCrashed: () => false,
        send: () => {
          throw new Error('Render frame was disposed before WebFrameMain could be accessed')
        }
      }
    } as unknown as BrowserWindow
    expect(() => sendToWindow(win, AUDIO_CHANNELS.events, [])).not.toThrow()
  })

  it('skips a failed, destroyed or absent window instead of throwing', () => {
    const cases = [
      { name: 'no window', make: () => null },
      { name: 'destroyed window', make: () => windowLike({ destroyed: true }) },
      { name: 'destroyed renderer', make: () => windowLike({ contentsDestroyed: true }) },
      { name: 'killed renderer', make: () => windowLike({ crashed: true }) }
    ] as const

    for (const testCase of cases) {
      const made = testCase.make()
      const win = made && 'win' in made ? made.win : null
      const send = made && 'win' in made ? made.send : null
      expect(liveWindow(win), testCase.name).toBe(false)
      expect(() => sendToWindow(win, SHOW_CHANNELS.events, [])).not.toThrow()
      if (send) expect(send, testCase.name).not.toHaveBeenCalled()
    }
  })
})
