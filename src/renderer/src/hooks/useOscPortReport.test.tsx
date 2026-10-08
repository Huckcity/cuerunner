// A refused OSC port is a status line and one info line in the log — never an alarm, never an
// error line — so several shows started on one machine at once are calm about it.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { oscPortReport, useOscPortReport } from './useOscPortReport'
import { useStore } from '../store'
import type { ServiceStatus } from '../../../shared/show'

const status = (state: ServiceStatus['state'], detail: string): ServiceStatus =>
  ({ id: 'osc-in', label: 'OSC input', state, detail, since: 0 })

const refused = 'port 53000 is in use by another program (QLab, another Cuerunner, a bridge) — this show cannot hear OSC there until it is let go or the port is changed (EADDRINUSE)'

describe('the OSC port report', () => {
  it('is a line for a refused port and for nothing else', () => {
    expect(oscPortReport(status('degraded', refused))).toBe(`OSC input: ${refused}`)
    expect(oscPortReport(status('running', 'listening on port 53000'))).toBeNull()
    expect(oscPortReport(status('degraded', 'stopped listening: recv ENOBUFS'))).toBeNull()
    expect(oscPortReport(undefined)).toBeNull()
  })

  describe('in the window', () => {
    let container: HTMLDivElement
    let root: Root
    function Probe() { useOscPortReport(); return null }

    beforeEach(() => {
      ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
      useStore.setState({ log: [], showServices: [], showAlerts: [] })
      container = document.createElement('div')
      root = createRoot(container)
      act(() => root.render(<Probe />))
    })

    afterEach(() => act(() => root.unmount()))

    it('writes the refusal to the log once, at the info level, and raises no alarm', () => {
      act(() => useStore.setState({ showServices: [status('degraded', refused)] }))
      act(() => useStore.setState({ showServices: [status('degraded', refused)] }))
      const lines = useStore.getState().log.filter(entry => entry.message.includes('in use'))
      expect(lines).toHaveLength(1)
      expect(lines[0].level).toBe('info')
      expect(useStore.getState().showAlerts).toEqual([])
    })
  })
})
