// The mapping decides what the plot is told about a pack, so it is held to the receiver's
// own captured words: one linked bodypack on AA cells, and channels with nobody on them.
import { describe, it, expect } from 'vitest'
import { audioPercent, channelsFrom, ewDxChannelId, subscriptionPaths } from './mapping'
import { FIXTURE_SERIAL, LINKED_EM4 } from './fixtures'

const resources = (entries = LINKED_EM4): Map<string, unknown> => new Map(entries)

describe('channelsFrom', () => {
  it('reads a linked bodypack into the contract and leaves unlinked channels out', () => {
    expect(channelsFrom(FIXTURE_SERIAL, resources())).toEqual([
      {
        id: ewDxChannelId(FIXTURE_SERIAL, 0),
        name: '37',
        rfDbm: -83,
        // The receiver raised no LowSignal, so its link is fine at a level the show's own
        // line would have called weak.
        rfWeak: false,
        audioLevel: audioPercent(-91.9),
        muted: false,
        batteryPercent: 76,
        frequencyMhz: 606.2
      }
    ])
  })

  it('has no minutes for a pack on AA cells, because the receiver gave none', () => {
    const [channel] = channelsFrom(FIXTURE_SERIAL, resources())
    expect(channel).not.toHaveProperty('batteryMinutes')
  })

  it('reads minutes when a rechargeable pack reports them', () => {
    const rechargeable = resources()
    rechargeable.set('/api/transmitters/0/battery', { type: 'Battery', gauge: 40, lifetime: 95 })
    const [channel] = channelsFrom(FIXTURE_SERIAL, rechargeable)
    expect(channel.batteryPercent).toBe(40)
    expect(channel.batteryMinutes).toBe(95)
  })

  it('leaves a channel out when it names a mate but the receiver warns NoLink', () => {
    const lost = resources()
    lost.set('/api/channel/0/warnings', ['NoLink'])
    expect(channelsFrom(FIXTURE_SERIAL, lost)).toEqual([])
  })

  it('takes the transmitter a mate names, counting from zero', () => {
    const third = resources()
    third.set('/api/channel/2', { name: 'LEAD', mute: false, mates: ['TX3'], gain: 21 })
    third.set('/api/channel/2/warnings', [])
    third.set('/api/channel/2/signalStrengthIndicator', { value: -70 })
    third.set('/api/transmitters/2/battery', { type: 'PrimaryCell', gauge: 55 })
    const channel = channelsFrom(FIXTURE_SERIAL, third).find(c => c.name === 'LEAD')
    expect(channel).toMatchObject({ id: ewDxChannelId(FIXTURE_SERIAL, 2), batteryPercent: 55, rfDbm: -70 })
  })

  it('takes the receiver\'s own LowSignal warning as its verdict that the signal is weak', () => {
    const weak = resources()
    weak.set('/api/channel/0/warnings', ['LowSignal'])
    expect(channelsFrom(FIXTURE_SERIAL, weak)[0].rfWeak).toBe(true)
  })

  it('gives no verdict when the receiver has not said what its warnings are', () => {
    const unknown = resources()
    unknown.delete('/api/channel/0/warnings')
    // Its mate says it is linked, so it is reported; with no warnings there is no verdict on
    // the signal, and none is guessed.
    expect(channelsFrom(FIXTURE_SERIAL, unknown)[0]).not.toHaveProperty('rfWeak')
  })

  describe('what the receiver complains of', () => {
    const complaints = (changes: Array<[string, unknown]>): unknown => {
      const live = resources()
      for (const [path, value] of changes) live.set(path, value)
      return channelsFrom(FIXTURE_SERIAL, live)[0].warnings
    }

    it('says nothing when the receiver complains of nothing', () => {
      expect(channelsFrom(FIXTURE_SERIAL, resources())[0]).not.toHaveProperty('warnings')
    })

    it('says a key that does not match is critical: the pack is linked and nobody hears it', () => {
      expect(complaints([['/api/channel/0/warnings', ['Aes256Error']]])).toEqual([
        { text: 'encryption error — no audio', critical: true }
      ])
    })

    it('words an overload and clipping for the person reading, and does not call them critical', () => {
      expect(complaints([['/api/channel/0/warnings', ['RfPeak', 'AfPeak']]])).toEqual([
        { text: 'RF overload' },
        { text: 'audio clipping' }
      ])
    })

    it('counts clipping once when the pack and the receiver both say it', () => {
      expect(complaints([
        ['/api/channel/0/warnings', ['AfPeak']],
        ['/api/transmitters/0/warnings', ['AfPeak']]
      ])).toEqual([{ text: 'audio clipping' }])
    })

    it('puts what has to be dealt with first', () => {
      expect(complaints([['/api/channel/0/warnings', ['AfPeak', 'Aes256Error']]])).toEqual([
        { text: 'encryption error — no audio', critical: true },
        { text: 'audio clipping' }
      ])
    })

    it('leaves out what the panel already says in its own place, and what it does not know', () => {
      // The battery has its own band, the signal its own verdict, and an absent pack is not a complaint.
      expect(complaints([
        ['/api/channel/0/warnings', ['LowSignal', 'SomethingNewInFirmware5']],
        ['/api/transmitters/0/warnings', ['LowBattery']]
      ])).toBeUndefined()
    })
  })

  it('reports muted when either end is muted', () => {
    const muted = resources()
    muted.set('/api/transmitters/0', { type: 'EW_DX_SK', mute: true })
    expect(channelsFrom(FIXTURE_SERIAL, muted)[0].muted).toBe(true)
  })

  it('drops a reading that is not a number rather than showing it', () => {
    const odd = resources()
    odd.set('/api/channel/0/signalStrengthIndicator', { value: 'loud' })
    odd.set('/api/transmitters/0/battery', { gauge: null })
    const [channel] = channelsFrom(FIXTURE_SERIAL, odd)
    expect(channel).not.toHaveProperty('rfDbm')
    expect(channel).not.toHaveProperty('batteryPercent')
  })

  it('says nothing before the receiver has said anything', () => {
    expect(channelsFrom(FIXTURE_SERIAL, new Map())).toEqual([])
  })
})

describe('audioPercent', () => {
  it('puts silence at 0 and full scale at 100, and clamps outside them', () => {
    expect(audioPercent(-138.5)).toBe(0)
    expect(audioPercent(-60)).toBe(0)
    expect(audioPercent(-30)).toBe(50)
    expect(audioPercent(0)).toBe(100)
    expect(audioPercent(6)).toBe(100)
  })
})

describe('subscriptionPaths', () => {
  it('names the readings of every channel and every transmitter, with the /api prefix', () => {
    const paths = subscriptionPaths(4)
    // Eight readings a channel: its own five, the radio's frequency, and the transmitter's two.
    expect(paths).toHaveLength(4 * 8)
    expect(paths.every(path => path.startsWith('/api/'))).toBe(true)
    expect(paths).toContain('/api/transmitters/3/battery')
    expect(new Set(paths).size).toBe(paths.length)
  })
})
