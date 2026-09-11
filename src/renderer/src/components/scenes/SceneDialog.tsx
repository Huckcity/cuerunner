import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { useStore } from '../../store'
import { OSC_DEFAULTS } from '../../utils/cueDefaults'
import {
  addDeskChannel,
  addScene,
  describeDeskMessage,
  midiNoteMessages,
  oscMessages,
  removeDeskChannel,
  removeScene,
  setPackLive,
  updateDeskChannel,
  updateScene
} from '../../utils/scenes'
import type { DeskChannel, ScenesSettings } from '../../types/show'
import './SceneDialog.css'

// A group with no patch of its own yet: one address per group, opened with a 1 and
// closed with a 0, on the host and port an OSC cue starts from. The operator changes
// all three the moment the desk is somewhere else, but the first message is always one
// the desk can read rather than an address made of empty strings.
const GROUP_OSC_DEFAULTS = { ...OSC_DEFAULTS, address: '/dca/1' }

// Values rather than free text: a MIDI channel is one of sixteen and a note is one of
// 128, so there is no range to check and no out-of-range value to drop on the floor.
const MIDI_CHANNELS = Array.from({ length: 16 }, (_, index) => index + 1)
const MIDI_NOTES = Array.from({ length: 128 }, (_, index) => index)

type Delivery = 'midi' | 'osc' | 'none'

interface Props {
  onClose: () => void
}

/**
 * A field that keeps what is being typed to itself until it is left. Binding the scene
 * list to every keystroke would rewrite the workspace on each character — and a scene
 * renamed halfway through a word is a name the desk never saw.
 */
function CommitInput({
  value,
  onCommit,
  ...rest
}: {
  value: string
  onCommit: (value: string) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    if (draft !== null && draft !== value) onCommit(draft)
    setDraft(null)
  }

  return (
    <input
      {...rest}
      value={draft ?? value}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/**
 * A port that commits when it is left rather than on every keystroke: binding "5" on the
 * way to "53000" would point a group at a port nobody asked for, and a value outside the
 * range is dropped rather than written.
 */
function CommitPort({
  value,
  onCommit,
  ...rest
}: {
  value: number
  onCommit: (value: number) => void
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'onBlur' | 'type'>) {
  const [draft, setDraft] = useState<string | null>(null)

  const commit = (): void => {
    const parsed = Number(draft)
    if (draft !== null && Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
      onCommit(parsed)
    }
    setDraft(null)
  }

  return (
    <input
      {...rest}
      type="number"
      min={1}
      max={65535}
      value={draft ?? String(value)}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

/** How a group is opened and closed, read back off the messages it is carrying. */
function deliveryOf(channel: DeskChannel): Delivery {
  if (channel.unmute === null && channel.mute === null) return 'none'
  if (channel.unmute?.kind === 'midi') return 'midi'
  if (channel.unmute?.kind === 'osc') return 'osc'
  return 'none'
}

/** The note a group is on, or where a group with no note yet would start. */
function midiFields(
  channel: DeskChannel,
  fallbackPort: string
): { portName: string; channel: number; note: number } {
  const message = channel.unmute?.kind === 'midi' ? channel.unmute : null
  if (message === null) return { portName: fallbackPort, channel: 1, note: 1 }
  const kind = message.message
  if (kind.kind !== 'noteOn' && kind.kind !== 'noteOff') {
    return { portName: message.portName, channel: 1, note: 1 }
  }
  return { portName: message.portName, channel: kind.channel, note: kind.note }
}

/** The address a group is on, or where a group with no address yet would start. */
function oscFields(channel: DeskChannel): { host: string; port: number; address: string } {
  const message = channel.unmute?.kind === 'osc' ? channel.unmute : null
  if (message === null) return GROUP_OSC_DEFAULTS
  return { host: message.host, port: message.port, address: message.address }
}

/**
 * The editor for the scenes and the desk groups they drive. Every change goes through the
 * pure operations in `utils/scenes`, so what the workspace holds is always something a
 * recall can read; this dialog only decides which scene is being edited and which group
 * a mic feeds.
 */
export function SceneDialog({ onClose }: Props) {
  const scenes = useStore(s => s.showSettings.scenes)
  const plot = useStore(s => s.showSettings.rf.plot)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)
  const updateRfSettings = useStore(s => s.updateRfSettings)

  // The desk remembers the last scene it was told about, so that is the one the editor
  // opens on: the scene that is on stage is the one being edited.
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const deskId = useStore.getState().deskSceneId
    const list = useStore.getState().showSettings.scenes.list
    if (deskId !== null && list.some(scene => scene.id === deskId)) return deskId
    return list[0]?.id ?? null
  })

  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    window.winslab.midi.listPorts().then(found => { if (mounted) setPorts(found) })
    return () => { mounted = false }
  }, [])

  // Dismiss on Escape, wherever focus is inside the dialog.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // A scene that has gone takes the selection with it: the mics below fall back to the
  // top of the list rather than to nothing.
  const selected = scenes.list.find(scene => scene.id === selectedId) ?? scenes.list[0] ?? null

  // The two kinds of edit this dialog makes, each written back as the one field it
  // changed so a name typed here cannot carry a stale copy of the desk groups with it.
  const writeList = (next: ScenesSettings): void => updateScenesSettings({ list: next.list })
  const writeChannels = (next: ScenesSettings): void =>
    updateScenesSettings({ channels: next.channels })

  const add = (): void => {
    const next = addScene(scenes)
    writeList(next)
    // The point of adding a scene is to open mics in it, so it arrives selected.
    setSelectedId(next.list[next.list.length - 1].id)
  }

  const removeGroup = (channel: DeskChannel): void => {
    writeChannels(removeDeskChannel(scenes, channel.id))
    // Removing the group is only half of it: a pack still pointing at it would be a mic
    // nothing on the desk opens, so the plot is cleared in the same edit.
    if (plot.packs.some(pack => pack.deskChannelId === channel.id)) {
      updateRfSettings({
        plot: {
          ...plot,
          packs: plot.packs.map(pack =>
            pack.deskChannelId === channel.id ? { ...pack, deskChannelId: null } : pack)
        }
      })
    }
  }

  const setMidi = (
    channel: DeskChannel,
    patch: Partial<{ portName: string; channel: number; note: number }>
  ): void => {
    const fields = { ...midiFields(channel, ports[0] ?? ''), ...patch }
    writeChannels(updateDeskChannel(
      scenes,
      channel.id,
      midiNoteMessages(fields.portName, fields.channel, fields.note)
    ))
  }

  const setOsc = (
    channel: DeskChannel,
    patch: Partial<{ host: string; port: number; address: string }>
  ): void => {
    const fields = { ...oscFields(channel), ...patch }
    writeChannels(updateDeskChannel(
      scenes,
      channel.id,
      oscMessages(fields.host, fields.port, fields.address)
    ))
  }

  // Switching delivery is a decision about the messages themselves, so the switch writes
  // them: MIDI and OSC replace them, and `none` empties them.
  const setDelivery = (channel: DeskChannel, delivery: Delivery): void => {
    if (delivery === 'none') {
      writeChannels(updateDeskChannel(scenes, channel.id, { mute: null, unmute: null }))
      return
    }
    if (delivery === 'midi') {
      const fields = midiFields(channel, ports[0] ?? '')
      writeChannels(updateDeskChannel(
        scenes,
        channel.id,
        midiNoteMessages(fields.portName, fields.channel, fields.note)
      ))
      return
    }
    const fields = oscFields(channel)
    writeChannels(updateDeskChannel(
      scenes,
      channel.id,
      oscMessages(fields.host, fields.port, fields.address)
    ))
  }

  return (
    <div className="scene-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="scene-dialog" role="dialog" aria-modal="true" aria-label="Scenes">
        <div className="scene-header">
          <span className="scene-title">Scenes</span>
          <button className="scene-close" onClick={onClose} aria-label="Dismiss scenes">✕</button>
        </div>

        <div className="scene-body">
          <div className="scene-section scene-list">
            <div className="scene-section-title">Scenes</div>
            {scenes.list.map(scene => (
              <div
                className="scene-row"
                key={scene.id}
                data-selected={scene.id === selected?.id}
                onClick={() => setSelectedId(scene.id)}
              >
                <CommitInput
                  className="scene-name-input"
                  value={scene.name}
                  placeholder="Scene name"
                  aria-label="Scene name"
                  onCommit={name => writeList(updateScene(scenes, scene.id, { name }))}
                />
                <button
                  className="scene-remove"
                  aria-label={`Remove ${scene.name}`}
                  onClick={e => {
                    e.stopPropagation()
                    writeList(removeScene(scenes, scene.id))
                  }}
                >✕</button>
              </div>
            ))}
            <button className="scene-add" onClick={add}>Add scene</button>
          </div>

          <div className="scene-section scene-mics">
            <div className="scene-section-title">Mics</div>
            {selected === null ? (
              <div className="scene-empty">Add a scene to open mics in it.</div>
            ) : plot.packs.length === 0 ? (
              <div className="scene-mics-empty">The mic plot is empty — add packs in Edit plot…</div>
            ) : (
              plot.packs.map(pack => {
                const performer = pack.performerId === null
                  ? null
                  : plot.performers.find(who => who.id === pack.performerId) ?? null
                const live = selected.live.includes(pack.id)
                return (
                  <div className="scene-mic-row" key={pack.id} data-live={live}>
                    <label className="scene-mic-label">
                      <input
                        className="scene-mic-toggle"
                        type="checkbox"
                        checked={live}
                        aria-label={`${pack.label} live`}
                        onChange={e =>
                          writeList(setPackLive(scenes, selected.id, pack.id, e.target.checked))}
                      />
                      {performer === null ? pack.label : `${pack.label} — ${performer.name}`}
                    </label>
                  </div>
                )
              })
            )}
          </div>

          <div className="scene-section scene-groups">
            <div className="scene-section-title">Desk groups</div>
            {scenes.channels.map(channel => {
              const delivery = deliveryOf(channel)
              const midi = midiFields(channel, ports[0] ?? '')
              const osc = oscFields(channel)
              // The list comes from the MIDI service, but a group patched to a port that
              // is switched off tonight keeps its patch, so the current value is always
              // one of the choices.
              const portOptions = ports.includes(midi.portName) ? ports : [midi.portName, ...ports]
              return (
                <div className="group-row" key={channel.id}>
                  <div className="group-fields">
                    <CommitInput
                      className="group-label"
                      value={channel.label}
                      placeholder="Group"
                      aria-label="Group label"
                      onCommit={label => writeChannels(updateDeskChannel(scenes, channel.id, { label }))}
                    />
                    <select
                      className="group-delivery"
                      value={delivery}
                      aria-label="Group delivery"
                      onChange={e => setDelivery(channel, e.target.value as Delivery)}
                    >
                      <option value="midi">MIDI</option>
                      <option value="osc">OSC</option>
                      <option value="none">None</option>
                    </select>

                    {delivery === 'midi' && (
                      <>
                        <select
                          className="group-port"
                          value={midi.portName}
                          aria-label="MIDI port"
                          onChange={e => setMidi(channel, { portName: e.target.value })}
                        >
                          {portOptions.map(port => (
                            <option key={port} value={port}>
                              {port === '' ? '— none —' : port}
                            </option>
                          ))}
                        </select>
                        <select
                          className="group-channel"
                          value={midi.channel}
                          aria-label="MIDI channel"
                          onChange={e => setMidi(channel, { channel: Number(e.target.value) })}
                        >
                          {MIDI_CHANNELS.map(note => <option key={note} value={note}>{note}</option>)}
                        </select>
                        <select
                          className="group-note"
                          value={midi.note}
                          aria-label="MIDI note"
                          onChange={e => setMidi(channel, { note: Number(e.target.value) })}
                        >
                          {MIDI_NOTES.map(note => <option key={note} value={note}>{note}</option>)}
                        </select>
                      </>
                    )}

                    {delivery === 'osc' && (
                      <>
                        <CommitInput
                          className="group-host"
                          value={osc.host}
                          placeholder="Host"
                          aria-label="OSC host"
                          onCommit={host => setOsc(channel, { host })}
                        />
                        <CommitPort
                          className="group-osc-port"
                          value={osc.port}
                          aria-label="OSC port"
                          onCommit={port => setOsc(channel, { port })}
                        />
                        <CommitInput
                          className="group-address"
                          value={osc.address}
                          placeholder="Address"
                          aria-label="OSC address"
                          onCommit={address => setOsc(channel, { address })}
                        />
                      </>
                    )}

                    <button
                      className="group-remove"
                      aria-label={`Remove ${channel.label}`}
                      onClick={() => removeGroup(channel)}
                    >✕</button>
                  </div>

                  <div className="group-summary">
                    <span className="group-summary-open">{describeDeskMessage(channel.unmute)}</span>
                    <span className="group-summary-sep">{' / '}</span>
                    <span className="group-summary-close">{describeDeskMessage(channel.mute)}</span>
                  </div>
                </div>
              )
            })}
            <button className="group-add" onClick={() => writeChannels(addDeskChannel(scenes))}>
              Add group
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
