// An output's mirror and its mask as a file carries them, the output a mirror shows, and the
// show's picture settings — what a load keeps, repairs and leaves out.
import { describe, expect, it } from 'vitest'
import {
  createOutput,
  isDefaultPictureSettings,
  normalizePictureSettings,
  normalizeVideoOutputs,
  outputFor,
  pictureSourceOf,
  stopsOnNextGo
} from './visual'

describe('a mirror and a mask', () => {
  it('keeps a mirror of an output with pictures of its own, and a mask, read as the file says', () => {
    const outputs = normalizeVideoOutputs([
      createOutput('stage', 'Stage'),
      { ...createOutput('desk', 'Desk'), mirrorOf: 'stage', mask: { filePath: '/masks/set.png', mode: 'alpha', invert: true } }
    ])
    expect(outputs[1].mirrorOf).toBe('stage')
    expect(outputs[1].mask).toEqual({ filePath: '/masks/set.png', mode: 'alpha', invert: true })
    expect(pictureSourceOf(outputs, 'desk')?.id).toBe('stage')
    expect(pictureSourceOf(outputs, 'stage')?.id).toBe('stage')
  })

  it('writes nothing for an output that mirrors nothing and has no mask: its bytes are what they were', () => {
    const [output] = normalizeVideoOutputs([createOutput('stage', 'Stage')])
    expect(Object.keys(output)).not.toContain('mirrorOf')
    expect(Object.keys(output)).not.toContain('mask')
  })

  it('drops a mirror of itself, of an output that is not there, or of another mirror, and a mask with no file', () => {
    const outputs = normalizeVideoOutputs([
      { ...createOutput('a', 'A'), mirrorOf: 'a' },
      { ...createOutput('b', 'B'), mirrorOf: 'gone' },
      { ...createOutput('c', 'C'), mirrorOf: 'd' },
      { ...createOutput('d', 'D'), mirrorOf: 'e' },
      { ...createOutput('e', 'E'), mask: { filePath: '', mode: 'luma', invert: false } }
    ])
    expect(outputs.map(output => output.mirrorOf)).toEqual([undefined, undefined, undefined, 'e', undefined])
    expect(outputs[4].mask).toBeUndefined()
    // A mask's reading is held to the two it can be.
    expect(normalizeVideoOutputs([{ ...createOutput('f', 'F'), mask: { filePath: '/m.png', mode: 'chroma' as never, invert: 'yes' as never } }])[0].mask)
      .toEqual({ filePath: '/m.png', mode: 'luma', invert: false })
  })

  it('sends a cue that names no output to the first with pictures of its own', () => {
    const outputs = normalizeVideoOutputs([{ ...createOutput('desk', 'Desk'), mirrorOf: 'stage' }, createOutput('stage', 'Stage')])
    expect(outputFor(outputs, '')?.id).toBe('stage')
  })
})

describe('the show\'s picture settings', () => {
  it('reads a file\'s settings, and a file without them as the default, which writes nothing', () => {
    expect(normalizePictureSettings(undefined)).toEqual({ stopOnNextGo: false })
    expect(normalizePictureSettings({ stopOnNextGo: true })).toEqual({ stopOnNextGo: true })
    expect(normalizePictureSettings({ stopOnNextGo: 'yes' })).toEqual({ stopOnNextGo: false })
    expect(isDefaultPictureSettings({ stopOnNextGo: false })).toBe(true)
  })

  it('lets a cue answer for itself, and follows the show where it does not', () => {
    expect(stopsOnNextGo({ stopOnNextGo: true }, { stopOnNextGo: false })).toBe(true)
    expect(stopsOnNextGo({ stopOnNextGo: false }, { stopOnNextGo: true })).toBe(false)
    expect(stopsOnNextGo({ stopOnNextGo: null }, { stopOnNextGo: true })).toBe(true)
    expect(stopsOnNextGo({}, { stopOnNextGo: false })).toBe(false)
  })
})
