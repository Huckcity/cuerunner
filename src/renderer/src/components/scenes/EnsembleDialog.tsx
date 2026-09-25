import { Fragment, useEffect, useRef, useState } from 'react'
import { stripLabel } from '../../utils/cast'
import { ensembleChannels } from '../../utils/scenes'
import { useModal } from '../../hooks/useModal'
import { TextField } from '../common/Field'
import type { CastSettings, Ensemble, MicScene } from '../../../../shared/show'
import './EnsembleDialog.css'

interface Props {
  scene: MicScene
  /** The fader's own number: the only name it has. */
  fader: number
  cast: CastSettings
  /** The group being edited, or null for a new one. */
  editing: Ensemble | null
  /** The row's box: the press that opened this came from inside it, so the keyboard goes
   *  back there when the dialog closes. */
  box: HTMLElement
  onCancel: () => void
  onDelete: () => void
  onSave: (name: string, channelIds: string[]) => void
}

/**
 * The one place a group is named and filled: the strips it could hold on the left, the ones
 * it does hold on the right, and the two arrows between them.
 *
 * It is reached from a row's box, and it is the row that decides what it opens as — the
 * group that row holds, or a new one — because a row is where an operator is standing when
 * they decide the chorus should be the eight people in front of them. Editing an existing
 * group changes it on every row that holds it, which is what the hint says in as many words:
 * an ensemble is membership rather than a copy, so there is one list to be wrong about.
 *
 * Both lists are the show's strips in the show's own order, named the way the grid names
 * them, because that is what the operator is looking at through the dialog. An ensemble
 * holds performers, though, so a strip nobody is cast on cannot be moved across: it is drawn
 * disabled with the reason in its name rather than left out, because a strip missing from a
 * list is a question and a strip that says why is an answer.
 *
 * Nothing here moves the desk.
 */
export function EnsembleDialog({
  scene, fader, cast, editing, box, onCancel, onDelete, onSave
}: Props) {
  const [name, setName] = useState(editing?.name ?? '')
  const [held, setHeld] = useState<string[]>(
    editing === null ? [] : ensembleChannels(cast, editing.id)
  )
  const [pickedFree, setPickedFree] = useState<string | null>(null)
  const [pickedHeld, setPickedHeld] = useState<string | null>(null)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  // The dialog owns the keyboard: the name being typed is a name, and its Escape is a
  // dismissal rather than the transport's stop.
  useModal()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      onCancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [onCancel])

  // The dialog takes the keyboard as it opens, and gives it back to the row's box as it
  // closes. It has to: the press that opened it was inside a menu that unmounted with it,
  // so without this the operator is left typing into nothing — and the first Tab would walk
  // the grid behind a dialog that says it is the only thing on screen.
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true })
    return () => box.focus({ preventScroll: true })
  }, [box])

  // The strips somebody is standing on, which is the set a group can be built out of.
  const castOn = new Set(
    cast.performers.flatMap(performer => performer.channelId === null ? [] : [performer.channelId])
  )
  // Both lists in the show's channel order, so a group reads the way the console does rather
  // than in the order it was picked.
  const free = cast.channels.filter(channel => !held.includes(channel.id))
  const chosen = cast.channels.filter(channel => held.includes(channel.id))

  // The two lists as data: one pane of the dialog is written once, and which arrow moves
  // what is the only thing that differs between them.
  const panes = [
    {
      key: 'free',
      title: 'Available',
      channels: free,
      picked: pickedFree,
      pick: setPickedFree,
      empty: 'Every strip is in it.'
    },
    {
      key: 'held',
      title: 'In the ensemble',
      channels: chosen,
      picked: pickedHeld,
      pick: setPickedHeld,
      empty: 'Nothing in it yet.'
    }
  ]

  return (
    <div className="ensemble-overlay">
      <div
        className="ensemble-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={editing === null ? 'New ensemble' : `Edit ${editing.name}`}
        // Focusable so the dialog itself can take the keyboard as it opens: the Name field
        // is then the first Tab, rather than the grid behind it.
        tabIndex={-1}
      >
        <div className="ensemble-header">
          <span className="ensemble-title">
            {editing === null ? 'New ensemble' : 'Edit ensemble'}
          </span>
          <button
            className="ensemble-dismiss"
            onClick={onCancel}
            aria-label="Close the ensemble builder"
          >
            ✕
          </button>
        </div>

        <div className="ensemble-body">
          <div className="field-row">
            <label htmlFor="ensemble-name">Name</label>
            <TextField
              id="ensemble-name"
              className="ensemble-name-field"
              value={name}
              placeholder="Ensemble"
              // Typed rather than handed over on leaving: the press that saves it is one
              // press away, and a name still sitting in an unfocused field would make the
              // group take the default name instead.
              when="typed"
              onValue={setName}
            />
          </div>
          <p className="ensemble-hint">
            {editing === null
              ? `Applies to DCA ${fader} in “${scene.name}” the moment you create it.`
              : `On DCA ${fader} in “${scene.name}”, and every other row that holds it: saving changes them all.`}
          </p>

          <div className="ensemble-panes">
            {panes.map((pane, index) => (
              <Fragment key={pane.key}>
                {/* The arrows sit between the two lists in the DOM as well as on screen:
                    the tab order is the left-to-right move they make. */}
                {index === 1 && (
                  <div className="ensemble-arrows">
                    <button
                      type="button"
                      className="ensemble-move"
                      aria-label="Put the picked strip in the ensemble"
                      title="Put the picked strip in the ensemble"
                      disabled={pickedFree === null}
                      onClick={() => {
                        if (pickedFree === null) return
                        setHeld([...held, pickedFree])
                        setPickedFree(null)
                      }}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      className="ensemble-move"
                      aria-label="Take the picked strip out of the ensemble"
                      title="Take the picked strip out of the ensemble"
                      disabled={pickedHeld === null}
                      onClick={() => {
                        if (pickedHeld === null) return
                        setHeld(held.filter(id => id !== pickedHeld))
                        setPickedHeld(null)
                      }}
                    >
                      ←
                    </button>
                  </div>
                )}
              <div className="ensemble-pane" data-pane={pane.key}>
                <div className="ensemble-pane-title">{pane.title}</div>
                <ul className="ensemble-list">
                  {pane.channels.length === 0 && (
                    <li className="ensemble-none">{pane.empty}</li>
                  )}
                  {pane.channels.map(channel => {
                    const label = stripLabel(cast.channels, cast.performers, channel.id)
                    const opens = castOn.has(channel.id)
                    return (
                      <li key={channel.id}>
                        <button
                          type="button"
                          className="ensemble-item"
                          // Which strip the arrows will move: painted, and announced as a
                          // press that is down, because both arrows and the save press act
                          // on it and nothing else does.
                          aria-pressed={pane.picked === channel.id}
                          data-selected={pane.picked === channel.id}
                          disabled={pane.key === 'free' && !opens}
                          // A disabled button is skipped by Tab, so the reason a strip will
                          // not move is in its name as well as in its tooltip.
                          aria-label={opens
                            ? label
                            : `${label} — nobody is cast on this strip, so the group could not hold it`}
                          title={opens
                            ? label
                            : `${label} — nobody is cast on this strip, and an ensemble holds performers`}
                          onClick={() => pane.pick(pane.picked === channel.id ? null : channel.id)}
                        >
                          {label}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
              </Fragment>
            ))}
          </div>
        </div>

        <div className="ensemble-footer">
          {/* Deleting is the one press here that takes something away, so it sits apart from
              the two that keep it, at the far end of the row. */}
          {editing !== null && (
            <button
              className="ensemble-delete"
              title="Remove this ensemble — every row holding it stops holding it"
              onClick={onDelete}
            >
              Delete
            </button>
          )}
          <span className="ensemble-footer-spacer" />
          <button className="ensemble-cancel" onClick={onCancel}>Cancel</button>
          <button
            className="ensemble-create"
            disabled={chosen.length === 0 && editing === null}
            title={chosen.length === 0 && editing === null
              ? 'A group with nothing in it opens nothing'
              : editing === null
                ? `Create this ensemble and apply it to DCA ${fader}`
                : `Save it, and put it on DCA ${fader}`}
            onClick={() => onSave(name, chosen.map(channel => channel.id))}
          >
            {editing === null ? 'Create and apply' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
