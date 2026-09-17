import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useStore } from '../../store'
import type { Cue } from '../../../../shared/cue'
import './ScriptPanel.css'

// How far the operator may scroll away before the panel stops chasing the next cue.
// The log panel pins its bottom with the same slack, and both panels should feel like
// the same gesture.
const PIN_THRESHOLD_PX = 24

// The script is read from a music stand in a dark pit and from the desk up close; the
// clamp keeps it legible without letting one step swallow the panel.
const MIN_FONT_SIZE = 11
const MAX_FONT_SIZE = 28

/**
 * Which cue numbers fire on which script line, in cue order. A cue pinned to nothing
 * does not appear: the map is the running order as the document shows it, and every
 * line is a line the operator can see.
 */
export function pinMap(cues: Cue[]): Map<number, string[]> {
  const pins = new Map<number, string[]>()
  for (const cue of cues) {
    if (cue.scriptLine == null) continue
    const numbers = pins.get(cue.scriptLine)
    if (numbers) numbers.push(cue.number)
    else pins.set(cue.scriptLine, [cue.number])
  }
  return pins
}

interface Props {
  onClose: () => void
}

export function ScriptPanel({ onClose }: Props) {
  const script = useStore(s => s.showSettings.script)
  const cues = useStore(s => s.cues)
  const selectedId = useStore(s => s.selectedId)
  const running = useStore(s => s.running)
  const updateCue = useStore(s => s.updateCue)
  const updateScriptSettings = useStore(s => s.updateScriptSettings)

  const [lines, setLines] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [following, setFollowing] = useState(true)
  const listRef = useRef<HTMLDivElement>(null)

  const path = script.path
  const hasScript = path !== ''

  // One read per document: a path kept in the workspace may be relative, and the main
  // process resolves it against the workspace the panel was last handed. Clearing first
  // means switching documents never leaves the previous script's lines on screen.
  useEffect(() => {
    setLines([])
    setError(null)
    if (path === '') return

    let cancelled = false
    window.cuerunner.script
      .readDocument(path, useStore.getState().workspacePath)
      .then(document => {
        if (cancelled) return
        if (document.ok) setLines(document.lines)
        // A document that cannot be shown says why. Opening a PDF by mistake is a
        // sentence on the screen, not an empty panel and not a dead window.
        else setError(document.error)
      })
      .catch(reason => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })

    return () => {
      cancelled = true
    }
  }, [path])

  const pins = useMemo(() => pinMap(cues), [cues])

  // Cues are pinned, but the running state belongs to the cue stack: a line whose cue
  // is firing is drawn the way the cue list draws a playing row.
  const runningLines = useMemo(() => {
    const live = new Set<number>()
    for (const cue of cues) {
      if (cue.scriptLine != null && running.has(cue.id)) live.add(cue.scriptLine)
    }
    return live
  }, [cues, running])

  const selected = cues.find(cue => cue.id === selectedId) ?? null
  const currentLine = selected?.scriptLine ?? null

  // Following is the whole point of the panel: the cue about to fire is kept on screen
  // as the selection advances. Releasing the follow leaves the view where the operator
  // put it, until they ask for the cue back. The document is a dependency because the
  // line only exists to scroll to once it has been read.
  useEffect(() => {
    if (!following || currentLine === null) return
    const line = listRef.current?.querySelector(`.script-line[data-line="${currentLine}"]`)
    if (line instanceof HTMLElement && typeof line.scrollIntoView === 'function') {
      line.scrollIntoView({ block: 'nearest' })
    }
  }, [following, currentLine, lines])

  // Following means the line the cue fires on stays on screen. Scrolling it out of view
  // is the operator taking the document somewhere else, so the follow lets go. The
  // log panel's pin threshold covers the case where there is no line to chase.
  const handleScroll = (): void => {
    const el = listRef.current
    if (!el) return
    const line =
      currentLine === null ? null : el.querySelector(`.script-line[data-line="${currentLine}"]`)
    if (line instanceof HTMLElement) {
      const list = el.getBoundingClientRect()
      const rect = line.getBoundingClientRect()
      setFollowing(rect.bottom > list.top && rect.top < list.bottom)
      return
    }
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < PIN_THRESHOLD_PX)
  }

  const chooseFile = async (): Promise<void> => {
    const picked = await window.cuerunner.script.pickFile()
    if (!picked) return
    updateScriptSettings({ path: picked })
  }

  const stepFontSize = (delta: number): void => {
    const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, script.fontSize + delta))
    updateScriptSettings({ fontSize: next })
  }

  // Clicking the line the cue already sits on takes it off: one gesture serves both,
  // and there is no separate way to unpin that an operator would have to remember.
  const pinTo = (line: number): void => {
    if (!selected) return
    updateCue(selected.id, { scriptLine: selected.scriptLine === line ? null : line })
  }

  // The header says where the script came from by its own name, not its whole path.
  const scriptName = path.split(/[\\/]/).pop() || path

  return (
    <div
      className="script-panel"
      style={{ '--script-font-size': `${script.fontSize}px` } as CSSProperties}
    >
      <div className="script-header">
        <span className="script-title">Script</span>
        <span className="script-path">{hasScript ? scriptName : 'no script'}</span>
        <div className="script-actions">
          <button className="script-btn" onClick={chooseFile} title="Load a script">
            Choose file…
          </button>
          <button
            className="script-btn script-font-dec"
            onClick={() => stepFontSize(-1)}
            title="Smaller script"
          >
            A−
          </button>
          <button
            className="script-btn script-font-inc"
            onClick={() => stepFontSize(1)}
            title="Larger script"
          >
            A+
          </button>
          <button className="script-btn" onClick={onClose} title="Hide script">
            ✕
          </button>
        </div>
      </div>

      {!hasScript ? (
        <div className="script-empty">
          <span>No script loaded. Open a document to pin cues to its lines.</span>
          <button className="script-choose" onClick={chooseFile}>
            Choose file…
          </button>
        </div>
      ) : error !== null ? (
        <div className="script-error">
          <span className="script-error-message">{error}</span>
          <button className="script-choose" onClick={chooseFile}>
            Choose another…
          </button>
        </div>
      ) : (
        <>
          <div className="script-lines" ref={listRef} onScroll={handleScroll}>
            {lines.map((text, index) => {
              const line = index + 1
              const numbers = pins.get(line)
              return (
                <div
                  key={line}
                  className="script-line"
                  data-line={line}
                  data-current={line === currentLine ? 'true' : undefined}
                  data-running={runningLines.has(line) ? 'true' : undefined}
                >
                  <button
                    className="script-line-no"
                    onClick={() => pinTo(line)}
                    title="Pin the selected cue to this line"
                  >
                    {line}
                  </button>
                  <span className="script-line-text">{text}</span>
                  {numbers && (
                    <span className="script-pin" data-cues={numbers.join(',')}>
                      {numbers.join(', ')}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          {!following && (
            <button
              className="script-follow"
              data-active="true"
              onClick={() => setFollowing(true)}
              title="Follow the selected cue"
            >
              Follow
            </button>
          )}
        </>
      )}
    </div>
  )
}
