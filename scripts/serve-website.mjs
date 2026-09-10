#!/usr/bin/env node
// Serves website/ locally, so a page can be checked before it deploys to GitHub Pages.
//
//   npm run site          → http://localhost:8080
//   npm run site -- 3000  → http://localhost:3000
//
// Mirrors the deployed layout (relative paths, directory index) without any dependency
// or network access. Opening website/index.html directly also works, but a server is
// closer to what Pages serves.
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'website')
const port = Number(process.argv[2]) || 8080

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
}

createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0])
  const requested = url === '/' ? 'index.html' : url.replace(/^\/+/, '')
  const filePath = path.join(root, requested)

  // Refuse anything that escapes the site directory
  if (!filePath.startsWith(root + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`Not found: ${requested}`)
      return
    }
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream' })
    res.end(data)
  })
}).listen(port, () => {
  console.log(`Winslab site: http://localhost:${port}/`)
  console.log(`User guide:   http://localhost:${port}/guide.html`)
  console.log('Ctrl+C to stop.')
})
