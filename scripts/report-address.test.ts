// A problem report is addressed from the app, and the support page names an address and the
// controls too. They are the same address and the same words, or a report goes to an inbox
// nobody reads and a reader is sent looking for a button that has moved.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SUPPORT_ADDRESS } from '../src/shared/support'
import { FILE_MENU } from '../src/shared/fileMenu'
import { ORDER_EMAIL } from '../website/docs/contact.mjs'
import { REPORT_BUTTONS, REPORT_ITEM } from '../website/docs/support.mjs'

describe('the report the support page describes', () => {
  it('is addressed to the address the support page publishes', () => {
    expect(SUPPORT_ADDRESS).toBe(ORDER_EMAIL)
  })

  it('opens from the File menu item the page names', () => {
    const item = FILE_MENU.find(entry => entry !== 'separator' && entry.action === 'report-problem')
    expect(item).toMatchObject({ label: REPORT_ITEM })
  })

  it('is left by the three buttons the page names, as the dialog draws them', () => {
    const dialog = readFileSync('src/renderer/src/components/layout/ReportDialog.tsx', 'utf8')
    for (const label of REPORT_BUTTONS as string[]) {
      expect(dialog, `the dialog has no "${label}" button`).toMatch(
        new RegExp(`>\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*<`)
      )
    }
  })
})
