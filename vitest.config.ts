import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  // The renderer is built with @vitejs/plugin-react, which uses the automatic runtime;
  // the root tsconfig says "preserve", so tests would otherwise fall back to
  // React.createElement and fail on any file that does not import React.
  esbuild: { jsx: 'automatic' },
  test: {
    // A hosted Windows runner has taken more than the default 10 seconds over one file's setup.
    hookTimeout: process.env.CI ? 30_000 : 10_000,
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/renderer/src/engine/**', 'src/renderer/src/store/**', 'src/renderer/src/utils/**'],
      reporter: ['text', 'html']
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  }
})
