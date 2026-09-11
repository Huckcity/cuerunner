// The plot's operations are pure so the editor stays small — and the swaps they produce
// are what the show report is read from the next morning. What is tested here is the
// record: who a pack came off, who it went to, and what the night did to its battery.
import { describe, it, expect } from 'vitest'
import {
  MAX_SWAPS,
  addPack,
  addPerformer,
  assignPack,
  buildReport,
  describeSwap,
  recordSwaps,
  removePack,
  removePerformer,
  reportText,
  updatePack,
  updatePerformer
} from './rfPlot'
import type { DeviceState, RfPlot, RfSwap } from '../types/show'

const AT = Date.parse('2026-09-11T20:14:00.000Z')

function plot(): RfPlot {
  const withCast = addPerformer(addPerformer({ performers: [], packs: [] }, 'Aldonza', 'lead'), 'Sancho', 'comic lead')
  const [aldonza, sancho] = withCast.performers
  return {
    performers: withCast.performers,
    packs: [
      { id: 'p1', label: 'Pack 1', channelId: 'ch-1', performerId: aldonza.id, notes: '' },
      { id: 'p2', label: 'Pack 2', channelId: 'ch-2', performerId: sancho.id, notes: '' }
    ]
  }
}

function device(id: string, overrides: Partial<DeviceState> = {}): DeviceState {
  return { id, service: 'rf', name: id, online: true, lastSeen: AT, ...overrides }
}

describe('plot edits', () => {
  it('adds performers and packs without inventing assignments', () => {
    const added = addPack(addPerformer({ performers: [], packs: [] }, 'Aldonza', 'lead'), 'Pack 9')

    expect(added.performers[0]).toMatchObject({ name: 'Aldonza', role: 'lead' })
    expect(added.packs[0]).toMatchObject({ label: 'Pack 9', channelId: null, performerId: null })
    // Fresh ids, so a pack can be added twice without the two colliding.
    expect(added.performers[0].id).not.toBe(added.packs[0].id)
  })

  it('updates and removes by id, leaving the rest alone', () => {
    const start = plot()
    const renamed = updatePerformer(start, start.performers[0].id, { name: 'Aldonza (cover)' })
    const repatched = updatePack(start, 'p1', { channelId: 'ch-9', notes: 'wig mic' })

    expect(renamed.performers[0].name).toBe('Aldonza (cover)')
    expect(renamed.performers[1].name).toBe('Sancho')
    expect(repatched.packs[0]).toMatchObject({ channelId: 'ch-9', notes: 'wig mic', label: 'Pack 1' })
    expect(removePack(start, 'p1').packs.map(pack => pack.id)).toEqual(['p2'])
    expect(start.packs).toHaveLength(2)
  })
})

describe('assignPack', () => {
  it('records a swap with the names as they were', () => {
    const start = plot()
    const { plot: next, swaps } = assignPack(start, 'p1', start.performers[1].id, AT)

    expect(next.packs[0].performerId).toBe(start.performers[1].id)
    expect(swaps).toEqual([
      { at: AT, packId: 'p1', packLabel: 'Pack 1', from: 'Aldonza', to: 'Sancho' }
    ])

    // Renaming afterwards must not rewrite what the report says happened on the night.
    const renamed = updatePerformer(next, start.performers[0].id, { name: 'Someone else' })
    expect(renamed.performers[0].name).toBe('Someone else')
    expect(swaps[0].from).toBe('Aldonza')
  })

  it('records a pack coming off someone as a swap to nobody', () => {
    const start = plot()
    const { swaps } = assignPack(start, 'p1', null, AT)

    expect(swaps[0]).toMatchObject({ from: 'Aldonza', to: null })
    expect(describeSwap(swaps[0])).toBe('Pack 1 Aldonza → unassigned')
  })

  it('says nothing when nothing changed, or when the pack is not there', () => {
    const start = plot()

    expect(assignPack(start, 'p1', start.packs[0].performerId, AT).swaps).toEqual([])
    expect(assignPack(start, 'nope', null, AT)).toEqual({ plot: start, swaps: [] })
  })
})

describe('removePerformer', () => {
  it('releases their packs, and says who each one came off', () => {
    const start = plot()
    const { plot: next, swaps } = removePerformer(start, start.performers[0].id, AT)

    expect(next.performers.map(performer => performer.name)).toEqual(['Sancho'])
    expect(next.packs[0].performerId).toBeNull()
    expect(next.packs[1].performerId).toBe(start.performers[1].id)
    expect(swaps).toEqual([
      { at: AT, packId: 'p1', packLabel: 'Pack 1', from: 'Aldonza', to: null }
    ])
  })

  it('changes nothing for an id that is not in the plot', () => {
    const start = plot()

    expect(removePerformer(start, 'nobody', AT)).toEqual({ plot: start, swaps: [] })
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
    const assigned = assignPack(start, 'p1', start.performers[1].id, AT)
    const devices = [
      device('rf:ch-1', {
        battery: { percent: 42 },
        history: { lowestPercent: 6, lowestAt: AT, dropouts: 2 }
      })
    ]

    const rows = buildReport(assigned.plot, devices, assigned.swaps)
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

    const [row] = buildReport(start, devices, [])

    expect(row.lowestPercent).toBe(3)
    expect(row.dropouts).toBe(2)
    expect(row.device?.battery).toBeUndefined()
    expect(reportText([row], AT)).toContain('lowest 3%')
  })

  it('counts the dropouts of a pack that never reported a battery', () => {
    // It has no floor to report and it certainly has dropouts: saying "no dropouts"
    // because there is no battery reading would be the report lying about the night.
    const start = plot()
    const rows = buildReport(start, [
      device('rf:ch-1', { online: false, history: { dropouts: 1 } })
    ], [])

    expect(rows[0].lowestPercent).toBeNull()
    expect(rows[0].dropouts).toBe(1)
    expect(reportText(rows, AT)).toContain('Pack 1 — Aldonza (lead), no reading, 1 dropout')
  })

  it('leaves a pack with no channel out of the device lookup', () => {
    const start = addPack({ performers: [], packs: [] }, 'Spare')

    const [row] = buildReport(start, [device('rf:ch-1')], [])

    expect(row.device).toBeUndefined()
    expect(row.performer).toBeNull()
  })
})

describe('reportText', () => {
  it('reads as a report of the night', () => {
    const start = plot()
    const assigned = assignPack(start, 'p1', null, AT)
    const rows = buildReport(assigned.plot, [
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
    const rows = buildReport(plot(), [], [])

    expect(reportText(rows, AT)).toContain('No swaps.')
  })
})

function swap(at: number): RfSwap {
  return { at, packId: 'p1', packLabel: 'Pack 1', from: 'A', to: 'B' }
}
