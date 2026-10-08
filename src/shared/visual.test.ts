import { describe, expect, it } from 'vitest'
import {
  MAX_OUTPUTS,
  carriesMediaFile,
  createOutput,
  isImageFile,
  isVideoFile,
  isVisualCue,
  mediaPathOf,
  mediaUrl,
  normalizeVideoOutputs,
  outputFor
} from './visual'
import { CUE_TYPES } from './cue'

describe('a show\'s outputs as the window holds them', () => {
  it('keeps an output this build wrote exactly as it was', () => {
    const output = createOutput('out-1', 'Stage')
    expect(normalizeVideoOutputs([output])).toEqual([output])
  })

  it('holds a hand-edited output\'s numbers to their ranges and fills what is missing', () => {
    const [output] = normalizeVideoOutputs([{
      id: 'out-1',
      name: '',
      width: 99_999,
      height: 'tall',
      timer: { mode: 'stopwatch', position: 'middle', size: 9, color: 'red' },
      warp: { corners: [{ x: 5, y: -5 }], blend: { left: 0.9 }, gamma: 0 }
    }])
    expect(output.name).toBe('Output 1')
    expect(output.width).toBe(8192)
    expect(output.height).toBe(1080)
    expect(output.timer).toEqual({ mode: 'off', position: 'bottom-right', size: 0.5, color: '#ffffff' })
    expect(output.warp.corners).toEqual([{ x: 1, y: -1 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }])
    expect(output.warp.blend.left).toBe(0.5)
    expect(output.warp.gamma).toBe(0.1)
  })

  it('leaves out what is not an output, an id twice, and anything past the most a show has', () => {
    const many = Array.from({ length: MAX_OUTPUTS + 4 }, (_, i) => createOutput(`out-${i}`, `O${i}`))
    expect(normalizeVideoOutputs(many)).toHaveLength(MAX_OUTPUTS)
    expect(normalizeVideoOutputs([null, 7, { name: 'no id' }, createOutput('a', 'A'), createOutput('a', 'again')]).map(o => o.name)).toEqual(['A'])
    expect(normalizeVideoOutputs(undefined)).toEqual([])
  })

  it('sends a cue that names no output to the first, and one that names a gone output nowhere', () => {
    const outputs = [createOutput('a', 'A'), createOutput('b', 'B')]
    expect(outputFor(outputs, '')?.id).toBe('a')
    expect(outputFor(outputs, 'b')?.id).toBe('b')
    expect(outputFor(outputs, 'gone')).toBeNull()
    expect(outputFor([], '')).toBeNull()
  })
})

describe('media', () => {
  it('reads a path back out of its media URL, whatever it is spelled with', () => {
    for (const path of ['/shows/Act 1/clip.mp4', 'C:\\Shows\\Act 1\\clip #2.mov', '/a/b/ü.webm']) {
      expect(mediaPathOf(mediaUrl(path))).toBe(path)
    }
    expect(mediaPathOf('https://example.com/x.mp4')).toBeNull()
    expect(mediaPathOf('cuerunner-media://file/%E0%A4%A')).toBeNull()
  })

  it('tells video and image files by their names', () => {
    expect(isVideoFile('a.MP4')).toBe(true)
    expect(isVideoFile('a.webm')).toBe(true)
    expect(isVideoFile('a.wav')).toBe(false)
    expect(isImageFile('a.png')).toBe(true)
    expect(isImageFile('a.mp4')).toBe(false)
  })

  it('names the cue types that carry a file and the ones that draw a picture', () => {
    expect(CUE_TYPES.filter(type => carriesMediaFile({ type }))).toEqual(['audio', 'midiFile', 'video', 'image'])
    expect(CUE_TYPES.filter(type => isVisualCue({ type }))).toEqual(['video', 'image', 'text', 'camera'])
  })
})
