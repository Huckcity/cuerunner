// The app's type, bundled rather than borrowed. A show machine has no network to fetch a
// webfont from, and the system UI font is a different face on every platform the app
// ships for — which is why the same panel came out one size on Windows and another on
// macOS. Latin subsets, and only the weights App.css asks for: about 180 KB in all.
import '@fontsource/ibm-plex-sans/latin-400.css'
import '@fontsource/ibm-plex-sans/latin-500.css'
import '@fontsource/ibm-plex-sans/latin-600.css'
import '@fontsource/ibm-plex-sans-condensed/latin-600.css'
import '@fontsource/ibm-plex-sans-condensed/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installRuntimeErrorReporting } from './errors'
import { installDropGuard } from './utils/dropGuard'

installRuntimeErrorReporting()
// A file dropped where no surface takes it must not replace the window: see dropGuard.ts.
installDropGuard()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
