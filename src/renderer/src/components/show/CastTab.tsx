import { useStore } from '../../store'
import { addPerformer, channelLabel, updatePerformer } from '../../utils/cast'
import type { CastSettings } from '../../../../shared/show'
import { TextField } from '../common/Field'

/**
 * The cast: who is in the show, and which strip their mic is patched to.
 *
 * A performer is who they are for the whole show — the mic plot assigns packs to them and
 * the report names them the next morning — so this is where they are named and patched,
 * and nothing else is: the groups they are opened in are the Scenes view's, built from the
 * strips a row should carry, because that is where the operator is standing when they
 * decide who is in the chorus.
 */
export function CastTab() {
  const cast = useStore(s => s.showSettings.cast)
  const updateCastSettings = useStore(s => s.updateCastSettings)
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
            <TextField
              className="performer-name"
              value={performer.name}
              placeholder="Name"
              aria-label="Performer name"
              onValue={name => apply(updatePerformer(cast, performer.id, { name }))}
            />
            <TextField
              className="performer-role"
              value={performer.role}
              placeholder="Role"
              aria-label="Performer role"
              onValue={role => apply(updatePerformer(cast, performer.id, { role }))}
            />
            <select
              className="performer-channel"
              value={performer.channelId ?? ''}
              aria-label="Performer channel"
              title="The strip their mic is patched to"
              onChange={e => apply(updatePerformer(cast, performer.id, { channelId: e.target.value || null }))}
            >
              <option value="">— unpatched —</option>
              {cast.channels.map(channel => (
                <option key={channel.id} value={channel.id}>
                  {channelLabel(cast.channels, channel.id)}
                </option>
              ))}
            </select>
            <TextField
              className="performer-notes"
              value={performer.notes}
              placeholder="Notes"
              aria-label="Performer notes"
              onValue={notes => apply(updatePerformer(cast, performer.id, { notes }))}
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
    </div>
  )
}
