import { useEffect, useMemo, useRef, type CSSProperties } from 'react'
import { useStore } from '../../store'
import { recallScene, resyncDesk } from '../../engine/scenes'
import { channelLabel } from '../../utils/cast'
import {
  addScene,
  ensembleState,
  placementFor,
  removeScene,
  rowChannels,
  sceneChanges,
  setChannelPlaced,
  setMemberExcluded,
  setRowEnsemble,
  updateScene,
  type DeskChange,
  type DeskState
} from '../../utils/scenes'
import { dcaNumber } from '../../utils/desk'
import { TextField } from '../common/Field'
import {
  ALL_CLOSED_SCENE_ID,
  type CastSettings,
  type Dca,
  type Ensemble,
  type MicScene,
  type ScenesSettings
} from '../../../../shared/show'
import './ScenesView.css'

// A scene name is what its column is read by, so the field asks for about a name's worth of
// room and no more. An input's default width is what sets a column's width, and a column
// wide enough for the browser's taste is one that pushes the numbers after it off the side
// of the window.
const SCENE_NAME_SIZE = 11

/** The columns that are scenes in the file: the all-closed column is not one of them. */
const SCENE_COLUMN = '.matrix-scene[data-scene-id]'

/** The count as the operator says it out loud: "4 faders", "1 fader", "no faders". */
function faderCount(count: number): string {
  if (count === 0) return 'no faders'
  return `${count} fader${count === 1 ? '' : 's'}`
}

/**
 * Whether this row of this scene is still to send: the column's own change list holds a
 * channel the scene places on this fader, or one the record still has on it — the two
 * sides of the same move, read off the one computation rather than derived a second way.
 */
function cellPending(changes: DeskChange[], dcaId: string, deskState: DeskState): boolean {
  return changes.some(change =>
    change.dcas.includes(dcaId) ||
    (deskState.assignments[change.channelId] ?? []).includes(dcaId))
}

interface CellProps {
  scene: MicScene
  dca: Dca
  cast: CastSettings
  scenes: ScenesSettings
  /** This scene's own change list, computed once per render and passed down. */
  changes: DeskChange[]
  deskState: DeskState
  isCurrent: boolean
  locked: boolean
  writeList: (next: ScenesSettings) => void
  groupRow: (sceneId: string, dcaId: string) => void
}

/**
 * One fader in one scene: the channels the row carries, the ensembles applied to it, and
 * — while editing — the presses that change either. A chip names what the row carries,
 * and its ✕ takes it off; the pickers name what it does not, and choosing one puts it on.
 * Every press is one store write, hence one undo.
 */
function SceneCell({
  scene, dca, cast, scenes, changes, deskState, isCurrent, locked, writeList, groupRow
}: CellProps) {
  const placement = placementFor(scene, dca.id)
  const carried = rowChannels(cast, placement)
  const appliedIds = placement?.ensembles ?? []
  const applied = cast.ensembles.filter(ensemble => appliedIds.includes(ensemble.id))
  const freeChannels = cast.channels.filter(channel => !carried.includes(channel.id))
  const freeEnsembles = cast.ensembles.filter(ensemble => !appliedIds.includes(ensemble.id))
  const pending = cellPending(changes, dca.id, deskState)

  return (
    <div
      className="matrix-cell"
      data-placed={carried.length > 0}
      data-current={isCurrent}
      data-pending={pending}
      aria-label={`${dca.label} in ${scene.name}`}
    >
      {carried.map(channelId => {
        const label = channelLabel(cast.channels, channelId)
        if (label === '') return null
        return (
          <span className="matrix-channel" key={channelId}>
            {label}
            <button
              type="button"
              className="matrix-channel-remove"
              aria-label={`Take ${label} off ${dca.label} in ${scene.name}`}
              title={locked ? label : `Take ${label} off this row — undo puts it back`}
              disabled={locked}
              onClick={() => writeList(
                setChannelPlaced(scenes, scene.id, dca.id, channelId, false, cast)
              )}
            >✕</button>
          </span>
        )
      })}
      {!locked && freeChannels.length > 0 && (
        <select
          className="matrix-place"
          value=""
          aria-label={`Place a channel on ${dca.label} in ${scene.name}`}
          title="Place a channel on this row"
          onChange={e => {
            if (e.target.value !== '') {
              writeList(setChannelPlaced(scenes, scene.id, dca.id, e.target.value, true, cast))
            }
          }}
        >
          <option value="">+ place</option>
          {freeChannels.map(channel => (
            <option key={channel.id} value={channel.id}>
              {channelLabel(cast.channels, channel.id)}
            </option>
          ))}
        </select>
      )}
      {applied.map(ensemble => (
        <AppliedEnsemble
          key={ensemble.id}
          scene={scene}
          dca={dca}
          ensemble={ensemble}
          cast={cast}
          scenes={scenes}
          locked={locked}
          writeList={writeList}
        />
      ))}
      {!locked && freeEnsembles.length > 0 && (
        <select
          className="matrix-ensemble-add"
          value=""
          aria-label={`Apply an ensemble to ${dca.label} in ${scene.name}`}
          title="Apply an ensemble to this row — its members ride it unless left off"
          onChange={e => {
            const ensemble = cast.ensembles.find(candidate => candidate.id === e.target.value)
            if (ensemble !== undefined) {
              writeList(setRowEnsemble(scenes, scene.id, dca.id, ensemble, true, cast))
            }
          }}
        >
          <option value="">+ ensemble</option>
          {freeEnsembles.map(ensemble => (
            <option key={ensemble.id} value={ensemble.id}>{ensemble.name}</option>
          ))}
        </select>
      )}
      {!locked && carried.length > 0 && (
        <button
          type="button"
          className="matrix-ensemble-new"
          title="Group these into an ensemble, applied to this row"
          onClick={() => groupRow(scene.id, dca.id)}
        >
          + Group
        </button>
      )}
    </div>
  )
}

interface AppliedProps {
  scene: MicScene
  dca: Dca
  ensemble: Ensemble
  cast: CastSettings
  scenes: ScenesSettings
  locked: boolean
  writeList: (next: ScenesSettings) => void
}

/**
 * An ensemble on one row, with its members beside it as the presses that leave them off.
 * Every member the ensemble holds on this row is shown — one the row carries reads
 * unmarked, one left off reads excluded — because leaving someone off has to be a press
 * on them. A member placed here by hand already has a channel chip with its own remove,
 * so the member chips are for what the ensemble holds. Members patched to nothing are
 * not shown: there is no channel to leave off.
 */
function AppliedEnsemble({
  scene, dca, ensemble, cast, scenes, locked, writeList
}: AppliedProps) {
  const state = ensembleState(scene, dca.id, ensemble, cast)
  const placement = placementFor(scene, dca.id)
  const members = ensemble.members.flatMap(memberId => {
    const performer = cast.performers.find(candidate => candidate.id === memberId)
    const channelId = performer?.channelId ?? null
    if (performer === undefined || channelId === null) return []
    if (!cast.channels.some(channel => channel.id === channelId)) return []
    if (placement?.channels.includes(channelId) ?? false) return []
    return [{ performer, channelId }]
  })
  return (
    <span className="matrix-applied">
      <button
        type="button"
        className="matrix-ensemble"
        data-applied={state}
        disabled={locked}
        title={locked
          ? ensemble.name
          : `Take ${ensemble.name} off this row — its members' hand placements stay as they were`}
        aria-label={`${ensemble.name} on ${dca.label} in ${scene.name}`}
        onClick={() => writeList(setRowEnsemble(scenes, scene.id, dca.id, ensemble, false, cast))}
      >
        {ensemble.name}
      </button>
      {members.map(({ performer, channelId }) => {
        const excluded = placement?.excluded.includes(channelId) ?? false
        return (
          <button
            key={performer.id}
            type="button"
            className="matrix-member"
            data-excluded={excluded}
            disabled={locked}
            title={locked
              ? performer.name
              : excluded
                ? `Put ${performer.name} back on this row`
                : `Leave ${performer.name} off this row`}
            aria-label={`${performer.name}, left off ${dca.label} in ${scene.name}`}
            onClick={() => writeList(
              setMemberExcluded(scenes, scene.id, dca.id, channelId, !excluded)
            )}
          >
            {performer.name || 'unnamed'}
          </button>
        )
      })}
    </span>
  )
}

/**
 * Scenes: the show's faders down the side, the scenes across the top. Each cell names the
 * channels its row places in its scene and the ensembles applied to that row, and — while
 * editing — places and removes either with one press each.
 *
 * The first column is the scene that is always there and never edited: all closed. It is
 * what the desk wants pressed between numbers, and nothing is ever placed in it.
 *
 * This is the curtain-up view and the place the show is run from, so it has two modes.
 * It always opens to run it: recall and Apply are live, and nothing else can be changed
 * by a stray click. Edit is the deliberate press that gives the grid and the names back,
 * and Done hands the view back to the show. Editing a cell changes the scene, never the
 * desk; the header's Apply is the press that moves the room, and it only appears once
 * there is a difference to send.
 */
export function ScenesView() {
  const showSettings = useStore(s => s.showSettings)
  const scenes = showSettings.scenes
  const cast = useStore(s => s.showSettings.cast)
  const deskState = useStore(s => s.deskState)
  const deskSceneId = useStore(s => s.deskSceneId)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)
  const addEnsembleFromRow = useStore(s => s.addEnsembleFromRow)
  const editing = useStore(s => s.scenesEditing)
  const setEditing = useStore(s => s.setScenesEditing)
  const openShowSettings = useStore(s => s.openShowSettings)

  const locked = !editing
  // The scene the desk is on, and whether that is the all-closed one: null is either the
  // all-closed scene or a desk nothing has been recalled to yet, and neither opens a mic.
  const recalled = scenes.list.find(scene => scene.id === deskSceneId) ?? null
  const allClosed = deskSceneId === ALL_CLOSED_SCENE_ID
  const current = allClosed ? null : recalled
  const currentIndex = recalled === null ? -1 : scenes.list.indexOf(recalled)

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
    const column = scroller.querySelectorAll<HTMLElement>(SCENE_COLUMN)[index]
    const plotColumn = scroller.querySelector<HTMLElement>('.matrix-mic')
    if (column === undefined || plotColumn === null) return
    // Measured rather than assumed: the current scene is parked against the plot column, and
    // the width behind that column is a CSS variable anyone is free to change.
    const left = column.getBoundingClientRect().left - scroller.getBoundingClientRect().left
    scroller.scrollLeft += left - plotColumn.getBoundingClientRect().width
  }, [deskSceneId, deskState])

  // What a recall of each scene would change, computed once: the columns read their marks
  // off it and the cells read theirs, so the two never disagree about the same press.
  const changesByScene = useMemo(() => {
    const map = new Map<string, DeskChange[]>()
    map.set(ALL_CLOSED_SCENE_ID, sceneChanges(showSettings, null, deskState))
    for (const scene of scenes.list) {
      map.set(scene.id, sceneChanges(showSettings, scene, deskState))
    }
    return map
  }, [showSettings, deskState, scenes.list])

  // The desk's question, asked for the header: what would a recall of the standing scene
  // change? Nothing means the desk is where the show left it.
  const toApply = deskSceneId === null ? 0 : (changesByScene.get(deskSceneId) ?? []).length

  // Every edit writes back the one field it changed, so a cell toggled in the grid cannot
  // carry a stale copy of anything else with it.
  const writeList = (next: ScenesSettings): void => updateScenesSettings({ list: next.list })

  return (
    <div className="scenes-view" data-editing={editing}>
      <div className="scenes-header">
        <span className="scenes-title">Scenes</span>
        {(scenes.list.length > 0 || deskSceneId !== null) && (
          <div className="scenes-where">
            <span className="scenes-now">
              <span className="scenes-where-label">now</span>{' '}
              {current === null && !allClosed ? (
                <span className="scenes-where-none">nothing recalled</span>
              ) : (
                <>
                  <strong className="scenes-where-number">
                    {allClosed ? 0 : currentIndex + 1}
                  </strong>{' '}
                  <span className="scenes-where-name" title={allClosed ? 'All closed' : current?.name}>
                    {allClosed ? 'All closed' : current?.name}
                  </span>
                </>
              )}
            </span>
            {next !== null && (
              <span className="scenes-next">
                <span className="scenes-where-label">next scene</span>{' '}
                <strong className="scenes-where-number">{nextIndex + 1}</strong>{' '}
                <span className="scenes-where-name" title={next.name}>{next.name}</span>
              </span>
            )}
          </div>
        )}
        <span className="scenes-subtitle">
          {`${faderCount(cast.dcas.length)} · ${scenes.list.length} scene${scenes.list.length === 1 ? '' : 's'}`}
        </span>
        <div className="scenes-actions">
          {editing && (
            <button
              className="scenes-add"
              onClick={() => writeList(addScene(scenes))}
              title="Add a scene — it places nothing until its cells do"
            >
              Add scene
            </button>
          )}
          {deskSceneId !== null && toApply > 0 && (
            <button
              className="matrix-apply"
              onClick={() => { void recallScene(deskSceneId) }}
              title="Recall the current scene: send its changes to the desk"
            >
              Recall now ({toApply})
            </button>
          )}
          {deskSceneId !== null && (
            <button
              className="matrix-resync"
              onClick={() => { void resyncDesk() }}
              title="Re-send the scene the desk is on: for when somebody moved a fader by hand"
            >
              Resync
            </button>
          )}
          <button
            className="scenes-edit"
            data-editing={editing}
            onClick={() => setEditing(!editing)}
            title={editing ? 'Back to running the show: recall stays live, nothing else moves' : 'Edit scenes and what their rows carry'}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {editing && (
        <div className="scenes-editing-hint">
          Editing — cells and names change the show. Done when finished.
        </div>
      )}

      {scenes.list.length === 0 ? (
        <div className="matrix-empty">
          <span>No scenes yet.</span>
          {editing ? (
            <span>Add one from the header.</span>
          ) : (
            <button className="matrix-empty-action" onClick={() => setEditing(true)}>Edit to add one</button>
          )}
        </div>
      ) : cast.dcas.length === 0 ? (
        <div className="matrix-empty">
          <span>No faders: the rows are the show&apos;s faders, and this show drives none.</span>
          <button
            className="matrix-empty-action"
            onClick={() => openShowSettings('channels')}
          >
            Set up channels…
          </button>
        </div>
      ) : (
        <div className="matrix-scroll" ref={scrollerRef}>
          <div
            className="matrix-grid"
            style={{
              gridTemplateColumns:
                `var(--matrix-mic-width) repeat(${scenes.list.length + 1}, minmax(var(--matrix-cell-width), 1fr))`
            } as CSSProperties}
          >
            <div className="matrix-corner" />

            {/* The scene that is never edited and always there: every mic closed. It is a
                column like the others so the press is where the show is run from, and the
                column reads as a place the desk can be rather than as a button. */}
            <div
              className="matrix-scene"
              data-all-closed="true"
              data-current={allClosed}
              data-pending={(changesByScene.get(ALL_CLOSED_SCENE_ID) ?? []).length > 0}
            >
              <div className="matrix-scene-name">
                <span className="scene-name-static">All closed</span>
              </div>
              <button
                className="matrix-recall"
                onClick={() => { void recallScene(ALL_CLOSED_SCENE_ID) }}
                title="Close every mic the show drives"
                aria-label="Recall all closed"
              >
                →
              </button>
            </div>

            {scenes.list.map(scene => {
              // Pending is the desk's question, not the scene's: a column is to apply when
              // recalling it would change something, which makes the marker mean the press.
              const pending = (changesByScene.get(scene.id) ?? []).length > 0
              return (
                <div
                  key={scene.id}
                  className="matrix-scene"
                  data-scene-id={scene.id}
                  data-current={scene.id === deskSceneId}
                  data-pending={pending}
                >
                  <div className="matrix-scene-name">
                    <TextField
                      className="scene-name-field"
                      value={scene.name}
                      placeholder="Scene name"
                      aria-label="Scene name"
                      size={SCENE_NAME_SIZE}
                      disabled={locked}
                      // A scene without a name is a row nobody can find again, so the old
                      // name stays until something is actually typed.
                      onValue={name => {
                        if (name.trim() === '') return
                        writeList(updateScene(scenes, scene.id, { name }))
                      }}
                    />
                    {/* Removing sits with the name, away from recall, and only exists
                        while the show is being edited. */}
                    {editing && (
                      <button
                        className="matrix-scene-remove"
                        aria-label={`Remove ${scene.name}`}
                        title="Remove this scene — undo puts it back"
                        onClick={() => writeList(removeScene(scenes, scene.id))}
                      >
                        ✕
                      </button>
                    )}
                  </div>
                  {/* The press the view is for: recalling is never locked out, so the
                      header of every column is a press in either mode. */}
                  <button
                    className="matrix-recall"
                    onClick={() => { void recallScene(scene.id) }}
                    title="Recall this scene"
                    aria-label={`Recall ${scene.name}`}
                  >
                    →
                  </button>
                </div>
              )
            })}

            {cast.dcas.map((dca, index) => (
              <div key={dca.id} className="matrix-row">
                {/* Who this row is: the fader, by its number and what the show calls it. */}
                <div className="matrix-mic">
                  <span className="matrix-fader">{`${dcaNumber(index)} · ${dca.label}`}</span>
                </div>
                {/* The all-closed column places nothing: there is nothing to carry in a
                    column that closes everything, so the gap is not a cell and is not in
                    reach. */}
                <div className="matrix-cell-blank" />
                {scenes.list.map(scene => (
                  <SceneCell
                    key={scene.id}
                    scene={scene}
                    dca={dca}
                    cast={cast}
                    scenes={scenes}
                    changes={changesByScene.get(scene.id) ?? []}
                    deskState={deskState}
                    isCurrent={scene.id === deskSceneId}
                    locked={locked}
                    writeList={writeList}
                    groupRow={addEnsembleFromRow}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
