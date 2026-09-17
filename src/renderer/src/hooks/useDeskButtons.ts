import { useEffect } from 'react'
import { recallScene } from '../engine/scenes'
import { sendDeskMessage } from '../engine/deskSend'
import { deskMidi } from '../utils/desk'
import { DeskButtons, muteGroupGet } from '../utils/deskInput'
import { sceneStep } from '../utils/scenes'
import { useStore, usePro } from '../store'
import { deskLinkName } from '../../../shared/deskLink'
import type { DeskButtons as DeskButtonMap, DeskSettings } from '../../../shared/show'

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

/** The groups this show listens to, so a desk is only asked about those. */
export function watchedGroups(desk: DeskSettings): number[] {
  const groups = [desk.buttons.go, desk.buttons.back]
    .filter((group): group is number => group !== null)
  // Once each: a file that gives one group both buttons is refused by the panel, and the
  // desk does not need asking twice.
  return [...new Set(groups)]
}

/**
 * Runs the show's scenes from the desk's own buttons.
 *
 * A key press makes the desk transmit a mute group's message, this reads it off the same
 * event river the triggers read, and the group the show assigned moves the scenes one step on
 * or back. The desk reports its own state — when a client connects and in answer to a get —
 * so the reader treats a first sighting as no press and only a change as one, and the app asks
 * about the groups it listens to when it starts and whenever the desk comes back: a show that
 * opened onto a desk with a group already muted must not recall a scene by itself.
 *
 * What stands in front of a press is the desk's own state rather than the firing window the
 * triggers use: the window would read a fast hand as a bounce, and the toggle in the message
 * already says which press this is. The window is still what stands in front of a *cue*
 * firing, which is a different question — whether one cue was fired twice.
 *
 * The show services only exist while licensed and listening, so with no key there is nothing
 * here to read.
 */
export function useDeskButtons(): void {
  const pro = usePro()
  // The show's desk is what decides which groups are watched and where to ask: a workspace
  // opened after the app started carries its own buttons, and the question has to be asked
  // again when they are. A reader is made per desk, so a changed group primes afresh.
  const desk = useStore(s => s.showSettings.desk)

  useEffect(() => {
    if (!pro) return
    const buttons = new DeskButtons()

    const askWhereTheGroupsStand = (): void => {
      const current = useStore.getState().showSettings.desk
      const asks = watchedGroups(current)
        .flatMap(group => muteGroupGet(current.profile, current.midiChannel, group))
      const addressed = deskMidi(current, asks)
      if (addressed !== null) void sendDeskMessage(addressed)
    }

    askWhereTheGroupsStand()

    return window.cuerunner.show.onEvents(events => {
      const current = useStore.getState().showSettings.desk
      const device = deskDevice(current)
      if (device === null) return

      for (const event of events) {
        // A desk that went away and came back reports its state again: what it says is news
        // about the room, not a hand on a key, so the reader starts over and is told to ask
        // rather than waiting for a press that would prime it instead of acting.
        if (event.kind === 'device' && event.device.id === `midi-tcp:${device}`) {
          buttons.reset()
          if (event.device.online) askWhereTheGroupsStand()
          continue
        }

        const pressed = buttons.read(current.profile, event)
        if (pressed === null || pressed.device !== device) continue
        const action = deskButtonAction(current.buttons, pressed.number)
        if (action === null) continue
        stepScenes(action)
      }
    })
  }, [pro, desk])
}

/** Moves the show's scenes one step, the way the desk's key asked. */
function stepScenes(action: 'go' | 'back'): void {
  const state = useStore.getState()
  const label = action === 'go' ? 'Desk GO' : 'Desk BACK'
  const target = sceneStep(state.showSettings.scenes.list, state.deskSceneId, action === 'go' ? 1 : -1)

  if (target === null) {
    // Nowhere to go is worth a line rather than silence: the operator pressed a button and
    // what they read should say whether the show has ended or the key is not wired.
    state.appendLog([{
      level: 'info',
      label,
      message: action === 'go' ? 'already at the last scene' : 'already at the first scene'
    }])
    return
  }

  // The recall writes its own line, under this label, saying what the desk was told.
  void recallScene(target.id, label)
}
