import { describe, expect, it } from 'vitest'
import { audioEngineError, isAudioRefusal, refusalFrom, unwrapAudioResult } from './audioResult'

describe('the audio result envelope', () => {
  it('gives back what the engine answered', () => {
    expect(unwrapAudioResult({ ok: true, value: { sampleMs: 40 } })).toEqual({ sampleMs: 40 })
  })

  // The preload's half. What it throws has to cross the context bridge, which copies an
  // Error by its message and drops everything else — so the refusal goes as itself.
  it('hands a refusal on as the value it is, so its code survives the context bridge', () => {
    const refusal = { ok: false as const, code: 'decode', message: 'unrecognised media format' }
    let thrown: unknown
    try {
      unwrapAudioResult(refusal)
    } catch (error) {
      thrown = error
    }
    expect(thrown).not.toBeInstanceOf(Error)
    expect(thrown).toEqual(refusal)
    // Plain data, which is the only thing the bridge is certain to carry whole.
    expect(structuredClone(thrown)).toEqual(refusal)
  })

  // The window's half.
  it('turns a refusal back into the exception callers catch today, with its code', () => {
    const error = audioEngineError({
      ok: false,
      code: 'device',
      message: 'device configuration is unavailable with the silent backend'
    })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).toBe('AudioEngineError')
    expect((error as Error).message).toBe('device configuration is unavailable with the silent backend')
    expect((error as Error & { code: string }).code).toBe('device')
  })

  it('leaves anything that is not a refusal as it was caught', () => {
    const fault = new Error('boom')
    expect(audioEngineError(fault)).toBe(fault)
    expect(audioEngineError('a string, somehow')).toBe('a string, somehow')
    expect(audioEngineError(null)).toBeNull()
    // A result that answered is not a refusal, and neither is half of one.
    expect(isAudioRefusal({ ok: true, value: 1 })).toBe(false)
    expect(isAudioRefusal({ ok: false, message: 'no code' })).toBe(false)
  })

  it('keeps the engine’s own code, and calls anything else an engine refusal', () => {
    class Coded extends Error {
      constructor(readonly code: string, message: string) {
        super(message)
      }
    }
    expect(refusalFrom(new Coded('device', 'no devices here'))).toEqual({
      ok: false,
      code: 'device',
      message: 'no devices here'
    })
    expect(refusalFrom(new Error('boom'))).toEqual({ ok: false, code: 'engine', message: 'boom' })
    expect(refusalFrom('a string, somehow')).toEqual({ ok: false, code: 'engine', message: 'a string, somehow' })
  })
})
