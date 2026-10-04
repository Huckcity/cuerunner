import { useEffect, useRef } from 'react'
import { sendDeskMessage } from '../engine/deskSend'
import { highestWinsActive, ridesWrite } from '../utils/desk'
import { useStore } from '../store'
import type { DeskState } from '../utils/scenes'
import type { DeskMessage, ShowSettings } from '../../../shared/show'

/**
 * What the desk is told when highest wins is turned on or off mid-show: every channel the
 * record has on more than one fader, handed to main with the new rule. On, main keeps each on
 * its highest fader; off, main puts each back on every fader the record holds — without that,
 * a channel main was following would be left riding only the fader it last won, while the
 * record, and the next recall's difference, said it rode them all.
 */
export function highestWinsResync(show: ShowSettings, deskState: DeskState, highest: boolean): DeskMessage[] {
  const messages: DeskMessage[] = []
  show.cast.channels.forEach((channel, index) => {
    const faders = deskState.assignments[channel.id] ?? []
    if (faders.length < 2) return
    const message = ridesWrite(index, faders, faders, highest, show)
    if (message !== null) messages.push(message)
  })
  return messages
}

/**
 * Hands main the show's multi-fader channels whenever highest wins comes into force or goes
 * out of it — the setting, the duplicate rule it depends on, or the desk it needs. Not on
 * mount: a show that has just opened has an empty record, and the first recall says it all.
 */
export function useHighestWins(): void {
  const active = useStore(s => highestWinsActive(s.showSettings))
  const was = useRef(active)

  useEffect(() => {
    if (was.current === active) return
    was.current = active
    const { showSettings, deskState } = useStore.getState()
    const messages = highestWinsResync(showSettings, deskState, active)
    if (messages.length === 0) return
    void (async () => {
      const failed: string[] = []
      for (const message of messages) {
        const sent = await sendDeskMessage(message)
        if (!sent.ok && sent.error !== undefined && !failed.includes(sent.error)) failed.push(sent.error)
      }
      useStore.getState().appendLog([{
        level: failed.length === 0 ? 'info' : 'error',
        label: 'Desk',
        message: failed.length === 0
          ? `Highest fader wins ${active ? 'on' : 'off'} — ${messages.length} channel${messages.length === 1 ? '' : 's'} on more than one fader handed to the desk`
          : `Highest fader wins ${active ? 'on' : 'off'} — not every channel reached the desk: ${failed.join('; ')}`
      }])
    })()
  }, [active])
}
