import { useState } from 'react'
import { useStore } from '../../store'
import { recallScene } from '../../engine/scenes'
import { channelLabel } from '../../utils/cast'
import { channelDcas, sceneChannelIds } from '../../utils/scenes'
import type { SceneCue } from '../../../../shared/cue'

/**
 * A scene cue names a scene and nothing else: which channels move and what they are told
 * belongs to the scene, so that a mic moving between faders is edited in one place.
 */
export function SceneInspector({ cue }: { cue: SceneCue }) {
  const scenes = useStore(s => s.showSettings.scenes.list)
  const cast = useStore(s => s.showSettings.cast)
  const updateCue = useStore(s => s.updateCue)
  const [recalling, setRecalling] = useState(false)

  const scene = scenes.find(candidate => candidate.id === cue.sceneId) ?? null
  // What a recall would touch is what the scene places anywhere: the channels it carries
  // on any fader, named the console's way — `Ch 3 · Ruth`, which is the desk's own reading
  // rather than the grid's — and the faders it speaks for. Both are asked of the scene
  // rather than read off a list, since an ensemble applied to a row carries channels no
  // list on the scene names directly.
  const placed = scene === null ? [] : sceneChannelIds(scene, cast)
  const labels = placed
    .map(channelId => channelLabel(cast.channels, channelId))
    .filter(label => label !== '')
  const faders = new Set(
    placed.flatMap(channelId => (scene === null ? [] : channelDcas(scene, channelId, cast)))
  ).size

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
          No scenes yet. Build them in the Scenes view.
        </p>
      ) : scene === null ? (
        <p className="inspector-hint">
          Pick a scene. Until then this cue does nothing, rather than closing every mic.
        </p>
      ) : (
        <p className="inspector-hint">
          Recalling it tells the desk the difference between “{scene.name}” and where it stands now:
          {' '}{placed.length} channel{placed.length === 1 ? '' : 's'} open
          {labels.length > 0 ? ` (${labels.join(', ')})` : ''}
          {' '}on {faders} fader{faders === 1 ? '' : 's'}, anything already in the right state
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
