// The support page, held to the two sources it rests on: the one published address, and the
// app's own words for the problem report. Every label is read back out of the file that declares
// it, so the page cannot send anyone looking for a control that has moved.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import { REPORT_BUTTONS, REPORT_ITEM, SUPPORT } from '../website/docs/support.mjs'
// @ts-ignore — js file, no type declarations
import { ORDER_EMAIL } from '../website/docs/contact.mjs'
// @ts-ignore — js file, no type declarations
import { NAV, renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf-8')

const page = SUPPORT.find((entry: { path: string }) => entry.path === 'support.html')
if (page === undefined) throw new Error('website/docs/support.mjs no longer declares support.html')
const rendered: string = renderPage(page)

describe('the support page', () => {
  it('is in the navigation', () => {
    expect(NAV.map(([href]: string[]) => href)).toContain('support.html')
  })

  it('publishes one address, and it is the declared one', () => {
    const addresses = new Set(rendered.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? [])
    expect([...addresses]).toEqual([ORDER_EMAIL])
  })

  it('sends a bug to the public tracker', () => {
    expect(rendered).toContain('https://github.com/Huckcity/cuerunner/issues')
  })

  it("names the report by the app's own words", () => {
    expect(read('src/shared/fileMenu.ts')).toContain(REPORT_ITEM)
    const dialog = read('src/renderer/src/components/layout/ReportDialog.tsx')
    for (const button of REPORT_BUTTONS) expect(dialog).toContain(button)
    expect(rendered).toContain(REPORT_ITEM)
  })

  it('sells nothing', () => {
    const words = rendered.replace(/<[^>]+>/g, ' ')
    expect(words).not.toMatch(/\b(Cuerunner Pro|licen[cs]e key|refund|trial|renewal|invoice)\b/i)
  })
})
