// The cue type icons: one box, one per type, and no two alike.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CUE_ICON_PATHS, CueIcon, GroupChevron } from './cueIcons'
import { CUE_TYPES } from '../../../shared/cue'

let root: Root | null = null
let host: HTMLDivElement | null = null

function draw(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root!.render(node) })
  return host
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  root = null
  host = null
})

describe('cue icons', () => {
  it('draws every cue type, and draws each one differently', () => {
    expect(Object.keys(CUE_ICON_PATHS).sort()).toEqual([...CUE_TYPES].sort())
    const drawings = Object.values(CUE_ICON_PATHS).map(paths => paths.join(' '))
    expect(drawings.every(drawing => drawing.trim() !== '')).toBe(true)
    expect(new Set(drawings).size).toBe(drawings.length)
  })

  it('stays inside the box they all share, so a column of them lines up', () => {
    for (const [type, paths] of Object.entries(CUE_ICON_PATHS)) {
      for (const number of paths.join(' ').match(/\d+(\.\d+)?/g) ?? []) {
        expect(Number(number), `${type} draws at ${number}, outside the 16×16 box`)
          .toBeLessThanOrEqual(16)
      }
    }
  })

  it('says which type it is drawing, rather than leaving that to the drawing', () => {
    const icon = draw(<CueIcon type="wait" />).querySelector('.cue-icon')
    expect(icon?.getAttribute('data-type')).toBe('wait')
    expect(icon?.querySelectorAll('path').length).toBe(CUE_ICON_PATHS.wait.length)
  })

  it('is hidden from a screen reader: the row already says what the cue is', () => {
    const icon = draw(<CueIcon type="audio" />).querySelector('.cue-icon')
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
  })

  it('turns the group chevron with the group', () => {
    const shown = draw(<GroupChevron open={true} />)
    expect(shown.querySelector('.group-chevron')?.getAttribute('data-open')).toBe('true')
    act(() => { root!.render(<GroupChevron open={false} />) })
    expect(shown.querySelector('.group-chevron')?.getAttribute('data-open')).toBe('false')
  })
})
