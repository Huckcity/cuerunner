// The pre-show check answers one question from what is already known. These hold what counts as
// not ready and what is only worth a look, so a pack is not failed for a spare in the case or
// passed with a key that does not match.
import { describe, it, expect } from 'vitest'
import { preshowCheck, preshowText } from './rfPreshow'
import type { PreshowEntry } from './rfPreshow'
import { defaultRfThresholds } from '../../../shared/show'
import type { DeviceState, RfPack } from '../../../shared/show'

const thresholds = defaultRfThresholds()

const pack = (label: string, channelId: string | null = `ch-${label}`): RfPack => ({
  id: `p-${label}`, label, channelId, performerId: null, notes: ''
})

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  id: 'rf:x', service: 'rf', name: 'x', online: true, lastSeen: 1, battery: { percent: 90 }, ...overrides
})

const entry = (label: string, d?: Partial<DeviceState> | null, channelId: string | null = `ch-${label}`): PreshowEntry => ({
  pack: pack(label, channelId),
  device: d === null ? undefined : device(d)
})

describe('preshowCheck', () => {
  it('says there is nothing to check, rather than that everything is ready, for an empty rack', () => {
    expect(preshowCheck([], thresholds)).toEqual({ verdict: 'nothing', total: 0, ready: 0, items: [] })
  })

  it('calls a rack ready when every pack is reporting, charged and clear', () => {
    const check = preshowCheck([entry('1'), entry('2')], thresholds)
    expect(check).toMatchObject({ verdict: 'ready', total: 2, ready: 2, items: [] })
  })

  it('fails a pack that is not reporting, and one that stopped', () => {
    const check = preshowCheck([entry('1', null), entry('2', { online: false })], thresholds)
    expect(check.verdict).toBe('not-ready')
    expect(check.items.map(item => [item.label, item.readiness, item.reasons])).toEqual([
      ['1', 'not-ready', ['not reporting — is it switched on?']],
      ['2', 'not-ready', ['stopped reporting']]
    ])
  })

  it('fails a battery at the urgent line and only flags one at the low line, at the thresholds exactly', () => {
    const check = preshowCheck([
      entry('urgent', { battery: { percent: thresholds.batteryCritical } }),
      entry('low', { battery: { percent: thresholds.batteryWarning } }),
      entry('fine', { battery: { percent: thresholds.batteryWarning + 1 } })
    ], thresholds)
    expect(check.items.map(item => [item.label, item.readiness])).toEqual([
      ['urgent', 'not-ready'],
      ['low', 'attention']
    ])
    expect(check.ready).toBe(1)
  })

  it('fails a key that does not match whatever the battery says, and flags clipping', () => {
    const check = preshowCheck([
      entry('keys', { warnings: [{ text: 'encryption error — no audio', critical: true }] }),
      entry('clip', { warnings: [{ text: 'audio clipping' }] })
    ], thresholds)
    expect(check.items).toEqual([
      { packId: 'p-keys', label: 'keys', readiness: 'not-ready', reasons: ['encryption error — no audio'] },
      { packId: 'p-clip', label: 'clip', readiness: 'attention', reasons: ['audio clipping'] }
    ])
  })

  it('takes a receiver\'s own verdict on the signal over the show\'s dBm line', () => {
    const check = preshowCheck([
      entry('fine', { rf: { level: -83, unit: 'dBm', weak: false } }),
      entry('weak', { rf: { level: -40, unit: 'dBm', weak: true } }),
      entry('line', { rf: { level: thresholds.rfWarningDbm, unit: 'dBm' } })
    ], thresholds)
    expect(check.items.map(item => item.label)).toEqual(['weak', 'line'])
    expect(check.items[0].reasons).toEqual(['signal weak — -40 dBm'])
  })

  describe('what the pack used last time', () => {
    const withPast = (percent: number, used?: number): PreshowEntry =>
      entry('1', { battery: { percent }, ...(used === undefined ? {} : { history: { dropouts: 0, lastUsedPercent: used } }) })

    it('flags a charge that a show would use up, at the exact line: a quarter more than last time, and the urgent line spare', () => {
      // 24% used, a quarter more is 30; to end above the urgent line (10) it has to start above 40.
      expect(preshowCheck([withPast(40, 24)], thresholds).items[0]?.reasons).toEqual(['battery 40% — a show used 24% last time'])
      expect(preshowCheck([withPast(41, 24)], thresholds).items).toEqual([])
    })

    it('says nothing for a pack with no past, or one that used little', () => {
      expect(preshowCheck([withPast(40)], thresholds).items).toEqual([])
      expect(preshowCheck([withPast(40, 3)], thresholds).items).toEqual([])
    })

    it('does not say it twice when the reading alone has already said the battery is low', () => {
      const check = preshowCheck([withPast(20, 24)], thresholds)
      expect(check.items[0].reasons).toEqual(['battery 20%'])
    })

    it('is worth a look and never a failure: the past is not a promise', () => {
      expect(preshowCheck([withPast(40, 24)], thresholds).verdict).toBe('attention')
    })
  })

  it('flags a pack muted at the receiver, which nobody wants to learn from the stalls', () => {
    const check = preshowCheck([entry('1', { audio: { level: 0, muted: true } })], thresholds)
    expect(check.items[0]).toMatchObject({ readiness: 'attention', reasons: ['muted at the receiver'] })
  })

  it('does not fail a pack with no channel, which is a patch waiting to be made', () => {
    const check = preshowCheck([entry('spare', null, null)], thresholds)
    expect(check.verdict).toBe('attention')
    expect(check.items[0].reasons).toEqual(['no channel patched'])
  })

  it('puts the worst reason of a pack first, and the packs that would fail first at the top', () => {
    const check = preshowCheck([
      entry('a', { battery: { percent: 20 } }),
      entry('b', { battery: { percent: 5 }, audio: { level: 0, muted: true } }),
      entry('c', { battery: { percent: 25 } })
    ], thresholds)
    expect(check.items.map(item => item.label)).toEqual(['b', 'a', 'c'])
    expect(check.items[0].reasons).toEqual(['battery 5%', 'muted at the receiver'])
    expect(check.verdict).toBe('not-ready')
  })

  it('says attention, not not-ready, when nothing is worse than worth a look', () => {
    expect(preshowCheck([entry('1', { battery: { percent: 20 } })], thresholds).verdict).toBe('attention')
  })
})

describe('preshowText', () => {
  it('is a line a person can paste to whoever is on the deck', () => {
    const check = preshowCheck([entry('1'), entry('2', { battery: { percent: 5 } }), entry('3', { audio: { level: 0, muted: true } })], thresholds)
    expect(preshowText(check)).toBe(
      ['1 of 3 packs ready.', 'NOT READY 2: battery 5%', 'check 3: muted at the receiver'].join('\n')
    )
  })

  it('says so when everything is ready, and when there is nothing', () => {
    expect(preshowText(preshowCheck([entry('1')], thresholds))).toBe('All 1 pack ready.')
    expect(preshowText(preshowCheck([entry('1'), entry('2')], thresholds))).toBe('All 2 packs ready.')
    expect(preshowText(preshowCheck([], thresholds))).toBe('No packs to check.')
  })
})
