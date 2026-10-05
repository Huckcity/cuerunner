// A file dropped on the window lands on a surface that takes files, or nowhere.
//
// The cue list takes them: a drop there becomes audio cues. Everywhere else — the toolbar,
// the inspector, the dock, the transport — nothing was listening, and a drop nothing takes
// is the browser's to handle: it opens the file in place of the page. For this window that
// is the whole app replaced by one audio file, mid-show, with the unsaved work gone and a
// window that can no longer be closed. The inspector's File field is the obvious place to
// aim a file at, and it is a few pixels from the list.
//
// So the window refuses what no surface took. A handler that takes a drop has already said
// so by the time the event reaches the window (`defaultPrevented`), and is left alone; the
// rest is refused with the cursor that says a drop here does nothing. A drag that is not
// files — a cue row being reordered — is none of this guard's business.
//
// `main/safety/navigation.ts` holds the same line from the other side, for anything that
// gets past a page.

/** Whether a drag is carrying files from outside the window. */
function carriesFiles(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') === true
}

function refuse(event: DragEvent): void {
  if (event.defaultPrevented || !carriesFiles(event)) return
  event.preventDefault()
  if (event.type === 'dragover' && event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

/** Installs the guard on the window; the returned function takes it away again. */
export function installDropGuard(target: Window = window): () => void {
  target.addEventListener('dragover', refuse)
  target.addEventListener('drop', refuse)
  return () => {
    target.removeEventListener('dragover', refuse)
    target.removeEventListener('drop', refuse)
  }
}
