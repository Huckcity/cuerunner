// The banding and the parser are where "is this an alarm?" is decided, so they are
// tested with no service, no clock and no source behind them — and the demo rack's
// readings have to stay inside the ranges the panel is promised.
import { describe, it, expect } from 'vitest'
import { batteryBand, demoRack, isWorse, parseTelemetry, rfBand } from './telemetry'
import { DEMO_PACK_COUNT, defaultRfThresholds, demoChannelId } from '../../renderer/src/types/show'
import type { TelemetryChannel, TelemetryDocument } from '../../renderer/src/types/show'

const thresholds = defaultRfThresholds()

describe('banding', () => {
  it('bands a battery at the exact lines the thresholds set', () => {
    expect(batteryBand(thresholds.batteryCritical, thresholds)).toBe('critical')
    expect(batteryBand(thresholds.batteryCritical + 1, thresholds)).toBe('warning')
    expect(batteryBand(thresholds.batteryWarning, thresholds)).toBe('warning')
    expect(batteryBand(thresholds.batteryWarning + 1, thresholds)).toBe('ok')
  })

  it('warns on RF at the line and only below it', () => {
    expect(rfBand(thresholds.rfWarningDbm, thresholds)).toBe('warning')
    expect(rfBand(thresholds.rfWarningDbm + 1, thresholds)).toBe('ok')
    expect(rfBand(-90, thresholds)).toBe('warning')
  })

  it('calls a band worse only when it has moved down', () => {
    expect(isWorse('warning', 'ok')).toBe(true)
    expect(isWorse('critical', 'warning')).toBe(true)
    expect(isWorse('critical', 'ok')).toBe(true)
    expect(isWorse('warning', 'warning')).toBe(false)
    expect(isWorse('ok', 'critical')).toBe(false)
  })
})

describe('parseTelemetry', () => {
  it('keeps the contract fields and drops the ones that are not readings', () => {
    const parsed = parseTelemetry({
      channels: [
        {
          id: 'p1',
          name: 'Pack 1',
          batteryPercent: 12,
          batteryMinutes: 30,
          charging: true,
          rfDbm: -80,
          audioLevel: 55,
          muted: true,
          frequencyMhz: 470.5
        },
        // A bridge that sends a string where a number belongs is sending no reading, not
        // a reading of NaN.
        { id: 'p2', batteryPercent: '12', rfDbm: null, audioLevel: Number.NaN, charging: 'yes' },
        { id: 'p3', somethingElse: 'ignored' }
      ]
    })

    expect(parsed).toEqual({
      channels: [
        {
          id: 'p1',
          name: 'Pack 1',
          batteryPercent: 12,
          batteryMinutes: 30,
          charging: true,
          rfDbm: -80,
          audioLevel: 55,
          muted: true,
          frequencyMhz: 470.5
        },
        { id: 'p2' },
        { id: 'p3' }
      ]
    })
  })

  it('rejects a document that is not the contract at all', () => {
    expect(parseTelemetry(null)).toBeNull()
    expect(parseTelemetry('channels')).toBeNull()
    expect(parseTelemetry({})).toBeNull()
    expect(parseTelemetry({ channels: {} })).toBeNull()
    expect(parseTelemetry({ channels: [null] })).toBeNull()
    expect(parseTelemetry({ channels: [{ name: 'no id' }] })).toBeNull()
    expect(parseTelemetry({ channels: [{ id: 7 }] })).toBeNull()
  })

  it('accepts an empty rack, and a channel that reports nothing', () => {
    expect(parseTelemetry({ channels: [] })).toEqual({ channels: [] })
    expect(parseTelemetry({ channels: [{ id: 'p1' }] })).toEqual({ channels: [{ id: 'p1' }] })
  })
})

describe('demoRack', () => {
  const start = 1_800_000_000_000

  function packAt(document: TelemetryDocument, index: number): TelemetryChannel {
    const channel = document.channels.find(candidate => candidate.id === demoChannelId(index))
    if (!channel) throw new Error(`the demo rack has no pack ${index}`)
    return channel
  }

  it('reports every pack but the one that never answers', () => {
    const document = demoRack(start)

    expect(document.channels).toHaveLength(DEMO_PACK_COUNT - 1)
    expect(document.channels[0].id).toBe(demoChannelId(1))
    expect(document.channels[0].name).toBe('Pack 1')
    expect(document.channels.at(-1)?.name).toBe(`Pack ${DEMO_PACK_COUNT}`)
    expect(document.channels.some(channel => channel.id === demoChannelId(7))).toBe(false)
  })

  it('gives the show one critical pack, one low pack and a healthy rest', () => {
    const document = demoRack(start)

    expect(batteryBand(packAt(document, 1).batteryPercent ?? 0, thresholds)).toBe('critical')
    expect(batteryBand(packAt(document, 2).batteryPercent ?? 0, thresholds)).toBe('warning')
    for (const channel of document.channels) {
      if (channel.id === demoChannelId(1) || channel.id === demoChannelId(2)) continue
      expect(channel.batteryPercent).toBeGreaterThanOrEqual(60)
      expect(channel.batteryPercent).toBeLessThanOrEqual(100)
    }
  })

  it('keeps every reading inside the ranges a healthy rack reports', () => {
    for (const channel of demoRack(start).channels) {
      expect(Number.isFinite(channel.batteryPercent)).toBe(true)
      expect(channel.rfDbm).toBeGreaterThanOrEqual(-70)
      expect(channel.rfDbm).toBeLessThanOrEqual(-50)
      // Above the warning line, so the simulation never invents an RF alarm.
      expect(channel.rfDbm).toBeGreaterThan(thresholds.rfWarningDbm)
      expect(channel.audioLevel).toBeGreaterThanOrEqual(40)
      expect(channel.audioLevel).toBeLessThanOrEqual(100)
      expect(channel.frequencyMhz).toBeGreaterThan(400)
      expect(channel.batteryMinutes).toBeGreaterThan(0)
    }
  })

  it('drifts the batteries down without crossing a band in a minute', () => {
    const before = demoRack(start)
    const after = demoRack(start + 60_000)

    for (const channel of after.channels) {
      const earlier = packAt(before, Number(channel.id.split('-').at(-1)))
      expect(channel.batteryPercent).toBeLessThan(earlier.batteryPercent ?? 0)
      expect(batteryBand(channel.batteryPercent ?? 0, thresholds)).toBe(
        batteryBand(earlier.batteryPercent ?? 0, thresholds)
      )
    }
  })
})
