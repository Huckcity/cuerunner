import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react'
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
 * them, because that is what the operator is looking at through the dialog — and every strip
 * can be moved across: a group holds strips, so a show that has never cast a performer is a
 * show whose rack can still be grouped.
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
  const rowRef = useRef<HTMLElement | null>(null)
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

  // The dialog takes the keyboard as it opens, and gives it back to the row as it closes. It
  // has to: the press that opened it was inside a menu that unmounted with it, so without
  // this the operator is left typing into nothing — and the first Tab would walk the grid
  // behind a dialog that says it is the only thing on screen.
  //
  // Back to the row, rather than to the box that opened it: a save or a delete can take that
  // box away — a row that was empty now holds the group, and a row that held one is empty —
  // and React swaps the cell's box and its block for one another. Focusing a detached element
  // is a no-op, so the row's own way in is found again, whichever of the two it now is.
  useEffect(() => {
    // The row is remembered while the press that opened this dialog is still in the
    // document: React detaches a control it stops rendering from its parent, so afterwards
    // there is no climbing from that press to the cell it was in.
    rowRef.current = box.closest('.matrix-cell')
    dialogRef.current?.focus({ preventScroll: true })
    return () => {
      const into = box.isConnected
        ? box
        : rowRef.current?.querySelector<HTMLElement>('.matrix-cell-add, .matrix-block-name') ?? null
      into?.focus({ preventScroll: true })
    }
  }, [box])

  // Both lists in the show's channel order, so a group reads the way the console does rather
  // than in the order it was picked.
  const free = cast.channels.filter(channel => !held.includes(channel.id))
  const chosen = cast.channels.filter(channel => held.includes(channel.id))

  // How tall the two lists are, fixed for as long as the dialog is open and measured in rows
  // rather than grown to fit: a list that shrank as strips were moved across would walk the
  // dialog up and down under the pointer, and the strips are moving between the two of them.
  // Four rows is the least that reads as a list, twelve the most that fits a dialog.
  const rows = Math.max(4, Math.min(12, cast.channels.length))

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
        style={{ '--ensemble-rows': rows } as CSSProperties}
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
                        // What takes its place is what is picked: the next strip in the list,
                        // or the one above it when it was the last — so a group is filled by
                        // picking and pressing, over and over, rather than by reaching back to
                        // the list between every one.
                        const at = free.findIndex(channel => channel.id === pickedFree)
                        const next = free[at + 1] ?? free[at - 1] ?? null
                        setHeld([...held, pickedFree])
                        setPickedFree(next?.id ?? null)
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
                        // The same on the way out: the next strip it holds is picked, so a
                        // group is emptied from the middle without losing the place.
                        const at = chosen.findIndex(channel => channel.id === pickedHeld)
                        const next = chosen[at + 1] ?? chosen[at - 1] ?? null
                        setHeld(held.filter(id => id !== pickedHeld))
                        setPickedHeld(next?.id ?? null)
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
                          aria-label={label}
                          title={label}
                          // Pressing a strip picks it, always: pressing the one that is
                          // already picked is how a list is read, and a press that emptied
                          // the pick would leave the arrow under the hand doing nothing.
                          onClick={() => pane.pick(channel.id)}
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
            // Nothing in it is nothing to save, whether the group is new or the edit has just
            // emptied it: the store refuses an empty list, and a press that is live for it
            // would close the dialog as if the emptying had been written — with the name
            // typed in the same visit and the strips taken out of it both gone in silence.
            disabled={chosen.length === 0}
            title={chosen.length === 0
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
