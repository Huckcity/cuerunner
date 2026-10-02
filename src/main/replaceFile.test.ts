// A rename that is refused for a moment because someone else has the destination open is not a
// failed write. These hold which errors are waited out, that others are not, and that the wait ends.
import { describe, expect, it, vi } from 'vitest'
import { replaceFile } from './replaceFile'

const refusal = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code })

describe('replaceFile', () => {
  it('moves the file the first time when nothing is in the way', async () => {
    const rename = vi.fn().mockResolvedValue(undefined)

    await replaceFile('a.tmp', 'a', { rename, delayMs: 0 })

    expect(rename).toHaveBeenCalledTimes(1)
    expect(rename).toHaveBeenCalledWith('a.tmp', 'a')
  })

  it.each(['EPERM', 'EBUSY', 'EACCES'])('waits out a destination that is held for a moment (%s)', async code => {
    const rename = vi.fn().mockRejectedValueOnce(refusal(code)).mockRejectedValueOnce(refusal(code)).mockResolvedValue(undefined)

    await expect(replaceFile('a.tmp', 'a', { rename, delayMs: 0 })).resolves.toBeUndefined()

    expect(rename).toHaveBeenCalledTimes(3)
  })

  it('gives up after a few tries, and says what the last refusal was', async () => {
    const rename = vi.fn().mockRejectedValue(refusal('EPERM'))

    await expect(replaceFile('a.tmp', 'a', { rename, attempts: 4, delayMs: 0 })).rejects.toMatchObject({ code: 'EPERM' })

    expect(rename).toHaveBeenCalledTimes(4)
  })

  it('does not retry an error that waiting cannot fix', async () => {
    const rename = vi.fn().mockRejectedValue(refusal('ENOENT'))

    await expect(replaceFile('a.tmp', 'a', { rename, delayMs: 0 })).rejects.toMatchObject({ code: 'ENOENT' })

    expect(rename).toHaveBeenCalledTimes(1)
  })

  it('does not retry an error with no code at all', async () => {
    const rename = vi.fn().mockRejectedValue(new Error('something else'))

    await expect(replaceFile('a.tmp', 'a', { rename, delayMs: 0 })).rejects.toThrow('something else')

    expect(rename).toHaveBeenCalledTimes(1)
  })
})
