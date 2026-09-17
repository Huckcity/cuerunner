// The tablet page is tested the way a tablet runs it: the served markup is mounted in a
// document, the inline script is executed, and the state it fetches is rendered. Escaping
// is asserted by feeding it markup as show data and looking for the element that must not
// exist — a page that interpolated state into innerHTML would create one.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { companionPage } from './companionPage'
import type { CompanionState } from '../../shared/show'

const TOKEN = 's3cret'

const EMPTY_STATE: CompanionState = {
  at: 0,
  workspaceName: '',
  nextCue: null,
  running: [],
  cues: [],
  script: null,
  alerts: []
}

function state(patch: Partial<CompanionState> = {}): CompanionState {
  return {
    at: Date.now(),
    workspaceName: 'Hamlet',
    nextCue: { id: 'b', number: '12', name: 'Ghost entrance', type: 'audio', parentId: null, scriptLine: 2 },
    running: [{ id: 'a', number: '3', name: 'Lighting', state: 'running' }],
    cues: [
      { id: 'a', number: '3', name: 'Lighting', type: 'audio', parentId: null, scriptLine: 1 },
      { id: 'b', number: '12', name: 'Ghost entrance', type: 'audio', parentId: null, scriptLine: 2 }
    ],
    script: { path: '/shows/hamlet.txt', lines: ['ACT I', 'Enter the GHOST', ''] },
    alerts: [{ id: 7, level: 'warning', message: 'Pack 4 low' }],
    ...patch
  }
}

/** Stands in for EventSource so a test can push a frame without a stream. */
class FakeEventSource {
  static opened: FakeEventSource[] = []
  readonly url: string
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeEventSource.opened.push(this)
  }

  close(): void {}
}

function between(page: string, open: string, close: string): string {
  return page.slice(page.indexOf(open) + open.length, page.indexOf(close))
}

function el(id: string): HTMLElement {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`the page has no #${id}`)
  return node
}

function flush(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, 0)
  return promise
}

interface Mounted {
  fetchMock: Mock
  streams: FakeEventSource[]
}

async function mount(options: { search?: string; state?: CompanionState } = {}): Promise<Mounted> {
  const page = companionPage()
  document.body.innerHTML = between(page, '<body>', '</body>').replace(/<script[\s\S]*?<\/script>/, '')
  FakeEventSource.opened = []
  const fetchMock = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(options.state ?? EMPTY_STATE) })
  )
  Object.defineProperty(window, 'fetch', { value: fetchMock, configurable: true, writable: true })
  Object.defineProperty(window, 'EventSource', {
    value: FakeEventSource,
    configurable: true,
    writable: true
  })
  window.history.replaceState({}, '', `/${options.search ?? `?token=${TOKEN}`}`)
  new Function(between(page, '<script>', '</script>'))()
  await flush()
  await flush()
  return { fetchMock, streams: FakeEventSource.opened }
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('companionPage', () => {
  it('is a page a tablet can open with no build step and no network of its own', () => {
    const page = companionPage()

    expect(page.startsWith('<!doctype html>')).toBe(true)
    expect(page).toContain('<meta name="viewport"')
    expect(page).toContain('<style>')
    expect(page).toContain('<script>')
    expect(page).not.toMatch(/(src|href)\s*=\s*["']https?:/)
    expect(page).not.toContain('@import')
  })

  it('asks for the state and the stream with the token it was opened with', async () => {
    const { fetchMock, streams } = await mount({ search: '?token=abc123' })

    expect(fetchMock).toHaveBeenCalledWith('/state?token=abc123', { cache: 'no-store' })
    expect(streams).toHaveLength(1)
    expect(streams[0].url).toBe('/events?token=abc123')
  })

  it('renders the next cue, what is running, the order, the script and the alarms', async () => {
    await mount({ state: state() })

    expect(el('workspace').textContent).toBe('Hamlet')
    expect(el('next-number').textContent).toBe('12')
    expect(el('next-name').textContent).toBe('Ghost entrance')

    const running = document.querySelectorAll('#running-cues .running-cue')
    expect(running).toHaveLength(1)
    expect(running[0].querySelector('.cue-name')?.textContent).toBe('Lighting')
    expect(running[0].querySelector('.cue-state')?.textContent).toBe('running')

    const order = document.querySelectorAll('#running-order .order-cue')
    expect(order).toHaveLength(2)
    expect(order[0].classList.contains('is-next')).toBe(false)
    expect(order[0].classList.contains('is-live')).toBe(true)
    expect(order[1].classList.contains('is-next')).toBe(true)
    expect(order[1].querySelector('.order-name')?.textContent).toBe('Ghost entrance')

    const lines = document.querySelectorAll('#script-lines .script-line')
    expect(lines).toHaveLength(3)
    expect(lines[0].classList.contains('is-current')).toBe(false)
    expect(lines[1].classList.contains('is-current')).toBe(true)
    expect(lines[1].textContent).toBe('Enter the GHOST')

    const alerts = document.querySelectorAll('#alerts .alert')
    expect(alerts).toHaveLength(1)
    expect(alerts[0].textContent).toBe('Pack 4 low')
    expect(alerts[0].classList.contains('alert-warning')).toBe(true)
    expect(el('script-path').textContent).toBe('/shows/hamlet.txt')
    expect(el('running-empty').hidden).toBe(true)
  })

  it('shows the empty places until the show publishes anything', async () => {
    await mount()

    expect(el('next-name').textContent).toBe('Nothing selected')
    expect(el('freshness').textContent).toBe('waiting for the show')
    expect(el('running-empty').hidden).toBe(false)
    expect(el('script-empty').hidden).toBe(false)
    expect(el('alerts-empty').hidden).toBe(false)
    expect(el('running-cues').children).toHaveLength(0)
    expect(el('running-order').children).toHaveLength(0)
    expect(el('script-lines').children).toHaveLength(0)
  })

  it('redraws from the stream when the show changes', async () => {
    const { streams } = await mount()
    expect(streams).toHaveLength(1)
    const next = { id: 'z', number: '99', name: 'Curtain call', type: 'audio', parentId: null, scriptLine: null }

    streams[0].onmessage?.({ data: JSON.stringify(state({ nextCue: next })) })

    expect(el('next-name').textContent).toBe('Curtain call')
    expect(el('next-number').textContent).toBe('99')
    expect(document.querySelectorAll('#script-lines .is-current')).toHaveLength(0)
  })

  it('turns the show into text, never into markup', async () => {
    const evil = '<script>alert(1)</script>'

    await mount({
      state: state({
        workspaceName: evil,
        nextCue: { id: 'x', number: evil, name: evil, type: 'audio', parentId: null, scriptLine: 1 },
        running: [{ id: 'x', number: evil, name: evil, state: evil }],
        cues: [],
        script: { path: evil, lines: [evil] },
        alerts: [{ id: 1, level: 'warning', message: evil }]
      })
    })

    expect(document.querySelectorAll('script')).toHaveLength(0)
    expect(el('next-name').textContent).toBe(evil)
    expect(el('next-name').innerHTML).toContain('&lt;script&gt;')
    expect(el('next-number').textContent).toBe(evil)
    expect(el('workspace').textContent).toBe(evil)
    expect(el('script-path').textContent).toBe(evil)
    expect(el('running-cues').querySelector('.cue-name')?.textContent).toBe(evil)
    expect(el('script-lines').querySelector('.script-line')?.textContent).toBe(evil)
    expect(el('alerts').querySelector('.alert')?.textContent).toBe(evil)
  })
})
