// The Changes dialog, both halves: the show's own history of its saves, and how it
// differs from another file. The history is read from the store and the comparison is
// asked for as one call, so these tests are about what the operator sees and what is
// asked for — the diff itself is `src/shared/showfile.test.ts`.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChangesDialog } from './ChangesDialog'
import { useStore } from '../../store'
import { TEST_LICENSE } from '../../../../test/license'
import type { WorkspaceDiff } from '../../../../shared/showfile'

let container: HTMLDivElement
let root: Root
let compare: Mock

const SHOW = { id: 'w1', name: 'Hamlet', createdAt: '2026-01-01T00:00:00.000Z' }

function diff(over: Partial<WorkspaceDiff> = {}): WorkspaceDiff {
  return {
    from: { ...SHOW, cues: 2 },
    to: { ...SHOW, cues: 3 },
    sameShow: true,
    added: [],
    removed: [],
    changed: [],
    settings: [],
    unchanged: 2,
    empty: true,
    ...over
  }
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  compare = window.cuerunner.workspace.compare as unknown as Mock
  compare.mockReset().mockResolvedValue({ ok: true, comparison: null })
  useStore.setState({
    license: { state: 'active', license: TEST_LICENSE },
    changesTab: null,
    showHistory: [],
    workspaceId: 'w1',
    workspaceName: 'Hamlet',
    cues: []
  })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  useStore.setState({ license: { state: 'unlicensed' }, showHistory: [], cues: [] })
})

async function show(tab: 'history' | 'compare' = 'history'): Promise<void> {
  await act(async () => {
    root.render(<ChangesDialog initialTab={tab} onClose={() => {}} />)
  })
}

describe('the show’s own history', () => {
  it('reads the file’s saves back, newest first', async () => {
    useStore.setState({
      showHistory: [
        {
          at: '2026-09-14T18:30:00.000Z',
          by: 'associate',
          cues: [{ kind: 'added', id: 'a', label: '3 Bows' }],
          settings: []
        },
        {
          at: '2026-09-15T20:00:00.000Z',
          by: 'designer',
          machine: 'stage-box',
          cues: [{ kind: 'edited', id: 'b', label: '2 Walk-in', fields: ['volume', 'name'] }],
          settings: ['audio.sampleRate']
        }
      ]
    })
    await show()

    const entries = container.querySelectorAll('.changes-entry')
    expect(entries).toHaveLength(2)
    expect(entries[0].querySelector('.changes-who')?.textContent).toBe('designer')
    expect(entries[0].querySelector('.changes-summary')?.textContent).toBe(
      '1 edited · audio.sampleRate'
    )
    expect(entries[1].querySelector('.changes-who')?.textContent).toBe('associate')

    // The cue lines are behind the disclosure, and they are what the entry is for.
    await act(async () => {
      entries[0].querySelector('summary')?.click()
    })
    const lines = entries[0].querySelectorAll('.changes-line')
    expect([...lines].map(line => line.textContent)).toEqual([
      'Edited 2 Walk-in — volume, name',
      'Settings — audio.sampleRate'
    ])
  })

  it('says so when there is nothing to read yet', async () => {
    await show()
    expect(container.querySelector('.changes-empty')?.textContent).toContain('Nothing has been saved')
  })
})

describe('comparing with another file', () => {
  it('asks for a comparison with the show as it stands, and draws the answer', async () => {
    useStore.setState({
      cues: [
        {
          type: 'wait', id: 'w-1', number: '1', name: 'Beat', colorLabel: 'none', parentId: null,
          preWait: 0, postWait: 0, timelineOffset: 0, duration: 1000, advance: 'none',
          isArmed: true, notes: ''
        }
      ]
    })
    compare.mockResolvedValue({
      ok: true,
      comparison: {
        path: '/shows/Hamlet — press.cuerunner',
        diff: diff({
          empty: false,
          added: [{ id: 'n', label: '4 Bows', type: 'wait', place: { parent: null, after: null } }],
          changed: [
            {
              id: 'w-1',
              label: '1 Beat',
              type: 'wait',
              fields: [{ field: 'duration', from: 1000, to: 2000 }]
            }
          ],
          settings: [{ path: 'audio.sampleRate', from: 48000, to: 44100 }],
          unchanged: 1
        })
      }
    })
    await show('compare')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.changes-choose')?.click()
    })

    // The window's own show goes down with the call: the comparison is between the file
    // it picks and the show as it stands, including its history.
    const sent = compare.mock.calls[0][0] as { cues: unknown[]; history?: unknown }
    expect(sent.cues).toHaveLength(1)
    expect(sent.history).toBeUndefined()

    const groups = container.querySelectorAll('.changes-group')
    expect([...groups].map(group => group.getAttribute('data-group'))).toEqual([
      'added', 'changed', 'settings'
    ])
    expect(container.querySelector('[data-group="added"] .changes-line')?.textContent).toBe('4 Bows')
    expect(container.querySelector('[data-group="changed"] .changes-field')?.textContent).toBe(
      'duration 1000 → 2000'
    )
    expect(container.querySelector('[data-group="settings"] .changes-field')?.textContent).toBe(
      '48000 → 44100'
    )
    expect(container.querySelector('.changes-foot')?.textContent).toBe('1 cue is the same in both files.')
  })

  it('says the two files are different shows rather than pretending they are versions', async () => {
    compare.mockResolvedValue({
      ok: true,
      comparison: {
        path: '/shows/Macbeth.cuerunner',
        diff: diff({ sameShow: false, empty: false, to: { ...SHOW, id: 'w2', name: 'Macbeth', cues: 3 } })
      }
    })
    await show('compare')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.changes-choose')?.click()
    })

    expect(container.querySelector('.changes-note')?.textContent).toContain('different shows')
  })

  it('stops showing an answer that belongs to the show it was made against', async () => {
    compare.mockResolvedValue({
      ok: true,
      comparison: { path: '/shows/other.cuerunner', diff: diff({ empty: false, unchanged: 0 }) }
    })
    await show('compare')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.changes-choose')?.click()
    })
    expect(container.querySelector('.changes-diff')).not.toBeNull()

    await act(async () => {
      useStore.setState({ workspaceId: 'w2' })
    })

    expect(container.querySelector('.changes-diff')).toBeNull()
  })

  it('shows what the main process said instead of an empty list', async () => {
    compare.mockResolvedValue({ ok: false, error: 'Cuerunner Pro is required for the show services' })
    await show('compare')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.changes-choose')?.click()
    })

    expect(container.querySelector('.changes-error')?.textContent).toContain('Cuerunner Pro is required')
  })
})

describe('without a license', () => {
  it('reads the show’s own history', async () => {
    useStore.setState({
      license: { state: 'unlicensed' },
      showHistory: [
        {
          at: '2026-09-14T18:30:00.000Z',
          by: 'associate',
          cues: [{ kind: 'added', id: 'a', label: '3 Bows' }],
          settings: []
        }
      ]
    })
    await show('history')

    expect(container.querySelectorAll('.changes-entry')).toHaveLength(1)
    expect(container.querySelector('.pro-lock')).toBeNull()
  })

  it('locks the comparison', async () => {
    useStore.setState({ license: { state: 'unlicensed' } })
    await show('compare')

    expect(container.querySelector('.pro-lock')).not.toBeNull()
    expect(container.querySelector('.changes-choose')).toBeNull()
  })
})
