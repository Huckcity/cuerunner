// The demo rack is the one-click way to see the wireless panel do something: a source
// the main process simulates, twelve packs, and the performers who wear them. These
// tests hold the two lists together — the ids have to agree, or the demo shows twelve
// unpatched rows.
import { describe, it, expect } from 'vitest'
import { demoPacks, demoPerformers, demoSource } from './rfDemo'
import {
  DEFAULT_POLL_MS,
  DEFAULT_TIMEOUT_MS,
  DEMO_PACK_COUNT,
  DEMO_SOURCE_ID,
  demoChannelId,
  startingChannels,
  startingDcas
} from '../types/show'

describe('demoSource', () => {
  it('describes an in-process rack with no target to poll', () => {
    expect(demoSource()).toEqual({
      id: DEMO_SOURCE_ID,
      label: 'Demo rack',
      kind: 'demo',
      target: '',
      pollMs: DEFAULT_POLL_MS,
      timeoutMs: DEFAULT_TIMEOUT_MS
    })
  })

  it('returns a fresh source each time so a store update is never a no-op', () => {
    expect(demoSource()).not.toBe(demoSource())
  })
})

describe('demoPacks and demoPerformers', () => {
  it('patches twelve packs to the twelve demo channels', () => {
    const packs = demoPacks()

    expect(packs).toHaveLength(DEMO_PACK_COUNT)
    expect(packs.map(p => p.label)).toEqual(
      Array.from({ length: DEMO_PACK_COUNT }, (_, i) => `Pack ${i + 1}`)
    )
    expect(packs.map(p => p.channelId)).toEqual(
      Array.from({ length: DEMO_PACK_COUNT }, (_, i) => demoChannelId(i + 1))
    )
  })

  it('gives every pack a distinct performer that exists in the cast', () => {
    const packs = demoPacks()
    const performers = demoPerformers()

    expect(performers).toHaveLength(DEMO_PACK_COUNT)
    expect(new Set(performers.map(p => p.id)).size).toBe(DEMO_PACK_COUNT)
    expect(new Set(packs.map(p => p.performerId)).size).toBe(DEMO_PACK_COUNT)
    for (const pack of packs) {
      expect(performers.some(p => p.id === pack.performerId)).toBe(true)
    }
  })

  it('patches every performer to the strip of their own number, so a scene moves them', () => {
    const channels = startingChannels(startingDcas())
    const performers = demoPerformers(channels)

    // A performer with no strip is a row no scene can open, and the demo is the show
    // somebody opens a scene on to see what the view does.
    expect(performers.map(p => p.channelId)).toEqual(channels.map(channel => channel.id))

    // With no console to patch them to, they are left unpatched rather than invented.
    expect(demoPerformers().every(p => p.channelId === null)).toBe(true)
  })

  it('casts the principals the panel names', () => {
    const packs = demoPacks()
    const performers = demoPerformers()

    expect(performers.find(p => p.id === packs[0].performerId))
      .toMatchObject({ name: 'Aldonza', role: 'lead' })
    expect(performers.find(p => p.id === packs[1].performerId))
      .toMatchObject({ name: 'Sancho', role: 'comic lead' })
    expect(performers.find(p => p.id === packs[6].performerId))
      .toMatchObject({ name: 'Antonia', role: 'supporting' })
  })

  it('hands the panel a role for every performer', () => {
    const performers = demoPerformers()

    expect(performers.map(p => p.role)).toEqual([
      'lead', 'comic lead', 'lead', 'ensemble', 'ensemble', 'ensemble',
      'supporting', 'supporting', 'featured', 'featured', 'ensemble', 'ensemble'
    ])
  })
})
