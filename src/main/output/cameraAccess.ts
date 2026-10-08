// Who may open a camera: the output windows, for pictures, and nobody else.
//
// Electron grants every permission a page asks for unless main says otherwise, which would give
// the control window — a page that renders text from show files and from consoles on the network
// — the machine's cameras and microphones for the asking. So the session answers a media request
// here: video from an output window is granted (that is what a Camera cue is), and anything else
// — a microphone, a request from the control window, a request for a screen — is refused. The
// other permissions keep Electron's own answers; this rule is about capture devices.
//
// A development build can be told to use Chromium's fake capture device instead of hardware
// (`CUERUNNER_TEST_FAKE_CAMERA`), so the acceptance suite runs a Camera cue on a machine with no
// camera; a packaged build never reads it.

import { BrowserWindow, systemPreferences } from 'electron'
import { isOutputWindow } from './OutputManager'

/** What decides a media request, apart from Electron: who asked, and for what. */
export function allowsMedia(fromOutput: boolean, mediaTypes: readonly string[] | undefined): boolean {
  if (!fromOutput) return false
  const types = mediaTypes ?? []
  // A request that names no type is a check for "any camera access": an output may enumerate.
  return types.every(type => type === 'video')
}

function fromOutputWindow(contents: Electron.WebContents | null): boolean {
  if (contents === null) return false
  try {
    return isOutputWindow(BrowserWindow.fromWebContents(contents))
  } catch {
    return false
  }
}

/** Installs the session's answers to camera requests. Called once the app is ready. */
export function installCameraPermissions(session: Electron.Session): void {
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission !== 'media') {
      callback(true)
      return
    }
    const mediaTypes = 'mediaTypes' in details ? (details.mediaTypes as string[] | undefined) : undefined
    const allowed = allowsMedia(fromOutputWindow(contents), mediaTypes)
    if (!allowed || process.platform !== 'darwin') {
      callback(allowed)
      return
    }
    // macOS asks the person at the machine once, and remembers: the app's own grant is only
    // half of it.
    void systemPreferences.askForMediaAccess('camera').then(granted => callback(granted), () => callback(false))
  })
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (permission !== 'media') return true
    const mediaType = (details as { mediaType?: string }).mediaType
    return allowsMedia(fromOutputWindow(contents), mediaType === undefined || mediaType === 'unknown' ? [] : [mediaType])
  })
}

/**
 * The Chromium switches a development build is told to add for a fake camera, or none. `1` is
 * Chromium's own moving test card; a path is a `.y4m` or `.mjpeg` file played as the camera's
 * picture, so a spec can read a known colour off the output.
 */
export function fakeCameraSwitches(packaged: boolean, env: NodeJS.ProcessEnv): Array<[string, string?]> {
  const fake = packaged ? undefined : env['CUERUNNER_TEST_FAKE_CAMERA']
  if (fake === undefined || fake === '') return []
  const switches: Array<[string, string?]> = [['use-fake-device-for-media-stream'], ['use-fake-ui-for-media-stream']]
  if (fake !== '1') switches.push(['use-file-for-fake-video-capture', fake])
  return switches
}
