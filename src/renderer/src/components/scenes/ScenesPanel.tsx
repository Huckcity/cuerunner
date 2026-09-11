import { useState } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { describeDeskMessage, deskSummary, sceneChanges } from '../../utils/scenes'
import { SceneDialog } from './SceneDialog'
import './ScenesPanel.css'

interface Props {
  onClose: () => void
}

/**
 * The scene panel: who is open on stage, and what recalling that leaves the desk doing.
 *
 * The panel never moves the desk on its own. A row says whether the desk is already in
 * that scene's state — a scene that differs is still to apply — and only a press or the
 * head closes the gap, because a desk that followed an edit would take the room by
 * surprise. The desk list below reads the scene the desk was last taken to rather than
 * the row under the cursor, so what it says is where the desk actually is.
 */
export function ScenesPanel({ onClose }: Props) {
  const scenes = useStore(s => s.showSettings.scenes)
  const plot = useStore(s => s.showSettings.rf.plot)
  const deskState = useStore(s => s.deskState)
  const deskSceneId = useStore(s => s.deskSceneId)

  const [editing, setEditing] = useState(false)

  const currentScene = scenes.list.find(scene => scene.id === deskSceneId) ?? null
  const deskRows = deskSummary(plot.packs, scenes.channels, currentScene)

  return (
    <div className="scenes-panel">
      <div className="scenes-header">
        <span className="scenes-title">Scenes</span>
        <span className="scenes-count">
          {scenes.list.length === 0 ? 'no scenes' : `${scenes.list.length} scenes`}
        </span>
        <div className="scenes-actions">
          <button
            className="scenes-btn"
            onClick={() => setEditing(true)}
            title="Enter the scenes and desk groups"
          >
            Edit scenes…
          </button>
          <button
            className="scenes-btn"
            onClick={() => { void recallScene(null) }}
            title="Close every group the plot drives"
          >
            Mics off
          </button>
          <button className="scenes-btn" onClick={onClose} title="Hide scenes">
            ✕
          </button>
        </div>
      </div>

      <div className="scenes-list">
        {scenes.list.map(scene => {
          // Pending is the desk's question, not the scene's: a scene is "to apply" when
          // telling the desk about it would change something, which is what makes one
          // marker mean the same thing as one press.
          const pending = sceneChanges(plot.packs, scenes.channels, scene, deskState).length > 0
          return (
            <div
              key={scene.id}
              className="scene-row"
              data-current={scene.id === deskSceneId}
              data-pending={pending}
            >
              <span className="scene-name">{scene.name}</span>
              <span className="scene-live">
                {scene.live.length === 0
                  ? 'no mics'
                  : `${scene.live.length} mic${scene.live.length === 1 ? '' : 's'}`}
              </span>
              {pending && <span className="scene-pending">not applied</span>}
              <button
                className="scene-recall"
                onClick={() => { void recallScene(scene.id) }}
                title="Send this scene to the desk"
              >
                Recall
              </button>
            </div>
          )
        })}
      </div>

      <div className="scenes-desk">
        {deskRows.map(summary => {
          // A group no mic feeds is not the plot's to move — the desk may be doing
          // something else with it, and a recall leaves it alone — so it reads as off
          // the panel's books rather than as a mute.
          const driven = summary.packs.length > 0
          const state = !driven ? '—' : summary.live ? 'live' : 'muted'
          return (
            <div key={summary.channel.id} className="desk-row" data-live={summary.live}>
              <span className="desk-label">{summary.channel.label}</span>
              <span className="desk-packs">
                {driven ? summary.packs.map(pack => pack.label).join(', ') : 'nothing assigned'}
              </span>
              <span className="desk-state">{state}</span>
              <span className="desk-message">
                {driven ? describeDeskMessage(summary.channel.unmute) : 'not driven'}
              </span>
            </div>
          )
        })}
      </div>

      {scenes.list.length === 0 && (
        <div className="scenes-empty">
          <span>No scenes yet. A scene is who is open on stage.</span>
          <button className="scenes-edit-btn" onClick={() => setEditing(true)}>
            Edit scenes…
          </button>
        </div>
      )}

      {editing && <SceneDialog onClose={() => setEditing(false)} />}
    </div>
  )
}
