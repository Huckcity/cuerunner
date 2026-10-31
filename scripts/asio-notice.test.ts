// Steinberg's usage guidelines, held to what ships: the logo on every page the site serves and
// beside each mention of ASIO in a page's body, the attribution in Steinberg's words, and the
// artwork unchanged in both places it is copied to.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ASIO_NOTICE } from '../src/shared/trademarks'

const root = join(__dirname, '..')
const site = join(root, 'website')

function pages(directory: string): string[] {
  return readdirSync(directory).flatMap(name => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return name === 'assets' ? [] : pages(path)
    return name.endsWith('.html') ? [path] : []
  })
}

const served = pages(site).map(path => ({ path, html: readFileSync(path, 'utf-8') }))
const LOGO = /<img src="[./]*assets\/asio-compatible\.svg" alt="ASIO Compatible"/

/** The page without its footer: what a reader meets as the page's own words. */
const body = (html: string): string => html.split('<footer')[0]

describe('the ASIO mark', () => {
  it('finds the pages', () => {
    expect(served.length).toBeGreaterThan(10)
  })

  it('is on every page, with the notice beside it', () => {
    const missing = served.filter(({ html }) => !LOGO.test(html) || !html.includes(ASIO_NOTICE))
    expect(missing.map(({ path }) => path)).toEqual([])
  })

  it('is in the body of any page whose body mentions ASIO, and that mention carries the ®', () => {
    const problems = served.flatMap(({ path, html }) => {
      const words = body(html).replace(/<[^>]+>/g, ' ')
      const first = words.search(/\bASIO\b/)
      if (first === -1) return []
      const faults: string[] = []
      if (words[first + 4] !== '®') faults.push(`${path}: the first ASIO has no ®`)
      if (!body(html).includes('assets/asio-compatible.svg')) faults.push(`${path}: no logo in the body`)
      return faults
    })
    expect(problems).toEqual([])
  })

  it("keeps Steinberg's artwork identical in the site and the app", () => {
    const app = readFileSync(join(root, 'src/renderer/src/assets/asio-compatible.svg'), 'utf-8')
    expect(readFileSync(join(site, 'assets/asio-compatible.svg'), 'utf-8')).toBe(app)
  })

  it('has one wording', () => {
    const stale = served.filter(({ html }) => html.includes('registered in Europe and other countries'))
    expect(stale.map(({ path }) => path)).toEqual([])
  })

  it('is in the About panel', () => {
    expect(readFileSync(join(root, 'src/main/index.ts'), 'utf-8')).toMatch(/copyright:[^\n]*\$\{ASIO_NOTICE\}/)
  })
})
