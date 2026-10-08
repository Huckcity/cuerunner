import { useEffect, useRef } from 'react'
import { useStore } from '../../store'
import { useModal } from '../../hooks/useModal'
import { cuesOfList } from '../../../../shared/cueLists'

interface Props {
  listId: string
  onClose: () => void
}

/**
 * Asks before a list goes, because its cues go with it: the sentence counts them. Undo brings
 * the list and every one of its cues back as they were.
 */
export function DeleteListDialog({ listId, onClose }: Props) {
  useModal()
  const list = useStore(s => s.cueLists.find(entry => entry.id === listId))
  const count = useStore(s => cuesOfList(s.cues, listId).length)
  const removeCueList = useStore(s => s.removeCueList)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // The safe answer has the keyboard: Enter on a dialog that deletes cues should not delete them.
    cancelRef.current?.focus()
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  if (list === undefined) return null
  const what = count === 0 ? 'It has no cues.' : `Its ${count === 1 ? 'cue goes' : `${count} cues go`} with it.`

  return (
    <div className="cue-list-dialog-overlay" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cue-list-dialog" role="alertdialog" aria-modal="true" aria-label="Delete list">
        <div className="cue-list-dialog-header">
          <span className="cue-list-dialog-title">Delete “{list.name}”?</span>
        </div>
        <p className="cue-list-dialog-blurb">{what} Undo brings them back.</p>
        <div className="cue-list-dialog-footer">
          <button ref={cancelRef} className="cue-list-dialog-button" onClick={onClose}>Cancel</button>
          <button className="cue-list-dialog-button" data-kind="danger" data-action="confirm-delete-list"
            onClick={() => { removeCueList(listId); onClose() }}>
            Delete list
          </button>
        </div>
      </div>
    </div>
  )
}
