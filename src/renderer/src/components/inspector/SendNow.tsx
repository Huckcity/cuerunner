import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Sends what the cue would send, and answers whether it left. */
  send: () => Promise<{ ok: boolean; error?: string }>
  /** What is being sent, for the button's title: "the message", "2 messages". */
  what: string
  disabled?: boolean
}

type Outcome = { ok: true } | { ok: false; reason: string } | null

/**
 * The cue's message sent now, from the inspector, without running the cue: no pre-wait, no
 * advance, no line in the run's history — the check an operator makes at the desk before the
 * show, "is the console listening on that address". What happened is said beside the button,
 * in the socket's own words when it did not leave.
 */
export function SendNow({ send, what, disabled }: Props) {
  const [outcome, setOutcome] = useState<Outcome>(null)
  const [sending, setSending] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const press = async (): Promise<void> => {
    setSending(true)
    window.clearTimeout(timer.current)
    try {
      const result = await send()
      setOutcome(result.ok ? { ok: true } : { ok: false, reason: result.error ?? 'it did not leave' })
    } catch (error) {
      setOutcome({ ok: false, reason: error instanceof Error ? error.message : String(error) })
    } finally {
      setSending(false)
    }
    // A sent mark is a confirmation, not a state: it goes; a failure stays until the next try.
    timer.current = window.setTimeout(() => setOutcome(current => current?.ok ? null : current), 2000)
  }

  return (
    <div className="field-row send-now">
      <label />
      <button
        className="add-row send-now-btn"
        onClick={() => { void press() }}
        disabled={disabled || sending}
        title={`Send ${what} now, without running the cue`}
      >
        Send now
      </button>
      {outcome !== null && (
        <span className="send-now-result" data-ok={outcome.ok}>
          {outcome.ok ? 'Sent' : outcome.reason}
        </span>
      )}
    </div>
  )
}
