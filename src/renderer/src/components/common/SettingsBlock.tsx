import type { ReactNode } from 'react'
import type { ServiceStatus as Status } from '../../types/show'
import { ServiceStatus } from './ServiceStatus'

interface ServiceBlockProps {
  title: string
  /** What switching it on does, from the operator's side. One line. */
  blurb: string
  /** The switch's id — what a test checks, and what the label points at. */
  id: string
  enabled: boolean
  onEnabled: (on: boolean) => void
  service?: Status
  children?: ReactNode
}

/**
 * One service: what it is, what it does, whether it is on, and what it is doing about it.
 *
 * Every service on these tabs was written out by hand — a section title, a checkbox in a
 * field row whose label said "Listen" or "Browse" or "Serve", a paragraph underneath, and
 * a line of monospace at the bottom — so no two read the same way. They are all this
 * shape now, and the switch says what it switches rather than which verb the service uses
 * for it.
 */
export function ServiceBlock({ title, blurb, id, enabled, onEnabled, service, children }: ServiceBlockProps) {
  return (
    <section className="settings-block" data-enabled={enabled}>
      <div className="settings-block-head">
        <div className="settings-block-text">
          <h3 className="settings-block-title">{title}</h3>
          <p className="settings-block-blurb">{blurb}</p>
        </div>
        <ServiceStatus service={service} />
        <input
          id={id}
          className="settings-switch"
          type="checkbox"
          role="switch"
          aria-label={title}
          checked={enabled}
          onChange={e => onEnabled(e.target.checked)}
        />
      </div>
      {children}
    </section>
  )
}

/**
 * The settings behind a service that are set once, if ever: the mDNS service types, a
 * timeout. They were the first thing on the panel and read as a lesson in the protocol;
 * they are one press away instead, and the press says what is behind it.
 */
export function Advanced({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="disclosure settings-advanced">
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  )
}
