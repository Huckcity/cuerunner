// The remote's panic, which main answers itself: the spellings a remote uses, gated by the
// remote setting — except the binding the show had before the remote existed.
import { describe, it, expect } from 'vitest'
import { remotePanicFromEvent } from './remotePanic'
import type { ShowEvent } from '../../shared/show'

const osc = (address: string): ShowEvent => ({
  kind: 'osc', at: 1, from: '10.0.0.5:53001', address, args: []
})

const on = { enabled: true, port: 53000 }
const off = { enabled: true, port: 53000, remote: false }

describe('remotePanicFromEvent', () => {
  it('reads QLab’s /panic, with or without its workspace prefix', () => {
    expect(remotePanicFromEvent(osc('/panic'), on)).toEqual({
      source: 'osc', reason: 'OSC /panic from 10.0.0.5:53001'
    })
    expect(remotePanicFromEvent(osc('/workspace/A1/panic'), on)?.source).toBe('osc')
  })

  it('leaves /cuerunner/panic to the binding that already answers it', () => {
    expect(remotePanicFromEvent(osc('/cuerunner/panic'), on)).toBeNull()
  })

  it('is silent when the remote is off', () => {
    expect(remotePanicFromEvent(osc('/panic'), off)).toBeNull()
  })

  it('is not a panic for any other address, or for MIDI', () => {
    expect(remotePanicFromEvent(osc('/go'), on)).toBeNull()
    expect(remotePanicFromEvent({
      kind: 'midi', at: 1, device: 'Pad', message: { kind: 'cc', channel: 1, controller: 120, value: 0 }
    }, on)).toBeNull()
  })
})
