import { useRef, useState } from 'react'
import { useStore } from '../../store'
import {
  addressSpan,
  DMX_LIMITS,
  identifyLook,
  patchWarnings,
  type FixtureType,
  type ParamKind,
  PARAM_KINDS
} from '../../../../shared/dmx'
import { NumberField, TextField } from '../common/Field'
import { addFixtures, addType, patchableTypes, removeFixtures, removeType, updateFixture, userType } from '../../utils/lighting'
import { importOflFixture } from '../../utils/oflImport'
import { lightingCommand } from '../../engine/lighting'

/** How long identify flashes a fixture. */
export const IDENTIFY_MS = 3000

function typeLabel(type: FixtureType): string {
  return type.manufacturer === '' || type.manufacturer === 'Generic' ? type.name : `${type.manufacturer} ${type.name}`
}

/** A channel name's kind, by the word in it: "Red" is red, "Dimmer" and "Intensity" are intensity. */
function kindOfName(name: string): ParamKind {
  const word = name.trim().toLowerCase()
  if (word === 'dimmer' || word === 'intensity' || word === 'master') return 'intensity'
  if (word === 'color' || word === 'colour' || word === 'colour wheel' || word === 'color wheel') return 'colour'
  const found = PARAM_KINDS.find(kind => kind === word)
  return found ?? 'other'
}

/**
 * The patch: every fixture hung, its type and mode, where it is addressed — and the clashes,
 * named, before the show finds them. Each fixture can be flashed to find it in the rig.
 */
export function PatchPanel() {
  const lighting = useStore(s => s.lighting)
  const setLighting = useStore(s => s.setLighting)
  const types = patchableTypes(lighting)
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  const type = types.find(entry => entry.id === typeId) ?? types[0]
  const [mode, setMode] = useState('')
  const chosenMode = type?.modes.find(entry => entry.name === mode) ?? type?.modes[0]
  const [universe, setUniverse] = useState(1)
  const [address, setAddress] = useState<number | null>(null)
  const [count, setCount] = useState(1)
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [typeName, setTypeName] = useState('')
  const [typeChannels, setTypeChannels] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const warnings = patchWarnings(lighting)
  const flagged = new Set(warnings.flatMap(warning => warning.fixtureIds))

  const patch = (): void => {
    if (type === undefined || chosenMode === undefined) return
    const result = addFixtures(lighting, {
      typeId: type.id,
      mode: chosenMode.name,
      universe,
      address,
      count,
      name: name === '' ? type.name : name
    })
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    setAddress(null)
    setLighting(result.lighting)
  }

  const buildType = (): void => {
    const channels = typeChannels.split(',').map(entry => entry.trim()).filter(entry => entry !== '')
    if (channels.length === 0 || channels.length > DMX_LIMITS.paramsPerMode) {
      setError(`a type has from 1 to ${DMX_LIMITS.paramsPerMode} channels, named and separated by commas`)
      return
    }
    const built = userType(typeName, '', channels.map(label => ({ label, kind: kindOfName(label) })))
    const next = addType(lighting, built)
    if ('error' in next) {
      setError(next.error)
      return
    }
    setError(null)
    setTypeName('')
    setTypeChannels('')
    setLighting(next)
    setTypeId(built.id)
  }

  const importFile = async (file: File): Promise<void> => {
    // Bounded before it is read: a definition is a few kilobytes of JSON.
    if (file.size > DMX_LIMITS.importBytes) {
      setError(`${file.name} is larger than the ${DMX_LIMITS.importBytes / 1024} KB a fixture definition is read up to`)
      return
    }
    const imported = importOflFixture(await file.text(), file.name.replace(/\.json$/i, ''))
    if (!imported.ok) {
      setError(`${file.name}: ${imported.error}`)
      return
    }
    const next = addType(useStore.getState().lighting, imported.type)
    if ('error' in next) {
      setError(next.error)
      return
    }
    setError(null)
    setLighting(next)
    setTypeId(imported.type.id)
  }

  return (
    <div className="lighting-panel" data-panel="patch">
      <div className="lighting-section-title">Add fixtures</div>
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="patch-type">Type</label>
          <select id="patch-type" value={type?.id ?? ''} onChange={e => { setTypeId(e.target.value); setMode('') }}>
            {types.map(entry => <option key={entry.id} value={entry.id}>{typeLabel(entry)}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="patch-mode">Mode</label>
          <select id="patch-mode" value={chosenMode?.name ?? ''} onChange={e => setMode(e.target.value)}>
            {type?.modes.map(entry => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
          </select>
        </div>
        <div className="field-row">
          <label htmlFor="patch-universe">Universe</label>
          <NumberField id="patch-universe" when="typed" min={1} max={DMX_LIMITS.maxUniverse} value={universe}
            onValue={value => { if (value !== null) setUniverse(value) }} />
        </div>
        <div className="field-row">
          <label htmlFor="patch-address">Address</label>
          <NumberField id="patch-address" when="typed" min={1} max={DMX_LIMITS.slots} value={address}
            placeholder="first free" onValue={setAddress} />
        </div>
        <div className="field-row">
          <label htmlFor="patch-count">How many</label>
          <NumberField id="patch-count" when="typed" min={1} max={128} value={count}
            onValue={value => { if (value !== null) setCount(value) }} />
        </div>
        <div className="field-row">
          <label htmlFor="patch-name">Name</label>
          <TextField id="patch-name" when="typed" value={name} placeholder={type?.name ?? ''} onValue={setName} />
        </div>
      </div>
      <div className="lighting-form-actions">
        <button className="lighting-btn" onClick={patch}>Patch</button>
        {error !== null && <span className="lighting-error" role="alert">{error}</span>}
      </div>

      <div className="lighting-section-title">Fixtures</div>
      {warnings.length > 0 && (
        <ul className="lighting-warnings" aria-label="Patch warnings">
          {warnings.map(warning => <li key={`${warning.kind}:${warning.fixtureIds.join(':')}`}>{warning.detail}</li>)}
        </ul>
      )}
      {lighting.fixtures.length === 0 ? (
        <p className="lighting-note">Nothing patched. Add fixtures above.</p>
      ) : (
        <table className="lighting-table" aria-label="Fixtures">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th className="lighting-narrow">Universe</th>
              <th className="lighting-narrow">Address</th>
              <th>Slots</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lighting.fixtures.map(fixture => {
              const span = addressSpan(lighting, fixture)
              const fixtureType = lighting.types.find(entry => entry.id === fixture.typeId)
              return (
                <tr key={fixture.id} data-fixture={fixture.name} data-warning={flagged.has(fixture.id)}>
                  <td>
                    <TextField aria-label={`${fixture.name} name`} value={fixture.name}
                      onValue={text => { if (text.trim() !== '') setLighting(updateFixture(lighting, fixture.id, { name: text.trim() })) }} />
                  </td>
                  <td>{fixtureType ? `${typeLabel(fixtureType)} · ${fixture.mode}` : 'type missing'}</td>
                  <td className="lighting-narrow">
                    <NumberField aria-label={`${fixture.name} universe`} min={1} max={DMX_LIMITS.maxUniverse} value={fixture.universe}
                      onValue={value => { if (value !== null) setLighting(updateFixture(lighting, fixture.id, { universe: value })) }} />
                  </td>
                  <td className="lighting-narrow">
                    <NumberField aria-label={`${fixture.name} address`} min={1} max={DMX_LIMITS.slots} value={fixture.address}
                      onValue={value => { if (value !== null) setLighting(updateFixture(lighting, fixture.id, { address: value })) }} />
                  </td>
                  <td className="lighting-mono">{span === null ? '—' : `${span.first}–${span.last}`}</td>
                  <td className="lighting-actions-cell">
                    <button className="lighting-btn" title="Flash it for three seconds"
                      onClick={() => void lightingCommand('identify', { values: identifyLook(lighting, fixture), ms: IDENTIFY_MS })}>
                      Identify
                    </button>
                    <button className="lighting-btn lighting-btn-remove" aria-label={`Remove ${fixture.name}`}
                      onClick={() => setLighting(removeFixtures(lighting, [fixture.id]))}>
                      Remove
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <div className="lighting-section-title">The show’s types</div>
      {lighting.types.length > 0 && (
        <table className="lighting-table" aria-label="Fixture types">
          <thead>
            <tr><th>Type</th><th>From</th><th>Modes</th><th /></tr>
          </thead>
          <tbody>
            {lighting.types.map(entry => (
              <tr key={entry.id}>
                <td>{typeLabel(entry)}</td>
                <td>{entry.source === 'builtin' ? 'built in' : entry.source === 'import' ? 'imported' : 'made here'}</td>
                <td>{entry.modes.map(m => m.name).join(', ')}</td>
                <td className="lighting-actions-cell">
                  <button className="lighting-btn lighting-btn-remove" onClick={() => {
                    const next = removeType(lighting, entry.id)
                    if ('error' in next) setError(next.error)
                    else setLighting(next)
                  }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="type-name">New type</label>
          <TextField id="type-name" when="typed" value={typeName} placeholder="name" onValue={setTypeName} />
        </div>
        <div className="field-row">
          <label htmlFor="type-channels">Channels</label>
          <TextField id="type-channels" when="typed" value={typeChannels} placeholder="Dimmer, Red, Green, Blue, Strobe"
            onValue={setTypeChannels} />
        </div>
      </div>
      <div className="lighting-form-actions">
        <button className="lighting-btn" onClick={buildType}>Add type</button>
        <button className="lighting-btn" onClick={() => fileRef.current?.click()}>Import Open Fixture Library file…</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden aria-label="Fixture definition file"
          onChange={e => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void importFile(file)
          }} />
      </div>
    </div>
  )
}
