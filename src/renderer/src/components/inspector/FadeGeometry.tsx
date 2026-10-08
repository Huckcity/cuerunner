import { useStore } from '../../store'
import type { FadeCue } from '../../../../shared/cue'
import { GEOMETRY_LIMITS, type VisualCue } from '../../../../shared/visual'
import type { GeometryTarget } from '../../../../shared/visualKeyframes'
import { NumberField } from '../common/Field'

// What a fade aimed at a picture moves besides its level: its position, scale, rotation and
// crop, each one ticked to move and given where it goes. A property left unticked stays where
// the picture has it, and a fade that ticks none moves only the opacity — which is every fade a
// show saved before this existed.

const percent = (fraction: number): number => Math.round(fraction * 1000) / 10

export function FadeGeometry({ cue, target }: { cue: FadeCue; target: VisualCue }) {
  const update = useStore(s => s.updateCue)
  const to: GeometryTarget = cue.geometryTarget ?? {}
  const set = (next: GeometryTarget): void => {
    // Nothing ticked is no geometry at all: the field goes, rather than an empty move staying.
    const moves = next.x !== undefined || next.y !== undefined || next.scale !== undefined || next.rotation !== undefined || next.crop !== undefined
    update(cue.id, { geometryTarget: moves ? next : null })
  }
  const without = <K extends keyof GeometryTarget>(keys: K[]): GeometryTarget => {
    const next = { ...to }
    for (const key of keys) delete next[key]
    return next
  }
  // A property ticked starts from where the picture's own geometry has it, so ticking it moves
  // nothing until a value is given.
  const from = target.geometry
  const [offsetMin, offsetMax] = GEOMETRY_LIMITS.offset
  const [scaleMin, scaleMax] = GEOMETRY_LIMITS.scale
  const moving = { position: to.x !== undefined || to.y !== undefined, scale: to.scale !== undefined, rotation: to.rotation !== undefined, crop: to.crop !== undefined }

  return (
    <div className="fade-geometry">
      <div className="field-section-title">Move the picture</div>
      <div className="field-row">
        <label htmlFor="fade-move-position">Position (%)</label>
        <input id="fade-move-position" type="checkbox" checked={moving.position}
          onChange={e => set(e.target.checked ? { ...to, x: from.x, y: from.y } : without(['x', 'y']))} />
        <NumberField when="typed" min={offsetMin * 100} max={offsetMax * 100} step={0.1} disabled={!moving.position}
          aria-label="Move across" title="Right of centre, as a share of the output's width"
          value={percent(to.x ?? from.x)} onValue={x => { if (x !== null) set({ ...to, x: x / 100, y: to.y ?? from.y }) }} />
        <NumberField when="typed" min={offsetMin * 100} max={offsetMax * 100} step={0.1} disabled={!moving.position}
          aria-label="Move down" title="Below centre, as a share of the output's height"
          value={percent(to.y ?? from.y)} onValue={y => { if (y !== null) set({ ...to, y: y / 100, x: to.x ?? from.x }) }} />
      </div>
      <div className="field-row">
        <label htmlFor="fade-move-scale">Scale (%)</label>
        <input id="fade-move-scale" type="checkbox" checked={moving.scale}
          onChange={e => set(e.target.checked ? { ...to, scale: from.scale } : without(['scale']))} />
        <NumberField when="typed" min={scaleMin * 100} max={scaleMax * 100} step={0.1} disabled={!moving.scale}
          aria-label="Move scale" value={percent(to.scale ?? from.scale)}
          onValue={scale => { if (scale !== null) set({ ...to, scale: scale / 100 }) }} />
      </div>
      <div className="field-row">
        <label htmlFor="fade-move-rotation">Rotate (°)</label>
        <input id="fade-move-rotation" type="checkbox" checked={moving.rotation}
          onChange={e => set(e.target.checked ? { ...to, rotation: from.rotation } : without(['rotation']))} />
        <NumberField when="typed" min={GEOMETRY_LIMITS.rotation[0]} max={GEOMETRY_LIMITS.rotation[1]} step={0.1} disabled={!moving.rotation}
          aria-label="Move rotation" value={to.rotation ?? from.rotation}
          onValue={rotation => { if (rotation !== null) set({ ...to, rotation }) }} />
      </div>
      {target.type !== 'text' && (
        <div className="field-row">
          <label htmlFor="fade-move-crop">Crop (%)</label>
          <input id="fade-move-crop" type="checkbox" checked={moving.crop}
            onChange={e => set(e.target.checked ? { ...to, crop: { ...from.crop } } : without(['crop']))} />
          {(['top', 'right', 'bottom', 'left'] as const).map(edge => (
            <NumberField key={edge} when="typed" min={0} max={GEOMETRY_LIMITS.crop[1] * 100} step={0.1} disabled={!moving.crop}
              className="visual-crop" aria-label={`Move crop ${edge}`} title={`Cut from the ${edge}`}
              value={percent((to.crop ?? from.crop)[edge])}
              onValue={value => { if (value !== null) set({ ...to, crop: { ...(to.crop ?? from.crop), [edge]: value / 100 } }) }} />
          ))}
        </div>
      )}
    </div>
  )
}
