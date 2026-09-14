// Recalling a scene is the one thing here that touches the room, so what is tested is
// what goes out on the wire, what is remembered about it, and what happens when the desk
// does not answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { recallScene } from './scenes'
import { useStore } from '../store'
import { midiNoteMessages, oscMessages } from '../utils/cast'
import { ALL_CLOSED_SCENE_ID, defaultShowSettings, type CastSettings, type MicScene } from '../types/show'

const note = midiNoteMessages('Yamaha', 1, 36)
const osc = oscMessages('10.0.0.5', 9000, '/dca/2/mute')

/**
 * Two DCAs, one strip each, and the two performers patched to them: p-1 opens DCA 1 over
 * MIDI, p-2 opens DCA 2 over OSC.
 */
function cast(): CastSettings {
  return {
    channels: [
      { id: 'ch-1', name: 'Ruth', enabled: true, dcaId: 'dca-1' },
      { id: 'ch-2', name: 'Sancho', enabled: true, dcaId: 'dca-2' }
    ],
    performers: [
      { id: 'p-1', name: 'Ruth', role: 'Lead', notes: '', channelId: 'ch-1' },
      { id: 'p-2', name: 'Sancho', role: 'Comic', notes: '', channelId: 'ch-2' }
    ],
    ensembles: [],
    dcas: [
      { id: 'dca-1', label: 'DCA 1 — Principals', mute: note.mute, unmute: note.unmute },
      { id: 'dca-2', label: 'DCA 2 — Ensemble', mute: osc.mute, unmute: osc.unmute }
    ]
  }
}

function scenesList(): MicScene[] {
  return [
    { id: 's-1', name: 'Wedding', live: ['p-1'], ensembles: [], excluded: [], notes: '' },
    { id: 's-2', name: 'Finale', live: ['p-1', 'p-2'], ensembles: [], excluded: [], notes: '' }
  ]
}

function seed(
  deskState: Record<string, boolean> = {},
  deskSceneId: string | null = null,
  settings: CastSettings = cast()
): void {
  useStore.setState({
    showSettings: {
      ...defaultShowSettings(),
      cast: settings,
      scenes: { list: scenesList() }
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

  it('opens the DCAs of an ensemble the scene applies', async () => {
    // p-1 and p-2 in one ensemble, applied by a scene that names nobody: both DCAs open.
    seed({}, null, {
      ...cast(),
      ensembles: [{ id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }]
    })
    useStore.setState(state => ({
      showSettings: {
        ...state.showSettings,
        scenes: {
          list: [
            { id: 's-1', name: 'Chorus number', live: [], ensembles: ['ens-1'], excluded: [], notes: '' }
          ]
        }
      }
    }))

    const result = await recallScene('s-1')

    expect(result.changes.map(change => change.live)).toEqual([true, true])
    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(oscSend).toHaveBeenCalledTimes(1)
  })

  it('drives nothing for a strip that is out of tonight’s patch', async () => {
    seed({}, null, {
      ...cast(),
      channels: [
        { id: 'ch-1', name: 'Ruth', enabled: false, dcaId: 'dca-1' },
        { id: 'ch-2', name: 'Sancho', enabled: true, dcaId: 'dca-2' }
      ]
    })

    await recallScene('s-2')

    // Ruth is open in the finale, but her strip is not in the patch: only DCA 2 is told.
    expect(midiSend).not.toHaveBeenCalled()
    expect(oscSend).toHaveBeenCalledTimes(1)
  })

  it('closes everything the show drives when the all-closed scene is recalled', async () => {
    seed({ 'dca-1': true, 'dca-2': true }, 's-2')

    await recallScene(ALL_CLOSED_SCENE_ID)

    expect(midiSend).toHaveBeenCalledWith(expect.objectContaining({
      messages: [{ kind: 'noteOff', channel: 1, note: 36, velocity: 0 }]
    }))
    expect(useStore.getState().deskState).toEqual({ 'dca-1': false, 'dca-2': false })
    // The desk is somewhere: it is on the scene that is always there, not nowhere.
    expect(useStore.getState().deskSceneId).toBe(ALL_CLOSED_SCENE_ID)
    expect(logMessages()).toEqual(['Mics closed — 2 groups'])
  })

  it('reads a recall of no scene at all the same way', async () => {
    seed({ 'dca-1': true, 'dca-2': true }, 's-2')

    await recallScene(null)

    expect(useStore.getState().deskState).toEqual({ 'dca-1': false, 'dca-2': false })
  })

  it('refuses a scene that is gone rather than closing the stage', async () => {
    // Deleting a scene leaves cues that pointed at it pointing at nothing. Reading that
    // as "nothing is live" would mute every DCA the show drives on the next GO.
    seed({ 'dca-1': true, 'dca-2': true }, 's-1')

    const result = await recallScene('s-deleted')

    expect(result.failures).toEqual(['no scene by that id — it may have been deleted (s-deleted)'])
    expect(result.changes).toEqual([])
    expect(midiSend).not.toHaveBeenCalled()
    expect(oscSend).not.toHaveBeenCalled()
    // The desk is where it was, and still remembers which scene put it there.
    expect(useStore.getState().deskState).toEqual({ 'dca-1': true, 'dca-2': true })
    expect(useStore.getState().deskSceneId).toBe('s-1')
    expect(logMessages()).toEqual(['no scene by that id — it may have been deleted (s-deleted)'])
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
