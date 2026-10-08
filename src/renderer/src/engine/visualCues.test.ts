import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'
import { VisualRunner, layerSpecOf, livePatchOf, videoTimeline } from './visualCues'
import { defaultGeometry, type ImageCue, type TextCue, type VideoCue } from '../../../shared/visual'
import type { LayerCommand } from '../../../shared/ipc/output'

vi.mock('./audioEngineClient')

const base = {
  colorLabel: 'none' as const, parentId: null, preWait: 0, postWait: 0, timelineOffset: 0,
  advance: 'none' as const, isArmed: true, notes: '', outputId: 'o1', layer: 3, opacity: 0.8,
  fadeInDuration: 400, fadeOutDuration: 600, crossfade: true, geometry: defaultGeometry()
}

const video: VideoCue = {
  ...base, id: 'v1', number: '1', name: 'Clip', type: 'video', duration: 8000, filePath: '/m/clip.mp4',
  startTime: 1000, endTime: 5000, loopCount: 2, holdLastFrame: true, volume: 1, pan: 0, outputs: null
}
const image: ImageCue = { ...base, id: 'i1', number: '2', name: 'Still', type: 'image', duration: 3000, filePath: '/m/still.png' }
const text: TextCue = {
  ...base, id: 't1', number: '3', name: 'Title', type: 'text', duration: 0, text: 'Hi', fontFamily: 'X', fontSize: 40,
  color: '#ff0000', bold: true, italic: false, position: 'top-left'
}

describe('a picture as an output is told to show it', () => {
  it('carries a video\'s region and loops — the ones its sound plays', () => {
    expect(videoTimeline(video)).toEqual({ startMs: 1000, endMs: 5000, durationMs: 8000, loopCount: 2 })
    const spec = layerSpecOf(video, 12_345, 7)
    expect(spec).toEqual(expect.objectContaining({
      cueId: 'v1', outputId: 'o1', kind: 'video', seq: 7, layer: 3, opacity: 0.8, at: 12_345,
      src: 'cuerunner-media://file/%2Fm%2Fclip.mp4', holdLastFrame: true, fadeInMs: 400, fadeOutMs: 600, crossfade: true
    }))
  })

  it('shows an image for its duration, and text until it is stopped when it has none', () => {
    expect(layerSpecOf(image, 0, 1).displayMs).toBe(3000)
    expect(layerSpecOf(text, 0, 1).displayMs).toBeNull()
    expect(layerSpecOf(text, 0, 1).text).toEqual({
      text: 'Hi', fontFamily: 'X', fontSize: 40, color: '#ff0000', bold: true, italic: false, position: 'top-left'
    })
  })

  it('starts a picture part-way in without fading or dissolving it in again', () => {
    const spec = layerSpecOf(image, 0, 1, 1000)
    expect(spec.fadeInMs).toBe(0)
    expect(spec.crossfade).toBe(false)
    expect(spec.displayMs).toBe(2000)
    expect(spec.elapsedMs).toBe(1000)
  })

  it('applies to a picture that is up only what may change while it is', () => {
    expect(livePatchOf(text)).toEqual({ layer: 3, opacity: 0.8, geometry: defaultGeometry(), fadeOutMs: 600, text: expect.objectContaining({ text: 'Hi' }) })
    expect(livePatchOf(image)).not.toHaveProperty('text')
  })
})

describe('the picture runner', () => {
  const layer = (): Mock => window.cuerunner.output.layer as unknown as Mock
  beforeEach(() => {
    layer().mockClear()
    layer().mockImplementation(() => Promise.resolve({ ok: true }))
  })
  const sent = (): LayerCommand[] => layer().mock.calls.map(call => call[0] as LayerCommand)

  it('knows where a video has got to, through a pause and a seek', () => {
    const runner = new VisualRunner()
    void runner.play(video, 10_000)
    expect(runner.position('v1', 11_500)).toEqual({ positionMs: 2500, loop: 0 })
    runner.pause('v1', 12_000)
    expect(runner.isPaused('v1')).toBe(true)
    expect(runner.position('v1', 30_000)).toEqual({ positionMs: 3000, loop: 0 })
    runner.resume('v1', 40_000)
    expect(runner.position('v1', 43_500)).toEqual({ positionMs: 2500, loop: 1 })
    runner.seek('v1', 500, 50_000)
    expect(runner.elapsed('v1', 50_100)).toBe(600)
    expect(sent().map(command => command.op)).toEqual(['play', 'pause', 'resume', 'seek'])
  })

  it('lets go of a loop only on a video that loops', () => {
    const runner = new VisualRunner()
    void runner.play(video, 0)
    expect(runner.release('v1', 100)).toBe(true)
    void runner.play({ ...video, id: 'v2', loopCount: 0 }, 0)
    expect(runner.release('v2', 100)).toBe(false)
  })

  it('forgets a picture it stopped, and tells its host about one it did not', () => {
    const runner = new VisualRunner()
    const pictureGone = vi.fn()
    runner.init({ pictureGone, pictureEnded: vi.fn(), measured: vi.fn(), pictureFailed: vi.fn(), dissolving: vi.fn(), firstFrame: vi.fn() })
    void runner.play(image, 0)
    void runner.play(text, 0)
    runner.stop('i1', 250)
    expect(sent().at(-1)).toEqual(expect.objectContaining({ op: 'stop', cueId: 'i1', fadeMs: 250 }))
    runner.handle([{ kind: 'gone', cueId: 'i1', outputId: 'o1' }, { kind: 'gone', cueId: 't1', outputId: 'o1' }])
    expect(pictureGone).toHaveBeenCalledTimes(1)
    expect(pictureGone).toHaveBeenCalledWith('t1')
    expect(runner.isShowing('t1')).toBe(false)
  })

  it('opens a video ahead of its GO, and nothing else', () => {
    const runner = new VisualRunner()
    runner.prepare(image)
    runner.prepare({ ...video, filePath: '' })
    runner.prepare(video)
    expect(sent().map(command => command.op)).toEqual(['prepare'])
  })
})
