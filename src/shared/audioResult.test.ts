import { describe, expect, it } from 'vitest'
import { refusalFrom, unwrapAudioResult } from './audioResult'

describe('the audio result envelope', () => {
  it('gives back what the engine answered', () => {
    expect(unwrapAudioResult({ ok: true, value: { sampleMs: 40 } })).toEqual({ sampleMs: 40 })
  })

  it('turns a refusal back into the exception callers catch today, with its code', () => {
    let thrown: unknown
    try {
      unwrapAudioResult({ ok: false, code: 'device', message: 'device configuration is unavailable with the silent backend' })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).name).toBe('AudioEngineError')
    expect((thrown as Error).message).toBe('device configuration is unavailable with the silent backend')
    expect((thrown as Error & { code: string }).code).toBe('device')
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
