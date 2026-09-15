import { useEffect } from 'react'
import { cueRunner } from '../engine/CueRunner'
import { DeskButtons } from '../utils/deskInput'
import { useStore, usePro } from '../store'
import { deskLinkName } from '../../../shared/deskLink'
import type { DeskButtons as DeskButtonMap, DeskSettings } from '../types/show'

/**
 * Where the desk's messages come from, as the services name them: an input port's name, or
 * the desk's own socket as "host:port".
 *
 * The same naming the desk service publishes under — it is what a trigger on the desk is
 * written against too — so the two cannot disagree about which device the show is listening to.
 */
export function deskDevice(desk: DeskSettings): string | null {
  if (desk.kind === 'midi') return desk.midiPort === '' ? null : desk.midiPort
  if (desk.kind === 'midi-tcp') {
    return desk.host.trim() === '' ? null : deskLinkName(desk.host, desk.tcpPort)
  }
  return null
}

/**
 * What a button on the desk does on this show, or null when the show listens to no button of
 * that number. GO first: a show that has somehow assigned one group to both is a show that
 * moves on, and the settings panel says the same thing about that assignment.
 */
export function deskButtonAction(buttons: DeskButtonMap, group: number): 'go' | 'back' | null {
  if (buttons.go === group) return 'go'
  if (buttons.back === group) return 'back'
  return null
}

/**
 * Runs the show from the desk's own buttons.
 *
 * The desk transmits a mute message when one of the keys the operator assigned is pressed —
 * the message the mute group would have sent anyway — and this reads those off the same
 * event river the triggers read, asks the runner for the action the show gave that group,
 * and nothing else. It is not a trigger: the button is the transport, which is why what
 * stands in front of it is the transport's own window and not a cue's.
 *
 * A show drives a desk over a socket while its services are licensed and listening, so with
 * no key there is nothing here to read.
 */
export function useDeskTransport(): void {
  const pro = usePro()

  useEffect(() => {
    if (!pro) return
    const buttons = new DeskButtons()
    return window.winslab.show.onEvents(events => {
      const desk = useStore.getState().showSettings.desk
      const device = deskDevice(desk)
      if (device === null) return

      for (const event of events) {
        const pressed = buttons.read(desk.profile, event)
        if (pressed === null || pressed.device !== device) continue
        const action = deskButtonAction(desk.buttons, pressed.number)
        if (action === null) continue

        // Keyed by the button, not by the message: a key press is a toggle, so the two
        // halves of one press are two different messages that mean the same press.
        const key = `${pressed.device} desk:muteGroup:${pressed.number}`
        if (action === 'go') cueRunner.goFrom('midi', key)
        else cueRunner.back('midi', key)
      }
    })
  }, [pro])
}
