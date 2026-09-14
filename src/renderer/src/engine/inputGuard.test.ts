// The guard is the answer to a doubled trigger, and the thing that makes it right rather
// than merely quiet is *which* firings it drops: the second half of one message, never a
// second message. These tests are written the way a desk misbehaves — a bounce, a repeat,
// a datagram sent twice — because that is the evidence the window is worth having.
import { describe, it, expect } from 'vitest'
import { InputGuard, firingIdentity, noteKey, refirePolicy } from './inputGuard'
import type { Cue, MidiMessageKind } from '../types/cue'
import type { ShowEvent } from '../types/show'

const guardAt = (windowMs: number) => new InputGuard(() => windowMs)

const osc = (address: string, ...values: Array<number | string>): ShowEvent => ({
  kind: 'osc',
  at: 0,
  from: '10.0.0.5:8000',
  address,
  args: values.map(value => typeof value === 'number'
    ? { type: 'f' as const, value }
    : { type: 's' as const, value })
})

const midi = (message: MidiMessageKind): ShowEvent => ({
  kind: 'midi',
  at: 0,
  device: 'IAC Bus 1',
  message
})

/** The firing an event represents, read in the order the trigger hook reads it. */
function fire(guard: InputGuard, event: ShowEvent, nowMs: number): boolean {
  const firing = firingIdentity(event)
  if (firing === null) return false
  const accepted = guard.accepts(firing.surface, firing.key, nowMs)
  const note = noteKey(event)
  if (accepted && note !== null && event.kind === 'midi' && event.message.kind === 'noteOn') {
    guard.pressNote(note)
  }
  return accepted
}

describe('InputGuard', () => {
  it('drops the second of two identical datagrams inside the window', () => {
    const guard = guardAt(300)
    const datagram = osc('/eos/cue/12/fire')

    expect(fire(guard, datagram, 1000)).toBe(true)
    expect(fire(guard, datagram, 1100)).toBe(false)
  })

  it('lets the same datagram through once the window has passed', () => {
    const guard = guardAt(300)
    const datagram = osc('/eos/cue/12/fire')

    expect(fire(guard, datagram, 1000)).toBe(true)
    expect(fire(guard, datagram, 1301)).toBe(true)
  })

  it('reads a different argument as a different instruction', () => {
    // Two cues fired from one address in the same breath is a thing a show does; the
    // guard is for the same message arriving twice, not for two messages.
    const guard = guardAt(300)

    expect(fire(guard, osc('/eos/cue/12/fire', 1), 1000)).toBe(true)
    expect(fire(guard, osc('/eos/cue/12/fire', 2), 1010)).toBe(true)
  })

  it('keeps the surfaces apart, so a note is not blamed for the keyboard', () => {
    const guard = guardAt(300)

    expect(guard.accepts('key', 'go', 1000)).toBe(true)
    expect(guard.accepts('midi', 'IAC Bus 1 note:1:60', 1010)).toBe(true)
    expect(guard.accepts('osc', '/go/1 ', 1020)).toBe(true)
  })

  it('fires once while a note is held, however often the desk repeats it', () => {
    const guard = guardAt(300)
    const noteOn = midi({ kind: 'noteOn', channel: 1, note: 60, velocity: 100 })
    const repeat = midi({ kind: 'noteOn', channel: 1, note: 60, velocity: 64 })

    expect(fire(guard, noteOn, 1000)).toBe(true)
    // Long past the window: a held note is held for as long as the player holds it, and
    // the repeat rate of a keyboard has nothing to do with how long that is.
    expect(fire(guard, repeat, 5000)).toBe(false)
    expect(fire(guard, repeat, 9000)).toBe(false)
  })

  it('fires again once the note has been released and pressed again', () => {
    const guard = guardAt(300)
    const noteOn = midi({ kind: 'noteOn', channel: 1, note: 60, velocity: 100 })

    expect(fire(guard, noteOn, 1000)).toBe(true)
    const note = noteKey(midi({ kind: 'noteOff', channel: 1, note: 60, velocity: 0 }))!
    guard.releaseNote(note)
    expect(fire(guard, noteOn, 1400)).toBe(true)
  })

  it('does not fire on a note going up', () => {
    expect(firingIdentity(midi({ kind: 'noteOff', channel: 1, note: 60, velocity: 0 }))).toBeNull()
    expect(firingIdentity(midi({ kind: 'sysex', data: [1, 2, 3] }))).toBeNull()
  })

  it('distinguishes the same note on two devices', () => {
    const guard = guardAt(300)
    const on = { kind: 'noteOn' as const, channel: 1, note: 60, velocity: 100 }

    expect(fire(guard, midi(on), 1000)).toBe(true)
    expect(fire(guard, { kind: 'midi', at: 0, device: 'IAC Bus 2', message: on }, 1010)).toBe(true)
  })

  it('fires every time when the window is off', () => {
    const guard = guardAt(0)
    const datagram = osc('/eos/cue/12/fire')

    expect(fire(guard, datagram, 1000)).toBe(true)
    expect(fire(guard, datagram, 1000)).toBe(true)
  })

  it('does not let a dropped repeat extend its own window', () => {
    // A desk that sends every 100 ms would otherwise keep the surface deaf for good —
    // each rejected datagram pushing the window out from under the next real one.
    const guard = guardAt(300)
    const datagram = osc('/eos/cue/12/fire')

    expect(fire(guard, datagram, 1000)).toBe(true)
    expect(fire(guard, datagram, 1100)).toBe(false)
    expect(fire(guard, datagram, 1200)).toBe(false)
    // A full window after the firing that was allowed: the surface is open again.
    expect(fire(guard, datagram, 1300)).toBe(true)
    // And the clock restarts from that one, not from the attempts in between.
    expect(fire(guard, datagram, 1400)).toBe(false)
  })

  it('forgets everything when it is reset', () => {
    const guard = guardAt(300)

    expect(guard.accepts('key', 'go', 1000)).toBe(true)
    guard.reset()
    expect(guard.accepts('key', 'go', 1000)).toBe(true)
  })
})

describe('refirePolicy', () => {
  const cue = (refire?: Cue['refire']): Cue =>
    ({ id: 'c1', refire } as unknown as Cue)

  it('leaves a running cue alone when the cue says nothing', () => {
    expect(refirePolicy(cue())).toBe('ignore')
    expect(refirePolicy(cue('ignore'))).toBe('ignore')
  })

  it('restarts when the cue asks to be restarted', () => {
    expect(refirePolicy(cue('restart'))).toBe('restart')
  })
})
