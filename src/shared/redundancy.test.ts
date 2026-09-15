// The two halves of a redundant pair have to agree about the wire and about what a
// takeover does, and neither of them can check the other while a show is running. So
// every decision the pair makes from what it has heard — is the partner gone, is it the
// same show, what can be picked up — is made here, where a test can hold it.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_TIMEOUT_MS,
  MAX_MESSAGE_BYTES,
  REDUNDANCY_PROTOCOL,
  cueListHash,
  decodeMessage,
  defaultRedundancySettings,
  describeTakeover,
  encodeMessage,
  normalizeRedundancySettings,
  peerStatus,
  prefersOutgoing,
  shouldTakeOver,
  syncVerdict,
  takeoverPlan,
  type HelloMessage,
  type MirrorCue,
  type PlanCue,
  type RedundancyDigest
} from './redundancy'


function audioCue(id: string, startTime = 0, duration = 180_000): PlanCue {
  return { id, number: id, name: `Cue ${id}`, type: 'audio', startTime, duration }
}

function run(entry: Partial<MirrorCue> & { cueId: string }): MirrorCue {
  return {
    number: entry.cueId,
    name: `Cue ${entry.cueId}`,
    type: 'audio',
    state: 'playing',
    positionMs: 10_000,
    durationMs: 180_000,
    ...entry
  }
}

function digest(overrides: Partial<RedundancyDigest> = {}): RedundancyDigest {
  return {
    at: 1000,
    show: { id: 'show-1', name: 'Hamlet', cues: 3, hash: 'abcd1234' },
    selectedId: 'a',
    running: [],
    prepared: 0,
    ...overrides
  }
}

describe('a machine’s own settings', () => {
  it('starts switched off, listening, and not yet pointed at a partner', () => {
    const settings = defaultRedundancySettings('desk-a', 'id-a')
    expect(settings.enabled).toBe(false)
    expect(settings.role).toBe('live')
    expect(settings.peerHost).toBe('')
    expect(settings.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
    expect(settings.takeover).toBe('manual')
  })

  it('keeps the timeout inside a range a show can live with', () => {
    expect(normalizeRedundancySettings({ timeoutMs: 20 }, { name: 'a', id: 'i' }).timeoutMs).toBe(1000)
    expect(normalizeRedundancySettings({ timeoutMs: 900_000 }, { name: 'a', id: 'i' }).timeoutMs).toBe(30_000)
    expect(normalizeRedundancySettings({ timeoutMs: 2500 }, { name: 'a', id: 'i' }).timeoutMs).toBe(2500)
    expect(normalizeRedundancySettings({ timeoutMs: Number.NaN }, { name: 'a', id: 'i' }).timeoutMs).toBe(1000)
  })

  it('refuses a port that is not one, and keeps the machine’s own name and id', () => {
    const settings = normalizeRedundancySettings(
      { port: 70_000, peerPort: 0, name: '  ', role: 'nonsense' as never, takeover: 'auto' },
      { name: 'desk-a', id: 'id-a' }
    )
    expect(settings.port).toBe(53110)
    expect(settings.peerPort).toBe(53110)
    expect(settings.name).toBe('desk-a')
    expect(settings.id).toBe('id-a')
    expect(settings.role).toBe('live')
    expect(settings.takeover).toBe('auto')
  })
})

describe('the wire', () => {
  const hello: HelloMessage = {
    t: 'hello',
    protocol: REDUNDANCY_PROTOCOL,
    id: 'id-a',
    name: 'desk-a',
    role: 'standby',
    driving: false,
    term: 0,
    token: 'sekrit'
  }

  it('round-trips every message a pair sends', () => {
    const messages = [
      hello,
      { t: 'beat' as const, seq: 4, term: 1, driving: true, digest: digest() },
      { t: 'beat' as const, seq: 5, term: 1, driving: true, digest: null },
      { t: 'bye' as const, reason: 'closing' },
      { t: 'refuse' as const, reason: 'wrong token' }
    ]
    for (const message of messages) {
      expect(decodeMessage(encodeMessage(message).trim())).toEqual(message)
    }
  })

  it('reads one message per line and calls anything else nothing', () => {
    expect(decodeMessage('')).toBeNull()
    expect(decodeMessage('not json')).toBeNull()
    expect(decodeMessage('{}')).toBeNull()
    expect(decodeMessage('[1,2,3]')).toBeNull()
    expect(decodeMessage('"hello"')).toBeNull()
    expect(decodeMessage('{"t":"beat","seq":1}')).toBeNull()
    expect(decodeMessage(JSON.stringify({ t: 'beat', seq: 'x', term: 0, driving: false, digest: null }))).toBeNull()
  })

  it('does not believe a digest whose running entries are not entries', () => {
    const broken = {
      t: 'beat',
      seq: 1,
      term: 0,
      driving: true,
      digest: { ...digest(), running: [{ cueId: 'a', state: 'sideways' }] }
    }
    expect(decodeMessage(JSON.stringify(broken))).toBeNull()
  })

  it('refuses a line long enough to be an attack rather than a partner', () => {
    const line = `{"t":"bye","reason":"${'x'.repeat(MAX_MESSAGE_BYTES)}"}`
    expect(decodeMessage(line)).toBeNull()
  })

  it('resolves the two sockets of a pair to one, the same way at both ends', () => {
    // The same pair, seen from each end: both machines keep the connection the lower id
    // opened, so the pair is left talking over one socket rather than two.
    expect(prefersOutgoing('a', 'b')).toBe(true)
    expect(prefersOutgoing('b', 'a')).toBe(false)
    expect(prefersOutgoing('a', 'a')).toBe(false)
  })
})

describe('the same show on both machines', () => {
  const cues = [
    { id: 'a', number: '1', name: 'Overture' },
    { id: 'b', number: '2', name: 'Entrance' }
  ]

  it('fingerprints the cue list the same way for the same list', () => {
    expect(cueListHash(cues)).toBe(cueListHash([...cues]))
    expect(cueListHash(cues)).not.toBe(cueListHash([...cues].reverse()))
    expect(cueListHash(cues)).not.toBe(cueListHash([{ ...cues[0], name: 'Prelude' }, cues[1]]))
  })

  it('is in sync when both machines have the same file, the same cues and the same list', () => {
    const mine = digest()
    expect(syncVerdict(mine, digest())).toEqual({ inSync: true, note: '3 cues, the same show' })
  })

  it('says what is wrong when the shows are not the same', () => {
    expect(syncVerdict(digest(), digest({ show: { id: 'other', name: 'Macbeth', cues: 3, hash: 'abcd1234' } })).note)
      .toContain('Macbeth')
    expect(syncVerdict(digest(), digest({ show: { id: 'show-1', name: 'Hamlet', cues: 4, hash: 'zz' } })).note)
      .toContain('save the show on the live machine')
    expect(syncVerdict(null, digest()).note).toBe('this machine has no show open')
    expect(syncVerdict(digest(), null).inSync).toBe(false)
  })
})

describe('what has been heard from the partner', () => {
  const hello: HelloMessage = {
    t: 'hello',
    protocol: REDUNDANCY_PROTOCOL,
    id: 'id-b',
    name: 'desk-b',
    role: 'live',
    driving: true,
    term: 0,
    token: 'sekrit'
  }

  it('counts the silence from the last message rather than from the last beat', () => {
    const facts = { hello, digest: digest(), lastHeardAt: 1000, everHeard: true }
    const fresh = peerStatus(facts, { digest: digest(), now: 1500, timeoutMs: DEFAULT_TIMEOUT_MS })
    expect(fresh).toMatchObject({ name: 'desk-b', alive: true, silentMs: 500, inSync: true, running: 0 })
    const quiet = peerStatus(facts, { digest: digest(), now: 4500, timeoutMs: DEFAULT_TIMEOUT_MS })
    expect(quiet).toMatchObject({ alive: false, silentMs: 3500 })
    // At the timeout exactly, the partner is still there: the rule is silent *past* it.
    expect(peerStatus(facts, { digest: digest(), now: 4000, timeoutMs: DEFAULT_TIMEOUT_MS })?.alive).toBe(true)
  })

  it('knows nothing about a partner that has not said hello', () => {
    expect(peerStatus({ hello: null, digest: null, lastHeardAt: 0, everHeard: false }, {
      digest: null,
      now: 1000,
      timeoutMs: DEFAULT_TIMEOUT_MS
    })).toBeNull()
  })
})

describe('who takes the show', () => {
  const standby = { enabled: true, role: 'standby' as const, takeover: 'auto' as const, driving: false }
  const silentPartner = { peerEverHeard: true, peerAlive: false }

  it('takes it when a partner it was hearing goes quiet', () => {
    expect(shouldTakeOver({ ...standby, ...silentPartner })).toBe(true)
  })

  it('leaves it alone while the partner is alive', () => {
    expect(shouldTakeOver({ ...standby, peerEverHeard: true, peerAlive: true })).toBe(false)
  })

  it('never seizes a show nobody was running', () => {
    // A backup that has heard nothing has nothing to pick up, and starting to drive on
    // its own would be a worse failure than saying it is alone.
    expect(shouldTakeOver({ ...standby, peerEverHeard: false, peerAlive: false })).toBe(false)
  })

  it('waits for the operator when the mode is manual, and does nothing when it is off', () => {
    expect(shouldTakeOver({ ...standby, takeover: 'manual', ...silentPartner })).toBe(false)
    expect(shouldTakeOver({ ...standby, enabled: false, ...silentPartner })).toBe(false)
  })

  it('does not take a show it is already driving, or one it is not configured to back up', () => {
    expect(shouldTakeOver({ ...standby, driving: true, ...silentPartner })).toBe(false)
    expect(shouldTakeOver({ ...standby, role: 'live', ...silentPartner })).toBe(false)
  })
})

describe('what a takeover picks up', () => {
  const cues = [audioCue('a'), audioCue('b', 5000, 60_000), audioCue('c')]

  it('puts a playing audio cue back at the position it had reached, plus the silence', () => {
    const plan = takeoverPlan(cues, digest({ running: [run({ cueId: 'a', positionMs: 10_000 })] }), 2000)
    expect(plan.adopt).toEqual([{ cueId: 'a', number: 'a', name: 'Cue a', seekMs: 12_000 }])
    expect(plan.skipped).toEqual([])
    expect(plan.note).toContain('took the show over 2.0 s after the live machine went quiet')
    expect(plan.note).toContain('1 cue picked up at its position')
  })

  it('measures a cue’s position from the start of its own region', () => {
    const plan = takeoverPlan(cues, digest({ running: [run({ cueId: 'b', positionMs: 20_000 })] }), 0)
    expect(plan.adopt[0].seekMs).toBe(15_000)
  })

  it('carries the operator’s place in the show across', () => {
    const plan = takeoverPlan(cues, digest({ selectedId: 'b' }), 0)
    expect(plan.selectedId).toBe('b')
    // A selection this machine does not have is not a place the operator can be put.
    expect(takeoverPlan(cues, digest({ selectedId: 'gone' }), 0).selectedId).toBeNull()
  })

  it('names what it cannot pick up rather than pretending', () => {
    // The mirror says what the live machine was running; this machine's own cue decides
    // what can be done with it, so the cue that cannot be picked up is a local one.
    const local: PlanCue[] = [
      { id: 'a', number: '1', name: 'Sting', type: 'midi', startTime: 0, duration: 0 },
      audioCue('b', 5000, 60_000),
      audioCue('c')
    ]
    const plan = takeoverPlan(
      local,
      digest({
        running: [
          run({ cueId: 'a', type: 'midi', positionMs: null }),
          run({ cueId: 'b', state: 'post-wait', positionMs: null }),
          run({ cueId: 'c', state: 'pre-wait', positionMs: null }),
          run({ cueId: 'd' })
        ]
      }),
      0
    )
    expect(plan.adopt).toEqual([])
    expect(plan.skipped.map(entry => entry.reason)).toEqual([
      'a midi cue that has already gone out cannot be picked up',
      'it had finished and was waiting to hand over',
      'it had not started yet',
      'this machine does not have that cue'
    ])
    expect(plan.note).toContain('nothing was picked up')
    expect(plan.note).toContain('4 not')
  })

  it('will not start a cue that had already reached its end', () => {
    const plan = takeoverPlan(
      [audioCue('a', 0, 30_000)],
      digest({ running: [run({ cueId: 'a', positionMs: 29_000, durationMs: 30_000 })] }),
      4000
    )
    expect(plan.adopt).toEqual([])
    expect(plan.skipped[0].reason).toBe('it had reached its end before the takeover')
  })

  it('does not guess a position nobody reported', () => {
    const plan = takeoverPlan(cues, digest({ running: [run({ cueId: 'a', positionMs: null })] }), 0)
    expect(plan.adopt).toEqual([])
    expect(plan.skipped[0].reason).toBe('the live machine never reported a position')
  })

  it('has something honest to say about a show that was standing still', () => {
    const plan = takeoverPlan(cues, digest(), 500)
    expect(plan.adopt).toEqual([])
    expect(plan.skipped).toEqual([])
    expect(plan.note).toContain('nothing was running')
    expect(takeoverPlan(cues, null, 0).note).toContain('nothing was running')
  })
})

describe('the line the operator reads', () => {
  it('counts the cues that were picked up', () => {
    const adopt = [
      { cueId: 'a', number: '1', name: 'Overture', seekMs: 0 },
      { cueId: 'b', number: '2', name: 'Entrance', seekMs: 0 }
    ]
    expect(describeTakeover(adopt, [], 1000)).toContain('2 cues picked up')
    expect(describeTakeover([], [], 1000)).toContain('nothing was running')
    expect(describeTakeover([], [{ cueId: 'c', label: '3 · Blackout', reason: 'x' }], 1000))
      .toContain('3 · Blackout')
  })
})
