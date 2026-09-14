import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// The bundle that ships is minified, and never carries source maps. electron-vite's defaults
// are the opposite of both — good for a debugger, but the output of an unminified production
// build is the source with the comments taken out, one `npx asar extract` away, and a source
// map hands the original names and comments straight back. Neither is a secret store: what is
// shipped can be read by whoever runs it. This only makes reading it work rather than
// automatic, so that the code being copied is a decision rather than an accident.
const shipped = { minify: 'esbuild', sourcemap: false } as const

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: shipped
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: shipped
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // Script cues run in a module worker (see engine/scriptWorker.ts).
    worker: { format: 'es' },
    build: shipped,
    plugins: [react()]
  }
})
