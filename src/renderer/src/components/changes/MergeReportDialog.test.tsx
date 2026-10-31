// What the operator is shown after a merge, and the two things they can do from it.
// The merge itself is a pure function with its own tests (`shared/showfileMerge.test.ts`)
// and the writing of the file is the main process's; this surface is the part that
// decides whether a conflict is visible or quietly gone.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MergeReportDialog } from './MergeReportDialog'
import { useStore, type MergeReport } from '../../store'

let container: HTMLDivElement
let root: Root
let merge: Mock
let openPath: Mock

const TALLY = { oursOnly: 3, theirsOnly: 2, blended: 1, same: 12, conflicts: 1 }

function report(over: Partial<{ notes: Array<{ subject: string; detail: string; conflict: boolean }>; policy: 'ours' | 'theirs' }> = {}) {
  return {
    path: '/shows/Hamlet (merged).cuerunner',
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
  merge = window.cuerunner.workspace.merge as unknown as Mock
  openPath = window.cuerunner.workspace.openPath as unknown as Mock
  merge.mockReset().mockResolvedValue({ ok: true, merged: null })
  openPath.mockReset().mockResolvedValue({
    ok: true,
    opened: {
      path: '/shows/Hamlet (merged).cuerunner',
      workspace: { cues: [], name: 'Hamlet', missingMedia: [] },
      missingMedia: []
    }
  })
  useStore.setState({
    mergeReport: report(),
    workspacePath: null,
    isDirty: false
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useStore.setState({ mergeReport: null })
})

async function show(report: MergeReport | null = useStore.getState().mergeReport): Promise<void> {
  await act(async () => {
    root.render(report === null ? null : <MergeReportDialog report={report} onClose={() => {}} />)
  })
}

describe('the merge report', () => {
  it('says what the merge kept, and names the one thing it had to decide', async () => {
    await show()

    const dialog = container.querySelector('.settings-dialog') as HTMLElement
    expect(dialog.textContent).toContain('Hamlet (merged).cuerunner')
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

    expect(openPath.mock.calls[0][0]).toBe('/shows/Hamlet (merged).cuerunner')
  })

  it('reports a merged show it cannot read, rather than losing the window to it', async () => {
    // `openMergedShow` branches on the refusal arm: the file is an ordinary state — one
    // saved by a newer build — so the notice carries the sentence and nothing is thrown.
    openPath.mockResolvedValue({
      ok: false,
      error: 'that show has a cue this version of Cuerunner does not know (hologram)'
    })
    await show()

    const open = container.querySelector<HTMLButtonElement>('.changes-actions button') as HTMLButtonElement
    await act(async () => {
      open.click()
    })

    expect(useStore.getState().notice).toContain('does not know (hologram)')
    expect(useStore.getState().notice).toContain('Could not open')
  })

  it('does not draw the conflict line when nobody disagreed', async () => {
    await show(report({ notes: [], policy: 'ours' }))

    expect(container.querySelector('.changes-note')).toBeNull()
    expect(container.querySelector('.changes-empty')?.textContent).toContain('nothing needed deciding')
  })
})
