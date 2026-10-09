import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import { useStore } from '../store'
import {
  CUE_CLIPBOARD_TYPE, copyBlock, describeBlock, heldBlock, holdBlock, parseBlock, pastePlace, pastedBlock
} from '../utils/cueClipboard'
import type { Cue } from '../../../shared/cue'

/** Copies the cues, their subtrees with them, and says how many were taken. */
export function copyCues(ids: readonly string[]): Cue[] {
  const block = copyBlock(useStore.getState().cues, ids)
  if (block.length > 0) holdBlock(block)
  return block
}

/** Copies the cues and takes them out of the show, as one edit. */
export function cutCues(ids: readonly string[]): Cue[] {
  const block = copyCues(ids)
  if (block.length > 0) useStore.getState().removeCues([...ids])
  return block
}

/** Pastes a block after the cue the operator stands on, as one edit; the first copy is selected. */
export function pasteCues(block: readonly Cue[] = heldBlock()): void {
  if (block.length === 0) return
  const { cues, selectedId, insertCues } = useStore.getState()
  const place = pastePlace(cues, selectedId)
  insertCues(pastedBlock(block, cues, place.parentId), { beforeIndex: place.beforeIndex })
}

/** Whether there is anything to paste. */
export function canPaste(): boolean {
  return heldBlock().length > 0
}

/** A copy or paste aimed at a text field is the field's: its own text, not the cues. */
function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  const tag = el?.tagName
  return (tag === 'INPUT' && (el as HTMLInputElement).type !== 'range') || tag === 'TEXTAREA' || el?.isContentEditable === true
}

/**
 * The cue list's clipboard events. Edit → Copy, Cut and Paste, and their keys, reach the list
 * as the page's own copy, cut and paste events, so the menu and the keyboard are one path. A
 * copy puts the cues on the system clipboard as well — as JSON under the app's own type, and
 * as plain lines a note or a mail can take — so a paste in another Cuerunner window brings them.
 */
export function clipboardHandlers(selectedIds: () => readonly string[]) {
  const copy = (e: ReactClipboardEvent, cut: boolean): void => {
    if (inTextField(e.target)) return
    const ids = selectedIds()
    if (ids.length === 0) return
    e.preventDefault()
    const block = cut ? cutCues(ids) : copyCues(ids)
    e.clipboardData.setData(CUE_CLIPBOARD_TYPE, JSON.stringify(block))
    e.clipboardData.setData('text/plain', describeBlock(block))
  }
  return {
    onCopy: (e: ReactClipboardEvent) => copy(e, false),
    onCut: (e: ReactClipboardEvent) => copy(e, true),
    onPaste: (e: ReactClipboardEvent) => {
      if (inTextField(e.target)) return
      const carried = parseBlock(e.clipboardData.getData(CUE_CLIPBOARD_TYPE))
      if (carried === null && !canPaste()) return
      e.preventDefault()
      if (carried !== null) holdBlock(carried)
      pasteCues(carried ?? heldBlock())
    }
  }
}
