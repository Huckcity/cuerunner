// The old schema's first output was the only one that ever played; the new one has a
// master level and pan, and crosspoints. A show written before the change must sound
// the same after it.
import { describe, it, expect } from 'vitest'
import { migrateLegacyAudioRouting } from './audioRouting'

describe('migrateLegacyAudioRouting', () => {
  it('carries a legacy first output into the master level and pan', () => {
    expect(migrateLegacyAudioRouting({
      outputs: [{ volume: 0.6, pan: -0.3 }]
    })).toEqual({ volume: 0.6, pan: -0.3, outputs: null })
  })

  it('ignores a legacy device and channel pair that were never wired to the graph', () => {
    expect(migrateLegacyAudioRouting({
      outputs: [{ deviceId: 'hw1', channelPair: [3, 4], volume: 0.5, pan: -0.2 }]
    })).toEqual({ volume: 0.5, pan: -0.2, outputs: null })
  })

  it('treats a legacy empty output list as the full-level default it meant, not silence', () => {
    expect(migrateLegacyAudioRouting({ outputs: [] }))
      .toEqual({ volume: 1, pan: 0, outputs: null })
  })

  it('fills in defaults for what a legacy cue never wrote', () => {
    expect(migrateLegacyAudioRouting({})).toEqual({ volume: 1, pan: 0, outputs: null })
  })

  it('leaves an already-migrated cue alone, crosspoints included', () => {
    const crosspoints = [{ inputChannel: 0, outputChannel: 2, gain: 0.5 }]
    expect(migrateLegacyAudioRouting({ volume: 0.8, pan: 0.1, outputs: crosspoints }))
      .toEqual({ volume: 0.8, pan: 0.1, outputs: crosspoints })
  })

  it('keeps a deliberate silence silent', () => {
    // [] on a migrated cue is a decision, and must not be read as "automatic".
    expect(migrateLegacyAudioRouting({ volume: 1, pan: 0, outputs: [] }))
      .toEqual({ volume: 1, pan: 0, outputs: [] })
  })

  it('keeps automatic routing automatic', () => {
    expect(migrateLegacyAudioRouting({ volume: 0.5, pan: -1, outputs: null }))
      .toEqual({ volume: 0.5, pan: -1, outputs: null })
  })

  it('clamps values that could not be played', () => {
    expect(migrateLegacyAudioRouting({ outputs: [{ volume: 4, pan: -3 }] }))
      .toEqual({ volume: 1, pan: -1, outputs: null })
  })
})
