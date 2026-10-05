import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installDropGuard } from './dropGuard'

/** A drag event as the window receives one, carrying what `types` says it carries. */
function drag(type: 'dragover' | 'drop', types: string[]): DragEvent & { dataTransfer: { dropEffect: string } } {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { types, dropEffect: 'copy' } })
  return event as DragEvent & { dataTransfer: { dropEffect: string } }
}

describe('installDropGuard', () => {
  let uninstall: () => void
  let surface: HTMLDivElement

  beforeEach(() => {
    uninstall = installDropGuard()
    surface = document.createElement('div')
    document.body.appendChild(surface)
  })

  afterEach(() => {
    uninstall()
    surface.remove()
  })

  it('refuses a file dropped where nothing takes it, so the window is not replaced by it', () => {
    const over = drag('dragover', ['Files'])
    surface.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(true)
    // The cursor says so before the button is let go.
    expect(over.dataTransfer.dropEffect).toBe('none')

    const drop = drag('drop', ['Files'])
    surface.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(true)
  })

  it('leaves a surface that takes the drop alone', () => {
    // The cue list's own handler: it takes the files and says what the drop will do.
    surface.addEventListener('dragover', event => {
      event.preventDefault()
      ;(event as DragEvent).dataTransfer!.dropEffect = 'copy'
    })
    const over = drag('dragover', ['Files'])
    surface.dispatchEvent(over)
    expect(over.dataTransfer.dropEffect).toBe('copy')
  })

  it('has nothing to say about a drag that is not files', () => {
    const over = drag('dragover', ['application/x-cue-render-index'])
    surface.dispatchEvent(over)
    expect(over.defaultPrevented).toBe(false)
    expect(over.dataTransfer.dropEffect).toBe('copy')
  })

  it('is gone once it is uninstalled', () => {
    uninstall()
    const drop = drag('drop', ['Files'])
    surface.dispatchEvent(drop)
    expect(drop.defaultPrevented).toBe(false)
  })
})
