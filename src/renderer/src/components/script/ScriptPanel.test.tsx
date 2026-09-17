// The script panel is where the document and the cue stack meet: each line can carry a
// cue, and the line the next GO fires on is kept in view. These tests pin the DOM
// contract the E2E spec targets, the pin/unpin rule behind the line numbers, and the
// follow that hands the view back to the operator.
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ScriptPanel, pinMap } from './ScriptPanel'
import { useStore } from '../../store'
import { scriptLines } from '../../utils/scriptDocument'
import { defaultShowSettings } from '../../types/show'
import type { Cue } from '../../types/cue'

const SCRIPT = 'First line\nSecond line\nThird line'
const WORKSPACE = '/shows/My Show.cuerunner'

function cue(overrides: Partial<Cue> = {}): Cue {
  return {
    id: 'c-1',
    number: '1',
    name: 'Cue 1',
    colorLabel: 'none',
    parentId: null,
    preWait: 0,
    postWait: 0,
    timelineOffset: 0,
    duration: 0,
    advance: 'none',
    isArmed: true,
    notes: '',
    scriptLine: null,
    type: 'wait',
    ...overrides
  } as Cue
}

// jsdom has no layout: a scrollable box and a spy on scrollIntoView stand in for it.
function scrollable(
  el: HTMLElement,
  box: { scrollHeight: number; clientHeight: number; scrollTop: number }
): void {
  Object.defineProperty(el, 'scrollHeight', { value: box.scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: box.clientHeight, configurable: true })
  Object.defineProperty(el, 'scrollTop', { value: box.scrollTop, writable: true, configurable: true })
}

// jsdom reports every box as zero; whether a line is on screen is what the follow
// decision is made on.
function rectAt(el: Element, top: number, bottom: number): void {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      top,
      bottom,
      left: 0,
      right: 0,
      width: 0,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => ({})
    })
  })
}

describe('ScriptPanel', () => {
  let container: HTMLDivElement
  let root: Root
  let onClose: Mock
  let readDocument: Mock
  let pickFile: Mock
  let scrollIntoView: Mock

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onClose = vi.fn()

    readDocument = window.cuerunner.script.readDocument as unknown as Mock
    pickFile = window.cuerunner.script.pickFile as unknown as Mock
    readDocument.mockReset()
    pickFile.mockReset()
    readDocument.mockResolvedValue({ ok: true, lines: SCRIPT.split('\n') })
    pickFile.mockResolvedValue(null)

    scrollIntoView = vi.fn()
    ;(Element.prototype as unknown as { scrollIntoView: Mock }).scrollIntoView = scrollIntoView
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
    useStore.setState({
      showSettings: defaultShowSettings(),
      cues: [],
      selectedId: null,
      running: new Map(),
      workspacePath: null
    })
  })

  interface PanelState {
    path?: string
    fontSize?: number
    code?: string
    /** A document the main process refused, and why. */
    refusal?: string
    cues?: Cue[]
    selectedId?: string | null
  }

  async function show(state: PanelState = {}): Promise<void> {
    if (state.refusal !== undefined) {
      readDocument.mockResolvedValue({ ok: false, error: state.refusal })
    } else if (state.code !== undefined) {
      readDocument.mockResolvedValue({ ok: true, lines: scriptLines(state.code) })
    }
    const defaults = defaultShowSettings()
    useStore.setState({
      showSettings: {
        ...defaults,
        script: { path: state.path ?? '', fontSize: state.fontSize ?? 13 }
      },
      cues: state.cues ?? [],
      selectedId: state.selectedId ?? null,
      running: new Map(),
      workspacePath: WORKSPACE
    })
    await act(async () => {
      root.render(<ScriptPanel onClose={onClose} />)
    })
  }

  function texts(selector: string): string[] {
    return [...container.querySelectorAll(selector)].map(el => el.textContent ?? '')
  }

  function headerButton(label: string): HTMLButtonElement {
    return [...container.querySelectorAll<HTMLButtonElement>('.script-btn')]
      .find(button => button.textContent === label)!
  }

  function lineNo(line: number): HTMLButtonElement {
    return container.querySelector<HTMLButtonElement>(
      `.script-line[data-line="${line}"] .script-line-no`
    )!
  }

  it('offers a document from the empty state and from the header', async () => {
    await show()

    expect(container.querySelector('.script-panel')).not.toBeNull()
    expect(texts('.script-title')).toEqual(['Script'])
    expect(texts('.script-path')).toEqual(['no script'])
    expect(container.querySelector('.script-empty')).not.toBeNull()

    pickFile.mockResolvedValue('/shows/Act One.txt')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.script-choose')!.click()
    })

    expect(pickFile).toHaveBeenCalledTimes(1)
    expect(useStore.getState().showSettings.script.path).toBe('/shows/Act One.txt')
    expect(texts('.script-path')).toEqual(['Act One.txt'])
    expect(container.querySelector('.script-empty')).toBeNull()
    expect(container.querySelectorAll('.script-line')).toHaveLength(3)

    // A cancelled dialog changes nothing: the document already open stays open.
    pickFile.mockResolvedValue(null)
    await act(async () => {
      headerButton('Choose file…').click()
    })

    expect(useStore.getState().showSettings.script.path).toBe('/shows/Act One.txt')
  })

  it('closes from the header', async () => {
    await show()

    await act(async () => {
      headerButton('✕').click()
    })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reads the document into numbered lines as text', async () => {
    await show({ path: 'Act One.txt', code: 'Enter, stage left.\n<b>not markup</b>\n\nExit.' })

    expect(readDocument).toHaveBeenCalledWith('Act One.txt', WORKSPACE)
    expect(
      [...container.querySelectorAll('.script-line')].map(line => line.getAttribute('data-line'))
    ).toEqual(['1', '2', '3', '4'])
    expect(texts('.script-line-no')).toEqual(['1', '2', '3', '4'])
    expect(texts('.script-line-text')).toEqual(['Enter, stage left.', '<b>not markup</b>', '', 'Exit.'])
    // The document is text: markup inside it must not become elements.
    expect(container.querySelector('.script-line-text b')).toBeNull()
  })

  it('says why a document cannot be shown instead of rendering it', async () => {
    // The crash this covers: a PDF opened as a script became a million rendered lines.
    // The refusal is what the operator sees, and the panel stays usable.
    await show({
      path: 'libretto.pdf',
      refusal: 'libretto.pdf is not a text file — the script panel shows plain text'
    })

    expect(texts('.script-error-message')).toEqual([
      'libretto.pdf is not a text file — the script panel shows plain text'
    ])
    expect(container.querySelectorAll('.script-line')).toHaveLength(0)
    expect(container.querySelector('.script-empty')).toBeNull()
    expect(texts('.script-path')).toEqual(['libretto.pdf'])
  })

  it('clears a refusal when another document is chosen', async () => {
    await show({ path: 'libretto.pdf', refusal: 'not a text file' })
    expect(container.querySelector('.script-error')).not.toBeNull()

    await show({ path: 'Act One.txt', code: 'ACT TWO' })

    expect(container.querySelector('.script-error')).toBeNull()
    expect(texts('.script-line-text')).toEqual(['ACT TWO'])
  })

  it('shows the cues pinned to a line', async () => {
    await show({
      path: 'Act One.txt',
      code: 'One\nTwo\nThree',
      cues: [
        cue({ id: 'c-1', number: '1', scriptLine: 2 }),
        cue({ id: 'c-2', number: '2.5', scriptLine: 2 }),
        cue({ id: 'c-3', number: '3', scriptLine: null })
      ]
    })

    const pin = container.querySelector('.script-line[data-line="2"] .script-pin')!
    expect(pin.getAttribute('data-cues')).toBe('1,2.5')
    expect(pin.textContent).toBe('1, 2.5')
    expect(container.querySelector('.script-line[data-line="1"] .script-pin')).toBeNull()
    expect(container.querySelectorAll('.script-pin')).toHaveLength(1)
  })

  it('marks the line the next cue fires on and keeps it in view', async () => {
    await show({
      path: 'Act One.txt',
      code: 'One\nTwo\nThree',
      cues: [
        cue({ id: 'c-1', number: '1', scriptLine: 1 }),
        cue({ id: 'c-2', number: '2', scriptLine: 3 }),
        cue({ id: 'c-3', number: '3', scriptLine: null })
      ],
      selectedId: 'c-1'
    })

    expect(
      container.querySelector('.script-line[data-current="true"]')?.getAttribute('data-line')
    ).toBe('1')
    expect(scrollIntoView).toHaveBeenCalled()

    scrollIntoView.mockClear()
    await act(async () => {
      useStore.getState().select('c-2')
    })

    expect(container.querySelectorAll('.script-line[data-current="true"]')).toHaveLength(1)
    expect(
      container.querySelector('.script-line[data-current="true"]')?.getAttribute('data-line')
    ).toBe('3')
    expect(scrollIntoView).toHaveBeenCalled()

    // A selected cue pinned to nothing marks no line.
    await act(async () => {
      useStore.getState().select('c-3')
    })

    expect(container.querySelector('.script-line[data-current="true"]')).toBeNull()
  })

  it('pins the selected cue to a line and unpins it on a second click', async () => {
    await show({
      path: 'Act One.txt',
      code: 'One\nTwo\nThree',
      cues: [cue({ id: 'c-1', number: '7' })],
      selectedId: 'c-1'
    })

    await act(async () => {
      lineNo(3).click()
    })

    expect(useStore.getState().cues[0].scriptLine).toBe(3)
    expect(container.querySelector('.script-line[data-line="3"] .script-pin')?.getAttribute('data-cues'))
      .toBe('7')

    await act(async () => {
      lineNo(3).click()
    })

    expect(useStore.getState().cues[0].scriptLine).toBeNull()
    expect(container.querySelector('.script-pin')).toBeNull()
  })

  it('does nothing when no cue is selected', async () => {
    await show({ path: 'Act One.txt', code: 'One\nTwo', cues: [cue({ id: 'c-1', number: '1' })] })

    await act(async () => {
      lineNo(2).click()
    })

    expect(useStore.getState().cues[0].scriptLine).toBeNull()
    expect(container.querySelector('.script-pin')).toBeNull()
  })

  it('steps the font size within the clamp', async () => {
    await show({ fontSize: 13 })

    const panel = (): HTMLElement => container.querySelector<HTMLElement>('.script-panel')!
    expect(panel().style.getPropertyValue('--script-font-size')).toBe('13px')
    expect(texts('.script-font-dec')).toEqual(['A−'])
    expect(texts('.script-font-inc')).toEqual(['A+'])

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.script-font-inc')!.click()
    })

    expect(useStore.getState().showSettings.script.fontSize).toBe(14)
    expect(panel().style.getPropertyValue('--script-font-size')).toBe('14px')

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.script-font-dec')!.click()
    })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.script-font-dec')!.click()
    })

    expect(useStore.getState().showSettings.script.fontSize).toBe(12)

    // Readable from a music stand, and not so large that one line fills the panel.
    await show({ fontSize: 28 })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.script-font-inc')!.click()
    })
    expect(useStore.getState().showSettings.script.fontSize).toBe(28)

    await show({ fontSize: 11 })
    await act(async () => {
      container.querySelector<HTMLButtonElement>('.script-font-dec')!.click()
    })
    expect(useStore.getState().showSettings.script.fontSize).toBe(11)
  })

  it('releases the follow when the current line is scrolled away and resumes from the button', async () => {
    await show({
      path: 'Act One.txt',
      code: 'One\nTwo\nThree',
      cues: [cue({ id: 'c-1', number: '1', scriptLine: 2 })],
      selectedId: 'c-1'
    })

    expect(container.querySelector('.script-follow')).toBeNull()

    const list = container.querySelector<HTMLElement>('.script-lines')!
    rectAt(list, 0, 200)
    rectAt(container.querySelector('.script-line[data-line="2"]')!, 400, 420)
    await act(async () => {
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    const follow = container.querySelector<HTMLButtonElement>('.script-follow')!
    expect(follow).not.toBeNull()
    expect(follow.getAttribute('data-active')).toBe('true')

    scrollIntoView.mockClear()
    await act(async () => {
      follow.click()
    })

    expect(container.querySelector('.script-follow')).toBeNull()
    expect(scrollIntoView).toHaveBeenCalled()
  })

  it('releases the follow on scroll with nothing selected', async () => {
    await show({ path: 'Act One.txt', code: 'One\nTwo\nThree' })

    const list = container.querySelector<HTMLElement>('.script-lines')!
    scrollable(list, { scrollHeight: 1000, clientHeight: 200, scrollTop: 100 })
    await act(async () => {
      list.dispatchEvent(new Event('scroll', { bubbles: true }))
    })

    expect(container.querySelector('.script-follow[data-active]')).not.toBeNull()
  })
})

describe('pinMap', () => {
  it('groups cue numbers by line in cue order', () => {
    const pins = pinMap([
      cue({ id: 'a', number: '1', scriptLine: 4 }),
      cue({ id: 'b', number: '2', scriptLine: 1 }),
      cue({ id: 'c', number: '3', scriptLine: 4 }),
      cue({ id: 'd', number: '4', scriptLine: 1 })
    ])

    expect([...pins.keys()]).toEqual([4, 1])
    expect(pins.get(4)).toEqual(['1', '3'])
    expect(pins.get(1)).toEqual(['2', '4'])
  })

  it('skips cues with no line', () => {
    const pins = pinMap([
      cue({ id: 'a', number: '1', scriptLine: null }),
      cue({ id: 'b', number: '2', scriptLine: undefined }),
      cue({ id: 'c', number: '3' })
    ])

    expect(pins.size).toBe(0)
    expect(pinMap([]).size).toBe(0)
  })
})
