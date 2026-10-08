// The stage's half of round two: a picture's blend mode reaching the frame, a fade cue's move
// and a cue's keyframes placing it, and a live picture's feed — opened, waited on, said to be
// missing, and let go of — held on text layers and a fake camera, which need no decoder.
import { describe, expect, it } from 'vitest'
import { Stage, type StageHost } from './stage'
import type { LayerSpec, OutputEvent } from '../../../shared/ipc/output'
import { createOutput, defaultGeometry } from '../../../shared/visual'
import type { CameraFeedState, LayerCamera } from '../../../shared/camera'
import type { CameraFeed, CameraFeeds, FeedReport } from './cameraFeeds'

function textLayer(cueId: string, patch: Partial<LayerSpec> = {}): LayerSpec {
  return {
    cueId, outputId: 'o1', kind: 'text', seq: 1, layer: 1, opacity: 1, geometry: defaultGeometry(),
    fadeInMs: 0, fadeOutMs: 0, crossfade: false, at: 1000, src: null, timeline: null, elapsedMs: 0,
    holdLastFrame: false, displayMs: null,
    text: { text: cueId, fontFamily: 'IBM Plex Sans', fontSize: 50, color: '#ffffff', bold: false, italic: false, position: 'center' },
    ...patch
  }
}

/** A camera that does what the test tells it, when it tells it. */
class FakeFeeds {
  opened: Array<{ camera: LayerCamera; report: FeedReport; feed: FakeFeed }> = []
  open(camera: LayerCamera, report: FeedReport): CameraFeed {
    const feed = new FakeFeed()
    this.opened.push({ camera, report, feed })
    // The real feeds say they are connecting before `open` has returned; so does this one.
    report('connecting', '')
    if (camera.url.startsWith('rtsp:')) {
      feed.state = 'unsupported'
      report('unsupported', 'RTSP is not something this build can play')
    }
    return feed
  }
}

class FakeFeed implements CameraFeed {
  element: HTMLVideoElement | null = null
  state: CameraFeedState = 'connecting'
  name = 'Stage cam'
  width = 0
  height = 0
  closed = false
  size(): { width: number; height: number } { return { width: this.width, height: this.height } }
  close(): void { this.closed = true }
  live(report: FeedReport): void {
    this.element = document.createElement('video')
    this.width = 1280
    this.height = 720
    this.state = 'live'
    report('live', '')
  }
}

function stageAt(cameras?: FakeFeeds): { stage: Stage; events: OutputEvent[]; at: (ms: number) => void } {
  let now = 0
  const events: OutputEvent[] = []
  const host: StageHost = {
    now: () => now,
    toEngine: local => local,
    emit: event => events.push(event),
    release: () => {},
    ...(cameras === undefined ? {} : { cameras: cameras as unknown as CameraFeeds })
  }
  const stage = new Stage(host)
  stage.configure(createOutput('o1', 'Stage'), 1920, 1080)
  return { stage, events, at: ms => { now = ms } }
}

function single(stage: Stage) {
  const frame = stage.frame()
  if (frame.plan.kind !== 'single') throw new Error('expected one stack')
  return frame.plan.draws
}

describe('a picture\'s blend mode', () => {
  it('reaches the frame with the picture, normal where it names none, and changes while it is up', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1') })
    stage.apply({ op: 'play', layer: textLayer('t2', { seq: 2, blend: 'screen' }) })
    at(1000)
    expect(single(stage).map(item => [item.key, item.blend])).toEqual([['t1', 'normal'], ['t2', 'screen']])
    stage.apply({ op: 'update', cueId: 't1', patch: { blend: 'difference' } })
    expect(single(stage)[0].blend).toBe('difference')
  })
})

describe('a picture\'s geometry over time', () => {
  it('moves along its keyframes from its first frame, held still while the picture is', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1', { keyframes: [{ atMs: 1000, x: 0.5, y: 0, scale: 1, rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, easing: 'linear' }] }) })
    at(1000)
    stage.frame()
    at(1500)
    expect(stage.geometry('t1')?.x).toBeCloseTo(0.25)
    stage.apply({ op: 'pause', cueId: 't1', at: 1500 })
    at(3000)
    expect(stage.geometry('t1')?.x).toBeCloseTo(0.25)
    stage.apply({ op: 'resume', cueId: 't1', at: 3000 })
    at(3250)
    expect(stage.geometry('t1')?.x).toBeCloseTo(0.375)
    at(9000)
    expect(stage.geometry('t1')?.x).toBeCloseTo(0.5)
  })

  it('takes a fade cue\'s move from where the picture is, and places it there in the frame', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1') })
    at(1000)
    const before = single(stage)[0].placement.transform
    stage.apply({ op: 'move', cueId: 't1', to: { x: 0.25, rotation: 90 }, durationMs: 1000, curve: 'linear', at: 1000 })
    at(1500)
    expect(stage.geometry('t1')).toEqual(expect.objectContaining({ x: expect.closeTo(0.125, 6), rotation: expect.closeTo(45, 6) }))
    at(2000)
    const after = single(stage)[0].placement.transform
    // A quarter of the output's width to the right of where it was: the frame is drawn from it.
    const centre = (m: number[]): number => m[4] + 0.5 * (m[0] + m[2])
    expect(centre(after) - centre(before)).toBeCloseTo(1920 * 0.25)
  })

  it('gives a moved property back to an edit, and keeps the move\'s others', () => {
    const { stage, at } = stageAt()
    stage.apply({ op: 'play', layer: textLayer('t1') })
    at(1000)
    stage.frame()
    stage.apply({ op: 'move', cueId: 't1', to: { x: 0.25, scale: 2 }, durationMs: 0, curve: 'linear', at: 1000 })
    stage.apply({ op: 'update', cueId: 't1', patch: { geometry: { ...defaultGeometry(), x: -0.1 } } })
    expect(stage.geometry('t1')).toEqual(expect.objectContaining({ x: -0.1, scale: 2 }))
  })
})

describe('a live picture', () => {
  const camera: LayerCamera = { source: 'device', deviceId: '', deviceName: 'Stage cam', url: '' }

  it('opens its camera and goes up on its first frame, saying it is live', () => {
    const feeds = new FakeFeeds()
    const { stage, events, at } = stageAt(feeds)
    stage.apply({ op: 'play', layer: textLayer('c1', { kind: 'camera', text: null, camera }) })
    at(1000)
    expect(single(stage)).toEqual([])
    expect(feeds.opened).toHaveLength(1)
    feeds.opened[0].feed.live(feeds.opened[0].report)
    at(1010)
    expect(single(stage).map(item => item.key)).toEqual(['c1'])
    expect(events).toContainEqual({ kind: 'camera', cueId: 'c1', outputId: 'o1', state: 'live', message: '' })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'first-frame', cueId: 'c1' }))
    expect(stage.cameras()).toEqual([{ cueId: 'c1', state: 'live', device: 'Stage cam' }])
  })

  it('says across the output when its camera is not connected, and lets go of it when it is stopped', () => {
    const feeds = new FakeFeeds()
    const { stage, events, at } = stageAt(feeds)
    stage.apply({ op: 'play', layer: textLayer('c1', { kind: 'camera', text: null, camera }) })
    feeds.opened[0].report('missing', 'Camera Stage cam is not connected')
    expect(stage.cameraLines()).toEqual(['Camera Stage cam is not connected'])
    expect(events).toContainEqual({ kind: 'camera', cueId: 'c1', outputId: 'o1', state: 'missing', message: 'Camera Stage cam is not connected' })
    stage.apply({ op: 'stop', cueId: 'c1', fadeMs: 0, at: 1 })
    at(2000)
    stage.frame()
    expect(feeds.opened[0].feed.closed).toBe(true)
    expect(stage.cameraLines()).toEqual([])
  })

  it('hears a feed that answers as it opens, before it is handed back', () => {
    const feeds = new FakeFeeds()
    const { stage, events } = stageAt(feeds)
    stage.apply({ op: 'play', layer: textLayer('c1', { kind: 'camera', text: null, camera: { ...camera, source: 'url', url: 'rtsp://cam/1' } }) })
    expect(events).toContainEqual(expect.objectContaining({ kind: 'camera', cueId: 'c1', state: 'unsupported' }))
    expect(stage.cameraLines()).toEqual(['RTSP is not something this build can play'])
  })

  it('hands a camera opened ahead of its GO to the picture, rather than opening it twice', () => {
    const feeds = new FakeFeeds()
    const { stage, at } = stageAt(feeds)
    stage.apply({ op: 'prepare', layer: textLayer('c1', { kind: 'camera', text: null, camera, at: 0 }) })
    feeds.opened[0].feed.live(feeds.opened[0].report)
    stage.apply({ op: 'play', layer: textLayer('c1', { kind: 'camera', text: null, camera }) })
    expect(feeds.opened).toHaveLength(1)
    at(1000)
    expect(single(stage).map(item => item.key)).toEqual(['c1'])
  })
})
