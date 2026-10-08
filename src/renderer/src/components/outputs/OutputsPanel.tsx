import { useEffect, useState } from 'react'
import { useStore } from '../../store'
import { useOutputState } from '../../hooks/useOutputs'
import { NumberField, TextField } from '../common/Field'
import {
  GRID_POSITIONS,
  MAX_OUTPUTS,
  TIMER_MODES,
  type CornerOffset,
  type GridPosition,
  type OutputPlacement,
  type OutputStatus,
  type TimerMode,
  type VideoOutput
} from '../../../../shared/visual'
import type { TimerWindowState } from '../../../../shared/ipc/output'
import './OutputsPanel.css'

// The video outputs, in the dock: what the show declares, where this machine puts each one,
// and a picture of what each is showing right now — so the operator can see the projector
// from the desk without turning round.

/** How often the previews are refreshed while the panel is open. */
const PREVIEW_MS = 1000

const TIMER_NAME: Record<TimerMode, string> = {
  off: 'No timer',
  clock: 'Time of day',
  elapsed: 'Show clock',
  remaining: 'Cue remaining'
}

const CORNER_NAME = ['Top left', 'Top right', 'Bottom right', 'Bottom left']

interface Props {
  onClose: () => void
}

export function OutputsPanel({ onClose }: Props) {
  const outputs = useStore(s => s.videoOutputs)
  const addVideoOutput = useStore(s => s.addVideoOutput)
  const statuses = useOutputState(s => s.statuses)
  const displays = useOutputState(s => s.displays)
  const timerWindow = useOutputState(s => s.timerWindow)
  const errors = useOutputState(s => s.errors)
  const [previews, setPreviews] = useState<Record<string, string | null>>({})

  // The displays and statuses as main has them now: the panel may open long after the last event.
  useEffect(() => {
    void window.cuerunner.output.snapshot().then(snapshot => useOutputState.getState().apply(snapshot)).catch(() => {})
  }, [])

  // A picture of each output, refreshed while the panel is on screen.
  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      for (const output of useStore.getState().videoOutputs) {
        void window.cuerunner.output.preview(output.id).then(url => {
          if (!cancelled) setPreviews(current => ({ ...current, [output.id]: url }))
        }).catch(() => {})
      }
    }
    refresh()
    const timer = setInterval(refresh, PREVIEW_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [outputs.length])

  const setTimerWindow = (state: TimerWindowState): void => {
    void window.cuerunner.output.timerWindow(state).then(next => useOutputState.getState().setTimerWindow(next)).catch(() => {})
  }

  return (
    <div className="outputs-panel">
      <div className="outputs-header">
        <span className="outputs-title">Video outputs</span>
        <span className="outputs-count">
          {outputs.length === 0 ? 'none yet' : `${outputs.length} ${outputs.length === 1 ? 'output' : 'outputs'}`}
        </span>
        <div className="outputs-actions">
          <button className="outputs-btn outputs-add" disabled={outputs.length >= MAX_OUTPUTS} onClick={() => addVideoOutput()}>
            + Add output
          </button>
          <button className="outputs-btn outputs-identify" disabled={outputs.length === 0}
            onClick={() => void window.cuerunner.output.identify()} title="Draw each output's name across it for three seconds">
            Identify
          </button>
          <label className="outputs-timer-window">
            Floating timer
            <select
              value={timerWindow.open ? timerWindow.mode : 'off'}
              onChange={e => {
                const mode = e.target.value as TimerMode
                setTimerWindow(mode === 'off' ? { ...timerWindow, open: false } : { open: true, mode })
              }}
            >
              {TIMER_MODES.map(mode => <option key={mode} value={mode}>{mode === 'off' ? 'Off' : TIMER_NAME[mode]}</option>)}
            </select>
          </label>
          <button className="outputs-btn" onClick={onClose} title="Hide outputs">✕</button>
        </div>
      </div>
      {errors.length > 0 && (
        <div className="outputs-error" role="status">{errors[errors.length - 1].message}</div>
      )}
      <div className="outputs-body">
        {outputs.length === 0 ? (
          <p className="outputs-empty">
            A video, image or text cue needs somewhere to go. Add an output: it opens as a window you can move to the projector, or put fullscreen on a display.
          </p>
        ) : outputs.map(output => (
          <OutputCard key={output.id} output={output} status={statuses[output.id]} preview={previews[output.id] ?? null}
            displays={displays} />
        ))}
      </div>
    </div>
  )
}

function OutputCard({ output, status, preview, displays }: {
  output: VideoOutput
  status: OutputStatus | undefined
  preview: string | null
  displays: ReturnType<typeof useOutputState.getState>['displays']
}) {
  const update = useStore(s => s.updateVideoOutput)
  const remove = useStore(s => s.removeVideoOutput)
  const cues = useStore(s => s.cues)
  const set = (patch: Partial<Omit<VideoOutput, 'id'>>): void => update(output.id, patch)
  const placement = status?.placement ?? { displayId: null, displayLabel: '', fullscreen: false, bounds: null }

  const place = (next: OutputPlacement): void => {
    void window.cuerunner.output.place(output.id, next).then(result => {
      if (result.ok) useOutputState.getState().status(result.status)
    }).catch(() => {})
  }
  const setCorner = (index: number, patch: Partial<CornerOffset>): void => {
    const corners = output.warp.corners.map((corner, i) => i === index ? { ...corner, ...patch } : corner) as VideoOutput['warp']['corners']
    set({ warp: { ...output.warp, corners } })
  }
  const setBlend = (edge: keyof VideoOutput['warp']['blend'], value: number): void =>
    set({ warp: { ...output.warp, blend: { ...output.warp.blend, [edge]: value } } })

  const showing = (status?.layers ?? []).map(id => cues.find(cue => cue.id === id)).filter(cue => cue !== undefined)
  const state = status?.windowClosed === true
    ? 'window closed'
    : status === undefined || !status.open
    ? 'opening…'
    : [status.renderer === 'webgl' ? 'GPU' : status.renderer === 'canvas' ? '2D fallback' : '', `${status.width} × ${status.height}`].filter(Boolean).join(' · ')

  return (
    <div className="output-card" data-output={output.id} data-missing={status?.displayMissing === true}>
      <div className="output-card-top">
        <div className="output-preview">
          {preview !== null ? <img src={preview} alt={`What ${output.name} is showing`} /> : <span>no picture yet</span>}
        </div>
        <div className="output-card-facts">
          <TextField value={output.name} aria-label="Output name" className="output-name"
            onValue={name => { if (name.trim() !== '') set({ name: name.trim() }) }} />
          <span className="output-state">{state}</span>
          {status?.displayMissing === true && (
            <span className="output-missing">{placement.displayLabel || 'Its display'} is not connected — showing in a window</span>
          )}
          <span className="output-showing">
            {showing.length === 0 ? 'Nothing up' : `Up: ${showing.map(cue => `${cue.number} ${cue.name}`).join(', ')}`}
          </span>
        </div>
      </div>

      <div className="field-row">
        <label>Display</label>
        <select className="output-display" value={placement.displayId === null ? '' : String(placement.displayId)}
          onChange={e => {
            const id = e.target.value === '' ? null : Number(e.target.value)
            const display = displays.find(candidate => candidate.id === id)
            place({ ...placement, displayId: id, displayLabel: display?.label ?? '', fullscreen: id !== null && placement.fullscreen, bounds: null })
          }}>
          <option value="">A window</option>
          {displays.map(display => (
            <option key={display.id} value={String(display.id)}>
              {display.label} ({display.bounds.width} × {display.bounds.height}){display.primary ? ' — main' : ''}
            </option>
          ))}
          {placement.displayId !== null && !displays.some(display => display.id === placement.displayId) && (
            <option value={String(placement.displayId)}>{placement.displayLabel || 'A display'} — not connected</option>
          )}
        </select>
        <label className="output-inline">
          <input type="checkbox" className="output-fullscreen" checked={placement.fullscreen} disabled={placement.displayId === null}
            onChange={e => place({ ...placement, fullscreen: e.target.checked })} /> Fullscreen
        </label>
      </div>
      <div className="field-row">
        <label>Size</label>
        <NumberField when="leave" min={16} max={8192} value={output.width} aria-label="Width"
          onValue={width => { if (width !== null) set({ width }) }} />
        <span className="output-times">×</span>
        <NumberField when="leave" min={16} max={8192} value={output.height} aria-label="Height"
          onValue={height => { if (height !== null) set({ height }) }} />
      </div>
      <div className="field-row">
        <label>Timer</label>
        <select className="output-timer-mode" value={output.timer.mode}
          onChange={e => set({ timer: { ...output.timer, mode: e.target.value as TimerMode } })}>
          {TIMER_MODES.map(mode => <option key={mode} value={mode}>{TIMER_NAME[mode]}</option>)}
        </select>
        <select aria-label="Timer position" value={output.timer.position} disabled={output.timer.mode === 'off'}
          onChange={e => set({ timer: { ...output.timer, position: e.target.value as GridPosition } })}>
          {GRID_POSITIONS.map(position => <option key={position} value={position}>{position.replace('-', ' ')}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label>Check</label>
        <button className="outputs-btn output-test-pattern" data-active={status?.testPattern === true}
          onClick={() => {
            void window.cuerunner.output.testPattern(output.id, !(status?.testPattern === true)).then(() =>
              window.cuerunner.output.snapshot()).then(snapshot => useOutputState.getState().apply(snapshot)).catch(() => {})
          }}>
          {status?.testPattern === true ? 'Hide test pattern' : 'Test pattern'}
        </button>
        {status?.windowClosed === true && (
          <button className="outputs-btn output-reopen" onClick={() => place(placement)}>Open its window</button>
        )}
        <button className="outputs-btn output-remove" onClick={() => remove(output.id)}>Remove output</button>
      </div>

      <details className="output-projector">
        <summary>Corner pin and soft edges</summary>
        {output.warp.corners.map((corner, index) => (
          <div className="field-row" key={CORNER_NAME[index]}>
            <label>{CORNER_NAME[index]} (%)</label>
            <NumberField when="leave" min={-100} max={100} step={0.1} value={Math.round(corner.x * 1000) / 10}
              aria-label={`${CORNER_NAME[index]} across`} onValue={x => { if (x !== null) setCorner(index, { x: x / 100 }) }} />
            <NumberField when="leave" min={-100} max={100} step={0.1} value={Math.round(corner.y * 1000) / 10}
              aria-label={`${CORNER_NAME[index]} down`} onValue={y => { if (y !== null) setCorner(index, { y: y / 100 }) }} />
          </div>
        ))}
        <div className="field-row">
          <label>Soft edge (%)</label>
          {(['left', 'right', 'top', 'bottom'] as const).map(edge => (
            <NumberField key={edge} when="leave" min={0} max={50} step={0.1} aria-label={`Soft edge ${edge}`} title={`Soft edge, ${edge}`}
              value={Math.round(output.warp.blend[edge] * 1000) / 10}
              onValue={value => { if (value !== null) setBlend(edge, value / 100) }} />
          ))}
        </div>
        <div className="field-row">
          <label>Edge curve</label>
          <NumberField when="leave" min={0.1} max={5} step={0.1} value={output.warp.gamma}
            onValue={gamma => { if (gamma !== null) set({ warp: { ...output.warp, gamma } }) }} />
          <button className="outputs-btn" onClick={() => set({ warp: { corners: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], blend: { left: 0, right: 0, top: 0, bottom: 0 }, gamma: 1 } })}>
            Reset
          </button>
        </div>
      </details>
    </div>
  )
}
