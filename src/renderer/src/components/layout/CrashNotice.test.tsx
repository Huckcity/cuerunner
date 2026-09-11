// The crash banner is the only place that says the session was reset, and the end-to-end
// test of it needs a renderer that can actually come back — which a CI runner cannot
// always manage. The wording and the dismissal are held here as well.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CrashNotice } from './CrashNotice'

describe('CrashNotice', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    ;(window.winslab.app.rendererCrash as unknown as Mock).mockResolvedValue(null)
  })

  async function renderCrash(report: { reason: string; at: number } | null): Promise<void> {
    ;(window.winslab.app.rendererCrash as unknown as Mock).mockResolvedValue(report)
    await act(async () => { root.render(<CrashNotice />) })
  }

  it('says the interface stopped, which reason, and that unsaved work is gone', async () => {
    await renderCrash({ reason: 'crashed', at: Date.parse('2026-01-01T20:30:00Z') })

    const notice = container.querySelector('.app-notice')
    expect(notice?.getAttribute('data-kind')).toBe('crash')
    expect(notice?.textContent).toContain('The interface stopped unexpectedly')
    expect(notice?.textContent).toContain('(crashed)')
    expect(notice?.textContent).toContain('was reloaded')
    expect(notice?.textContent).toContain('Anything unsaved is gone')
  })

  it('shows nothing when the last renderer did not crash', async () => {
    await renderCrash(null)

    expect(container.querySelector('.app-notice')).toBeNull()
  })

  it('is dismissed and stays dismissed', async () => {
    await renderCrash({ reason: 'killed', at: Date.now() })

    const dismiss = container.querySelector('.app-notice-dismiss') as HTMLButtonElement
    await act(async () => { dismiss.click() })

    expect(container.querySelector('.app-notice')).toBeNull()
  })
})
