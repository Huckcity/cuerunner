// The window's half of the QLab import: the dialog that asks where the show comes from,
// the flows its buttons run, and the report that says what came. The conversion itself is
// main's and has its own tests (`src/main/import/`); this is the part that decides whether
// a placeholder or a missing file is in front of the operator or quietly gone.
import { describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useStore } from '../../store'
import { QLabImportHost } from './QLabImportHost'
import {
  closeQLabImport, findQLabMediaInFolder, findQLabWorkspaces, importQLabFile, importQLabLive,
  openQLabImport, setQLabAddress, useQLabImport
} from './qlabImport'
import type { QLabImported } from '../../../../shared/ipc/qlab'
import type { AudioCue, WaitCue } from '../../../../shared/cue'

let container: HTMLDivElement
let root: Root

const WALK_IN: AudioCue = {
  id: 'A1', number: '1', name: 'Walk-in', colorLabel: 'green', parentId: null, preWait: 0, postWait: 0,
  timelineOffset: 0, duration: 0, advance: 'none', isArmed: true, notes: '', type: 'audio',
  filePath: '/Users/sm/Show/audio/walk-in.wav', startTime: 0, endTime: null, fadeInDuration: 0, volume: 1, pan: 0,
  outputs: null, loopCount: 0, playbackRate: 1, trim: 1
}

const FILM: WaitCue = {
  id: 'V2', number: '2', name: 'Film', colorLabel: 'none', parentId: null, preWait: 0, postWait: 0,
  timelineOffset: 0, duration: 0, advance: 'none', isArmed: false, notes: '[From QLab: Video cue.]', type: 'wait'
}

function imported(): QLabImported {
  return {
    workspace: {
      version: 1, id: 'imported', name: 'Press Night', createdAt: '2026-10-08T00:00:00.000Z',
      audioSettings: { outputDeviceId: 'default' }, midiSettings: { outputPortName: '' }, cues: [WALK_IN, FILM]
    },
    missingMedia: [{ cueId: 'A1', path: WALK_IN.filePath, originalPath: WALK_IN.filePath }],
    loadNotes: [],
    report: {
      source: 'file',
      origin: '/shows/Press Night.qlab5',
      workspaceName: 'Press Night',
      cueLists: 1,
      totalCues: 2,
      types: [{ qlabType: 'Audio', becameType: 'audio', count: 1 }, { qlabType: 'Video', becameType: null, count: 1 }],
      notes: [{ cueId: 'V2', number: '2', name: 'Film', qlabType: 'Video', kind: 'placeholder', detail: 'Cuerunner has no video cue' }],
      media: { referenced: 1, found: 0 }
    }
  }
}

const bridge = () => window.cuerunner.qlab as unknown as Record<'importFile' | 'listWorkspaces' | 'importLive' | 'findMedia', Mock>

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  for (const member of Object.values(bridge())) member.mockReset()
  bridge().importFile.mockResolvedValue({ ok: true, imported: imported() })
  useStore.setState({ isDirty: false, cues: [], missingMedia: [], workspacePath: null, audioSettings: { outputDeviceId: 'Studio Out' } })
  useQLabImport.setState({ stage: 'closed', error: null, busy: false, report: null, workspaces: null, workspaceId: null, host: '127.0.0.1', port: '53000', passcode: '' })
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(): Promise<void> {
  await act(async () => root.render(<QLabImportHost />))
}

describe('the import dialog', () => {
  it('opens from the menu action, and closes', async () => {
    await render()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    act(() => openQLabImport())
    expect(container.querySelector('[aria-label="Import QLab Workspace"]')).not.toBeNull()
    act(() => closeQLabImport())
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('opens the imported show as a new, unsaved show, keeping this machine’s audio device', async () => {
    act(() => openQLabImport())
    await act(() => importQLabFile())
    const store = useStore.getState()
    expect(store.cues.map(cue => cue.id)).toEqual(['A1', 'V2'])
    expect(store.workspaceName).toBe('Press Night')
    expect(store.workspacePath).toBeNull()
    expect(store.isDirty).toBe(true)
    expect(store.audioSettings.outputDeviceId).toBe('Studio Out')
    expect(store.missingMedia).toHaveLength(1)
    expect(useQLabImport.getState().stage).toBe('report')
  })

  it('shows a refusal in the dialog, and leaves the open show alone', async () => {
    useStore.setState({ cues: [FILM] })
    bridge().importFile.mockResolvedValueOnce({ ok: false, error: '“x.qlab5” is not a QLab workspace' })
    act(() => openQLabImport())
    await render()
    await act(() => importQLabFile())
    expect(container.querySelector('.qlab-error')?.textContent).toBe('“x.qlab5” is not a QLab workspace')
    expect(useStore.getState().cues).toEqual([FILM])
  })

  it('asks a running QLab for its workspaces, then imports the one picked with its passcode', async () => {
    bridge().listWorkspaces.mockResolvedValueOnce({ ok: true, workspaces: [{ id: 'WS', name: 'Tour', hasPasscode: true, version: '5.4' }] })
    bridge().importLive.mockResolvedValueOnce({ ok: true, imported: { ...imported(), report: { ...imported().report, source: 'live', origin: '10.0.0.9:53000' } } })
    act(() => openQLabImport())
    act(() => setQLabAddress({ host: '10.0.0.9' }))
    await render()
    await act(() => findQLabWorkspaces())
    expect(bridge().listWorkspaces).toHaveBeenCalledWith('10.0.0.9', 53000)
    expect(container.querySelector('#qlab-passcode')).not.toBeNull()
    act(() => setQLabAddress({ passcode: '4321' }))
    await act(() => importQLabLive())
    expect(bridge().importLive).toHaveBeenCalledWith({ host: '10.0.0.9', port: 53000, workspaceId: 'WS', passcode: '4321' })
    expect(container.querySelector('[data-testid="qlab-summary"]')?.textContent).toContain('QLab at 10.0.0.9:53000')
  })

  it('says a port that is not one is not one, without asking', async () => {
    act(() => setQLabAddress({ port: '53k' }))
    await act(() => findQLabWorkspaces())
    expect(useQLabImport.getState().error).toBe('53k is not a port: QLab listens on 53000')
    expect(bridge().listWorkspaces).not.toHaveBeenCalled()
  })
})

describe('the report', () => {
  beforeEach(async () => {
    act(() => openQLabImport())
    await act(() => importQLabFile())
    await render()
  })

  it('lists each QLab type with what it became, and every placeholder by cue', () => {
    const rows = [...container.querySelectorAll('.qlab-types tbody tr')].map(row => [
      row.getAttribute('data-qlab-type'), row.getAttribute('data-became'), row.querySelector('.qlab-count')?.textContent
    ])
    expect(rows).toEqual([['Audio', 'audio', '1'], ['Video', 'placeholder', '1']])
    const placeholders = container.querySelector('[data-notes="placeholder"]')
    expect(placeholders?.textContent).toContain('Placeholders (1)')
    expect(placeholders?.textContent).toContain('Film')
    expect(placeholders?.textContent).toContain('Video: Cuerunner has no video cue')
    expect(container.querySelector('[data-testid="qlab-summary"]')?.textContent)
      .toContain('2 cues in 1 cue list came across from Press Night.qlab5; 1 is a placeholder')
  })

  it('lists the missing audio and finds it in a folder, updating the show', async () => {
    expect(container.querySelector('[data-testid="qlab-media-missing"]')?.textContent).toContain('1 file is not where QLab said')
    expect(container.querySelector('.qlab-missing')?.textContent).toContain('1 Walk-in')
    bridge().findMedia.mockResolvedValueOnce({
      ok: true,
      found: {
        workspace: { ...imported().workspace, cues: [{ ...WALK_IN, filePath: '/Volumes/Stick/audio/walk-in.wav' }, FILM] },
        missingMedia: [],
        found: 1
      }
    })
    await act(() => findQLabMediaInFolder())
    expect((useStore.getState().cues[0] as AudioCue).filePath).toBe('/Volumes/Stick/audio/walk-in.wav')
    expect(container.querySelector('[data-testid="qlab-media-ok"]')).not.toBeNull()
    expect(container.textContent).toContain('Found 1 file in that folder.')
  })
})
