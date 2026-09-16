#!/usr/bin/env node
// Builds the documentation pages from docs/pages.mjs.
//
//   node website/build-docs.mjs
//
// Every page on the site shares a header, a footer and a shell; writing that shell into
// fifteen files by hand is fifteen places for the navigation to go stale. The pages carry
// their own content and nothing else, and this writes them out.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES } from './docs/pages.mjs'

const site = path.dirname(fileURLToPath(import.meta.url))

/** The links across the top of every page. */
const NAV = [
  ['guide.html', 'Guides'],
  ['reference/index.html', 'Reference'],
  ['reliability.html', 'Reliability'],
  ['index.html#download', 'Download']
]

const esc = text => text.replace(/&(?!#?\w+;)/g, '&amp;')

function shell(page) {
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
      <a class="donate-btn" href="https://www.paypal.com/donate/?hosted_button_id=CMLJQS38QHP7W" target="_blank" rel="noreferrer">Say Thanks on PayPal</a>
    </div>
  </header>

  <main class="layout doc-layout">
${crumb}${page.body.trimEnd()}
  </main>

  <footer class="site-footer">
    <p>Cuerunner — show control for Windows and macOS. <a href="${up}guide.html">Guides</a> · <a href="${up}reference/index.html">Reference</a></p>
  </footer>
</body>
</html>
`
}

let written = 0
for (const page of PAGES) {
  const file = path.join(site, page.path)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, shell(page))
  written += 1
  console.log(`  ${page.path}`)
}
console.log(`${written} pages.`)
