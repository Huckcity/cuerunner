import { useStore } from '../../store'
import {
  addEnsemble,
  addPerformer,
  channelLabel,
  ensembleMembers,
  updateEnsemble,
  updatePerformer
} from '../../utils/cast'
import type { CastSettings } from '../../types/show'
import { CommitInput } from './CommitField'

/** The DCA a strip drives, as the cast list names it: "DCA 4", or a label someone wrote. */
function dcaLabel(cast: CastSettings, dcaId: string | null): string {
  if (dcaId === null) return ''
  const index = cast.dcas.findIndex(dca => dca.id === dcaId)
  return index === -1 ? '' : cast.dcas[index].label
}

/**
 * The cast: who is in the show, which strip their mic is patched to, and the ensembles
 * they are grouped into. An ensemble is a grouping and nothing else — it is applied to a
 * scene from the Scenes view, where the mics it holds open are pressed for the show —
 * so this tab is where the groups are named and filled, not where they are used.
 */
export function CastTab() {
  const cast = useStore(s => s.showSettings.cast)
  const updateCastSettings = useStore(s => s.updateCastSettings)
  const removeEnsemble = useStore(s => s.removeEnsemble)
  const removePerformer = useStore(s => s.removePerformer)

  const apply = (next: CastSettings): void => updateCastSettings(next)

  return (
    <div className="show-tab-body">
      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Performers</span>
        </div>

        {cast.performers.map(performer => (
          <div className="performer-row" key={performer.id}>
            <CommitInput
              className="performer-name"
              value={performer.name}
              placeholder="Name"
              aria-label="Performer name"
              onCommit={name => apply(updatePerformer(cast, performer.id, { name }))}
            />
            <CommitInput
              className="performer-role"
              value={performer.role}
              placeholder="Role"
              aria-label="Performer role"
              onCommit={role => apply(updatePerformer(cast, performer.id, { role }))}
            />
            <select
              className="performer-channel"
              value={performer.channelId ?? ''}
              aria-label="Performer channel"
              title="The strip their mic is patched to — the DCA it opens is the strip's"
              onChange={e => apply(updatePerformer(cast, performer.id, { channelId: e.target.value || null }))}
            >
              <option value="">— unpatched —</option>
              {cast.channels.map(channel => {
                const label = channelLabel(cast.channels, channel.id)
                const fader = dcaLabel(cast, channel.dcaId)
                // The fader is part of what a patch means, so the option says it: picking
                // a strip is choosing what the desk moves.
                return (
                  <option key={channel.id} value={channel.id}>
                    {fader === '' ? label : `${label} → ${fader}`}
                  </option>
                )
              })}
            </select>
            <CommitInput
              className="performer-notes"
              value={performer.notes}
              placeholder="Notes"
              aria-label="Performer notes"
              onCommit={notes => apply(updatePerformer(cast, performer.id, { notes }))}
            />
            <button
              className="performer-remove"
              aria-label={`Remove ${performer.name || 'performer'}`}
              title="Remove from the cast — undo puts them back"
              onClick={() => removePerformer(performer.id)}
            >✕</button>
          </div>
        ))}

        <button className="performer-add add-row" onClick={() => apply(addPerformer(cast, 'New performer', ''))}>
          + Performer
        </button>
      </div>

      <div className="show-section">
        <div className="show-section-head">
          <span className="show-section-title">Ensembles</span>
        </div>

        {cast.ensembles.map(ensemble => {
          const members = ensembleMembers(cast, ensemble.id)
          const free = cast.performers.filter(performer => !ensemble.members.includes(performer.id))
          return (
            <div className="ensemble-row" key={ensemble.id}>
              <div className="ensemble-fields">
                <CommitInput
                  className="ensemble-name"
                  value={ensemble.name}
                  placeholder="Ensemble"
                  aria-label="Ensemble name"
                  onCommit={name => apply(updateEnsemble(cast, ensemble.id, { name }))}
                />
                <span className="ensemble-count">
                  {members.length === 1 ? '1 member' : `${members.length} members`}
                </span>
                <button
                  className="ensemble-remove"
                  aria-label={`Remove ${ensemble.name}`}
                  title="Remove this ensemble — every scene using it stops using it"
                  onClick={() => removeEnsemble(ensemble.id)}
                >✕</button>
              </div>
              <div className="ensemble-members">
                {members.map(member => (
                  <span className="member-chip" key={member.id}>
                    {member.name || 'unnamed'}
                    <button
                      type="button"
                      aria-label={`Take ${member.name} out of ${ensemble.name}`}
                      onClick={() => apply(updateEnsemble(cast, ensemble.id, {
                        members: ensemble.members.filter(id => id !== member.id)
                      }))}
                    >✕</button>
                  </span>
                ))}
                {free.length > 0 && (
                  <select
                    className="member-add"
                    aria-label={`Add a performer to ${ensemble.name}`}
                    value=""
                    onChange={e => {
                      if (e.target.value !== '') {
                        apply(updateEnsemble(cast, ensemble.id, {
                          members: [...ensemble.members, e.target.value]
                        }))
                      }
                    }}
                  >
                    <option value="">+ add member</option>
                    {free.map(performer => (
                      <option key={performer.id} value={performer.id}>{performer.name}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          )
        })}

        <button className="ensemble-add add-row" onClick={() => apply(addEnsemble(cast))}>
          + Ensemble
        </button>
      </div>
    </div>
  )
}
