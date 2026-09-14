import { useEffect, useRef, type CSSProperties } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { channelLabel, performerDcaId } from '../../utils/cast'
import {
  addScene,
  ensembleState,
  isPerformerLive,
  removeScene,
  sceneChanges,
  setEnsembleApplied,
  setPerformerLive,
  updateScene
} from '../../utils/scenes'
import { TextField } from '../common/Field'
import { ALL_CLOSED_SCENE_ID, type ScenesSettings } from '../../types/show'
import './ScenesView.css'

// A scene name is what its column is read by, so the field asks for about a name's worth of
// room and no more. An input's default width is what sets a column's width, and a column
// wide enough for the browser's taste is one that pushes the numbers after it off the side
// of the window.
const SCENE_NAME_SIZE = 11

/** The columns that are scenes in the file: the all-closed column is not one of them. */
const SCENE_COLUMN = '.matrix-scene[data-scene-id]'

/** The count as the operator says it out loud: "4 performers", "1 performer", "no performers". */
function performerCount(count: number): string {
  if (count === 0) return 'no performers'
  return `${count} performer${count === 1 ? '' : 's'}`
}

/**
 * Scenes: the cast down the side, the scenes across the top. Where each performer's mic
 * is patched — and so which DCA it opens — is set up in Show Settings; this view runs it,
 * and applies the ensembles that move a handful of mics together.
 *
 * The first column is the scene that is always there and never edited: all closed. It is
 * what the desk wants pressed between numbers, and nobody is ever added to it.
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
  const addEnsembleFromScene = useStore(s => s.addEnsembleFromScene)
  const removeEnsemble = useStore(s => s.removeEnsemble)
  const updateCastSettings = useStore(s => s.updateCastSettings)
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

  // The desk's question, asked for the header: what would a recall of the current scene
  // change? Nothing means the desk is where the show left it.
  const toApply = sceneChanges(showSettings, current, deskState).length

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
          {`${performerCount(cast.performers.length)} · ${scenes.list.length} scene${scenes.list.length === 1 ? '' : 's'}`}
        </span>
        <div className="scenes-actions">
          {editing && (
            <>
              <button
                className="scenes-add"
                onClick={() => writeList(addScene(scenes))}
                title="Add a scene and open performers in it"
              >
                Add scene
              </button>
              {/* The other half of building a scene: a group of the mics that are open in
                  it, named and kept, so the next scene built from the same people is one
                  press rather than a row of them. */}
              <button
                className="scenes-ensemble"
                onClick={() => recalled !== null && addEnsembleFromScene(recalled.id)}
                disabled={recalled === null}
                title={recalled === null
                  ? 'Recall a scene first — an ensemble is made from who is open in it'
                  : `Group the mics open in "${recalled.name}" into an ensemble`}
              >
                + Ensemble
              </button>
            </>
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
          <button
            className="scenes-edit"
            data-editing={editing}
            onClick={() => setEditing(!editing)}
            title={editing ? 'Back to running the show: recall stays live, nothing else moves' : 'Edit scenes and who is in them'}
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
      ) : cast.performers.length === 0 ? (
        <div className="matrix-empty">
          <span>The cast is empty: the rows are the performers in your show.</span>
          <button
            className="matrix-empty-action"
            onClick={() => openShowSettings('cast')}
          >
            Enter the cast…
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
              data-pending={sceneChanges(showSettings, null, deskState).length > 0}
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
              const pending = sceneChanges(showSettings, scene, deskState).length > 0
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
                  {/* How many performers a scene opens is the block of colour next to it, so
                      the column says a name and the press that recalls it. */}
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

            {/* Ensembles before the performers: they are what the grid does with several
                rows at once, and applying one is a press in a scene column like any other. */}
            {cast.ensembles.map(ensemble => (
              <div className="matrix-ensemble-row" key={ensemble.id}>
                <div className="matrix-mic">
                  {editing ? (
                    <TextField
                      className="ensemble-name-field"
                      value={ensemble.name}
                      placeholder="Ensemble"
                      aria-label="Ensemble name"
                      size={SCENE_NAME_SIZE}
                      onValue={name => {
                        if (name.trim() === '') return
                        updateCastSettings({
                          ensembles: cast.ensembles.map(candidate =>
                            candidate.id === ensemble.id ? { ...candidate, name } : candidate)
                        })
                      }}
                    />
                  ) : (
                    <span className="matrix-performer">{ensemble.name}</span>
                  )}
                  <span className="matrix-ensemble-count">{ensemble.members.length}</span>
                  {editing && (
                    <button
                      className="matrix-scene-remove"
                      aria-label={`Remove ${ensemble.name}`}
                      title="Remove this ensemble — every scene using it stops using it"
                      onClick={() => removeEnsemble(ensemble.id)}
                    >
                      ✕
                    </button>
                  )}
                </div>
                {/* The all-closed column takes nobody, and an ensemble row needs its place
                    in the grid as much as a performer row does: without this gap the row is
                    one cell short, and every row after it is placed a column to the left. */}
                <div className="matrix-cell-blank" />
                {scenes.list.map(scene => {
                  const applied = scene.ensembles.includes(ensemble.id)
                  return (
                    <button
                      key={scene.id}
                      className="matrix-cell"
                      data-applied={ensembleState(scene, ensemble)}
                      data-current={scene.id === deskSceneId}
                      aria-label={`${ensemble.name} in ${scene.name}`}
                      disabled={locked}
                      onClick={() =>
                        writeList(setEnsembleApplied(scenes, scene.id, ensemble, !applied))
                      }
                    />
                  )
                })}
              </div>
            ))}

            {cast.performers.map(performer => {
              const groupId = performerDcaId(performer, cast.channels)
              const on = isPerformerLive(current, cast.ensembles, performer.id)
              const channel = channelLabel(cast.channels, performer.channelId)

              return (
                <div key={performer.id} className="matrix-row" data-on={on}>
                  {/* Who this row is: the performer, and the strip their mic is patched to.
                      Which DCA that opens is the channel's business, set up in Show
                      Settings. */}
                  <div className="matrix-mic">
                    {channel !== '' && <span className="matrix-channel">{channel}</span>}
                    <span className="matrix-performer">{performer.name}</span>
                  </div>
                  {/* The all-closed column takes no one: there is nothing to open in it, so
                      the gap is not a cell and is not in reach. */}
                  <div className="matrix-cell-blank" />
                  {scenes.list.map(scene => {
                    const live = isPerformerLive(scene, cast.ensembles, performer.id)
                    // The desk holds one state per DCA, so every performer routed to the
                    // same one are pending together: the cell says what that DCA has not
                    // been told yet.
                    const pending =
                      scene.id === deskSceneId &&
                      groupId !== null &&
                      deskState[groupId] !== live
                    return (
                      <button
                        key={scene.id}
                        className="matrix-cell"
                        data-live={live}
                        data-current={scene.id === deskSceneId}
                        data-pending={pending}
                        aria-label={`${performer.name} in ${scene.name}`}
                        disabled={locked}
                        onClick={() => writeList(
                          setPerformerLive(scenes, scene.id, performer.id, !live, cast.ensembles)
                        )}
                      />
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
