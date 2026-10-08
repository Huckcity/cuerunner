// The update bar and the settings tab: what each phase says, which presses each offers, and the
// refusals said beside the buttons rather than in a dialog.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { UpdateNotice } from './UpdateNotice'
import { UpdateSection } from './UpdateSection'
import { setUpdateStatus } from '../../engine/updateStatus'
import { useStore } from '../../store'
import { idleUpdateStatus } from '../../../../test/setup'
import { HELD_FOR_SHOW, type UpdateStatus } from '../../../../shared/update'

const NOTES = '# [0.18.0](x) (2026-10-20)\n\n### Features\n\n* **update:** the app updates itself'

function offered(patch: Partial<UpdateStatus> = {}): UpdateStatus {
  return {
    ...idleUpdateStatus(),
    current: '0.17.0',
    install: 'nsis',
    phase: 'available',
    available: { version: '0.18.0', notes: NOTES, releaseDate: '2026-10-20T00:00:00.000Z' },
    ...patch
  }
}

describe('the update bar and the settings tab', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    useStore.setState({ isDirty: false })
    vi.mocked(window.cuerunner.update.download).mockClear()
    vi.mocked(window.cuerunner.update.install).mockClear()
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function button(label: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find(each => each.textContent === label)
  }

  it('offers a newer version with its notes and a download, and says nothing while there is none', () => {
    act(() => setUpdateStatus(idleUpdateStatus()))
    act(() => root.render(<UpdateNotice showMode={false} />))
    expect(container.querySelector('.update-notice')).toBeNull()
    act(() => setUpdateStatus(offered()))
    expect(container.textContent).toContain('Cuerunner 0.18.0 is available.')
    expect(button('Download')).toBeDefined()
    act(() => button('Release notes')!.click())
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('the app updates itself')
  })

  it('stays out of Show Mode', () => {
    act(() => setUpdateStatus(offered()))
    act(() => root.render(<UpdateNotice showMode={true} />))
    expect(container.querySelector('.update-notice')).toBeNull()
  })

  it('says why a download was held, from the status main pushed', async () => {
    vi.mocked(window.cuerunner.update.download).mockResolvedValueOnce({ ok: false, error: HELD_FOR_SHOW })
    act(() => setUpdateStatus(offered()))
    act(() => root.render(<UpdateNotice showMode={false} />))
    await act(async () => button('Download')!.click())
    expect(window.cuerunner.update.download).toHaveBeenCalledTimes(1)
    act(() => setUpdateStatus(offered({ phase: 'held', message: HELD_FOR_SHOW })))
    expect(container.textContent).toContain(HELD_FOR_SHOW)
    expect(button('Download again')).toBeDefined()
  })

  it('asks for the show to be saved before a restart, and restarts nothing until it is', async () => {
    useStore.setState({ isDirty: true })
    act(() => setUpdateStatus(offered({ phase: 'downloaded', progress: 1 })))
    act(() => root.render(<UpdateNotice showMode={false} />))
    expect(container.textContent).toContain('It installs when Cuerunner quits')
    await act(async () => button('Restart now')!.click())
    expect(container.textContent).toContain('Save the show first: restarting closes it.')
    expect(window.cuerunner.update.install).not.toHaveBeenCalled()
    act(() => useStore.setState({ isDirty: false }))
    await act(async () => button('Restart now')!.click())
    expect(window.cuerunner.update.install).toHaveBeenCalledTimes(1)
  })

  it('sends a .deb to the download page instead of downloading', () => {
    act(() => setUpdateStatus(offered({ install: 'deb', message: 'This copy was installed from the .deb package, which cannot replace itself.' })))
    act(() => root.render(<UpdateNotice showMode={false} />))
    expect(button('Download')).toBeUndefined()
    act(() => button('Open the download page')!.click())
    expect(window.cuerunner.update.openDownloads).toHaveBeenCalled()
  })

  it('puts the bar away for the session with Later', () => {
    act(() => setUpdateStatus(offered({ available: { version: '0.18.1', notes: '', releaseDate: null } })))
    act(() => root.render(<UpdateNotice showMode={false} />))
    act(() => button('Later')!.click())
    expect(container.querySelector('.update-notice')).toBeNull()
  })

  it('changes the machine’s settings from the tab, and says why a check was refused', async () => {
    vi.mocked(window.cuerunner.update.check).mockResolvedValueOnce({
      ok: false,
      error: 'Update checks are locked out from 18:00 to 23:30. Change that in Settings → Updates.'
    })
    act(() => setUpdateStatus({ ...idleUpdateStatus(), lockout: 'Update checks are locked out from 18:00 to 23:30.' }))
    act(() => root.render(<UpdateSection />))
    expect(container.querySelector('[data-testid="update-lockout"]')?.textContent).toBe(
      'Update checks are locked out from 18:00 to 23:30.'
    )
    await act(async () => (container.querySelector('#update-auto') as HTMLInputElement).click())
    expect(window.cuerunner.update.configure).toHaveBeenCalledWith({ check: false })
    await act(async () => (container.querySelector('#update-lockout') as HTMLInputElement).click())
    expect(window.cuerunner.update.configure).toHaveBeenLastCalledWith({
      lockout: { enabled: true, from: '18:00', to: '23:30' }
    })
    await act(async () => button('Check now')!.click())
    expect(container.querySelector('[role="alert"]')?.textContent).toMatch(/locked out from 18:00 to 23:30/)
  })
})
