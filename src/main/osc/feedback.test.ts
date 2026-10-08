// The feedback's timing and bookkeeping: a change pushed at most once per MIN_PUSH_MS, progress
// at the show's rate, the remotes that asked — bounded — and replies to whoever asked.
import { describe, it, expect } from 'vitest'
import { MAX_SUBSCRIBERS, MIN_PUSH_MS, OscFeedback } from './feedback'
import { decodePacket } from './codec'
import type { OscFeedbackSettings, OscFeedbackSnapshot } from '../../shared/oscFeedback'

/** A clock and a timer list the test moves by hand. */
function ports() {
  let now = 1000
  let next = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  const sent: Array<{ host: string; port: number; address: string; args: unknown[] }> = []
  return {
    sent,
    advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (due === undefined) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].callback()
      }
      now = until
    },
    pending: () => timers.size,
    ports: {
      now: () => now,
      setTimer: (callback: () => void, ms: number) => {
        const id = next++
        timers.set(id, { at: now + ms, callback })
        return id
      },
      clearTimer: (handle: unknown) => { timers.delete(handle as number) },
      send: (host: string, port: number, packet: Buffer) => {
        for (const message of decodePacket(packet)) sent.push({ host, port, address: message.address, args: message.args.map(arg => arg.value) })
      },
      appVersion: () => '1.0.0'
    }
  }
}

const settings = (patch: Partial<OscFeedbackSettings> = {}): OscFeedbackSettings =>
  ({ enabled: true, host: '10.0.0.9', port: 9000, rateHz: 10, ...patch })

const snap = (patch: Partial<OscFeedbackSnapshot> = {}): OscFeedbackSnapshot => ({
  workspaceId: 'WS',
  workspaceName: 'Show',
  activeListId: 'main',
  playhead: { id: 'c1', number: '1', name: 'Walk-in', type: 'audio' },
  lists: [{ id: 'main', name: 'Main Cue List', playhead: { id: 'c1', number: '1', name: 'Walk-in', type: 'audio' }, cart: false, disarmed: false }],
  running: [],
  cues: [{ id: 'c1', number: '1', name: 'Walk-in', type: 'audio', parentId: null, listId: 'main', isArmed: true, colorName: 'none', notes: '' }],
  ...patch
})

const playing = (elapsedMs: number): OscFeedbackSnapshot['running'] =>
  [{ id: 'c1', number: '1', name: 'Walk-in', type: 'audio', listId: 'main', state: 'playing', elapsedMs, durationMs: 10_000 }]

describe('the OSC feedback', () => {
  it('pushes a change to the show’s destination, and a burst of publishes as one push', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(settings({ rateHz: 0 }))
    feedback.publish(snap())
    clock.advance(0)
    const first = clock.sent.length
    expect(clock.sent.every(entry => entry.host === '10.0.0.9' && entry.port === 9000)).toBe(true)
    expect(clock.sent.find(entry => entry.address === '/cuerunner/playhead/number')?.args).toEqual(['1'])

    // Five moves of the playhead inside one interval: one more push, of the last.
    for (let i = 0; i < 5; i++) feedback.publish(snap({ playhead: { id: `x${i}`, number: `${i}`, name: '', type: 'wait' } }))
    clock.advance(MIN_PUSH_MS - 1)
    expect(clock.sent.length).toBe(first)
    clock.advance(1)
    const pushed = clock.sent.slice(first).filter(entry => entry.address === '/cuerunner/playhead/number')
    expect(pushed.map(entry => entry.args[0])).toEqual(['4'])
  })

  it('pushes progress at the show’s rate while a cue runs, carried on between publishes, then zeroes it once', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(settings({ rateHz: 10 }))
    feedback.publish(snap({ running: playing(1000) }))
    clock.advance(1000)
    const progress = clock.sent.filter(entry => entry.address === '/cuerunner/running/0/elapsed').map(entry => entry.args[0] as number)
    // Ten a second, and the elapsed time moving on between the window's publishes.
    expect(progress.length).toBe(10)
    expect(progress[progress.length - 1]).toBeCloseTo(2, 1)
    feedback.publish(snap({ running: [] }))
    clock.advance(1000)
    const after = clock.sent.filter(entry => entry.address === '/cuerunner/running/0/progress').slice(progress.length)
    expect(after.map(entry => entry.args[0])).toEqual([0])
    // Nothing runs, so nothing is timed.
    expect(clock.pending()).toBe(0)
  })

  it('pushes no progress at a rate of nought, and none faster than its ceiling', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(settings({ rateHz: 0 }))
    feedback.publish(snap({ running: playing(0) }))
    clock.advance(1000)
    expect(clock.sent.filter(entry => entry.address.endsWith('/progress'))).toHaveLength(0)

    const fast = ports()
    const quick = new OscFeedback(fast.ports)
    quick.configure(settings({ rateHz: 1000 }))
    quick.publish(snap({ running: playing(0) }))
    fast.advance(1000)
    expect(fast.sent.filter(entry => entry.address === '/cuerunner/running/0/progress').length).toBeLessThanOrEqual(30)
  })

  it('answers a QLab query to whoever asked, and pushes QLab’s updates to those who asked for them', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(null)
    feedback.publish(snap())
    expect(feedback.handle('/cue/selected/name', [], { host: '10.0.0.7', port: 53001 })).toBe(true)
    expect(clock.sent).toEqual([{
      host: '10.0.0.7', port: 53001, address: '/reply/cue/selected/name',
      args: [JSON.stringify({ workspace_id: 'WS', address: '/cue/selected/name', status: 'ok', data: 'Walk-in' })]
    }])

    expect(feedback.handle('/updates', [{ type: 'i', value: 1 }], { host: '10.0.0.7', port: 53001 })).toBe(true)
    feedback.publish(snap({ playhead: null, running: playing(0) }))
    clock.advance(MIN_PUSH_MS)
    const updates = clock.sent.filter(entry => entry.address.startsWith('/update/'))
    expect(updates.map(entry => entry.address)).toEqual([
      '/update/workspace/WS/cueList/main/playbackPosition',
      '/update/workspace/WS/cue_id/c1'
    ])
    // No destination of its own: the Cuerunner namespace went nowhere.
    expect(clock.sent.some(entry => entry.address.startsWith('/cuerunner/'))).toBe(false)
  })

  it('tells QLab’s remotes when another list’s playhead moves, by that list’s own id', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(null)
    const twoLists = (cartHead: string | null): OscFeedbackSnapshot => snap({
      lists: [
        { id: 'main', name: 'Main Cue List', playhead: { id: 'c1', number: '1', name: 'Walk-in', type: 'audio' }, cart: false, disarmed: false },
        { id: 'sfx', name: 'Effects', playhead: cartHead === null ? null : { id: cartHead, number: 'X', name: 'Door', type: 'audio' }, cart: true, disarmed: false }
      ]
    })
    feedback.publish(twoLists('x1'))
    feedback.handle('/updates', [{ type: 'i', value: 1 }], { host: '10.0.0.7', port: 53001 })
    clock.advance(MIN_PUSH_MS)
    clock.sent.length = 0
    feedback.publish(twoLists('x2'))
    clock.advance(MIN_PUSH_MS)
    expect(clock.sent.filter(entry => entry.address.startsWith('/update/')).map(entry => [entry.address, entry.args])).toEqual([
      ['/update/workspace/WS/cueList/sfx/playbackPosition', ['x2']]
    ])
  })

  it('sends a subscriber the state at once, to the port it names, and forgets it when it asks', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(null)
    feedback.publish(snap())
    feedback.handle('/cuerunner/feedback/subscribe', [{ type: 'i', value: 9100 }], { host: '10.0.0.8', port: 50000 })
    expect(clock.sent.some(entry => entry.port === 9100 && entry.address === '/cuerunner/playhead/name')).toBe(true)
    feedback.handle('/cuerunner/feedback/unsubscribe', [], { host: '10.0.0.8', port: 50000 })
    const before = clock.sent.length
    feedback.publish(snap({ playhead: null }))
    clock.advance(MIN_PUSH_MS)
    expect(clock.sent.length).toBe(before)
  })

  it('keeps a bounded list of subscribers, dropping the one that asked longest ago', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(null)
    feedback.publish(snap())
    for (let i = 0; i <= MAX_SUBSCRIBERS; i++) {
      feedback.handle('/cuerunner/feedback/subscribe', [], { host: `10.0.1.${i}`, port: 9000 })
    }
    const before = clock.sent.length
    feedback.publish(snap({ playhead: null }))
    clock.advance(MIN_PUSH_MS)
    const hosts = new Set(clock.sent.slice(before).map(entry => entry.host))
    expect(hosts.size).toBe(MAX_SUBSCRIBERS)
    expect(hosts.has('10.0.1.0')).toBe(false)
  })

  it('leaves a message that is not its own to the show', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.publish(snap())
    expect(feedback.handle('/go', [], { host: '10.0.0.7', port: 1 })).toBe(false)
    expect(feedback.handle('/cue/1/start', [], { host: '10.0.0.7', port: 1 })).toBe(false)
    expect(clock.sent).toEqual([])
  })

  it('stops every timer when it is closed', () => {
    const clock = ports()
    const feedback = new OscFeedback(clock.ports)
    feedback.configure(settings())
    feedback.publish(snap({ running: playing(0) }))
    expect(clock.pending()).toBeGreaterThan(0)
    feedback.close()
    expect(clock.pending()).toBe(0)
  })
})
