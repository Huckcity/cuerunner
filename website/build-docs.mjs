#!/usr/bin/env node
// Builds the documentation pages from docs/pages.mjs.
//
//   node website/build-docs.mjs
//
// Every page on the site shares a header, a footer and a shell; writing that shell into
// every page by hand is a place per page for the navigation to go stale. The pages carry
// their own content and nothing else, and this writes them out.
//
// The renderer is exported and the writing is not: scripts/docs-build.test.ts renders every
// page in PAGES and compares it with the file the repository commits, which is the only
// thing that catches a page edited without a rebuild — `deploy-website.yml` ships website/
// as it stands, with no build step of its own.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES } from './docs/pages.mjs'
import { SELLER_BLOCK } from './docs/contact.mjs'

const site = path.dirname(fileURLToPath(import.meta.url))

/**
 * The links across the top of every page. Exported beside the renderer so a guard can read the
 * list the pages were rendered from.
 */
export const NAV = [
  ['guide.html', 'Guides'],
  ['reference/index.html', 'Reference'],
  ['support.html', 'Support'],
  ['interop.html', 'Other programs'],
  ['reliability.html', 'Reliability']
]

const esc = text => text.replace(/&(?!#?\w+;)/g, '&amp;')

/**
 * One page as the site serves it: the shared head, the navigation, the page's own body and
 * the footer. Pure string work — a caller renders a page without writing anything — so the
 * committed HTML can be held to its source (scripts/docs-build.test.ts).
 */
export function renderPage(page) {
  const up = page.path.includes('/') ? '../' : './'
  const nav = NAV.map(([href, label]) => {
    const active = page.path === href || (href === 'guide.html' && page.path.startsWith('guides/'))
      || (href === 'reference/index.html' && page.path.startsWith('reference/'))
    return `        <a href="${up}${href}"${active ? ' aria-current="page"' : ''}>${label}</a>`
  }).join('\n')

  const crumb = page.section
    ? `      <nav class="crumbs" aria-label="Breadcrumb">
        <a href="${up}${page.section === 'Guides' ? 'guide.html' : 'reference/index.html'}">${page.section}</a>
        <span aria-hidden="true">/</span>
        <span>${page.title}</span>
      </nav>\n`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(page.title)} — Cuerunner</title>
  <meta name="description" content="${esc(page.blurb)}" />
  <meta property="og:type" content="article" />
  <meta property="og:title" content="${esc(page.title)} — Cuerunner" />
  <meta property="og:description" content="${esc(page.blurb)}" />
  <link rel="icon" href="${up}assets/logo-mark.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="${up}styles.css" />
</head>
<body>
  <div class="bg-grid" aria-hidden="true"></div>

  <header class="site-header">
    <div class="header-inner">
      <a class="brand" href="${up}index.html" aria-label="Cuerunner home">
        <img src="${up}assets/logo-mark.svg" alt="Cuerunner" class="brand-mark" />
        <span>CUERUNNER</span>
      </a>
      <nav class="top-nav" aria-label="Primary">
${nav}
      </nav>
      <a class="header-cta" href="${up}index.html#download">Download</a>
    </div>
  </header>

  <main class="layout doc-layout">
${crumb}${page.body.trimEnd()}
  </main>

  <footer class="site-footer">
    <p>Cuerunner — show control for Windows, macOS and Linux. <a href="${up}guide.html">Guides</a> · <a href="${up}reference/index.html">Reference</a> · <a href="https://github.com/Huckcity/cuerunner">Source on GitHub</a> (MIT)</p>
    <p class="seller">${esc(SELLER_BLOCK)}</p>
  </footer>
</body>
</html>
`
}

/**
 * Whether a path is this file, however the path was reached: a symlink to the script is the
 * script, and a candidate that resolves to nothing — or to no path at all — is not.
 */
function sameFile(candidate) {
  try {
    return fs.realpathSync(candidate) === fs.realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

// The command line writes every page; an import renders without writing. `process.argv[1]` is
// the file node was asked to run, and the two sides are compared as real paths so the CLI is
// recognised however it was reached — a symlinked invocation is still this program.
const invoked = process.argv[1]
const asProgram = invoked !== undefined && sameFile(path.resolve(invoked))

if (asProgram) {
  let written = 0
  for (const page of PAGES) {
    const file = path.join(site, page.path)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, renderPage(page))
    written += 1
    console.log(`  ${page.path}`)
  }
  console.log(`${written} pages.`)
}
