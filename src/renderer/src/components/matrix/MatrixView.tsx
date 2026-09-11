import { type CSSProperties } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { sceneChanges, setPackLive } from '../../utils/scenes'
import './MatrixView.css'

/** The count as the operator says it out loud: "4 mics", "1 mic", "no mics". */
function micCount(count: number): string {
  if (count === 0) return 'no mics'
  return `${count} mic${count === 1 ? '' : 's'}`
}

/**
 * The matrix: the mic plot down the side, the scenes across the top, and the column the
 * desk was last taken to.
 *
 * This is the curtain-up view, so it answers one question without being asked — who is
 * open now — and asks one back in amber: has the desk caught up? Editing a cell changes
 * the scene, never the desk; the header's Apply is the press that moves the room, and it
 * only appears once there is a difference to send. The lock stops editing and nothing
 * else, because recalling is what this view is for.
 */
export function MatrixView() {
  const scenes = useStore(s => s.showSettings.scenes)
  const plot = useStore(s => s.showSettings.rf.plot)
  const deskState = useStore(s => s.deskState)
  const deskSceneId = useStore(s => s.deskSceneId)
  const updateScenesSettings = useStore(s => s.updateScenesSettings)

  const locked = scenes.locked
  const current = scenes.list.find(scene => scene.id === deskSceneId) ?? null

  // The desk's question, asked for the header: what would a recall of the current scene
  // change? Nothing means the desk is where the show left it.
  const toApply =
    current === null ? 0 : sceneChanges(plot.packs, scenes.channels, current, deskState).length

  const groupLabels: Record<string, string> = Object.fromEntries(
    scenes.channels.map(channel => [channel.id, channel.label])
  )
  const performerNames: Record<string, string> = Object.fromEntries(
    plot.performers.map(performer => [performer.id, performer.name])
  )

  return (
    <div className="matrix-view" data-locked={locked}>
      <div className="matrix-header">
        <span className="matrix-title">Mic plot</span>
        <span className="matrix-subtitle">
          {`${micCount(plot.packs.length)} · ${scenes.list.length} scene${scenes.list.length === 1 ? '' : 's'}`}
        </span>
        <div className="matrix-actions">
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
        <div className="matrix-locked-hint">
          Locked for the show — recall is live, editing is not.
        </div>
      )}

      {scenes.list.length === 0 ? (
        <div className="matrix-empty">No scenes yet — make them in the SCENES panel.</div>
      ) : plot.packs.length === 0 ? (
        <div className="matrix-empty">The mic plot is empty — add packs in the RF panel.</div>
      ) : (
        <div className="matrix-scroll">
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
                  <span className="matrix-scene-name">{scene.name}</span>
                  <span className="matrix-scene-count">{micCount(scene.live.length)}</span>
                  <button
                    className="matrix-recall"
                    onClick={() => { void recallScene(scene.id) }}
                    title="Send this scene to the desk"
                  >
                    Recall
                  </button>
                </div>
              )
            })}

            {plot.packs.map(pack => {
              const channelId = pack.deskChannelId ?? null
              const on = current !== null && current.live.includes(pack.id)
              const performer =
                pack.performerId === null ? null : performerNames[pack.performerId] ?? null
              const group = channelId === null ? null : groupLabels[channelId] ?? null

              return (
                <div key={pack.id} className="matrix-row" data-on={on}>
                  {/* The plot down the side: which pack, who is wearing it, and which group
                      it feeds — the three facts a swap at the interval is made from. */}
                  <div className="matrix-mic">
                    <span className="matrix-pack">{pack.label}</span>
                    <span className="matrix-performer">{performer?.trim() || 'unassigned'}</span>
                    <span className="matrix-group">{group ?? '—'}</span>
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
    </div>
  )
}
