// Recalling a scene is the one thing here that touches the room, so what is tested is
// what goes out on the wire, what is remembered about it, and what happens when the desk
// does not answer.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { recallScene } from './scenes'
import { useStore } from '../store'
import { midiNoteMessages } from '../utils/desk'
import {
  ALL_CLOSED_SCENE_ID,
  defaultShowSettings,
  type CastSettings,
  type DeskSettings,
  type MicScene
} from '../types/show'

// The desk the fixtures drive, and what its first two DCAs are sent: the note of their
// own number, on the port and channel the show is pointed at.
const DESK: DeskSettings = {
  kind: 'midi',
  midiPort: 'Yamaha',
  midiChannel: 1,
  host: '127.0.0.1',
  port: 8000,
  address: '/dca/{n}/on'
}
const noteOf = (index: number) => midiNoteMessages('Yamaha', 1, index + 1)

/** Two DCAs, one strip each, and the two performers patched to them. */
function cast(): CastSettings {
  return {
    channels: [
      { id: 'ch-1', name: 'Ruth', dcaId: 'dca-1' },
      { id: 'ch-2', name: 'Sancho', dcaId: 'dca-2' }
    ],
    performers: [
      { id: 'p-1', name: 'Ruth', role: 'Lead', notes: '', channelId: 'ch-1' },
      { id: 'p-2', name: 'Sancho', role: 'Comic', notes: '', channelId: 'ch-2' }
    ],
    ensembles: [],
    dcas: [
      { id: 'dca-1', label: 'DCA 1 — Principals', note: null, address: null },
      { id: 'dca-2', label: 'DCA 2 — Ensemble', note: null, address: null }
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
  settings: CastSettings = cast(),
  desk: DeskSettings = DESK
): void {
  useStore.setState({
    showSettings: {
      ...defaultShowSettings(),
      desk,
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
      messages: [noteOf(0).unmute.message]
    })
    expect(midiSend).toHaveBeenCalledWith({
      portName: 'Yamaha',
      messages: [noteOf(1).mute.message]
    })
    expect(oscSend).not.toHaveBeenCalled()

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

    // Recall the finale: only the second DCA has anything to hear.
    await recallScene('s-2')

    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend.mock.calls[0][0]).toMatchObject({ messages: [noteOf(1).unmute.message] })
  })

  it('opens the DCAs of an ensemble the scene applies', async () => {
    // p-1 and p-2 in one ensemble, applied by a scene that names nobody: both DCAs open.
    seed({}, null, {
      ...cast(),
      ensembles: [{ id: 'ens-1', name: 'Chorus', members: ['p-1', 'p-2'] }]
    }, DESK)
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
    expect(midiSend).toHaveBeenCalledTimes(2)
  })

  it('drives nothing for a strip that is on no fader', async () => {
    seed({}, null, {
      ...cast(),
      channels: [
        { id: 'ch-1', name: 'Ruth', dcaId: null },
        { id: 'ch-2', name: 'Sancho', dcaId: 'dca-2' }
      ]
    })

    await recallScene('s-2')

    // Ruth is open in the finale, but her strip rides no fader: only DCA 2 is told.
    expect(midiSend).toHaveBeenCalledTimes(1)
    expect(midiSend.mock.calls[0][0]).toMatchObject({ messages: [noteOf(1).unmute.message] })
  })

  it('closes everything the show drives when the all-closed scene is recalled', async () => {
    seed({ 'dca-1': true, 'dca-2': true }, 's-2')

    await recallScene(ALL_CLOSED_SCENE_ID)

    expect(midiSend).toHaveBeenCalledWith(expect.objectContaining({
      messages: [noteOf(0).mute.message]
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

  it('does not pretend a DCA was told when the desk did not answer', async () => {
    // The first message gets there and the second does not: what landed is remembered,
    // and the next recall tries the rest again.
    midiSend.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, error: 'no such port' })

    const result = await recallScene('s-1')

    expect(result.failures).toEqual(['DCA 2 — Ensemble: noteOff ch1 → "Yamaha"'])
    expect(useStore.getState().deskState).toEqual({ 'dca-1': true })
    expect(logMessages()).toEqual([
      'Scene "Wedding" — 1 opened, 1 closed',
      'Could not reach the desk: DCA 2 — Ensemble: noteOff ch1 → "Yamaha"'
    ])
  })

  it('carries on when the desk throws rather than refusing', async () => {
    midiSend.mockRejectedValue(new Error('port closed'))

    const result = await recallScene('s-1')

    expect(result.failures).toHaveLength(2)
  })
})
