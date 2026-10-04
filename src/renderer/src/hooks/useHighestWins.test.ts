// What the desk is told when highest wins comes into force or goes out of it: every channel
// the record has on more than one fader, with the new rule, and nothing else.
import { describe, it, expect } from 'vitest'
import { highestWinsResync } from './useHighestWins'
import { defaultDeskSettings, defaultShowSettings, type ShowSettings } from '../../../shared/show'

function show(profile: 'sq' | 'avantis' = 'sq'): ShowSettings {
  const base = defaultShowSettings()
  return {
    ...base,
    desk: { ...defaultDeskSettings(), kind: 'midi-tcp', host: '10.0.0.5', profile },
    cast: {
      ...base.cast,
      channels: [{ id: 'ch-1', name: 'Alex' }, { id: 'ch-2', name: '' }, { id: 'ch-3', name: '' }],
      dcas: [{ id: 'dca-a', deskNumber: null }, { id: 'dca-b', deskNumber: null }, { id: 'dca-c', deskNumber: 7 }]
    },
    scenes: { list: [], allowDuplicateAssignment: true, highestWins: true }
  }
}

const RECORD = {
  mutes: {},
  assignments: { 'ch-1': ['dca-a', 'dca-c'], 'ch-2': ['dca-b'], 'ch-3': [] }
}

describe('highestWinsResync', () => {
  it('hands main each channel on more than one fader, by the desk’s own numbers', () => {
    // An SQ's desk number counts from 0, as its pair writes read it: desk number 7 is DCA 8.
    expect(highestWinsResync(show(), RECORD, true)).toEqual([
      { kind: 'sq-native-rides', channel: 1, dcas: [1, 8], wrote: [1, 8], highest: true }
    ])
  })

  it('tells main to put them back on every fader when highest wins goes', () => {
    expect(highestWinsResync(show(), RECORD, false)).toEqual([
      { kind: 'sq-native-rides', channel: 1, dcas: [1, 8], wrote: [1, 8], highest: false }
    ])
  })

  it('says nothing to a desk main cannot follow', () => {
    expect(highestWinsResync(show('avantis'), RECORD, false)).toEqual([])
  })
})
