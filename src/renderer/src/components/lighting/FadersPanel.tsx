import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'
import type { LightCue } from '../../../../shared/cue'
import { functionAt, resolveParam } from '../../../../shared/dmx'
import type { DmxMonitor, DmxProgrammerValue } from '../../../../shared/dmxWire'
import { lightingCommand } from '../../engine/lighting'
import { paramsOf, recordLook } from '../../utils/lighting'
import { targetLabel } from '../inspector/targetLabel'

function key(fixtureId: string, param: string): string {
  return `${fixtureId}\u0000${param}`
}

/**
 * The faders: every fixture's parameters, live, over whatever the cues are doing — the way a
 * look is built by eye. Record puts what the faders hold into a Light cue and lets the faders
 * go, so the next GO shows the cue rather than the faders on top of it.
 */
export function FadersPanel({ monitor }: { monitor: DmxMonitor | null }) {
  const lighting = useStore(s => s.lighting)
  const cues = useStore(s => s.cues)
  const selectedId = useStore(s => s.selectedId)
  const updateCue = useStore(s => s.updateCue)
  const addCue = useStore(s => s.addCue)
  const lightCues = cues.filter((cue): cue is LightCue => cue.type === 'light')
  const [held, setHeld] = useState<Map<string, DmxProgrammerValue>>(new Map())
  const [target, setTarget] = useState<string>('')
  const [note, setNote] = useState<string | null>(null)
  const loaded = useRef(false)

  // What the engine holds when the view opens: faders moved before, in this session.
  useEffect(() => {
    if (loaded.current || monitor === null) return
    loaded.current = true
    setHeld(new Map(monitor.programmer.map(value => [key(value.fixtureId, value.param), value])))
  }, [monitor])

  const selectedLight = lightCues.find(cue => cue.id === selectedId)
  const chosen = lightCues.find(cue => cue.id === target) ?? selectedLight ?? null

  const move = (fixtureId: string, param: string, v: number): void => {
    const fixture = lighting.fixtures.find(entry => entry.id === fixtureId)
    const address = fixture === undefined ? null : resolveParam(lighting, fixture, param)
    if (fixture === undefined || address === null) return
    const value: DmxProgrammerValue = { ...address, v, fixtureId, param }
    setHeld(previous => new Map(previous).set(key(fixtureId, param), value))
    void lightingCommand('program', { values: [value] })
  }

  const clear = (): void => {
    setHeld(new Map())
    void lightingCommand('clearProgrammer')
  }

  const record = (mode: 'merge' | 'replace' | 'new'): void => {
    const values = [...held.values()]
    if (values.length === 0) {
      setNote('Move a fader first: there is nothing to record.')
      return
    }
    if (mode === 'new') {
      addCue('light', selectedId ?? undefined, { look: recordLook([], values, 'replace') } as Partial<LightCue>)
      setNote(`Recorded ${values.length} value${values.length === 1 ? '' : 's'} into a new Light cue.`)
    } else {
      if (chosen === null) return
      updateCue(chosen.id, { look: recordLook(chosen.look, values, mode) } as Partial<LightCue>)
      setNote(`Recorded ${values.length} value${values.length === 1 ? '' : 's'} into ${targetLabel(chosen)}.`)
    }
    clear()
  }

  return (
    <div className="lighting-panel" data-panel="faders">
      <div className="lighting-section-title">Record</div>
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="record-target">Light cue</label>
          <select id="record-target" value={chosen?.id ?? ''} onChange={e => setTarget(e.target.value)}>
            {chosen === null && <option value="">— none —</option>}
            {lightCues.map(cue => <option key={cue.id} value={cue.id}>{targetLabel(cue)}</option>)}
          </select>
        </div>
      </div>
      <div className="lighting-form-actions">
        <button className="lighting-btn" disabled={chosen === null} onClick={() => record('merge')}>
          Record into cue
        </button>
        <button className="lighting-btn" disabled={chosen === null} onClick={() => record('replace')}>
          Replace cue’s look
        </button>
        <button className="lighting-btn" onClick={() => record('new')}>New Light cue</button>
        <button className="lighting-btn" onClick={clear}>Clear faders</button>
        {note !== null && <span className="lighting-note" role="status">{note}</span>}
      </div>

      <div className="lighting-section-title">Fixtures</div>
      {lighting.fixtures.length === 0 && <p className="lighting-note">Nothing patched. Add fixtures in Patch.</p>}
      <div className="lighting-fixtures">
        {lighting.fixtures.map(fixture => (
          <div key={fixture.id} className="lighting-fixture" data-fixture={fixture.name}>
            <div className="lighting-fixture-name">
              <span>{fixture.name}</span>
              <span className="lighting-mono">{fixture.universe}/{fixture.address}</span>
            </div>
            {paramsOf(lighting, fixture).map(entry => {
              const value = held.get(key(fixture.id, entry.key))
              const id = `fader-${fixture.id}-${entry.key}`
              return (
                <div key={entry.key} className="lighting-fader" data-held={value !== undefined}>
                  <label htmlFor={id}>{entry.label}</label>
                  <input
                    id={id}
                    type="range"
                    min={0}
                    max={1}
                    step={entry.fineOffset === null ? 1 / 255 : 1 / 1000}
                    value={value?.v ?? 0}
                    aria-label={`${fixture.name} ${entry.label}`}
                    onChange={e => move(fixture.id, entry.key, Number(e.target.value))}
                  />
                  <output htmlFor={id}>{value === undefined ? '—' : `${Math.round(value.v * 100)}%`}</output>
                  {entry.functions !== undefined && (
                    <span className="lighting-function" data-testid="fader-function">
                      {functionAt(entry, value?.v ?? entry.home) ?? ''}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
