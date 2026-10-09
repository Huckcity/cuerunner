import { describe, it, expect, vi, afterEach } from 'vitest'
import { normalizeSummary, planNormalize } from './normalize'
import { audioEngine } from '../engine/audioEngineClient'
import type { AudioCue, Cue } from '../../../shared/cue'
import { createCue } from './cueDefaults'
import { parseChannels } from '../components/audio/AudioRoutingSection'

vi.mock('../engine/audioEngineClient')
const engine = vi.mocked(audioEngine)

const audio = (id: string, filePath: string): AudioCue => ({ ...(createCue('audio') as AudioCue), id, filePath })

afterEach(() => vi.clearAllMocks())

describe('normalising a selection', () => {
  it('measures every audio cue with a file and plans one patch for each, the rest left alone', async () => {
    engine.loudness.mockImplementation(async (filePath: string) => ({
      filePath,
      integratedLufs: filePath === '/loud.wav' ? -13 : -70,
      truePeakDb: filePath === '/loud.wav' ? -0.5 : -200,
      samplePeakDb: -1,
      silent: filePath !== '/loud.wav',
      durationMs: 1000,
      sampleRate: 48000,
      channels: 2
    }))
    const cues: Cue[] = [audio('a', '/loud.wav'), audio('b', '/silent.wav'), audio('c', ''), createCue('wait')]
    const { patches, outcomes } = await planNormalize(cues, { outputDeviceId: '', loudnessTargetLufs: -16 })
    expect(engine.loudness).toHaveBeenCalledTimes(2)
    expect(patches.a).toEqual({
      loudness: { filePath: '/loud.wav', integratedLufs: -13, truePeakDb: -0.5, silent: false },
      trim: Number(Math.pow(10, -3 / 20).toFixed(4))
    })
    // A silent file keeps its trim, and its reading is written down.
    expect(patches.b).toEqual({ loudness: { filePath: '/silent.wav', integratedLufs: -70, truePeakDb: -200, silent: true } })
    expect(normalizeSummary(outcomes)).toBe('normalised 1 cue, 1 left as it was')
  })

  it('says which cues the ceiling held short', () => {
    expect(normalizeSummary([
      { cueId: 'a', plan: { trim: 1, gainDb: 0, limitedBy: 'ceiling', resultLufs: -20 }, measured: null, problem: null },
      { cueId: 'b', plan: { trim: 1, gainDb: 0, limitedBy: 'target', resultLufs: -23 }, measured: null, problem: null }
    ])).toBe('normalised 2 cues, 1 held short of the target')
  })
})

describe('a patch\'s outputs as an operator types them', () => {
  it('reads ranges and lists, one-based, into device outputs', () => {
    expect(parseChannels('1-2')).toEqual([0, 1])
    expect(parseChannels('5, 6')).toEqual([4, 5])
    expect(parseChannels('3')).toEqual([2])
    expect(parseChannels('1–4')).toEqual([0, 1, 2, 3])
  })

  it('refuses what is not outputs', () => {
    expect(parseChannels('')).toBeNull()
    expect(parseChannels('0')).toBeNull()
    expect(parseChannels('2-1')).toBeNull()
    expect(parseChannels('33')).toBeNull()
    expect(parseChannels('left')).toBeNull()
  })
})
