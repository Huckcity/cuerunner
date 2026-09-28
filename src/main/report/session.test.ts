// The two verbs that let a report leave: save it where the operator says, or put it on the
// clipboard and open a message. Neither may act on anything but a string the window read, and
// neither may do anything when the operator cancels.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'

const electron = vi.hoisted(() => ({
  save: vi.fn(),
  clipboard: vi.fn(),
  open: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getVersion: () => '0.14.0', getPath: () => tmpdir(), isPackaged: true },
  dialog: { showSaveDialog: electron.save },
  clipboard: { writeText: electron.clipboard },
  shell: { openExternal: electron.open }
}))

import { emailReport, saveReport } from './session'
import { REPORT_TEXT_LIMIT } from './report'
import { SUPPORT_ADDRESS } from '../../shared/support'

const win = {} as BrowserWindow

beforeEach(() => {
  electron.save.mockReset()
  electron.clipboard.mockReset()
  electron.open.mockReset()
  electron.open.mockResolvedValue(undefined)
})

describe('saveReport', () => {
  it('writes the text it was given where the operator chose', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-save-'))
    const filePath = join(dir, 'r.txt')
    electron.save.mockResolvedValue({ canceled: false, filePath })
    try {
      const result = await saveReport(win, 'the report')
      expect(result).toEqual({ ok: true, path: filePath })
      expect(readFileSync(filePath, 'utf8')).toBe('the report')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does nothing when the operator cancels the dialog', async () => {
    electron.save.mockResolvedValue({ canceled: true, filePath: undefined })
    expect(await saveReport(win, 'the report')).toEqual({ ok: true, path: null })
  })

  it('refuses text that is not a report, or is past the ceiling, without opening a dialog', async () => {
    for (const bad of [undefined, 42, '', 'x'.repeat(REPORT_TEXT_LIMIT + 1)]) {
      await expect(saveReport(win, bad)).rejects.toMatchObject({ name: 'Refusal' })
    }
    expect(electron.save).not.toHaveBeenCalled()
  })
})

describe('emailReport', () => {
  it('puts the report on the clipboard and opens a message to the support address', async () => {
    expect(await emailReport('the report')).toEqual({ ok: true })

    expect(electron.clipboard).toHaveBeenCalledWith('the report')
    const url = new URL(electron.open.mock.calls[0][0] as string)
    expect(url.protocol).toBe('mailto:')
    expect(url.pathname).toBe(SUPPORT_ADDRESS)
    // The report rides the clipboard: a mailto: body that long is dropped by Windows.
    expect(url.searchParams.get('body')).not.toContain('the report\n')
    expect(url.searchParams.get('subject')).toContain('0.14.0')
  })

  it('refuses text that is not a report before touching the clipboard', async () => {
    await expect(emailReport('')).rejects.toMatchObject({ name: 'Refusal' })
    expect(electron.clipboard).not.toHaveBeenCalled()
    expect(electron.open).not.toHaveBeenCalled()
  })
})
