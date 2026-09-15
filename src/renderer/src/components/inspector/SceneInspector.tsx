import { useState } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { sceneLiveIds } from '../../utils/scenes'
import type { SceneCue } from '../../types/cue'

/**
 * A scene cue names a scene and nothing else: which groups change and what they are told
 * belongs to the scene, so that a mic moving between performers is edited in one place.
 */
export function SceneInspector({ cue }: { cue: SceneCue }) {
  const scenes = useStore(s => s.showSettings.scenes.list)
  const ensembles = useStore(s => s.showSettings.cast.ensembles)
  const updateCue = useStore(s => s.updateCue)
  const [recalling, setRecalling] = useState(false)

  const scene = scenes.find(candidate => candidate.id === cue.sceneId) ?? null
  // Who a scene opens is what it names plus the members of the ensembles it applies, so
  // the count is asked of the scene rather than read off its list.
  const open = scene === null ? 0 : sceneLiveIds(scene, ensembles).length

  return (
    <div className="inspector-section">
      <div className="field-section-title">Scene</div>
      <div className="field-row">
        <label htmlFor="scene-cue-select">Scene</label>
        <select
          id="scene-cue-select"
          value={cue.sceneId}
          onChange={e => updateCue(cue.id, { sceneId: e.target.value })}
        >
          <option value="">— none —</option>
          {scenes.map(candidate => (
            <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
          ))}
        </select>
      </div>

      {scenes.length === 0 ? (
        <p className="inspector-hint">
          No scenes yet. Make them in the Scenes view; which DCA a mic opens is set up in
          Show Settings.
        </p>
      ) : scene === null ? (
        <p className="inspector-hint">
          This cue is not pointed at a scene, so firing it will refuse rather than close
          every mic on the desk.
        </p>
      ) : (
        <p className="inspector-hint">
          Recalling it tells the desk the difference between “{scene.name}” and where it stands now:
          {' '}{open} performer{open === 1 ? '' : 's'} open, DCAs already in the right state
          left alone.
        </p>
      )}

      <div className="field-row">
        <label></label>
        <button
          className="inspector-btn"
          disabled={scene === null || recalling}
          onClick={() => {
            setRecalling(true)
            // The recall logs what it did under this cue's label, as firing it would.
            void recallScene(cue.sceneId, `${cue.number} · ${cue.name}`)
              .finally(() => setRecalling(false))
          }}
        >
          {recalling ? 'Recalling…' : 'Recall now'}
        </button>
      </div>
    </div>
  )
}
