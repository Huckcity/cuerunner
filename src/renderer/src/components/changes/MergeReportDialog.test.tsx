// What the operator is shown after a merge, and the two things they can do from it.
// The merge itself is a pure function with its own tests (`shared/showfileMerge.test.ts`)
// and the writing of the file is the main process's; this surface is the part that
// decides whether a conflict is visible or quietly gone.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MergeReportDialog } from './MergeReportDialog'
import { useStore } from '../../store'
import { TEST_LICENSE } from '../../../../test/license'

let container: HTMLDivElement
let root: Root
let merge: Mock
let openPath: Mock

const TALLY = { oursOnly: 3, theirsOnly: 2, blended: 1, same: 12, conflicts: 1 }

function report(over: Partial<{ notes: Array<{ subject: string; detail: string; conflict: boolean }>; policy: 'ours' | 'theirs' }> = {}) {
  return {
    path: '/shows/Hamlet (merged).wlab',
    tally: TALLY,
    policy: over.policy ?? ('ours' as const),
    notes: over.notes ?? [
      { subject: '4 Bows', detail: 'volume was changed on both sides: kept this show (0.6 against 0.9)', conflict: true },
      { subject: '2 Interval', detail: 'the other show plays “bows.wav” here; this show keeps “walk-in.wav”', conflict: false }
    ]
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  merge = window.winslab.workspace.merge as unknown as Mock
  openPath = window.winslab.workspace.openPath as unknown as Mock
  merge.mockReset().mockResolvedValue({ ok: true, merged: null })
  openPath.mockReset().mockResolvedValue({
    path: '/shows/Hamlet (merged).wlab',
    workspace: { cues: [], name: 'Hamlet', missingMedia: [] },
    missingMedia: []
  })
  useStore.setState({
    license: { state: 'active', license: TEST_LICENSE },
    mergeReport: report(),
    workspacePath: null,
    isDirty: false
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useStore.setState({ license: { state: 'unlicensed' }, mergeReport: null })
})

async function show(): Promise<void> {
  await act(async () => {
    root.render(<MergeReportDialog />)
  })
}

describe('the merge report', () => {
  it('says what the merge kept, and names the one thing it had to decide', async () => {
    await show()

    const dialog = container.querySelector('.settings-dialog') as HTMLElement
    expect(dialog.textContent).toContain('Hamlet (merged).wlab')
    expect(dialog.textContent).toContain('3 from this show')
    expect(dialog.textContent).toContain('2 from the other show')
    expect(dialog.textContent).toContain('1 put together')
    expect(dialog.textContent).toContain('1 conflict')
    // The conflicting cue is named with both values, and the decision says whose it is.
    expect(container.querySelector('.changes-note')?.textContent).toContain('this show’s version is in the merged file')
    const lines = [...container.querySelectorAll('.changes-line')].map(line => line.textContent)
    expect(lines[0]).toContain('4 Bows')
    expect(lines[0]).toContain('kept this show (0.6 against 0.9)')
    expect(lines[1]).toContain('2 Interval')
  })

  it('offers the other side’s choices as a second attempt over the same two files', async () => {
    await show()

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('.changes-actions button')]
    await act(async () => {
      buttons[1].click()
    })

    expect(merge.mock.calls[0][2]).toMatchObject({ policy: 'theirs', again: true })
  })

  it('opens the merged show when that is what the operator asks for', async () => {
    await show()

    const open = container.querySelector<HTMLButtonElement>('.changes-actions button') as HTMLButtonElement
    await act(async () => {
      open.click()
    })

    expect(openPath.mock.calls[0][0]).toBe('/shows/Hamlet (merged).wlab')
  })

  it('does not draw the conflict line when nobody disagreed', async () => {
    useStore.setState({ mergeReport: report({ notes: [], policy: 'ours' }) })
    await show()

    expect(container.querySelector('.changes-note')).toBeNull()
    expect(container.querySelector('.changes-empty')?.textContent).toContain('nothing needed deciding')
  })

  it('describes what merging is, on a machine with no key', async () => {
    useStore.setState({ license: { state: 'unlicensed' } })
    await show()

    expect(container.querySelector('.pro-lock[data-feature="Merging two shows"]')).not.toBeNull()
    expect(container.querySelector('.changes-actions')).toBeNull()
  })
})
