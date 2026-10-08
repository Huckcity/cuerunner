import { useRef } from 'react'
import {
  DEFAULT_BEZIER,
  FADE_SHAPE_LABELS,
  FADE_SHAPE_PRESETS,
  shapePath,
  type FadeShape,
  type FadeShapePreset
} from '../../../../shared/fadeShape'
import './AudioIo.css'

const WIDTH = 168
const HEIGHT = 96

interface Props {
  /** The row's label: "Fade-in shape". */
  label: string
  /** What the fade does with no shape of its own, named for the "default" option. */
  defaultLabel: string
  shape: FadeShape | null | undefined
  onChange: (shape: FadeShape | null) => void
  /** Distinguishes two editors in one panel, for tests and labels. */
  name: string
}

/**
 * A fade's shape: the default it always had, one of the presets, or a Bézier drawn by
 * dragging its two handles. The curve drawn is the curve that plays — the same function
 * (`shapeValue`) the engine's table and the lighting are made from.
 */
export function CurveEditor({ label, defaultLabel, shape, onChange, name }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const value = shape ?? null
  const selected = value === null ? 'default' : value.kind === 'bezier' ? 'bezier' : value.preset
  const id = `curve-editor-${name}`

  const choose = (next: string): void => {
    if (next === 'default') onChange(null)
    else if (next === 'bezier') onChange(value?.kind === 'bezier' ? value : DEFAULT_BEZIER)
    else onChange({ kind: 'preset', preset: next as FadeShapePreset })
  }

  // A handle follows the pointer, held inside the box: x is the share of the time, so it
  // keeps the curve a function of time, and y the share of the change, so it never overshoots.
  const drag = (handle: 1 | 2) => (event: React.PointerEvent<SVGCircleElement>): void => {
    if (value?.kind !== 'bezier') return
    const svg = svgRef.current
    if (svg === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const move = (moved: PointerEvent): void => {
      const box = svg.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (moved.clientX - box.left) / box.width))
      const y = Math.min(1, Math.max(0, 1 - (moved.clientY - box.top) / box.height))
      const rounded = (n: number): number => Math.round(n * 1000) / 1000
      onChange(handle === 1
        ? { ...value, x1: rounded(x), y1: rounded(y) }
        : { ...value, x2: rounded(x), y2: rounded(y) })
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const drawn: FadeShape = value ?? { kind: 'preset', preset: 'linear' }
  return (
    <div className="curve-editor" data-name={name}>
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <select id={id} className="curve-select" value={selected} onChange={e => choose(e.target.value)}>
          <option value="default">Default ({defaultLabel})</option>
          {FADE_SHAPE_PRESETS.map(preset => (
            <option key={preset} value={preset}>{FADE_SHAPE_LABELS[preset]}</option>
          ))}
          <option value="bezier">{FADE_SHAPE_LABELS.bezier}</option>
        </select>
      </div>
      {value !== null && (
        <svg
          ref={svgRef}
          className="curve-editor-plot"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          width={WIDTH}
          height={HEIGHT}
          role="img"
          aria-label={`${label}: ${value.kind === 'bezier' ? 'custom curve' : FADE_SHAPE_LABELS[value.preset]}`}
        >
          <line className="curve-editor-diagonal" x1={0} y1={HEIGHT} x2={WIDTH} y2={0} />
          <path className="curve-editor-path" d={shapePath(drawn, WIDTH, HEIGHT)} />
          {value.kind === 'bezier' && (
            <>
              <line className="curve-editor-arm" x1={0} y1={HEIGHT} x2={value.x1 * WIDTH} y2={HEIGHT - value.y1 * HEIGHT} />
              <line className="curve-editor-arm" x1={WIDTH} y1={0} x2={value.x2 * WIDTH} y2={HEIGHT - value.y2 * HEIGHT} />
              <circle className="curve-handle curve-handle-1" cx={value.x1 * WIDTH} cy={HEIGHT - value.y1 * HEIGHT} r={6}
                onPointerDown={drag(1)} />
              <circle className="curve-handle curve-handle-2" cx={value.x2 * WIDTH} cy={HEIGHT - value.y2 * HEIGHT} r={6}
                onPointerDown={drag(2)} />
            </>
          )}
        </svg>
      )}
    </div>
  )
}
