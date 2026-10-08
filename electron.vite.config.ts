import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { RENDERER_CONTENT_POLICY } from './src/shared/contentPolicy'

// The bundle that ships is minified, and never carries source maps. electron-vite's defaults
// are the opposite of both — good for a debugger, but the output of an unminified production
// build is the source with the comments taken out, one `npx asar extract` away, and a source
// map hands the original names and comments straight back. Neither is a secret store: what is
// shipped can be read by whoever runs it. This only makes reading it work rather than
// automatic, so that the code being copied is a decision rather than an accident.
const shipped = { minify: 'esbuild', sourcemap: false } as const

// The built page states what it may load and run (see src/shared/contentPolicy.ts). Build
// only: the development server's hot reload is an inline script and a socket, which is
// what the policy exists to refuse.
const contentPolicy: Plugin = {
  name: 'cuerunner-content-policy',
  apply: 'build',
  transformIndexHtml: () => [{
    tag: 'meta',
    attrs: { 'http-equiv': 'Content-Security-Policy', content: RENDERER_CONTENT_POLICY },
    injectTo: 'head-prepend'
  }]
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: shipped
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // Two preloads: the control window's bridge, and the output windows' smaller one.
    build: {
      ...shipped,
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          output: resolve('src/preload/output.ts')
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    // Script cues run in a module worker (see engine/scriptWorker.ts).
    worker: { format: 'es' },
    // Two pages: the control window, and the page every video output (and the floating
    // timer) draws in — src/renderer/output.html.
    build: {
      ...shipped,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          output: resolve('src/renderer/output.html')
        }
      }
    },
    plugins: [react(), contentPolicy]
  }
})
