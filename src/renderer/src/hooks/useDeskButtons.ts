import { useEffect } from 'react'
import { recallScene } from '../engine/scenes'
import { sendDeskMessage } from '../engine/deskSend'
import { deskMidi } from '../utils/desk'
import { DeskButtons, muteGroupGet, type DeskButton } from '../utils/deskInput'
import { sceneStep } from '../utils/scenes'
import { useStore } from '../store'
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
 * that number on that route. The press says which route it is: a note and a mute group are
 * separate spaces, so a show may name group 5 and note 5 and each press runs its own
 * action. Within a space GO comes first: a show that has somehow assigned both buttons the
 * same number is a show that moves on, and the settings panel says the same thing.
 */
export function deskButtonAction(buttons: DeskButtonMap, press: DeskButton): 'go' | 'back' | null {
  if (press.control === 'note') {
    if (buttons.goNote === press.number) return 'go'
    if (buttons.backNote === press.number) return 'back'
    return null
  }
  if (buttons.go === press.number) return 'go'
  if (buttons.back === press.number) return 'back'
  return null
}

/**
 * The mute groups this show listens to, so a desk is only asked about those. A note is not
 * asked about: no get exists for a soft key, which is why a note primes on its own press.
 */
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
 * A key press makes the desk transmit a mute group's message — or, on a key assigned to a
 * MIDI note, the note itself — this reads it off the same event river the triggers read, and
 * the button the show assigned moves the scenes one step on or back. The desk reports its own
 * state — when a client connects and in answer to a get — so the reader treats a group's first
 * sighting as no press and only a change as one, and the app asks about the groups it listens
 * to when it starts and whenever the desk comes back: a show that opened onto a desk with a
 * group already muted must not recall a scene by itself. A note is the other way round: the
 * desk has no get for a soft key and transmits only while the key is held, so its note-on is
 * the press, its note-off the release, and a repeat while it is down says nothing new.
 *
 * What stands in front of a press is the desk's own state rather than the firing window the
 * triggers use: the window would read a fast hand as a bounce, and the toggle in the message
 * already says which press this is. The window is still what stands in front of a *cue*
 * firing, which is a different question — whether one cue was fired twice.
 */
export function useDeskButtons(): void {
  // The show's desk is what decides which groups are watched and where to ask: a workspace
  // opened after the app started carries its own buttons, and the question has to be asked
  // again when they are. A reader is made per desk, so a changed group primes afresh.
  const desk = useStore(s => s.showSettings.desk)

  useEffect(() => {
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
      // Which of the show's device rows is the desk's own. The spellings are the services':
      // an input port is published as `midi-in:<port name>` (`MidiInputService.ts`), the
      // desk's own socket as `midi-tcp:<host:port>` (`MidiTcpService.ts`) — and which one a
      // desk arrives under is its kind, because a desk reached through a cable is a port of
      // this machine rather than a socket.
      const deskId = current.kind === 'midi' ? `midi-in:${device}` : `midi-tcp:${device}`

      for (const event of events) {
        // A desk that went away and came back reports its state again: what it says is news
        // about the room, not a hand on a key, so the reader starts over and is told to ask
        // rather than waiting for a press that would prime it instead of acting.
        //
        // Both edges reset. A port that has gone down is a port that can no longer send the
        // note-off a key it was holding would have sent, so a reader that kept the latch
        // would read the operator's next press as the repeat of a key nobody is holding —
        // and the edge detection for the groups is wedged by a message that never arrived
        // in exactly the same way. Only the return asks: a port that has just left has no
        // desk behind it to answer.
        if (event.kind === 'device' && event.device.id === deskId) {
          buttons.reset()
          if (event.device.online) askWhereTheGroupsStand()
          continue
        }

        const pressed = buttons.read(current.profile, event)
        if (pressed === null || pressed.device !== device) continue
        const action = deskButtonAction(current.buttons, pressed)
        if (action === null) continue
        stepScenes(action)
      }
    })
  }, [desk])
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
