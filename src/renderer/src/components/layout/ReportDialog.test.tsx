// The dialog's promise is that the text under the box is the text that leaves. These hold it:
// what the operator types reaches the composer, the composed text is what Save and Email are
// handed, an older build never overwrites a newer one, and Escape closes it.
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReportDialog } from './ReportDialog'
import { useStore } from '../../store'

const app = () => window.cuerunner.app as unknown as {
  composeReport: Mock
  saveReport: Mock
  emailReport: Mock
}

describe('ReportDialog', () => {
  let container: HTMLDivElement
  let root: Root
  const onClose = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose.mockReset()
    app().composeReport.mockImplementation((input: { description: string }) =>
      Promise.resolve(`REPORT\n${input.description}`))
    app().saveReport.mockResolvedValue({ ok: true, path: null })
    app().emailReport.mockResolvedValue({ ok: true })
    useStore.setState({ log: [{ id: 1, at: 0, level: 'error', message: 'engine stopped' }] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useStore.setState({ log: [] })
    vi.useRealTimers()
  })

  async function open(): Promise<void> {
    await act(async () => { root.render(<ReportDialog onClose={onClose} />) })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  async function type(text: string): Promise<void> {
    const box = container.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
      setter.call(box, text)
      box.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  }

  const shown = (): string => container.querySelector('.report-text')?.textContent ?? ''
  const press = async (label: string): Promise<void> => {
    const button = [...container.querySelectorAll('button')].find(b => b.textContent === label)!
    await act(async () => { button.click() })
  }

  it('builds the report with the session log and shows it before anything is pressed', async () => {
    await open()

    const input = app().composeReport.mock.calls[0][0] as { log: string[] }
    expect(input.log).toHaveLength(1)
    expect(input.log[0]).toContain('[error] engine stopped')
    expect(shown()).toContain('REPORT')
  })

  it('rebuilds around what the operator writes, and Save and Email get exactly that text', async () => {
    await open()
    await type('the cue never fired')

    expect(shown()).toBe('REPORT\nthe cue never fired')
    await press('Save…')
    expect(app().saveReport).toHaveBeenCalledWith('REPORT\nthe cue never fired')
    await press('Email…')
    expect(app().emailReport).toHaveBeenCalledWith('REPORT\nthe cue never fired')
  })

  it('says what a refusal said rather than pretending the report was saved', async () => {
    app().saveReport.mockResolvedValue({ ok: false, error: 'The report is too large to save or mail.' })
    await open()
    await press('Save…')

    expect(container.querySelector('.report-status')?.textContent).toBe('The report is too large to save or mail.')
  })

  it('does not let a slow earlier build overwrite a newer one', async () => {
    let releaseFirst: (text: string) => void = () => {}
    app().composeReport.mockImplementationOnce(() => new Promise<string>(resolve => { releaseFirst = resolve }))
    await open()
    await type('newer')
    await act(async () => { releaseFirst('STALE') })

    expect(shown()).toBe('REPORT\nnewer')
  })

  it('closes on Escape and on the ✕', async () => {
    await open()
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    await press('✕')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
