// The plot's operations are pure so the editor stays small — and the swaps they produce
// are what the show report is read from the next morning. What is tested here is the
// record: who a pack came off, who it went to, and what the night did to its battery.
// Performers themselves are the cast's (`utils/cast.test.ts`); every function here that
// needs a name takes the cast's performer list as a plain fixture.
import { describe, it, expect } from 'vitest'
import {
  MAX_SWAPS,
  addPack,
  assignPack,
  buildReport,
  describeSwap,
  recordSwaps,
  releasePerformerPacks,
  removePack,
  reportText,
  updatePack
} from './rfPlot'
import type { DeviceState, Performer, RfPlot, RfSwap } from '../../../shared/show'

const AT = Date.parse('2026-09-11T20:14:00.000Z')

function performer(id: string, name: string, role: string): Performer {
  return { id, name, role, notes: '', channelId: null }
}

const ALDONZA = performer('perf-1', 'Aldonza', 'lead')
const SANCHO = performer('perf-2', 'Sancho', 'comic lead')
const PERFORMERS = [ALDONZA, SANCHO]

function plot(): RfPlot {
  return {
    packs: [
      { id: 'p1', label: 'Pack 1', channelId: 'ch-1', performerId: ALDONZA.id, notes: '' },
      { id: 'p2', label: 'Pack 2', channelId: 'ch-2', performerId: SANCHO.id, notes: '' }
    ]
  }
}

function device(id: string, overrides: Partial<DeviceState> = {}): DeviceState {
  return { id, service: 'rf', name: id, online: true, lastSeen: AT, ...overrides }
}

describe('plot edits', () => {
  it('adds a pack without inventing an assignment', () => {
    const added = addPack({ packs: [] }, 'Pack 9')

    expect(added.packs[0]).toMatchObject({ label: 'Pack 9', channelId: null, performerId: null })
  })

  it('updates and removes packs by id, leaving the rest alone', () => {
    const start = plot()
    const repatched = updatePack(start, 'p1', { channelId: 'ch-9', notes: 'wig mic' })

    expect(repatched.packs[0]).toMatchObject({ channelId: 'ch-9', notes: 'wig mic', label: 'Pack 1' })
    expect(removePack(start, 'p1').packs.map(pack => pack.id)).toEqual(['p2'])
    expect(start.packs).toHaveLength(2)
  })
})

describe('assignPack', () => {
  it('records a swap with the names as they were', () => {
    const start = plot()
    const { plot: next, swaps } = assignPack(start, PERFORMERS, 'p1', SANCHO.id, AT)

    expect(next.packs[0].performerId).toBe(SANCHO.id)
    expect(swaps).toEqual([
      { at: AT, packId: 'p1', packLabel: 'Pack 1', from: 'Aldonza', to: 'Sancho' }
    ])
  })

  it('records a pack coming off someone as a swap to nobody', () => {
    const start = plot()
    const { swaps } = assignPack(start, PERFORMERS, 'p1', null, AT)

    expect(swaps[0]).toMatchObject({ from: 'Aldonza', to: null })
    expect(describeSwap(swaps[0])).toBe('Pack 1 Aldonza → unassigned')
  })

  it('says nothing when nothing changed, or when the pack is not there', () => {
    const start = plot()

    expect(assignPack(start, PERFORMERS, 'p1', start.packs[0].performerId, AT).swaps).toEqual([])
    expect(assignPack(start, PERFORMERS, 'nope', null, AT)).toEqual({ plot: start, swaps: [] })
  })
})

describe('releasePerformerPacks', () => {
  it('releases their packs, and says who each one came off', () => {
    const start = plot()
    const { plot: next, swaps } = releasePerformerPacks(start, PERFORMERS, ALDONZA.id, AT)

    expect(next.packs[0].performerId).toBeNull()
    expect(next.packs[1].performerId).toBe(SANCHO.id)
    expect(swaps).toEqual([
      { at: AT, packId: 'p1', packLabel: 'Pack 1', from: 'Aldonza', to: null }
    ])
  })

  it('changes nothing for a performer wearing no packs', () => {
    const start = plot()

    expect(releasePerformerPacks(start, PERFORMERS, 'nobody', AT)).toEqual({ plot: start, swaps: [] })
  })
})

describe('recordSwaps', () => {
  it('keeps the newest swaps and nothing older', () => {
    const swaps = Array.from({ length: MAX_SWAPS }, (_, i) => swap(i))

    const recorded = recordSwaps(swaps, [swap(999)])

    expect(recorded).toHaveLength(MAX_SWAPS)
    expect(recorded[0].at).toBe(1)
    expect(recorded[MAX_SWAPS - 1].at).toBe(999)
  })

  it('returns the same list when there is nothing to add', () => {
    const swaps = [swap(1)]

    expect(recordSwaps(swaps, [])).toBe(swaps)
  })
})

describe('buildReport', () => {
  it('reports the battery floor, the dropouts and the swaps for each pack', () => {
    const start = plot()
    const assigned = assignPack(start, PERFORMERS, 'p1', SANCHO.id, AT)
    const devices = [
      device('rf:ch-1', {
        battery: { percent: 42 },
        history: { lowestPercent: 6, lowestAt: AT, dropouts: 2 }
      })
    ]

    const rows = buildReport(assigned.plot, PERFORMERS, devices, assigned.swaps)
    const [first, second] = rows

    expect(first).toMatchObject({
      label: 'Pack 1',
      performer: 'Sancho',
      role: 'comic lead',
      channelId: 'ch-1',
      lowestPercent: 6,
      lowestAt: AT,
      dropouts: 2
    })
    expect(first.swaps).toHaveLength(1)
    // Nothing is reporting for the second pack: no reading, and honest about it.
    expect(second).toMatchObject({ label: 'Pack 2', device: undefined, lowestPercent: null, dropouts: 0 })
    expect(second.swaps).toEqual([])
  })

  it('reports what the pack used last time, from the device\'s history', () => {
    const [first, second] = buildReport(plot(), PERFORMERS, [
      device('rf:ch-1', { history: { lowestPercent: 40, lowestAt: AT, dropouts: 0, lastUsedPercent: 24 } })
    ], [])

    expect(first.lastUsedPercent).toBe(24)
    expect(second.lastUsedPercent).toBeNull()
    expect(reportText([first], AT)).toContain('lowest 40% at')
    expect(reportText([first], AT)).toContain(', last show used 24%,')
    expect(reportText([second], AT)).not.toContain('last show used')
  })

  it('gives each pack the incidents on its own channel, in order, with the cue that was playing', () => {
    const incidents = [
      { at: AT, channelId: 'ch-1', name: 'Pack 1', kind: 'dropout' as const, text: 'went quiet', cue: { number: '47', name: 'Walk-in' } },
      { at: AT + 5, channelId: 'ch-2', name: 'Pack 2', kind: 'weak' as const, text: 'signal weak', cue: null }
    ]
    const [first, second] = buildReport(plot(), PERFORMERS, [], [], incidents)

    expect(first.incidents).toEqual([incidents[0]])
    expect(second.incidents).toEqual([incidents[1]])
    const text = reportText([first, second], AT)
    expect(text).toContain('went quiet during cue 47 Walk-in')
    expect(text).toContain('signal weak during between cues')
  })

  it('reports a channel that reported with no plot naming it, and does not repeat one the plot has', () => {
    const rows = buildReport(plot(), PERFORMERS, [
      device('rf:ch-1', { history: { lowestPercent: 40, lowestAt: AT, dropouts: 1 } }),
      device('rf:spare', { name: 'Spare', history: { lowestPercent: 12, lowestAt: AT, dropouts: 0 } }),
      { ...device('presence:amp'), service: 'presence' }
    ], [])

    expect(rows.map(row => row.label)).toEqual(['Pack 1', 'Pack 2', 'Spare'])
    expect(rows[2]).toMatchObject({ channelId: 'spare', performer: null, lowestPercent: 12 })
  })

  it('reports a show that never entered a plot', () => {
    const rows = buildReport({ packs: [] }, [], [device('rf:ew-dx:1:0', { name: '37', history: { lowestPercent: 6, lowestAt: AT, dropouts: 2 } })], [])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ label: '37', dropouts: 2, lowestPercent: 6 })
  })

  it('reports the floor for a pack that ended the night quiet', () => {
    // The case the report exists for: nobody is hearing it now, and that is exactly the
    // pack someone asks about the next morning.
    const start = plot()
    const devices = [
      device('rf:ch-1', {
        online: false,
        history: { lowestPercent: 3, lowestAt: AT, dropouts: 2 }
      })
    ]

    const [row] = buildReport(start, PERFORMERS, devices, [])

    expect(row.lowestPercent).toBe(3)
    expect(row.dropouts).toBe(2)
    expect(row.device?.battery).toBeUndefined()
    expect(reportText([row], AT)).toContain('lowest 3%')
  })

  it('counts the dropouts of a pack that never reported a battery', () => {
    // It has no floor to report and it certainly has dropouts: saying "no dropouts"
    // because there is no battery reading would be the report lying about the night.
    const start = plot()
    const rows = buildReport(start, PERFORMERS, [
      device('rf:ch-1', { online: false, history: { dropouts: 1 } })
    ], [])

    expect(rows[0].lowestPercent).toBeNull()
    expect(rows[0].dropouts).toBe(1)
    expect(reportText(rows, AT)).toContain('Pack 1 — Aldonza (lead), no reading, 1 dropout')
  })

  it('leaves a pack with no channel out of the device lookup', () => {
    const start = addPack({ packs: [] }, 'Spare')

    const [row] = buildReport(start, PERFORMERS, [device('rf:ch-1')], [])

    expect(row.device).toBeUndefined()
    expect(row.performer).toBeNull()
  })
})

describe('reportText', () => {
  it('reads as a report of the night', () => {
    const start = plot()
    const assigned = assignPack(start, PERFORMERS, 'p1', null, AT)
    const rows = buildReport(assigned.plot, PERFORMERS, [
      device('rf:ch-1', { battery: { percent: 5 }, history: { lowestPercent: 5, lowestAt: AT, dropouts: 1 } })
    ], assigned.swaps)

    const text = reportText(rows, AT)

    expect(text).toContain('Mic plot report — 2 packs')
    expect(text).toMatch(/Pack 1 — unassigned, lowest 5% at \d{2}:\d{2}:\d{2}, 1 dropout/)
    expect(text).toContain('Pack 2 — Sancho (comic lead), no reading, no dropouts')
    expect(text).toContain('Swaps (1):')
    expect(text).toMatch(/Pack 1 Aldonza → unassigned/)
  })

  it('says so when nothing changed hands', () => {
    const rows = buildReport(plot(), PERFORMERS, [], [])

    expect(reportText(rows, AT)).toContain('No swaps.')
  })
})

function swap(at: number): RfSwap {
  return { at, packId: 'p1', packLabel: 'Pack 1', from: 'A', to: 'B' }
}
