import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { OSC_DEFAULTS } from '../../utils/cueDefaults'
import {
  addDeskChannel,
  addScene,
  describeDeskMessage,
  deskSummary,
  midiNoteMessages,
  oscMessages,
  removeScene,
  sceneChanges,
  setPackLive,
  updateDeskChannel,
  updateScene
} from '../../utils/scenes'
import type { DeskChannel, ScenesSettings } from '../../types/show'
import './ScenesView.css'

// A group with no patch of its own yet: one address per group, opened with a 1 and
// closed with a 0, on the host and port an OSC cue starts from. The operator changes
// all three the moment the desk is somewhere else, but the first message is always one
// the desk can read rather than an address made of empty strings.
const GROUP_OSC_DEFAULTS = { ...OSC_DEFAULTS, address: '/dca/1' }

// Values rather than free text: a MIDI channel is one of sixteen and a note is one of
// 128, so there is no range to check and no out-of-range value to drop on the floor.
const MIDI_CHANNELS = Array.from({ length: 16 }, (_, index) => index + 1)
const MIDI_NOTES = Array.from({ length: 128 }, (_, index) => index)

// A scene name is what its column is read by, so the field asks for about a name's worth of
// room and no more. An input's default width is what sets a column's width, and a column
// wide enough for the browser's taste is one that pushes the numbers after it off the side
// of the window.
const SCENE_NAME_SIZE = 11

type Delivery = 'midi' | 'osc' | 'none'

/** The count as the operator says it out loud: "4 mics", "1 mic", "no mics". */
function micCount(count: number): string {
  if (count === 0) return 'no mics'
  return `${count} mic${count === 1 ? '' : 's'}`
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
 * Scenes: the mic plot down the side, the scenes across the top, and the desk groups
 * they drive.
 *
 * This is the curtain-up view and the only place the show is built, so the two jobs are
 * one surface: the grid answers who is open now, and the drawer under it holds the desk
 * groups those mics feed. Editing a cell changes the scene, never the desk; the header's
 * Apply is the press that moves the room, and it only appears once there is a difference
 * to send. The lock stops every edit — cells, names, the drawer — and nothing else,
 * because recalling is what this view is for.
 */
export function ScenesView() {
  const scenes = useStore(s => s.showSettings.scenes)
  const plot = useStore(s => s.showSettings.rf.plot)
  const deskState = useStore(s => s.deskState)
  const deskSceneId = useStore(s => s.deskSceneId)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)
  const removeDeskGroup = useStore(s => s.removeDeskGroup)

  const [groupsOpen, setGroupsOpen] = useState(false)
  const [ports, setPorts] = useState<string[]>([])

  useEffect(() => {
    let mounted = true
    window.winslab.midi.listPorts().then(found => { if (mounted) setPorts(found) })
    return () => { mounted = false }
  }, [])

  const locked = scenes.locked
  const currentIndex = scenes.list.findIndex(scene => scene.id === deskSceneId)
  const current = currentIndex === -1 ? null : scenes.list[currentIndex]

  // The running order is the show order, so what comes next is the scene after this one —
  // and before anything has been recalled, the first one. Which scene it is belongs in the
  // header rather than only in the grid: the columns scroll, this does not.
  const nextIndex = currentIndex === -1 ? 0 : currentIndex + 1
  const next = scenes.list[nextIndex] ?? null

  // The show moves without a hand on the grid — a scene cue, a trigger, someone else at the
  // desk — so the view follows it: the scene the desk has just gone to is parked at the left
  // of the visible columns, which is where the ones after it are laid out for the next press.
  // A short number cannot leave the next scene off the side of a long show. Scrolling by hand
  // is left alone until the show moves again, and so is an edit: this runs on a recall — the
  // desk was just handed a new state, or a second one for the scene it is already on — and
  // never on the list changing under it, which is how deleting a scene used to drag the view
  // back to wherever the show was.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const scroller = scrollerRef.current
    // Found rather than taken from the render: which column a scene sits in is the list's
    // business, and the list is not what this follows.
    const index = scenes.list.findIndex(scene => scene.id === deskSceneId)
    if (scroller === null || index === -1) return
    const column = scroller.querySelectorAll<HTMLElement>('.matrix-scene')[index]
    const plotColumn = scroller.querySelector<HTMLElement>('.matrix-mic')
    if (column === undefined || plotColumn === null) return
    // Measured rather than assumed: the current scene is parked against the plot column, and
    // the width behind that column is a CSS variable anyone is free to change.
    const left = column.getBoundingClientRect().left - scroller.getBoundingClientRect().left
    scroller.scrollLeft += left - plotColumn.getBoundingClientRect().width
  }, [deskSceneId, deskState])

  // The desk's question, asked for the header: what would a recall of the current scene
  // change? Nothing means the desk is where the show left it.
  const toApply =
    current === null ? 0 : sceneChanges(plot.packs, scenes.channels, current, deskState).length

  const performerNames: Record<string, string> = Object.fromEntries(
    plot.performers.map(performer => [performer.id, performer.name])
  )
  const groupRows = deskSummary(plot.packs, scenes.channels, current)

  // Every edit writes back the one field it changed, so a name typed in the grid cannot
  // carry a stale copy of the desk groups with it — or the other way round.
  const writeList = (next: ScenesSettings): void => updateScenesSettings({ list: next.list })
  const writeChannels = (next: ScenesSettings): void =>
    updateScenesSettings({ channels: next.channels })

  // The group and the packs that fed it go in one edit, so the undo to come has one step
  // to take rather than half of two.
  const removeGroup = (channel: DeskChannel): void => removeDeskGroup(channel.id)

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
    <div className="scenes-view" data-locked={locked}>
      <div className="scenes-header">
        <span className="scenes-title">Scenes</span>
        {scenes.list.length > 0 && (
          <div className="scenes-where">
            <span className="scenes-now">
              <span className="scenes-where-label">now</span>{' '}
              {current === null ? (
                <span className="scenes-where-none">nothing recalled</span>
              ) : (
                <>
                  <strong className="scenes-where-number">{currentIndex + 1}</strong>{' '}
                  <span className="scenes-where-name" title={current.name}>{current.name}</span>
                </>
              )}
            </span>
            {next !== null && (
              <span className="scenes-next">
                <span className="scenes-where-label">next</span>{' '}
                <strong className="scenes-where-number">{nextIndex + 1}</strong>{' '}
                <span className="scenes-where-name" title={next.name}>{next.name}</span>
              </span>
            )}
          </div>
        )}
        <span className="scenes-subtitle">
          {`${micCount(plot.packs.length)} · ${scenes.list.length} scene${scenes.list.length === 1 ? '' : 's'}`}
        </span>
        <div className="scenes-actions">
          <button
            className="scenes-add"
            disabled={locked}
            onClick={() => writeList(addScene(scenes))}
            title="Add a scene and open mics in it"
          >
            Add scene
          </button>
          <button
            className="scenes-mics-off"
            onClick={() => { void recallScene(null) }}
            title="Close every group the plot drives"
          >
            Mics off
          </button>
          <button
            className="scenes-groups-toggle"
            data-open={groupsOpen}
            onClick={() => setGroupsOpen(open => !open)}
            title="Edit the desk groups the mics feed"
          >
            {`Desk groups (${scenes.channels.length})`}
          </button>
          {deskSceneId !== null && toApply > 0 && (
            <button
              className="matrix-apply"
              onClick={() => { void recallScene(deskSceneId) }}
              title="Send the current scene's changes to the desk"
            >
              Apply to desk ({toApply})
            </button>
          )}
          <button
            className="matrix-lock"
            data-locked={locked}
            onClick={() => updateScenesSettings({ locked: !locked })}
            title={locked ? 'Allow the show to be edited' : 'Lock the show for the performance'}
          >
            {locked ? 'Locked' : 'Lock'}
          </button>
        </div>
      </div>

      {locked && (
        <div className="scenes-locked-hint">
          Locked for the show — recall is live, editing is not.
        </div>
      )}

      {scenes.list.length === 0 ? (
        <div className="matrix-empty">No scenes yet — add one from the header.</div>
      ) : plot.packs.length === 0 ? (
        <div className="matrix-empty">The mic plot is empty — add packs in the RF panel.</div>
      ) : (
        <div className="matrix-scroll" ref={scrollerRef}>
          <div
            className="matrix-grid"
            style={{
              gridTemplateColumns:
                `var(--matrix-mic-width) repeat(${scenes.list.length}, minmax(var(--matrix-cell-width), 1fr))`
            } as CSSProperties}
          >
            <div className="matrix-corner" />

            {scenes.list.map(scene => {
              // Pending is the desk's question, not the scene's: a column is to apply when
              // recalling it would change something, which makes the marker mean the press.
              const pending =
                sceneChanges(plot.packs, scenes.channels, scene, deskState).length > 0
              return (
                <div
                  key={scene.id}
                  className="matrix-scene"
                  data-current={scene.id === deskSceneId}
                  data-pending={pending}
                >
                  <CommitInput
                    className="scene-name-field"
                    value={scene.name}
                    placeholder="Scene name"
                    aria-label="Scene name"
                    size={SCENE_NAME_SIZE}
                    disabled={locked}
                    // A scene without a name is a row nobody can find again, so the old
                    // name stays until something is actually typed.
                    onCommit={name => {
                      if (name.trim() === '') return
                      writeList(updateScene(scenes, scene.id, { name }))
                    }}
                  />
                  {/* How many mics a scene opens is the block of colour next to it, so the
                      column says a name and two presses and nothing else. */}
                  <div className="matrix-scene-actions">
                    <button
                      className="matrix-recall"
                      onClick={() => { void recallScene(scene.id) }}
                      title="Send this scene to the desk"
                      aria-label={`Recall ${scene.name}`}
                    >
                      →
                    </button>
                    <button
                      className="matrix-scene-remove"
                      aria-label={`Remove ${scene.name}`}
                      title="Remove this scene — undo puts it back"
                      disabled={locked}
                      onClick={() => writeList(removeScene(scenes, scene.id))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )
            })}

            {plot.packs.map(pack => {
              const performer = pack.performerId === null
                ? null
                : performerNames[pack.performerId]?.trim() || null
              const channelId = pack.deskChannelId ?? null
              const on = current !== null && current.live.includes(pack.id)

              return (
                <div key={pack.id} className="matrix-row" data-on={on}>
                  {/* Who is wearing this mic, which is what the rows are read by. The label on
                      the pack and the group it feeds are set once at setup, with the rest of
                      the plot, and are edited in the mic plot editor. A pack nobody is wearing
                      is still a row the show has to have, so it falls back to its label. */}
                  <div className="matrix-mic">
                    <span className="matrix-performer" data-unassigned={performer === null}>
                      {performer ?? pack.label}
                    </span>
                  </div>
                  {scenes.list.map(scene => {
                    const live = scene.live.includes(pack.id)
                    // The desk holds one state per group, so two mics on the same DCA are
                    // pending together: the cell says what that group has not been told yet.
                    const pending =
                      scene.id === deskSceneId &&
                      channelId !== null &&
                      deskState[channelId] !== live
                    return (
                      <button
                        key={scene.id}
                        className="matrix-cell"
                        data-live={live}
                        data-current={scene.id === deskSceneId}
                        data-pending={pending}
                        aria-label={`${pack.label} in ${scene.name}`}
                        disabled={locked}
                        onClick={() =>
                          updateScenesSettings({
                            list: setPackLive(scenes, scene.id, pack.id, !live).list
                          })
                        }
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* The drawer sits under the grid rather than inside it, so the groups are edited
          without the header or the scene columns moving; it scrolls its own rows and
          never widens the view. While the show is locked it still opens — reading the
          groups is what it is for at curtain up — but nothing in it can be changed. */}
      {groupsOpen && (
        <div className="scenes-groups">
          <div className="scenes-groups-title">Desk groups</div>
          {groupRows.map(summary => {
            const channel = summary.channel
            const delivery = deliveryOf(channel)
            const midi = midiFields(channel, ports[0] ?? '')
            const osc = oscFields(channel)
            // The list comes from the MIDI service, but a group patched to a port that
            // is switched off tonight keeps its patch, so the current value is always
            // one of the choices.
            const portOptions = ports.includes(midi.portName) ? ports : [midi.portName, ...ports]
            const configured = channel.unmute !== null || channel.mute !== null
            const state = configured ? (summary.live ? 'live' : 'muted') : '—'
            return (
              <div className="group-row" key={channel.id}>
                <div className="group-fields">
                  <CommitInput
                    className="group-label"
                    value={channel.label}
                    placeholder="Group"
                    aria-label="Group label"
                    disabled={locked}
                    onCommit={label => writeChannels(updateDeskChannel(scenes, channel.id, { label }))}
                  />
                  <select
                    className="group-delivery"
                    value={delivery}
                    aria-label="Group delivery"
                    disabled={locked}
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
                        disabled={locked}
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
                        disabled={locked}
                        onChange={e => setMidi(channel, { channel: Number(e.target.value) })}
                      >
                        {MIDI_CHANNELS.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                      <select
                        className="group-note"
                        value={midi.note}
                        aria-label="MIDI note"
                        disabled={locked}
                        onChange={e => setMidi(channel, { note: Number(e.target.value) })}
                      >
                        {MIDI_NOTES.map(option => (
                          <option key={option} value={option}>{option}</option>
                        ))}
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
                        disabled={locked}
                        onCommit={host => setOsc(channel, { host })}
                      />
                      <CommitPort
                        className="group-osc-port"
                        value={osc.port}
                        aria-label="OSC port"
                        disabled={locked}
                        onCommit={port => setOsc(channel, { port })}
                      />
                      <CommitInput
                        className="group-address"
                        value={osc.address}
                        placeholder="Address"
                        aria-label="OSC address"
                        disabled={locked}
                        onCommit={address => setOsc(channel, { address })}
                      />
                    </>
                  )}

                  <button
                    className="group-remove"
                    aria-label={`Remove ${channel.label}`}
                    disabled={locked}
                    onClick={() => removeGroup(channel)}
                  >
                    ✕
                  </button>
                </div>

                <div className="group-summary">
                  <span className="group-summary-open">{describeDeskMessage(channel.unmute)}</span>
                  <span className="group-summary-sep">{' / '}</span>
                  <span className="group-summary-close">{describeDeskMessage(channel.mute)}</span>
                </div>

                <div className="group-carrying">
                  <span className="group-packs">
                    {summary.packs.length === 0
                      ? 'nothing assigned'
                      : summary.packs.map(pack => pack.label).join(', ')}
                  </span>
                  <span className="group-state" data-state={state}>{state}</span>
                </div>
              </div>
            )
          })}
          <button
            className="group-add"
            disabled={locked}
            onClick={() => writeChannels(addDeskChannel(scenes))}
          >
            Add group
          </button>
        </div>
      )}
    </div>
  )
}
