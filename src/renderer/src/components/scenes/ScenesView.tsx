import { useEffect, useRef, useState, type CSSProperties, type InputHTMLAttributes } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { resolvedGroupId } from '../../utils/cast'
import { addScene, removeScene, sceneChanges, setPerformerLive, updateScene } from '../../utils/scenes'
import type { ScenesSettings } from '../../types/show'
import { PlotDialog } from '../rf/PlotDialog'
import { ShowDialog } from '../show/ShowDialog'
import './ScenesView.css'

// A scene name is what its column is read by, so the field asks for about a name's worth of
// room and no more. An input's default width is what sets a column's width, and a column
// wide enough for the browser's taste is one that pushes the numbers after it off the side
// of the window.
const SCENE_NAME_SIZE = 11

/** The count as the operator says it out loud: "4 performers", "1 performer", "no performers". */
function performerCount(count: number): string {
  if (count === 0) return 'no performers'
  return `${count} performer${count === 1 ? '' : 's'}`
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
 * Scenes: the cast down the side, the scenes across the top. Who each performer's mic
 * routes to on the desk — their own group, or their ensemble's — is set up in the Show
 * panel; this view only runs it.
 *
 * This is the curtain-up view and the place the show is run from, so it has two modes.
 * It always opens to run it: recall, Apply and Mics off are live, and nothing else can
 * be changed by a stray click. Edit is the deliberate press that gives the grid and the
 * names back, and Done hands the view back to the show. Editing a cell changes the
 * scene, never the desk; the header's Apply is the press that moves the room, and it
 * only appears once there is a difference to send.
 */
export function ScenesView() {
  const scenes = useStore(s => s.showSettings.scenes)
  const cast = useStore(s => s.showSettings.cast)
  const deskState = useStore(s => s.deskState)
  const deskSceneId = useStore(s => s.deskSceneId)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)
  const editing = useStore(s => s.scenesEditing)
  const setEditing = useStore(s => s.setScenesEditing)
  const openSettings = useStore(s => s.openSettings)

  const [showOpen, setShowOpen] = useState(false)
  const [plotOpen, setPlotOpen] = useState(false)

  const locked = !editing
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
  const toApply = current === null
    ? 0
    : sceneChanges(cast.performers, cast.ensembles, cast.groups, current, deskState).length

  // Every edit writes back the one field it changed, so a cell toggled in the grid cannot
  // carry a stale copy of anything else with it.
  const writeList = (next: ScenesSettings): void => updateScenesSettings({ list: next.list })

  return (
    <div className="scenes-view" data-editing={editing}>
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
              <button
                className="scenes-plot"
                onClick={() => setPlotOpen(true)}
                title="Who is currently wearing which pack"
              >
                Mic plot…
              </button>
              <button
                className="scenes-show"
                onClick={() => setShowOpen(true)}
                title="Performers, ensembles and the desk groups they drive"
              >
                Show…
              </button>
              <button
                className="scenes-sources"
                onClick={() => openSettings('wireless')}
                title="Where the packs' battery and RF readings come from"
              >
                Telemetry…
              </button>
            </>
          )}
          <button
            className="scenes-mics-off"
            onClick={() => { void recallScene(null) }}
            title="Close every group the cast drives"
          >
            Mics off
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
            onClick={() => { setEditing(true); setShowOpen(true) }}
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
                `var(--matrix-mic-width) repeat(${scenes.list.length}, minmax(var(--matrix-cell-width), 1fr))`
            } as CSSProperties}
          >
            <div className="matrix-corner" />

            {scenes.list.map(scene => {
              // Pending is the desk's question, not the scene's: a column is to apply when
              // recalling it would change something, which makes the marker mean the press.
              const pending =
                sceneChanges(cast.performers, cast.ensembles, cast.groups, scene, deskState).length > 0
              return (
                <div
                  key={scene.id}
                  className="matrix-scene"
                  data-current={scene.id === deskSceneId}
                  data-pending={pending}
                >
                  <div className="matrix-scene-name">
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
                    title="Send this scene to the desk"
                    aria-label={`Recall ${scene.name}`}
                  >
                    →
                  </button>
                </div>
              )
            })}

            {cast.performers.map(performer => {
              const groupId = resolvedGroupId(performer, cast.ensembles)
              const on = current !== null && current.live.includes(performer.id)

              return (
                <div key={performer.id} className="matrix-row" data-on={on}>
                  {/* Who this row is: the performer, not a mic. Which group their mic
                      routes to — their own, or their ensemble's — is set up in the Show
                      panel, and stays with them across a pack swap. */}
                  <div className="matrix-mic">
                    <span className="matrix-performer">{performer.name}</span>
                  </div>
                  {scenes.list.map(scene => {
                    const live = scene.live.includes(performer.id)
                    // The desk holds one state per group, so every performer routed to
                    // the same one are pending together: the cell says what that group
                    // has not been told yet.
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
                        onClick={() =>
                          updateScenesSettings({
                            list: setPerformerLive(scenes, scene.id, performer.id, !live).list
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

      {plotOpen && <PlotDialog onClose={() => setPlotOpen(false)} />}
      {showOpen && <ShowDialog onClose={() => setShowOpen(false)} />}
    </div>
  )
}
