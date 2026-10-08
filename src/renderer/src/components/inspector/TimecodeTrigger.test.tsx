// The timecode half of the trigger editor: a frame typed as a label or as seconds, added to
// the cue as the label the clock will be read at, and refused when the rate has no such frame.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Triggers, describeTrigger } from './Triggers'
import { parseTriggerText } from './TimecodeTrigger'
import { useStore } from '../../store'
import { createCue } from '../../utils/cueDefaults'
import { setTimecodeStatus } from '../../engine/timecodeStatus'
import { idleReceiverStatus } from '../../../../shared/timecode'

function Harness({ id }: { id: string }) {
  const cue = useStore(s => s.cues.find(c => c.id === id))
  return cue ? <Triggers cue={cue} /> : null
}

describe('parseTriggerText', () => {
  it('reads a label, or seconds from midnight', () => {
    expect(parseTriggerText('01:00:10:00', '25')).toEqual({ hours: 1, minutes: 0, seconds: 10, frames: 0 })
    expect(parseTriggerText('3610s', '25')).toEqual({ hours: 1, minutes: 0, seconds: 10, frames: 0 })
    expect(parseTriggerText('3610.5 s', '25')).toEqual({ hours: 1, minutes: 0, seconds: 10, frames: 12 })
    expect(parseTriggerText('90000s', '25')).toBeNull()
    expect(parseTriggerText('00:01:00;00', '29.97df')).toBeNull()
  })
})

describe('the timecode trigger form', () => {
  let container: HTMLDivElement
  let root: Root
  let cueId: string

  beforeEach(() => {
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    const cue = createCue('wait')
    cueId = cue.id
    useStore.setState({ cues: [cue], showEvents: [] })
    setTimecodeStatus({ receiver: { ...idleReceiverStatus('artnet'), rate: '30' }, generators: [] })
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    useStore.setState({ cues: [], showEvents: [] })
  })

  function type(text: string): void {
    const input = container.querySelector<HTMLInputElement>('#trigger-timecode')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    act(() => {
      setter.call(input, text)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  it('adds the frame as a label at the rate the clock is read at', () => {
    act(() => root.render(<Harness id={cueId} />))
    type('120s')
    const add = container.querySelector<HTMLButtonElement>('.trigger-timecode-add')!
    expect(add.disabled).toBe(false)
    act(() => add.click())
    const triggers = useStore.getState().cues[0].triggers ?? []
    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toMatchObject({ kind: 'timecode', timecode: '00:02:00:00' })
    expect(describeTrigger(triggers[0])).toBe('Timecode 00:02:00:00')
    expect(container.querySelector('.trigger-row[data-kind="timecode"]')?.textContent).toContain('Timecode 00:02:00:00')
  })

  it('refuses a frame the rate does not have, and says so', () => {
    act(() => root.render(<Harness id={cueId} />))
    type('00:00:00:30')
    expect(container.querySelector<HTMLButtonElement>('.trigger-timecode-add')!.disabled).toBe(true)
    expect(container.querySelector('.trigger-section[data-kind="timecode"]')?.textContent).toContain('Not a frame at 30 fps')
  })
})
