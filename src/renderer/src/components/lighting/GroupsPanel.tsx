import { useState } from 'react'
import { useStore } from '../../store'
import { TextField } from '../common/Field'
import { addGroup, removeGroup, updateGroup } from '../../utils/lighting'

/**
 * Groups: fixtures a cue drives as one. A level on a group reaches every member that has the
 * parameter, so "the wash to blue" is one line in a cue however many pars are in the wash.
 */
export function GroupsPanel() {
  const lighting = useStore(s => s.lighting)
  const setLighting = useStore(s => s.setLighting)
  const [name, setName] = useState('')

  return (
    <div className="lighting-panel" data-panel="groups">
      <div className="lighting-section-title">Add a group</div>
      <div className="lighting-form">
        <div className="field-row">
          <label htmlFor="group-name">Name</label>
          <TextField id="group-name" when="typed" value={name} placeholder={`Group ${lighting.groups.length + 1}`} onValue={setName} />
        </div>
      </div>
      <div className="lighting-form-actions">
        <button className="lighting-btn" onClick={() => { setLighting(addGroup(lighting, name, [])); setName('') }}>
          Add group
        </button>
      </div>
      {lighting.groups.length === 0 && <p className="lighting-note">No groups yet.</p>}
      {lighting.groups.map(group => (
        <div key={group.id} data-group={group.name}>
          <div className="lighting-section-title">{group.name}</div>
          <div className="lighting-form-actions">
            <TextField aria-label={`${group.name} name`} value={group.name}
              onValue={text => { if (text.trim() !== '') setLighting(updateGroup(lighting, group.id, { name: text.trim() })) }} />
            <button className="lighting-btn lighting-btn-remove" onClick={() => setLighting(removeGroup(lighting, group.id))}>
              Remove group
            </button>
          </div>
          {lighting.fixtures.length === 0 ? (
            <p className="lighting-note">Patch fixtures to put them in a group.</p>
          ) : (
            <table className="lighting-table" aria-label={`${group.name} members`}>
              <tbody>
                {lighting.fixtures.map(fixture => {
                  const member = group.fixtureIds.includes(fixture.id)
                  return (
                    <tr key={fixture.id}>
                      <td className="lighting-actions-cell">
                        <input
                          type="checkbox"
                          aria-label={`${fixture.name} in ${group.name}`}
                          checked={member}
                          onChange={e => setLighting(updateGroup(lighting, group.id, {
                            fixtureIds: e.target.checked
                              ? [...group.fixtureIds, fixture.id]
                              : group.fixtureIds.filter(id => id !== fixture.id)
                          }))}
                        />
                      </td>
                      <td>{fixture.name}</td>
                      <td className="lighting-mono">{fixture.universe}/{fixture.address}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </div>
  )
}
