import type {
  DeskChannel,
  DeskMessage,
  MicScene,
  RfPack,
  ScenesSettings
} from '../types/show'

/**
 * Scenes and desk groups, as pure operations.
 *
 * The point of the whole feature is the function at the bottom of this file: given who is
 * open in a scene, what does the desk actually have to be told? A scene recall should be
 * three messages, not a slam of every fader on the desk — both because a desk takes a
 * moment to accept them and because the operator can see what changed.
 */

export function addScene(settings: ScenesSettings, name = ''): ScenesSettings {
  const scene: MicScene = {
    id: crypto.randomUUID(),
    name: name.trim() === '' ? `Scene ${settings.list.length + 1}` : name.trim(),
    live: [],
    notes: ''
  }
  return { ...settings, list: [...settings.list, scene] }
}

export function updateScene(
  settings: ScenesSettings,
  sceneId: string,
  patch: Partial<Omit<MicScene, 'id'>>
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => scene.id === sceneId ? { ...scene, ...patch } : scene)
  }
}

export function removeScene(settings: ScenesSettings, sceneId: string): ScenesSettings {
  return { ...settings, list: settings.list.filter(scene => scene.id !== sceneId) }
}

/** Opens or closes one mic in one scene. */
export function setPackLive(
  settings: ScenesSettings,
  sceneId: string,
  packId: string,
  live: boolean
): ScenesSettings {
  return {
    ...settings,
    list: settings.list.map(scene => {
      if (scene.id !== sceneId) return scene
      const already = scene.live.includes(packId)
      if (already === live) return scene
      return { ...scene, live: live ? [...scene.live, packId] : scene.live.filter(id => id !== packId) }
    })
  }
}

export function addDeskChannel(settings: ScenesSettings, label = ''): ScenesSettings {
  const channel: DeskChannel = {
    id: crypto.randomUUID(),
    label: label.trim() === '' ? `DCA ${settings.channels.length + 1}` : label.trim(),
    mute: null,
    unmute: null
  }
  return { ...settings, channels: [...settings.channels, channel] }
}

export function updateDeskChannel(
  settings: ScenesSettings,
  channelId: string,
  patch: Partial<Omit<DeskChannel, 'id'>>
): ScenesSettings {
  return {
    ...settings,
    channels: settings.channels.map(channel =>
      channel.id === channelId ? { ...channel, ...patch } : channel)
  }
}

/**
 * Removes a group. Packs still pointed at it keep the pointer until something clears it —
 * the caller clears them in the plot, because a pack belongs to the other section.
 */
export function removeDeskChannel(settings: ScenesSettings, channelId: string): ScenesSettings {
  return { ...settings, channels: settings.channels.filter(channel => channel.id !== channelId) }
}

/**
 * The ordinary desk arrangement for a wireless group: one note, open on note-on and
 * closed on note-off, which is what most desks map a mute to.
 */
export function midiNoteMessages(
  portName: string,
  channel: number,
  note: number
): { mute: DeskMessage; unmute: DeskMessage } {
  return {
    unmute: { kind: 'midi', portName, message: { kind: 'noteOn', channel, note, velocity: 127 } },
    mute: { kind: 'midi', portName, message: { kind: 'noteOff', channel, note, velocity: 0 } }
  }
}

/** The same arrangement over OSC: one address, open value and close value. */
export function oscMessages(
  host: string,
  port: number,
  address: string,
  open: number[] = [1],
  close: number[] = [0]
): { mute: DeskMessage; unmute: DeskMessage } {
  return {
    unmute: { kind: 'osc', host, port, address, args: open },
    mute: { kind: 'osc', host, port, address, args: close }
  }
}

export function describeDeskMessage(message: DeskMessage | null): string {
  if (message === null) return 'nothing'
  if (message.kind === 'osc') {
    return `OSC ${message.address} ${message.args.join(' ')} → ${message.host}:${message.port}`
  }
  // A sysex carries no channel, so it is described by what it is.
  if (message.message.kind === 'sysex') {
    return `sysex ${message.message.data.length} bytes → "${message.portName}"`
  }
  return `${message.message.kind} ch${message.message.channel} → "${message.portName}"`
}

/** One group the desk has to be told about, and what to tell it. */
export interface DeskChange {
  channelId: string
  label: string
  /** True when the group is being opened, false when it is being closed. */
  live: boolean
  message: DeskMessage
}

/**
 * What a recall actually sends.
 *
 * A group is open when one of the mics the plot puts in it is open in the scene. Groups
 * no mic is assigned to are left alone entirely — the desk may well be doing something
 * else with them — and a group already in the state the scene asks for is not mentioned:
 * that is what makes a recall a few messages instead of a sweep.
 */
export function sceneChanges(
  packs: RfPack[],
  channels: DeskChannel[],
  scene: MicScene | null,
  deskState: Record<string, boolean>
): DeskChange[] {
  const changes: DeskChange[] = []

  for (const channel of channels) {
    const assigned = packs.filter(pack => pack.deskChannelId === channel.id)
    if (assigned.length === 0) continue

    const shouldBeLive = assigned.some(pack => scene?.live.includes(pack.id) ?? false)
    if (deskState[channel.id] === shouldBeLive) continue

    const message = shouldBeLive ? channel.unmute : channel.mute
    if (message === null) continue

    changes.push({ channelId: channel.id, label: channel.label, live: shouldBeLive, message })
  }

  return changes
}

/** The groups the plot drives, in order, with what each one is carrying. */
export interface DeskChannelSummary {
  channel: DeskChannel
  packs: RfPack[]
  /** True when at least one of its mics is open in the current scene. */
  live: boolean
}

export function deskSummary(
  packs: RfPack[],
  channels: DeskChannel[],
  scene: MicScene | null
): DeskChannelSummary[] {
  return channels.map(channel => {
    const assigned = packs.filter(pack => pack.deskChannelId === channel.id)
    return {
      channel,
      packs: assigned,
      live: assigned.some(pack => scene?.live.includes(pack.id) ?? false)
    }
  })
}
