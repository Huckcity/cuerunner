import { useEffect } from 'react'
import { useModal } from '../../hooks/useModal'
import type { ReleaseSection } from '../../../../shared/releaseNotes'
import './Update.css'

/**
 * Release notes as the window draws them: a heading per version, one per kind of change, a line
 * per change. The notes arrive as plain words (`parseReleaseNotes`), so nothing a release says
 * can become markup here.
 */
export function ReleaseSections({ sections }: { sections: readonly ReleaseSection[] }) {
  return (
    <div className="release-sections">
      {sections.map(section => (
        <section key={section.version} className="release-section" data-version={section.version}>
          <h3 className="release-version">
            {section.version}
            {section.date !== null && <span className="release-date">{section.date}</span>}
          </h3>
          {section.groups.map(group => (
            <div key={group.title} className="release-group">
              <h4 className="release-group-title">{group.title}</h4>
              <ul className="release-items">
                {group.items.map((item, index) => (
                  <li key={index}>
                    {item.scope !== null && <span className="release-scope">{item.scope}</span>}
                    {item.text}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

interface DialogProps {
  title: string
  /** The line under the title: what these notes are about. */
  lede: string
  sections: readonly ReleaseSection[]
  /** Notes that did not read as versions, shown as the words they are. */
  fallback?: string
  /** Buttons beside Close: what the notes lead to. */
  actions?: React.ReactNode
  onClose: () => void
}

/** A modal of release notes: the update on offer, or the versions just installed. */
export function ReleaseNotesDialog({ title, lede, sections, fallback, actions, onClose }: DialogProps) {
  useModal()
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="update-overlay">
      <div className="update-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <div className="update-dialog-header">
          <span className="update-dialog-title">{title}</span>
          <button className="update-dialog-close" onClick={onClose} aria-label="Close the notes" title="Close (Esc)">✕</button>
        </div>
        <div className="update-dialog-body">
          <p className="update-dialog-lede">{lede}</p>
          {sections.length > 0 ? (
            <ReleaseSections sections={sections} />
          ) : fallback !== undefined && fallback.trim() !== '' ? (
            <pre className="release-fallback">{fallback}</pre>
          ) : (
            <p className="update-dialog-lede">This release carries no notes.</p>
          )}
        </div>
        <div className="update-dialog-footer">
          {actions}
          <button className="update-action" onClick={onClose} autoFocus>Close</button>
        </div>
      </div>
    </div>
  )
}
