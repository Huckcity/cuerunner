// Every page the docs build writes, held to the file the repository commits.
//
// `deploy-website.yml` uploads `website/` as it stands — there is no build step on the deploy
// side — so a page edited in `website/docs/*.mjs` without running `node website/build-docs.mjs`
// ships the old words, and nothing said so. The renderer and the page list are exported for
// this: render every page in PAGES and compare it with the committed file, which is the
// same-commit rule the generated pages are supposed to hold to.
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// @ts-ignore — js file, no type declarations
import { PAGES } from '../website/docs/pages.mjs'
// @ts-ignore — js file, no type declarations
import { renderPage } from '../website/build-docs.mjs'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Reads a page the guard cannot run without: an absent file is a failure, never a skip. */
function committed(page: string): string {
  try {
    return fs.readFileSync(path.join(root, 'website', page), 'utf-8')
  } catch (cause) {
    throw new Error(`docs build: website/${page} cannot be read — ${(cause as Error).message}`)
  }
}

describe('the committed site pages', () => {
  it('are what the docs build renders, page for page', () => {
    expect(
      PAGES.filter(page => renderPage(page) !== committed(page.path)).map(
        page =>
          `website/${page.path} is not what website/docs renders from it: run \`node website/build-docs.mjs\` and commit the page`
      )
    ).toEqual([])
  })
})
