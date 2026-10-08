// The Camera cue's source: a capture device on this machine — a webcam, a USB camera, an HDMI
// capture card — or a network stream, shown live on an output like any other picture.
//
// A device has two names. The one its driver gives it ("Blackmagic UltraStudio", "HD Pro
// Webcam C920") travels with the show, because it is what the operator chose and what another
// machine's driver will most likely call the same camera. The id Chromium gives it is this
// machine's alone — it is salted per machine and per install — so it is kept in userData by
// cue id (spine AD-14, AD-27), and a show opened on the venue machine finds its camera by name
// until the operator picks it there once.
//
// A network stream is read the way Chromium reads one: HTTP(S) progressive video, HLS where
// this build's Chromium plays it, and MJPEG (an `multipart/x-mixed-replace` stream of JPEGs,
// what most IP cameras and phone camera apps serve). It reaches the output through main's own
// scheme (`cuerunner-stream:`), which adds the one header a picture needs to be drawn on the
// GPU and read back, and which only passes a stream a cue on the show has named. RTSP is not
// something Chromium speaks, and this build has no decoder of its own for it: a cue that names
// one says so rather than showing black.

/** Where a camera cue's picture comes from. */
export type CameraSourceKind = 'device' | 'url'

/** A capture device as an output window enumerates it. */
export interface CameraDevice {
  deviceId: string
  label: string
}

/** What a camera picture is told: the source, and this machine's id for the device if it has one. */
export interface LayerCamera {
  source: CameraSourceKind
  /** This machine's id for the device, from userData, or '' when it has not been chosen here. */
  deviceId: string
  /** The device's name as the show carries it. */
  deviceName: string
  /** The stream's address, for a network source. */
  url: string
}

/** How a camera picture is getting on, as its output reports it. */
export type CameraFeedState =
  /** Asked for, not yet giving frames. */
  | 'connecting'
  | 'live'
  /** The device the cue names is not connected to this machine. */
  | 'missing'
  /** The machine refused the camera: an OS privacy setting, or a device another program holds. */
  | 'denied'
  /** The stream could not be opened or stopped giving frames. */
  | 'failed'
  /** An address this build cannot play (RTSP). */
  | 'unsupported'

/** The device a cue's picture should open: this machine's id if it is still there, else the same name. */
export function resolveCameraDevice(
  wanted: { deviceId: string; deviceName: string },
  devices: readonly CameraDevice[]
): CameraDevice | null {
  if (wanted.deviceId !== '') {
    const exact = devices.find(device => device.deviceId === wanted.deviceId)
    if (exact !== undefined) return exact
  }
  const name = wanted.deviceName.trim()
  if (name === '') return null
  return devices.find(device => device.label === name)
    // A driver that adds the bus or a number after the name ("HD Webcam (046d:0825)") is still
    // the same camera to the operator: the name it was chosen under, at the start, is enough.
    ?? devices.find(device => device.label.startsWith(name))
    ?? null
}

/** The line an output draws across itself while a camera picture cannot be shown. */
export function cameraBanner(state: CameraFeedState, name: string): string {
  const what = name.trim() === '' ? 'The camera' : name.trim()
  switch (state) {
    case 'missing':
      return `Camera ${what} is not connected`
    case 'denied':
      return `${what} could not be opened — another program may have it, or the system is refusing camera access`
    case 'failed':
      return `${what} is not giving a picture`
    case 'unsupported':
      return `${what}: RTSP is not something this build can play — use the camera's HTTP, MJPEG or HLS address`
    case 'connecting':
    case 'live':
      return ''
  }
}

/** The scheme network streams reach an output through (src/main/output/streamProtocol.ts). */
export const STREAM_SCHEME = 'cuerunner-stream'

/** Whether an address is RTSP (or its secured form): a stream this build cannot play. */
export function isRtsp(url: string): boolean {
  return /^rtsps?:\/\//i.test(url.trim())
}

/**
 * The address an output reads a network stream through: `cuerunner-stream://<scheme>/<host>/<path>`.
 * The host and path stay a path, so a playlist's relative segments (HLS) resolve against it.
 * Null for an address that is not HTTP or HTTPS.
 */
export function streamUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // Credentials in the address are the camera's login: main passes them on when it fetches
  // (src/main/output/streamProtocol.ts), and they never go into an address the page can read.
  return `${STREAM_SCHEME}://${parsed.protocol.slice(0, -1)}/${parsed.host}${parsed.pathname}${parsed.search}`
}

/** The address a stream URL stands for, without credentials, or null for one that is not a stream URL. */
export function streamTarget(proxied: string): string | null {
  const prefix = `${STREAM_SCHEME}://`
  if (!proxied.startsWith(prefix)) return null
  const rest = proxied.slice(prefix.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return null
  const scheme = rest.slice(0, slash).toLowerCase()
  if (scheme !== 'http' && scheme !== 'https') return null
  const remainder = rest.slice(slash + 1)
  if (remainder === '') return null
  try {
    const target = new URL(`${scheme}://${remainder}`)
    return target.toString()
  } catch {
    return null
  }
}

/** The origin a stream's every request must be on: what a cue's address allows main to fetch. */
export function streamOrigin(url: string): string | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed.origin
  } catch {
    return null
  }
}

/**
 * Whether a stream is served as a run of JPEGs rather than as video: read off its address, the
 * way the cameras that serve one name it. An address that says neither is tried as video first,
 * and as MJPEG when the video element cannot read it.
 */
export function looksLikeMjpeg(url: string): boolean {
  return /mjpe?g|\.cgi(\?|$)|action=stream|video\.jpg|faststream/i.test(url)
}

/** Why a camera cue cannot start, or null when it can. */
export function cameraSourceProblem(camera: { source: CameraSourceKind; deviceName: string; url: string }): string | null {
  if (camera.source === 'device') return camera.deviceName.trim() === '' ? 'no camera chosen' : null
  const url = camera.url.trim()
  if (url === '') return 'no stream address'
  if (isRtsp(url)) return 'RTSP streams are not supported — use the camera\'s HTTP, MJPEG or HLS address'
  return streamUrl(url) === null ? 'the stream address is not an http:// or https:// address' : null
}

/** The Camera cue's own defaults: a device, not chosen yet. */
export const CAMERA_DEFAULTS = {
  source: 'device' as CameraSourceKind,
  deviceName: '',
  url: ''
}
