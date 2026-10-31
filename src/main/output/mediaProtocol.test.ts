import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { answerMediaRequest, contentTypeOf, parseRange, servable } from './mediaProtocol'
import { mediaUrl } from '../../shared/visual'

describe('the media scheme', () => {
  it('reads the one-range forms a media element sends', () => {
    expect(parseRange(null, 1000)).toBeNull()
    expect(parseRange('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 })
    expect(parseRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseRange('bytes=0-5000', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseRange('bytes=1000-', 1000)).toBe('unsatisfiable')
    expect(parseRange('bytes=0-1,5-9', 1000)).toBeNull()
  })

  it('serves only pictures, by their names', () => {
    expect(servable('/a/clip.mp4')).toBe(true)
    expect(servable('/a/still.PNG')).toBe(true)
    expect(servable('/etc/passwd')).toBe(false)
    expect(servable('/home/me/ew-dx.json')).toBe(false)
    expect(contentTypeOf('/a/b.webm')).toBe('video/webm')
  })

  it('answers a range with exactly the bytes asked for, and the whole file without one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cuerunner-media-scheme-'))
    try {
      const file = join(dir, 'clip.mp4')
      writeFileSync(file, Buffer.from('0123456789'))
      const ranged = answerMediaRequest(mediaUrl(file), 'bytes=2-5')
      expect(ranged.status).toBe(206)
      expect(ranged.headers.get('content-range')).toBe('bytes 2-5/10')
      expect(ranged.headers.get('content-type')).toBe('video/mp4')
      expect(ranged.headers.get('access-control-allow-origin')).toBe('*')
      expect(await ranged.text()).toBe('2345')
      const whole = answerMediaRequest(mediaUrl(file), null)
      expect(whole.status).toBe(200)
      expect(await whole.text()).toBe('0123456789')
      expect(answerMediaRequest(mediaUrl(file), 'bytes=50-').status).toBe(416)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('refuses a file that is not a picture, and one that is not there', () => {
    expect(answerMediaRequest(mediaUrl('/etc/passwd'), null).status).toBe(404)
    expect(answerMediaRequest(mediaUrl('/no/such/clip.mp4'), null).status).toBe(404)
    expect(answerMediaRequest('cuerunner-media://elsewhere/x.mp4', null).status).toBe(404)
  })
})
