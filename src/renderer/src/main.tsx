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
import { useStore } from './store'

installRuntimeErrorReporting()

/**
 * The license decides which half of the app is on screen, so it is read before the
 * first frame rather than in an effect: a licensed window must not flash the locked
 * panels, and an unlicensed one must not draw a view that is about to be taken away.
 * The read is a local file in the main process, so this costs a round trip, not a wait.
 * If it fails, the store keeps its locked default and the app runs free — never the
 * other way round.
 */
void window.winslab.license.status()
  .then(status => useStore.getState().setLicense(status))
  .catch(() => {})
  .finally(() => {
    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </React.StrictMode>
    )
  })