// Recalling a scene is the one thing here that touches the room, so what is tested is
// what goes out on the wire, what is remembered about it, and what happens when the desk
// does not answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { recallScene } from './scenes'
import { useStore } from '../store'
import { midiNoteMessages, oscMessages } from '../utils/scenes'
import { defaultShowSettings, type ScenesSettings } from '../types/show'
import type { RfPack } from '../types/show'

const note = midiNoteMessages('Yamaha', 1, 36)
const osc = oscMessages('10.0.0.5', 9000, '/dca/2/mute')

function scenes(): ScenesSettings {
  return {
    locked: false,
    channels: [
      { id: 'dca-1', label: 'DCA 1 — Principals', mute: note.mute, unmute: note.unmute },
      { id: 'dca-2', label: 'DCA 2 — Ensemble', mute: osc.mute, unmute: osc.unmute }
    ],
    list: [
      { id: 's-1', name: 'Wedding', live: ['pack-1'], notes: '' },
      { id: 's-2', name: 'Finale', live: ['pack-1', 'pack-2'], notes: '' }
    ]
  }
}

function pack(id: string, deskChannelId: string): RfPack {
  return { id, label: id, channelId: null, performerId: null, notes: '', deskChannelId }
}

function seed(deskState: Record<string, boolean> = {}, deskSceneId: string | null = null): void {
  const settings = defaultShowSettings()
  useStore.setState({
    showSettings: {
      ...settings,
      scenes: scenes(),
      rf: { ...settings.rf, plot: { performers: [], packs: [pack('pack-1', 'dca-1'), pack('pack-2', 'dca-2')] } }
    },
    deskState,
    deskSceneId,
    log: []
  })
}

function logMessages(): string[] {
  return useStore.getState().log.map(entry => entry.message)
}

describe('recallScene', () => {
  let midiSend: ReturnType<typeof vi.fn>
  let oscSend: ReturnType<typeof vi.fn>

  beforeEach(() => {
    midiSend = vi.mocked(window.winslab.midi.send)
    oscSend = vi.mocked(window.winslab.osc.send)
    midiSend.mockResolvedValue({ ok: true })
    oscSend.mockResolvedValue({ ok: true })
    seed()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('opens what the scene needs, closes the rest, and remembers where the desk is', async () => {
    const result = await recallScene('s-1')

    expect(result.failures).toEqual([])
    // DCA 1 carries the live mic: opened. DCA 2's mic is closed: muted. Nothing else.
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [{ kind: 'noteOn', channel: 1, note: 36, velocity: 127 }]
    })
    expect(oscSend).toHaveBeenCalledWith({
      host: '10.0.0.5', port: 9000, address: '/dca/2/mute', args: [{ type: 'i', value: 0 }]
    })

    expect(useStore.getState().deskState).toEqual({ 'dca-1': true, 'dca-2': false })
    expect(useStore.getState().deskSceneId).toBe('s-1')
    expect(logMessages()).toEqual(['Scene "Wedding" — 1 opened, 1 closed'])
  })

  it('says nothing to a desk that is already where the scene wants it', async () => {
    seed({ 'dca-1': true, 'dca-2': false }, 's-1')

    const result = await recallScene('s-1')

    expect(result.changes).toEqual([])
    expect(midiSend).not.toHaveBeenCalled()
    expect(oscSend).not.toHaveBeenCalled()
    expect(logMessages()).toEqual(['Scene "Wedding" — desk already set'])
  })

  it('sends only the difference after a scene has been edited', async () => {
    seed({ 'dca-1': true, 'dca-2': false }, 's-1')

    // Recall the finale: only the second group has anything to hear.
    await recallScene('s-2')

    expect(midiSend).not.toHaveBeenCalled()
    expect(oscSend).toHaveBeenCalledTimes(1)
    expect(oscSend.mock.calls[0][0]).toMatchObject({ args: [{ type: 'i', value: 1 }] })
  })

  it('closes everything the plot drives when there is no scene', async () => {
    seed({ 'dca-1': true, 'dca-2': true }, 's-2')

    await recallScene(null)

    expect(midiSend).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ kind: 'noteOff', channel: 1, note: 36, velocity: 0 }]
    }))
    expect(useStore.getState().deskState).toEqual({ 'dca-1': false, 'dca-2': false })
    expect(useStore.getState().deskSceneId).toBeNull()
    expect(logMessages()).toEqual(['Mics closed — 2 groups'])
  })

  it('does not pretend a group was told when the desk did not answer', async () => {
    midiSend.mockResolvedValue({ ok: false, error: 'no such port' })

    const result = await recallScene('s-1')

    // The OSC group got there; the MIDI one did not, so it is not remembered as set and
    // the next recall will try it again.
    expect(result.failures).toEqual(['DCA 1 — Principals: noteOn ch1 → "Yamaha"'])
    expect(useStore.getState().deskState).toEqual({ 'dca-2': false })
    expect(logMessages()).toEqual([
      'Scene "Wedding" — 1 opened, 1 closed',
      'Could not reach the desk: DCA 1 — Principals: noteOn ch1 → "Yamaha"'
    ])
  })

  it('carries on when the desk throws rather than refusing', async () => {
    midiSend.mockRejectedValue(new Error('port closed'))

    const result = await recallScene('s-1')

    expect(result.failures).toHaveLength(1)
    expect(oscSend).toHaveBeenCalledTimes(1)
  })
})
