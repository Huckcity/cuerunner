// Every page the docs build writes, held to the file the repository commits.
//
// `deploy-website.yml` uploads `website/` as it stands — there is no build step on the deploy
// side — so a page edited in `website/docs/*.mjs` without running `node website/build-docs.mjs`
// ships the old words, and a page whose entry left PAGES ships with nothing generating it at
// all. Nothing said so about either: the renderer and the page list are exported for this —
// render every page in PAGES and compare it with the committed file, and read the site back
// for a page no entry renders.
//
// Each check is a function of the pages and the renderer, so the cases below can hand them a
// page list the repository would never hold and get the failure back by name.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import { PAGES } from '../website/docs/pages.mjs'
// @ts-ignore — js file, no type declarations
import { renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The HTML the docs build does not write, named so a page that no entry renders is a decision
 * rather than a silent ship: the landing page and the reliability page are hand-written, and
 * the redundancy walkthrough is written by scripts/capture-redundancy.mjs. A new page outside
 * `website/docs/` joins this list deliberately, or fails below.
 */
const BESIDE_THE_BUILD = ['index.html', 'reliability.html', 'redundancy.html']

/** Reads a page the guard cannot run without: an absent file is a failure, never a skip. */
function committed(page: string): string {
  try {
    return fs.readFileSync(path.join(root, 'website', page), 'utf-8')
  } catch (cause) {
    throw new Error(`docs build: website/${page} cannot be read — ${(cause as Error).message}`)
  }
}

/** Every page the site ships, relative to `website/`, as the deploy uploads them. */
function sitePages(): string[] {
  let entries: string[]
  try {
    entries = fs.readdirSync(path.join(root, 'website'), { recursive: true, encoding: 'utf-8' })
  } catch (cause) {
    throw new Error(`docs build: website/ cannot be walked — ${(cause as Error).message}`)
  }
  const pages = entries.map(entry => entry.split(path.sep).join('/')).filter(entry => entry.endsWith('.html'))
  if (pages.length === 0) {
    throw new Error('docs build: website/ holds no page to read, so a pass here would mean nothing')
  }
  return pages.sort()
}

/** The pages whose committed file is not what `render` produces, each named with the fix. */
function stalePages(pages: Array<{ path: string }>, render: (page: unknown) => string): string[] {
  return pages
    .filter(page => render(page) !== committed(page.path))
    .map(
      page =>
        `website/${page.path} is not what website/docs renders from it: run \`node website/build-docs.mjs\` and commit the page`
    )
}

/** The pages that ship as their own file with no entry in PAGES rendering them. */
function orphanPages(pages: Array<{ path: string }>): string[] {
  const rendered = new Set(pages.map(page => page.path))
  return sitePages()
    .filter(page => !rendered.has(page) && !BESIDE_THE_BUILD.includes(page))
    .map(
      page =>
        `website/${page} ships as it stands and no entry in PAGES renders it: give it a page in website/docs/, or name it among the pages the docs build does not own`
    )
}

describe('the committed site pages', () => {
  it('are what the docs build renders, page for page', () => {
    expect(stalePages(PAGES, renderPage)).toEqual([])
  })

  it('are all rendered by an entry in PAGES, unless the build does not own them', () => {
    expect(orphanPages(PAGES)).toEqual([])
  })

  it('names a page the renderer no longer produces from its body', () => {
    const page = PAGES.find((entry: { path: string }) => entry.path === 'pro.html')
    expect(
      page,
      'website/docs/pages.mjs no longer renders pro.html: this case edits the page that ships as website/pro.html'
    ).toBeDefined()
    const edited = [{ ...page, body: `${page.body}\n    <p>An edit nobody rebuilt.</p>` }]
    expect(stalePages(edited, renderPage)).toEqual([
      expect.stringContaining('website/pro.html is not what website/docs renders from it')
    ])
  })

  it('names a page whose entry left PAGES', () => {
    const without = PAGES.filter((entry: { path: string }) => entry.path !== 'pro.html')
    expect(orphanPages(without)).toEqual([expect.stringContaining('website/pro.html')])
  })
})
