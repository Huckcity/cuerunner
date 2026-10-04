// Highest wins, as the operator who asked for it describes it: Alex on his own fader (DCA 1)
// and on the cast's (DCA 2). The cast fader comes up to -20 and Alex stays where his own fader
// has him; Alex's fader comes down past the cast's and he lands on it. Levels are the desk's
// raw values (`dcaReports.ts`), which only rise as a fader does.
import { describe, expect, it } from 'vitest'
import { HighestWins } from './HighestWins'
import type { SqMembershipIntent } from '../../shared/show'

const ALEX = 1
const OWN = 1
const CAST = 2

/** A resolver that is told every write it plans landed, the way the service tells it. */
function landing(resolver: HighestWins, writes: SqMembershipIntent[]): string[] {
  for (const write of writes) resolver.landed(write)
  return writes.map(write => `${write.placed ? 'onto' : 'off'} ${write.dca}${write.rides ? '' : ' (rides none)'}`)
}

describe('HighestWins', () => {
  it('keeps a channel on its own fader while the group comes up below it, then hands it over', () => {
    const resolver = new HighestWins()
    expect(landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))).toEqual(['onto 1'])
    landing(resolver, resolver.report({ dca: OWN, level: 13000 }))

    // The cast fader comes up from -inf to below Alex's own: nothing moves.
    expect(resolver.report({ dca: CAST, level: 3442 })).toEqual([])
    expect(resolver.report({ dca: CAST, level: 10000 })).toEqual([])

    // Alex's own fader comes down past it: he lands on the cast's, placed before cleared.
    expect(resolver.report({ dca: OWN, level: 10010 })).toEqual([])
    expect(landing(resolver, resolver.report({ dca: OWN, level: 9000 }))).toEqual(['onto 2', 'off 1'])

    // And back up past it again: he returns to his own.
    expect(landing(resolver, resolver.report({ dca: OWN, level: 12000 }))).toEqual(['onto 1', 'off 2'])
  })

  it('needs a challenger clearly above before it moves a channel', () => {
    const resolver = new HighestWins('assign-first', 16)
    landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))
    landing(resolver, resolver.report({ dca: OWN, level: 10000 }))
    expect(resolver.report({ dca: CAST, level: 10016 })).toEqual([])
    expect(landing(resolver, resolver.report({ dca: CAST, level: 10017 }))).toEqual(['onto 2', 'off 1'])
  })

  it('clears first when asked to, leaving the flag as each write leaves the channel', () => {
    const resolver = new HighestWins('clear-first')
    landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))
    landing(resolver, resolver.report({ dca: OWN, level: 9000 }))
    expect(landing(resolver, resolver.report({ dca: CAST, level: 12000 })))
      .toEqual(['off 1 (rides none)', 'onto 2'])
  })

  it('counts a muted fader as -inf, so muting a channel’s own fader hands it to the group', () => {
    const resolver = new HighestWins()
    landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))
    landing(resolver, resolver.report({ dca: OWN, level: 15196 }))
    landing(resolver, resolver.report({ dca: CAST, level: 8000 }))
    expect(landing(resolver, resolver.report({ dca: OWN, muted: true }))).toEqual(['onto 2', 'off 1'])
    expect(landing(resolver, resolver.report({ dca: OWN, muted: false }))).toEqual(['onto 1', 'off 2'])
  })

  it('starts from what the window says the desk holds, and clears only that', () => {
    // The record says the channel was put on both faders before this session followed it:
    // the desk adds them, so the one that loses is cleared rather than left to pull it down.
    const resolver = new HighestWins()
    landing(resolver, resolver.report({ dca: OWN, level: 6000 }))
    landing(resolver, resolver.report({ dca: CAST, level: 9000 }))
    expect(landing(resolver, resolver.ride(ALEX, [OWN, CAST], [OWN, CAST], true))).toEqual(['off 1'])
  })

  it('stays put, or takes the first fader, while nothing has been read', () => {
    const resolver = new HighestWins()
    expect(landing(resolver, resolver.ride(ALEX, [CAST, OWN], [], true))).toEqual(['onto 2'])
    expect(resolver.needsLevels()).toBe(true)
    // One fader read is enough to prefer it over one that has not been.
    expect(resolver.report({ dca: OWN, level: 2000 }).map(write => [write.dca, write.placed]))
      .toEqual([[OWN, true], [CAST, false]])
  })

  it('writes every fader when the show does not ask for the highest, and stops following', () => {
    const resolver = new HighestWins()
    landing(resolver, resolver.report({ dca: OWN, level: 15000 }))
    landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))
    expect(landing(resolver, resolver.ride(ALEX, [OWN, CAST], [OWN, CAST], false))).toEqual(['onto 2'])
    expect(resolver.follows(ALEX)).toBe(false)
    expect(resolver.report({ dca: OWN, level: 1 })).toEqual([])
  })

  it('lets a channel go when a recall writes it as a pair', () => {
    const resolver = new HighestWins()
    landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))
    resolver.release(ALEX)
    expect(resolver.report({ dca: CAST, level: 16383 })).toEqual([])
  })

  it('plans the same switch again when the last one did not land', () => {
    const resolver = new HighestWins()
    landing(resolver, resolver.ride(ALEX, [OWN, CAST], [], true))
    landing(resolver, resolver.report({ dca: OWN, level: 9000 }))
    // Not landed: the session was down. The next report about either fader tries again.
    expect(resolver.report({ dca: CAST, level: 12000 }).length).toBe(2)
    expect(landing(resolver, resolver.report({ dca: CAST, level: 12001 }))).toEqual(['onto 2', 'off 1'])
  })
})
