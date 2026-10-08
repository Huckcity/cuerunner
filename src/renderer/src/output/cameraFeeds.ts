// Live pictures on an output: a capture device opened with `getUserMedia`, or a network stream
// read through main's stream scheme. The output window is the only page the app lets open a
// camera (src/main/output/cameraAccess.ts), so this is where a Camera cue's picture comes from.
//
// A feed is a video element (or, for an MJPEG stream, an image element that Chromium redraws
// with every frame the camera sends) and a state the cue is told: connecting, live, or why it
// is not. A device that is not plugged in is not a failure the show stops for: the output says
// so across itself, and the feed comes up by itself when the device is connected — Chromium
// tells every page when the devices change, and every waiting feed looks again.

import { cameraBanner, isRtsp, looksLikeMjpeg, resolveCameraDevice, type CameraDevice, type CameraFeedState, type LayerCamera } from '../../../shared/camera'

/** One live picture, and the element it draws from. */
export interface CameraFeed {
  /** The element frames are read from; it can change once (a stream read as video, then as MJPEG). */
  readonly element: HTMLVideoElement | HTMLImageElement | null
  readonly state: CameraFeedState
  /** The device it opened, or the stream's address: what the banner names. */
  readonly name: string
  /** Its frame size, once it is giving frames. */
  size(): { width: number; height: number }
  close(): void
}

/** What a feed reports as it goes. */
export type FeedReport = (state: CameraFeedState, message: string) => void

/** The browser half the feeds use: a seam for the tests, the window's own otherwise. */
export interface MediaDevicesLike {
  enumerateDevices(): Promise<Array<{ kind: string; deviceId: string; label: string }>>
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  addEventListener(type: 'devicechange', listener: () => void): void
}

/** The ideal size asked of a capture device: an HD capture card's, which a webcam scales down from. */
const IDEAL = { width: 1920, height: 1080 }

export class CameraFeeds {
  private devices: CameraDevice[] = []
  private listed = false
  private readonly waiting = new Set<() => void>()
  private readonly listeners = new Set<(devices: CameraDevice[]) => void>()

  constructor(private readonly media: MediaDevicesLike | null) {
    media?.addEventListener('devicechange', () => { void this.refresh() })
  }

  /** Subscribes to the device list, as it is now and whenever it changes. */
  onDevices(listener: (devices: CameraDevice[]) => void): void {
    this.listeners.add(listener)
    if (this.listed) listener(this.devices)
  }

  /** Reads the capture devices again, and lets every waiting feed look for its own. */
  async refresh(): Promise<CameraDevice[]> {
    if (this.media === null) return []
    try {
      const all = await this.media.enumerateDevices()
      this.devices = all
        .filter(device => device.kind === 'videoinput' && device.deviceId !== '')
        .map((device, index) => ({ deviceId: device.deviceId, label: device.label !== '' ? device.label : `Camera ${index + 1}` }))
    } catch {
      this.devices = []
    }
    this.listed = true
    for (const listener of [...this.listeners]) listener(this.devices)
    for (const retry of [...this.waiting]) retry()
    return this.devices
  }

  /** Opens a live picture. It reports as it goes, and comes up when it can. */
  open(camera: LayerCamera, report: FeedReport): CameraFeed {
    return camera.source === 'url' ? this.openStream(camera, report) : this.openDevice(camera, report)
  }

  private openDevice(camera: LayerCamera, report: FeedReport): CameraFeed {
    const name = camera.deviceName.trim()
    let state: CameraFeedState = 'connecting'
    let video: HTMLVideoElement | null = null
    let stream: MediaStream | null = null
    let closed = false
    let opening = false
    const set = (next: CameraFeedState): void => {
      if (closed || next === state && next !== 'connecting') return
      state = next
      report(next, cameraBanner(next, name))
    }
    const stopStream = (): void => {
      for (const track of stream?.getTracks() ?? []) track.stop()
      stream = null
    }
    const attempt = (): void => {
      if (closed || opening || stream !== null) return
      const device = resolveCameraDevice(camera, this.devices)
      if (device === null) {
        // Not listed yet is not the same as not there: the first look decides.
        if (this.listed) set('missing')
        return
      }
      opening = true
      const media = this.media
      if (media === null) { set('failed'); return }
      void media.getUserMedia({
        audio: false,
        video: { deviceId: { exact: device.deviceId }, width: { ideal: IDEAL.width }, height: { ideal: IDEAL.height } }
      }).then(opened => {
        opening = false
        if (closed) {
          for (const track of opened.getTracks()) track.stop()
          return
        }
        stream = opened
        const element = video ?? document.createElement('video')
        element.muted = true
        element.playsInline = true
        element.disablePictureInPicture = true
        element.srcObject = opened
        video = element
        // A cable pulled mid-show ends the track: the output says so, and the feed waits.
        for (const track of opened.getVideoTracks()) {
          track.addEventListener('ended', () => {
            stopStream()
            set('missing')
          })
        }
        element.addEventListener('playing', () => set('live'), { once: true })
        void element.play().catch(() => {})
      }, (error: unknown) => {
        opening = false
        const kind = (error as { name?: string } | null)?.name
        set(kind === 'NotFoundError' || kind === 'OverconstrainedError' ? 'missing' : kind === 'NotAllowedError' || kind === 'NotReadableError' || kind === 'SecurityError' ? 'denied' : 'failed')
      })
    }
    this.waiting.add(attempt)
    report('connecting', '')
    if (this.listed) attempt()
    else void this.refresh()
    return {
      get element() { return video },
      get state() { return state },
      name,
      size: () => ({ width: video?.videoWidth ?? 0, height: video?.videoHeight ?? 0 }),
      close: () => {
        closed = true
        this.waiting.delete(attempt)
        stopStream()
        if (video !== null) {
          video.pause()
          video.srcObject = null
        }
      }
    }
  }

  private openStream(camera: LayerCamera, report: FeedReport): CameraFeed {
    const name = camera.deviceName.trim() !== '' ? camera.deviceName.trim() : camera.url
    let state: CameraFeedState = 'connecting'
    let element: HTMLVideoElement | HTMLImageElement | null = null
    let closed = false
    const set = (next: CameraFeedState): void => {
      if (closed || next === state) return
      state = next
      report(next, cameraBanner(next, name))
    }
    const asImage = (): void => {
      if (closed) return
      const image = new Image()
      image.crossOrigin = 'anonymous'
      image.addEventListener('load', () => set('live'))
      image.addEventListener('error', () => set('failed'))
      image.src = camera.url
      element = image
    }
    const asVideo = (): void => {
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      video.crossOrigin = 'anonymous'
      video.disablePictureInPicture = true
      video.autoplay = true
      video.addEventListener('playing', () => set('live'))
      // A stream the video element cannot read is tried as MJPEG, which only an image reads.
      video.addEventListener('error', () => {
        video.removeAttribute('src')
        video.load()
        asImage()
      }, { once: true })
      video.src = camera.url
      void video.play().catch(() => {})
      element = video
    }
    report('connecting', '')
    if (isRtsp(camera.url)) set('unsupported')
    else if (looksLikeMjpeg(camera.url)) asImage()
    else asVideo()
    return {
      get element() { return element },
      get state() { return state },
      name,
      size: () => {
        if (element instanceof HTMLVideoElement) return { width: element.videoWidth, height: element.videoHeight }
        if (element instanceof HTMLImageElement) return { width: element.naturalWidth, height: element.naturalHeight }
        return { width: 0, height: 0 }
      },
      close: () => {
        closed = true
        if (element instanceof HTMLVideoElement) {
          element.pause()
          element.removeAttribute('src')
          element.load()
        } else if (element instanceof HTMLImageElement) {
          // An MJPEG stream keeps its connection open for as long as the image has it.
          element.src = ''
        }
      }
    }
  }
}
