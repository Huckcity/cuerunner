// An incident is a change, noted with what was playing when it happened. These hold what is and is
// not a change — a pack that stays weak, a device seen for the first time, a pack that comes
// back — and that the cue is the one that was playing then, said as a fact.
import { describe, it, expect } from 'vitest'
import { cueWords, incidentsFrom } from './rfIncidents'
import type { IncidentCue } from './rfIncidents'
import { defaultRfThresholds } from '../../../shared/show'
import type { DeviceEvent, DeviceState } from '../../../shared/show'

const thresholds = defaultRfThresholds()
const AT = 1_700_000_000_000
const walkIn: IncidentCue = { number: '47', name: 'Walk-in' }

const device = (overrides: Partial<DeviceState> = {}): DeviceState => ({
  id: 'rf:ch-1', service: 'rf', name: 'Pack 7', online: true, lastSeen: AT, ...overrides
})
const event = (d: DeviceState, at = AT): DeviceEvent => ({ kind: 'device', at, device: d })

describe('incidentsFrom', () => {
  it('notes a pack going quiet, with the cue that was playing and what the pack was called', () => {
    const incidents = incidentsFrom([device()], [event(device({ online: false }), AT + 5)], thresholds, walkIn)

    expect(incidents).toEqual([
      { at: AT + 5, channelId: 'ch-1', name: 'Pack 7', kind: 'dropout', text: 'went quiet', cue: walkIn }
    ])
  })

  it('says between cues when nothing was playing, and does not guess', () => {
    const [incident] = incidentsFrom([device()], [event(device({ online: false }))], thresholds, null)
    expect(incident.cue).toBeNull()
  })

  it('notes a signal turning weak once, and not while it stays weak', () => {
    const weak = device({ rf: { level: -80, unit: 'dBm' } })
    const first = incidentsFrom([device({ rf: { level: -60, unit: 'dBm' } })], [event(weak)], thresholds, walkIn)
    expect(first.map(i => [i.kind, i.text])).toEqual([['weak', 'signal weak']])

    expect(incidentsFrom([weak], [event(device({ rf: { level: -82, unit: 'dBm' } }))], thresholds, walkIn)).toEqual([])
  })

  it('takes the receiver\'s own verdict on the signal over the show\'s dBm line', () => {
    const fine = device({ rf: { level: -60, unit: 'dBm', weak: false } })
    const weak = device({ rf: { level: -40, unit: 'dBm', weak: true } })
    expect(incidentsFrom([fine], [event(weak)], thresholds, walkIn)).toHaveLength(1)
    expect(incidentsFrom([device({ rf: { level: -60, unit: 'dBm' } })], [event(device({ rf: { level: -90, unit: 'dBm', weak: false } }))], thresholds, walkIn)).toEqual([])
  })

  it('notes each complaint when it first appears, marking a critical one, and not while it stands', () => {
    const clipping = device({ warnings: [{ text: 'audio clipping' }] })
    const both = device({ warnings: [{ text: 'audio clipping' }, { text: 'encryption error — no audio', critical: true }] })

    expect(incidentsFrom([device()], [event(clipping)], thresholds, walkIn).map(i => i.text)).toEqual(['audio clipping'])
    const added = incidentsFrom([clipping], [event(both)], thresholds, walkIn)
    expect(added).toEqual([expect.objectContaining({ kind: 'warning', text: 'encryption error — no audio', critical: true })])
  })

  it('does not call a device it has never seen a change: it may be new, or the window may have just reloaded', () => {
    expect(incidentsFrom([], [event(device({ online: false }))], thresholds, walkIn)).toEqual([])
  })

  it('does not note a pack coming back, or readings of a pack that is quiet', () => {
    expect(incidentsFrom([device({ online: false })], [event(device())], thresholds, walkIn)).toEqual([])
    expect(incidentsFrom(
      [device({ online: false })],
      [event(device({ online: false, warnings: [{ text: 'audio clipping' }] }))],
      thresholds,
      walkIn
    )).toEqual([])
  })

  it('reads a batch in order, so a pack that drops and comes back inside it is noted once', () => {
    const batch = [event(device({ online: false }), AT + 1), event(device(), AT + 2), event(device({ online: false }), AT + 3)]
    expect(incidentsFrom([device()], batch, thresholds, walkIn).map(i => i.at)).toEqual([AT + 1, AT + 3])
  })

  it('leaves other services\' devices and other kinds of event alone', () => {
    const amp = device({ id: 'presence:amp', service: 'presence' })
    expect(incidentsFrom([amp], [event(device({ id: 'presence:amp', service: 'presence', online: false }))], thresholds, walkIn)).toEqual([])
    expect(incidentsFrom([], [{ kind: 'osc', at: AT, address: '/x', args: [], from: '' } as never], thresholds, walkIn)).toEqual([])
  })
})

describe('cueWords', () => {
  it('names a cue by its number and name, or says between cues', () => {
    expect(cueWords(walkIn)).toBe('cue 47 Walk-in')
    expect(cueWords(null)).toBe('between cues')
  })

  it('copes with a cue that has only a number, only a name, or neither', () => {
    expect(cueWords({ number: '12', name: '' })).toBe('cue 12')
    expect(cueWords({ number: '', name: 'Blackout' })).toBe('cue Blackout')
    expect(cueWords({ number: ' ', name: ' ' })).toBe('a cue with no name')
  })
})
