import { useCallback, useEffect, useRef, useState } from 'react'
import type { EwDxDiscoverResult, EwDxFound } from '../../../../shared/ipc/show'
import type { TelemetrySource } from '../../../../shared/show'
import { isAdded } from '../../utils/ewdx'
import './EwDxFinder.css'

interface Props {
  sources: TelemetrySource[]
  /** Makes the receiver a source. The operator still has to give it a password. */
  onAdd: (found: EwDxFound) => void
}

/**
 * The EW-DX receivers on the network, so nobody types an address.
 *
 * It looks once, when the Wireless page is opened, and again when asked: nothing in the app
 * browses for receivers in the background, so a show that never opens this page has no traffic
 * from it. Finding one adds nothing and logs into nothing — the receiver is offered, and the
 * operator decides it is theirs and gives it its password.
 */
export function EwDxFinder({ sources, onAdd }: Props): React.JSX.Element {
  const [looking, setLooking] = useState(true)
  const [result, setResult] = useState<EwDxDiscoverResult | null>(null)
  /** The look the window still cares about: a page closed mid-look has nobody to tell. */
  const current = useRef(0)

  const look = useCallback((): void => {
    const mine = ++current.current
    setLooking(true)
    window.cuerunner.show.ewDxDiscover().then(
      found => {
        if (current.current !== mine) return
        setResult(found)
        setLooking(false)
      },
      error => {
        if (current.current !== mine) return
        setResult({ receivers: [], error: error instanceof Error ? error.message : String(error) })
        setLooking(false)
      }
    )
  }, [])

  useEffect(() => {
    look()
    return () => {
      current.current += 1
    }
  }, [look])

  const fresh = (result?.receivers ?? []).filter(found => !isAdded(sources, found))
  const all = result?.receivers.length ?? 0

  const state = looking
    ? 'Looking…'
    : result?.error
      ? `Could not look: ${result.error}`
      : all === 0
        ? 'No EW-DX receivers found'
        : fresh.length === 0
          ? 'Every receiver found is added'
          : `${fresh.length} found`

  return (
    <div className="ewdx-finder">
      <div className="field-row">
        <label>On the network</label>
        <span className="ewdx-finder-state" data-state={looking ? 'looking' : result?.error ? 'error' : 'done'}>
          {state}
        </span>
        <button className="inspector-btn" disabled={looking} onClick={look}>
          Look again
        </button>
      </div>
      {fresh.map(found => (
        <div key={found.serial} className="ewdx-found" data-serial={found.serial}>
          <span className="ewdx-found-name">{found.model}</span>
          <span className="ewdx-found-address">{found.address}</span>
          <button className="inspector-btn" onClick={() => onAdd(found)}>
            Add
          </button>
        </div>
      ))}
    </div>
  )
}
