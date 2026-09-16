// What a service is doing, said in a word the operator would use. The runtime's own
// state names are right for a log and wrong for a settings panel: "stopped" reads as a
// failure when it means the operator has not switched it on.
import { describe, it, expect, afterEach } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ServiceStatus } from './ServiceStatus'
import type { ServiceStatus as Status } from '../../types/show'

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

function service(state: Status['state'], detail: string): Status {
  return { id: 'osc-in', label: 'OSC input', state, detail, since: 0 }
}

describe('ServiceStatus', () => {
  it('says On, and what the service is doing about it', () => {
    const host = draw(<ServiceStatus service={service('running', 'listening on port 53000')} />)
    expect(host.querySelector('.service-pill')?.textContent).toBe('On')
    expect(host.querySelector('.service-detail')?.textContent).toBe('listening on port 53000')
  })

  it('says Off without a reason: the reason is the switch beside it', () => {
    const host = draw(<ServiceStatus service={service('stopped', 'disabled')} />)
    expect(host.querySelector('.service-pill')?.textContent).toBe('Off')
    expect(host.querySelector('.service-detail')).toBeNull()
  })

  it('keeps the state on the element, for the panel to colour and a test to read', () => {
    const host = draw(<ServiceStatus service={service('failed', 'port 53000 is in use')} />)
    const line = host.querySelector('.settings-service')
    expect(line?.getAttribute('data-state')).toBe('failed')
    expect(line?.getAttribute('data-service')).toBe('osc-in')
    expect(host.querySelector('.service-pill')?.textContent).toBe('Failed')
    expect(host.querySelector('.service-detail')?.textContent).toBe('port 53000 is in use')
  })

  it('names trouble as trouble rather than as a state machine word', () => {
    const host = draw(<ServiceStatus service={service('degraded', 'rack unreachable')} />)
    expect(host.querySelector('.service-pill')?.textContent).toBe('Trouble')
  })

  it('draws nothing at all when there is no service, unless given words for that', () => {
    expect(draw(<ServiceStatus service={undefined} />).textContent).toBe('')
    expect(draw(<ServiceStatus service={undefined} absent="Not started" />).textContent)
      .toBe('Not started')
  })
})
