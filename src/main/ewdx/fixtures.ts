// What an EM 4 Dante (firmware 4.x, SSCv2 protocol 2.4) actually pushed on a subscription,
// captured from a receiver on a show network. The values are the receiver's own; the serial
// is a placeholder. Channel 0 is linked to TX1, an EW_DX_SK bodypack on AA cells, and
// channels 1 to 3 are not linked to anything.

export const FIXTURE_SERIAL = '0000000001'

/** Channel 0 linked: the receiver's first snapshot of every subscribed path. */
export const LINKED_EM4: ReadonlyArray<readonly [string, unknown]> = [
  ['/api/channel/0', { name: '37', mute: false, mates: ['TX1'], gain: 21, audio: ['Out1'], outputLevel: 6, eventCounter: 0 }],
  ['/api/channel/0/level', { value: -91.900000000000006 }],
  ['/api/channel/0/signalStrengthIndicator', { value: -83.0 }],
  ['/api/channel/0/warnings', []],
  ['/api/rf/channels/0', { frequency: 606200, presets: { type: 'Factory', bank: 0, channel: 0 } }],
  ['/api/transmitters/0', { type: 'EW_DX_SK', capsule: 'Unknown', version: '3.0.2', mute: false, identification: false, lowcut: 'Off', name: '37', trim: 0, cableEmulation: 'Off', led: true, lock: false, muteConfig: 'AfMute' }],
  ['/api/transmitters/0/battery', { type: 'PrimaryCell', gauge: 76 }],
  ['/api/transmitters/0/warnings', []],
  ['/api/channel/1', { name: '38', mute: false, mates: [], gain: 21, audio: ['Out2'], outputLevel: 6, eventCounter: 0 }],
  ['/api/channel/1/level', { value: -138.5 }],
  ['/api/channel/1/signalStrengthIndicator', { value: -107.0 }],
  ['/api/channel/1/warnings', ['NoLink']],
  ['/api/rf/channels/1', { frequency: 606800, presets: { type: 'Factory', bank: 0, channel: 1 } }],
  ['/api/transmitters/1', {}],
  ['/api/transmitters/1/battery', {}],
  ['/api/transmitters/1/warnings', []]
]

/** The wire form of the same snapshot: one SSE `data:` line per path, as the receiver sent them. */
export function sseData(entries: ReadonlyArray<readonly [string, unknown]>): string {
  return entries.map(([path, value]) => `data: ${JSON.stringify({ [path]: value })}\n\n`).join('')
}
