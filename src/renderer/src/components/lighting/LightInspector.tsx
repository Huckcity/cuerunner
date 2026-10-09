import { useState } from 'react'
import { useStore } from '../../store'
import type { FadeCurve, LightCue } from '../../../../shared/cue'
import {
  DMX_LIMITS,
  EFFECT_SHAPES,
  type EffectShape,
  type IntensityRule,
  type LightEffect,
  type LightLevel
} from '../../../../shared/dmx'
import { NumberField } from '../common/Field'
import { LastRun } from '../inspector/LastRun'
import { ResetButton } from '../inspector/ResetButton'
import { LIGHT_DEFAULTS } from '../../utils/cueDefaults'
import { paramsOf, targetName, targetParams, trackingSheet, type TrackingRole } from '../../utils/lighting'
import './Lighting.css'
import { CurveEditor } from '../audio/CurveEditor'

/** A target as a select carries it: its kind and its id in one value. */
function targetValue(target: 'fixture' | 'group', id: string): string {
  return `${target}:${id}`
}

function parseTarget(value: string): { target: 'fixture' | 'group'; id: string } | null {
  const at = value.indexOf(':')
  if (at < 0) return null
  const target = value.slice(0, at)
  return target === 'fixture' || target === 'group' ? { target, id: value.slice(at + 1) } : null
}

/** The target picker: the show's groups first, then its fixtures. */
function TargetSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  const lighting = useStore(s => s.lighting)
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— choose —</option>
      {lighting.groups.length > 0 && (
        <optgroup label="Groups">
          {lighting.groups.map(group => <option key={group.id} value={targetValue('group', group.id)}>{group.name}</option>)}
        </optgroup>
      )}
      {lighting.fixtures.length > 0 && (
        <optgroup label="Fixtures">
          {lighting.fixtures.map(fixture => (
            <option key={fixture.id} value={targetValue('fixture', fixture.id)}>{fixture.name}</option>
          ))}
        </optgroup>
      )}
    </select>
  )
}

/**
 * A Light cue: how long its look takes to arrive and on what curve, how its intensity combines
 * with other cues', the look itself — each level a fixture's or a group's — and the effects it
 * starts. A look is usually recorded from the faders in the lighting view; it can be built and
 * trimmed here too.
 */
export function LightInspector({ cue }: { cue: LightCue }) {
  const update = useStore(s => s.updateCue)
  const lighting = useStore(s => s.lighting)
  const set = (patch: Partial<LightCue>): void => update(cue.id, patch)
  const [pick, setPick] = useState('')
  const [param, setParam] = useState('')
  const [value, setValue] = useState(1)
  const [shape, setShape] = useState<EffectShape>('sine')
  const picked = parseTarget(pick)
  const offered = picked === null ? [] : targetParams(lighting, picked.target, picked.id)
  const chosenParam = offered.find(entry => entry.key === param) ?? offered[0]

  const label = (level: Pick<LightLevel, 'target' | 'id' | 'param'>): { text: string; gone: boolean } => {
    const name = targetName(lighting, level.target, level.id)
    if (name === null) return { text: `${level.param} — not in the rig`, gone: true }
    const params = level.target === 'fixture'
      ? paramsOf(lighting, lighting.fixtures.find(fixture => fixture.id === level.id)!)
      : targetParams(lighting, level.target, level.id)
    const paramLabel = params.find(entry => entry.key === level.param)?.label ?? level.param
    return { text: `${name} · ${paramLabel}`, gone: false }
  }

  const addLevel = (): void => {
    if (picked === null || chosenParam === undefined || cue.look.length >= DMX_LIMITS.lookEntries) return
    set({ look: [...cue.look, { target: picked.target, id: picked.id, param: chosenParam.key, value }] })
  }

  const addEffect = (): void => {
    if (picked === null || chosenParam === undefined || cue.effects.length >= DMX_LIMITS.effects) return
    const effect: LightEffect = {
      target: picked.target, id: picked.id, param: chosenParam.key, shape, rate: 0.5, low: 0, high: 1,
      spread: picked.target === 'group' ? 1 : 0
    }
    set({ effects: [...cue.effects, effect] })
  }

  const setLevel = (index: number, next: number): void =>
    set({ look: cue.look.map((level, at) => (at === index ? { ...level, value: next } : level)) })

  const setEffect = (index: number, patch: Partial<LightEffect>): void =>
    set({ effects: cue.effects.map((effect, at) => (at === index ? { ...effect, ...patch } : effect)) })

  return (
    <div className="inspector-section">
      <div className="field-row">
        <label htmlFor="light-fade">Fade (s)</label>
        <NumberField id="light-fade" when="typed" min={0} max={DMX_LIMITS.fadeMs / 1000} step={0.1} value={cue.duration / 1000}
          onValue={seconds => { if (seconds !== null) set({ duration: Math.round(seconds * 1000) }) }} />
        <ResetButton label="Fade" value={cue.duration} defaultValue={LIGHT_DEFAULTS.duration}
          onReset={() => set({ duration: LIGHT_DEFAULTS.duration })} />
      </div>
      <div className="field-row">
        <label htmlFor="light-curve">Curve</label>
        <select id="light-curve" value={cue.curve} onChange={e => set({ curve: e.target.value as FadeCurve })}>
          <option value="linear">Linear</option>
          <option value="sCurve">S-Curve</option>
          <option value="logarithmic">Logarithmic</option>
        </select>
        <ResetButton label="Curve" value={cue.curve} defaultValue={LIGHT_DEFAULTS.curve}
          onReset={() => set({ curve: LIGHT_DEFAULTS.curve })} />
      </div>
      <CurveEditor name="light" label="Shape" defaultLabel="the curve" shape={cue.shape} onChange={shape => set({ shape })} />
      <div className="field-row">
        <label htmlFor="light-intensity">Intensity</label>
        <select id="light-intensity" value={cue.intensity} onChange={e => set({ intensity: e.target.value as IntensityRule })}>
          <option value="ltp">Latest takes precedence</option>
          <option value="htp">Highest takes precedence</option>
        </select>
        <ResetButton label="Intensity" value={cue.intensity} defaultValue={LIGHT_DEFAULTS.intensity}
          onReset={() => set({ intensity: LIGHT_DEFAULTS.intensity })} />
      </div>

      <div className="field-section-title">Look</div>
      {cue.look.length === 0 && (
        <p className="inspector-hint" data-scope="panel">Nothing yet. Record the faders in Lighting, or add a level below.</p>
      )}
      <div className="light-look" aria-label="Look">
        {cue.look.map((level, index) => {
          const named = label(level)
          return (
            <div key={`${level.target}:${level.id}:${level.param}:${index}`} className="light-look-row" data-gone={named.gone}>
              <span className="light-look-target" title={named.text}>{named.text}</span>
              <input type="range" min={0} max={1} step={0.01} value={level.value} aria-label={`${named.text} level`}
                onChange={e => setLevel(index, Number(e.target.value))} />
              <button className="inspector-btn-icon inspector-btn-remove" aria-label={`Remove ${named.text}`}
                onClick={() => set({ look: cue.look.filter((_, at) => at !== index) })}>✕</button>
            </div>
          )
        })}
      </div>

      <div className="field-row">
        <label htmlFor="light-target">Target</label>
        <TargetSelect id="light-target" value={pick} onChange={next => { setPick(next); setParam('') }} />
      </div>
      <div className="field-row">
        <label htmlFor="light-param">Parameter</label>
        <select id="light-param" value={chosenParam?.key ?? ''} disabled={offered.length === 0} onChange={e => setParam(e.target.value)}>
          {offered.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
        </select>
      </div>
      <div className="field-row">
        <label htmlFor="light-value">Level (%)</label>
        <NumberField id="light-value" when="typed" min={0} max={100} value={Math.round(value * 100)}
          onValue={percent => { if (percent !== null) setValue(percent / 100) }} />
        <button className="inspector-btn" disabled={chosenParam === undefined} onClick={addLevel}>Add level</button>
      </div>

      <div className="field-section-title">Effects</div>
      {cue.effects.map((effect, index) => {
        const named = label(effect)
        return (
          <div key={`${effect.target}:${effect.id}:${effect.param}:${index}`} className="light-effect" data-effect={index}>
            <div className="field-row">
              <label>{named.gone ? 'Gone' : 'Moves'}</label>
              <span className="light-look-target" title={named.text}>{named.text}</span>
              <button className="inspector-btn-icon inspector-btn-remove" aria-label={`Remove effect on ${named.text}`}
                onClick={() => set({ effects: cue.effects.filter((_, at) => at !== index) })}>✕</button>
            </div>
            <div className="field-row">
              <label htmlFor={`effect-shape-${index}`}>Shape</label>
              <select id={`effect-shape-${index}`} value={effect.shape} onChange={e => setEffect(index, { shape: e.target.value as EffectShape })}>
                {EFFECT_SHAPES.map(entry => <option key={entry} value={entry}>{entry}</option>)}
              </select>
            </div>
            <div className="field-row">
              <label htmlFor={`effect-rate-${index}`}>Rate (Hz)</label>
              <NumberField id={`effect-rate-${index}`} min={0.01} max={25} step={0.01} value={effect.rate}
                onValue={rate => { if (rate !== null) setEffect(index, { rate }) }} />
            </div>
            <div className="field-row">
              <label htmlFor={`effect-low-${index}`}>Between (%)</label>
              <NumberField id={`effect-low-${index}`} aria-label="Low" min={0} max={100} value={Math.round(effect.low * 100)}
                onValue={low => { if (low !== null) setEffect(index, { low: low / 100 }) }} />
              <NumberField aria-label="High" min={0} max={100} value={Math.round(effect.high * 100)}
                onValue={high => { if (high !== null) setEffect(index, { high: high / 100 }) }} />
            </div>
            {effect.target === 'group' && (
              <div className="field-row">
                <label htmlFor={`effect-spread-${index}`}>Spread (%)</label>
                <NumberField id={`effect-spread-${index}`} min={0} max={100} value={Math.round(effect.spread * 100)}
                  onValue={spread => { if (spread !== null) setEffect(index, { spread: spread / 100 }) }} />
              </div>
            )}
          </div>
        )
      })}
      <div className="field-row">
        <label htmlFor="light-effect-shape">New effect</label>
        <select id="light-effect-shape" value={shape} onChange={e => setShape(e.target.value as EffectShape)}>
          {EFFECT_SHAPES.map(entry => <option key={entry} value={entry}>{entry}</option>)}
        </select>
        <button className="inspector-btn" disabled={chosenParam === undefined} onClick={addEffect}>Add effect</button>
      </div>
      <p className="inspector-hint">An effect moves the target and parameter chosen above. On a group, spread makes a chase.</p>
      <LastRun cueId={cue.id} />
    </div>
  )
}

const ROLE_WORDS: Record<TrackingRole, string> = {
  changed: 'moves',
  repeated: 'sets again',
  tracked: 'tracks'
}

/**
 * The cue's tracking sheet: every parameter with a value at this cue, and whether this cue moves
 * it, sets it to what it already was — a level that could come out without changing the show —
 * or leaves it where an earlier cue put it.
 */
export function LightTrackingTab({ cue }: { cue: LightCue }) {
  const cues = useStore(s => s.cues)
  const lighting = useStore(s => s.lighting)
  const rows = trackingSheet(cues, lighting, cue)
  const numberOf = (cueId: string): string => (cueId === cue.id ? 'this cue' : `cue ${cues.find(entry => entry.id === cueId)?.number ?? '?'}`)
  const [onlyChanged, setOnlyChanged] = useState(false)
  const shown = onlyChanged ? rows.filter(row => row.role !== 'tracked') : rows

  return (
    <div className="inspector-section">
      <div className="field-row">
        <label htmlFor="tracking-only">Only this cue</label>
        <input id="tracking-only" type="checkbox" checked={onlyChanged} onChange={e => setOnlyChanged(e.target.checked)} />
      </div>
      {shown.length === 0 ? (
        <p className="inspector-hint" data-scope="panel">No parameter has a value at this cue.</p>
      ) : (
        <table className="lighting-table" aria-label="Tracking">
          <thead>
            <tr><th>Fixture</th><th>Parameter</th><th>Level</th><th>From</th><th /></tr>
          </thead>
          <tbody>
            {shown.map(row => {
              const fixture = lighting.fixtures.find(entry => entry.id === row.fixtureId)
              const paramLabel = fixture === undefined ? row.param : (paramsOf(lighting, fixture).find(entry => entry.key === row.param)?.label ?? row.param)
              return (
                <tr key={`${row.fixtureId}:${row.param}`} className="light-tracking-row" data-role={row.role}>
                  <td>{fixture?.name ?? '?'}</td>
                  <td>{paramLabel}</td>
                  <td className="lighting-mono">{Math.round(row.value * 100)}%</td>
                  <td>{numberOf(row.cueId)}</td>
                  <td>{ROLE_WORDS[row.role]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
