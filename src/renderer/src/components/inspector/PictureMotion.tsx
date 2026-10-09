import { useStore } from '../../store'
import { BLEND_MODES, blendOf, type BlendMode } from '../../../../shared/visualBlend'
import {
  KEYFRAME_EASINGS,
  MAX_KEYFRAMES,
  keyframeAt,
  keyframesEndMs,
  normalizeKeyframes,
  type GeometryKeyframe,
  type KeyframeEasing
} from '../../../../shared/visualKeyframes'
import { GEOMETRY_LIMITS, type VisualCue } from '../../../../shared/visual'
import { NumberField } from '../common/Field'

// The parts of a picture's Picture tab that are about how it sits with the rest of the show:
// how it is laid over what is behind it, whether the next GO takes it down, and where it moves
// over its own play.

const BLEND_NAME: Record<BlendMode, string> = {
  normal: 'Normal',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'Colour dodge',
  'color-burn': 'Colour burn',
  'hard-light': 'Hard light',
  'soft-light': 'Soft light',
  difference: 'Difference',
  exclusion: 'Exclusion',
  add: 'Add',
  subtract: 'Subtract'
}

const EASING_NAME: Record<KeyframeEasing, string> = {
  linear: 'Linear',
  'ease-in': 'Ease in',
  'ease-out': 'Ease out',
  'ease-in-out': 'Ease in and out',
  hold: 'Jump'
}

const percent = (fraction: number): number => Math.round(fraction * 1000) / 10
const toSeconds = (ms: number): number => Math.round(ms / 100) / 10

/** Blend mode and the next GO: how the picture sits with the rest of the show. */
export function PictureCompositing({ cue }: { cue: VisualCue }) {
  const update = useStore(s => s.updateCue)
  const showDefault = useStore(s => s.pictures.stopOnNextGo)
  const blend = blendOf(cue.blendMode)
  const nextGo = typeof cue.stopOnNextGo === 'boolean' ? (cue.stopOnNextGo ? 'yes' : 'no') : 'default'
  return (
    <>
      <div className="field-row">
        <label htmlFor="inspector-blend">Blend</label>
        <select id="inspector-blend" className="visual-blend" value={blend}
          onChange={e => update(cue.id, { blendMode: e.target.value as BlendMode })}>
          {BLEND_MODES.map(mode => <option key={mode} value={mode}>{BLEND_NAME[mode]}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="inspector-next-go">Next GO</label>
        <select id="inspector-next-go" className="visual-next-go" value={nextGo}
          onChange={e => update(cue.id, { stopOnNextGo: e.target.value === 'default' ? null : e.target.value === 'yes' })}>
          <option value="default">{showDefault ? 'The show’s default — takes it down' : 'The show’s default — leaves it up'}</option>
          <option value="yes">Takes it down</option>
          <option value="no">Leaves it up</option>
        </select>
      </div>
    </>
  )
}

/**
 * The picture's keyframes: where it is at moments of its own play, from its first frame. Each
 * one is reached from the one before by its easing; the picture starts where its own geometry
 * puts it and stays at the last.
 */
export function PictureKeyframes({ cue }: { cue: VisualCue }) {
  const update = useStore(s => s.updateCue)
  const keyframes = normalizeKeyframes(cue.keyframes, cue.geometry)
  const write = (next: GeometryKeyframe[]): void => {
    const normalized = normalizeKeyframes(next, cue.geometry)
    update(cue.id, { keyframes: normalized.length === 0 ? undefined : normalized })
  }
  const change = (index: number, patch: Partial<GeometryKeyframe>): void =>
    write(keyframes.map((keyframe, i) => (i === index ? { ...keyframe, ...patch } : keyframe)))
  const add = (): void => {
    // A second after the last one, where the picture would be then: a move starts from rest.
    const at = keyframes.length === 0 ? 1000 : keyframesEndMs(keyframes) + 1000
    write([...keyframes, keyframeAt(cue.geometry, keyframes, at)])
  }
  const [offsetMin, offsetMax] = GEOMETRY_LIMITS.offset
  const [scaleMin, scaleMax] = GEOMETRY_LIMITS.scale

  return (
    <div className="visual-keyframes">
      <div className="field-section-title">Keyframes</div>
      {keyframes.length === 0 && (
        <p className="inspector-hint" style={{ marginTop: 0 }}>None: the picture stays where its geometry puts it.</p>
      )}
      {keyframes.map((keyframe, index) => (
        <div className="visual-keyframe" key={index} data-keyframe={index}>
          <div className="field-row">
            <label>At (s)</label>
            <NumberField when="typed" min={0} step={0.1} value={toSeconds(keyframe.atMs)} aria-label="Keyframe time"
              onValue={seconds => { if (seconds !== null) change(index, { atMs: Math.round(seconds * 1000) }) }} />
            <select aria-label="Easing" className="visual-keyframe-easing" value={keyframe.easing}
              onChange={e => change(index, { easing: e.target.value as KeyframeEasing })}>
              {KEYFRAME_EASINGS.map(easing => <option key={easing} value={easing}>{EASING_NAME[easing]}</option>)}
            </select>
            <button className="inspector-btn visual-keyframe-remove" onClick={() => write(keyframes.filter((_, i) => i !== index))}>
              Remove
            </button>
          </div>
          <div className="field-row">
            <label>Position (%)</label>
            <NumberField when="typed" min={offsetMin * 100} max={offsetMax * 100} step={0.1} value={percent(keyframe.x)}
              aria-label="Keyframe across" onValue={x => { if (x !== null) change(index, { x: x / 100 }) }} />
            <NumberField when="typed" min={offsetMin * 100} max={offsetMax * 100} step={0.1} value={percent(keyframe.y)}
              aria-label="Keyframe down" onValue={y => { if (y !== null) change(index, { y: y / 100 }) }} />
          </div>
          <div className="field-row">
            <label>Scale (%)</label>
            <NumberField when="typed" min={scaleMin * 100} max={scaleMax * 100} step={0.1} value={percent(keyframe.scale)}
              aria-label="Keyframe scale" onValue={scale => { if (scale !== null) change(index, { scale: scale / 100 }) }} />
            <label className="visual-inline-label">Rotate (°)</label>
            <NumberField when="typed" min={GEOMETRY_LIMITS.rotation[0]} max={GEOMETRY_LIMITS.rotation[1]} step={0.1}
              value={keyframe.rotation} aria-label="Keyframe rotation"
              onValue={rotation => { if (rotation !== null) change(index, { rotation }) }} />
          </div>
          {cue.type !== 'text' && (
            <div className="field-row">
              <label>Crop (%)</label>
              {(['top', 'right', 'bottom', 'left'] as const).map(edge => (
                <NumberField key={edge} when="typed" min={0} max={GEOMETRY_LIMITS.crop[1] * 100} step={0.1}
                  className="visual-crop" aria-label={`Keyframe crop ${edge}`} value={percent(keyframe.crop[edge])}
                  onValue={value => { if (value !== null) change(index, { crop: { ...keyframe.crop, [edge]: value / 100 } }) }} />
              ))}
            </div>
          )}
        </div>
      ))}
      <div className="field-row">
        <label>Keyframes</label>
        <button className="inspector-btn visual-keyframe-add" disabled={keyframes.length >= MAX_KEYFRAMES} onClick={add}>
          Add keyframe
        </button>
        {keyframes.length > 0 && (
          <button className="inspector-btn" onClick={() => write([])}>Remove all</button>
        )}
      </div>
    </div>
  )
}
