// A camera cue's source: which device it opens on this machine, what an output says when it
// cannot, and how a network stream's address reaches the output through main.
import { describe, expect, it } from 'vitest'
import {
  cameraBanner,
  cameraSourceProblem,
  isRtsp,
  looksLikeMjpeg,
  resolveCameraDevice,
  streamOrigin,
  streamTarget,
  streamUrl
} from './camera'

const devices = [
  { deviceId: 'a1', label: 'FaceTime HD Camera' },
  { deviceId: 'b2', label: 'HD Pro Webcam C920 (046d:082d)' },
  { deviceId: 'c3', label: 'Blackmagic UltraStudio' }
]

describe('which device a camera cue opens', () => {
  it('opens this machine\'s own pick when it is still connected', () => {
    expect(resolveCameraDevice({ deviceId: 'c3', deviceName: 'FaceTime HD Camera' }, devices)?.deviceId).toBe('c3')
  })

  it('finds the camera by the name the show carries on a machine that has not picked it', () => {
    expect(resolveCameraDevice({ deviceId: '', deviceName: 'Blackmagic UltraStudio' }, devices)?.deviceId).toBe('c3')
    // A driver that adds the bus after the name is the same camera.
    expect(resolveCameraDevice({ deviceId: 'gone', deviceName: 'HD Pro Webcam C920' }, devices)?.deviceId).toBe('b2')
  })

  it('opens nothing for a camera that is not connected, or none chosen', () => {
    expect(resolveCameraDevice({ deviceId: 'gone', deviceName: 'Sony FX3' }, devices)).toBeNull()
    expect(resolveCameraDevice({ deviceId: '', deviceName: '' }, devices)).toBeNull()
    expect(resolveCameraDevice({ deviceId: '', deviceName: 'FaceTime HD Camera' }, [])).toBeNull()
  })
})

describe('what an output says about a camera it cannot show', () => {
  it('names the camera and what is wrong, and says nothing while it is live or coming up', () => {
    expect(cameraBanner('missing', 'Stage cam')).toBe('Camera Stage cam is not connected')
    expect(cameraBanner('denied', 'Stage cam')).toContain('could not be opened')
    expect(cameraBanner('failed', '')).toBe('The camera is not giving a picture')
    expect(cameraBanner('unsupported', 'rtsp://cam')).toContain('RTSP')
    expect(cameraBanner('live', 'Stage cam')).toBe('')
    expect(cameraBanner('connecting', 'Stage cam')).toBe('')
  })
})

describe('a network stream', () => {
  it('is read through main\'s scheme, its host and path kept as a path so a playlist\'s segments resolve', () => {
    const proxied = streamUrl('http://10.0.0.20:8080/live/index.m3u8?token=1')
    expect(proxied).toBe('cuerunner-stream://http/10.0.0.20:8080/live/index.m3u8?token=1')
    expect(streamTarget(proxied!)).toBe('http://10.0.0.20:8080/live/index.m3u8?token=1')
    // A segment named relative to the playlist resolves to the camera's own.
    expect(streamTarget(new URL('segment-3.ts', proxied!).toString())).toBe('http://10.0.0.20:8080/live/segment-3.ts')
  })

  it('never puts a login in an address the page can read', () => {
    const proxied = streamUrl('https://admin:secret@cam.local/video.mjpg')
    expect(proxied).toBe('cuerunner-stream://https/cam.local/video.mjpg')
    expect(streamOrigin('https://admin:secret@cam.local/video.mjpg')).toBe('https://cam.local')
  })

  it('refuses what is not HTTP or HTTPS', () => {
    expect(streamUrl('rtsp://cam.local/stream')).toBeNull()
    expect(streamUrl('file:///etc/passwd')).toBeNull()
    expect(streamUrl('not a url')).toBeNull()
    expect(streamTarget('cuerunner-stream://file/etc/passwd')).toBeNull()
    expect(streamTarget('cuerunner-media://file/x.png')).toBeNull()
  })

  it('reads an MJPEG camera\'s address as one, and RTSP as what this build cannot play', () => {
    expect(looksLikeMjpeg('http://cam/video.mjpg')).toBe(true)
    expect(looksLikeMjpeg('http://cam/axis-cgi/mjpg/video.cgi')).toBe(true)
    expect(looksLikeMjpeg('http://cam/?action=stream')).toBe(true)
    expect(looksLikeMjpeg('http://cam/live/index.m3u8')).toBe(false)
    expect(isRtsp('RTSP://cam/1')).toBe(true)
    expect(isRtsp('http://cam/1')).toBe(false)
  })
})

describe('why a camera cue cannot start', () => {
  it('says what is missing, and nothing for a source that can be opened', () => {
    expect(cameraSourceProblem({ source: 'device', deviceName: '', url: '' })).toBe('no camera chosen')
    expect(cameraSourceProblem({ source: 'device', deviceName: 'Stage cam', url: '' })).toBeNull()
    expect(cameraSourceProblem({ source: 'url', deviceName: '', url: '' })).toBe('no stream address')
    expect(cameraSourceProblem({ source: 'url', deviceName: '', url: 'rtsp://cam/1' })).toContain('RTSP')
    expect(cameraSourceProblem({ source: 'url', deviceName: '', url: 'ftp://cam/1' })).toContain('http')
    expect(cameraSourceProblem({ source: 'url', deviceName: '', url: 'http://cam/video.mjpg' })).toBeNull()
  })
})
