/**
 * The A&H desk peer held to the vendor documents, with no app and no Electron: every
 * assertion here is either bytes a real client socket saw or the desk's own state.
 *
 * The byte strings are the documents' own worked examples, kept in their notation — "SQ MIDI
 * Protocol" Issue 5, sections 3.1 to 3.7, and "Avantis MIDI TCP/IP Protocol" (V2.0+). Where a
 * document writes a message as `B N, 00, Bank`, the N is the desk's MIDI channel, so the spec
 * says which channel the desk was set to before asserting the byte string.
 */

import { expect, test } from '@playwright/test'
import { once } from 'node:events'
import { createConnection } from 'node:net'
import type { Socket } from 'node:net'
import { encodeMessages, startDeskPeer } from '../peers/desk.ts'
import type { DeskPeer, DeskPeerOptions, DeskReceived } from '../peers/desk.ts'

/** 'B0 63 00' to bytes, so an assertion reads like the document it came from. */
const bytes = (notation: string): number[] =>
  notation
    .trim()
    .split(/\s+/)
    .map((pair) => Number.parseInt(pair, 16))

/** `06 76 26 5C` is Ip1 to LR at 0 dB: the document's own linear level value. */
const IP1_TO_LR_ZERO_DB = (0x76 << 7) | 0x5c

async function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Poll until `check` produces something, rather than assuming the event loop's pace. */
async function until<T>(check: () => T | undefined, what: string, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = check()
    if (value !== undefined) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await sleep(5)
  }
}

/**
 * A cursor per peer, because the desk decodes fast: asking for the messages that arrived
 * after the last assertion is the only way to wait for a message that may already be in.
 */
const cursors = new Map<DeskPeer, number>()

/** The next `count` messages the desk has not been asked about yet. */
async function take(peer: DeskPeer, count: number): Promise<DeskReceived[]> {
  const from = cursors.get(peer) ?? 0
  await until(
    () => (peer.received.length >= from + count ? true : undefined),
    `${count} messages from the desk, saw ${peer.received.length - from}`
  )
  cursors.set(peer, from + count)
  return peer.received.slice(from, from + count)
}

class DeskClient {
  readonly received: number[] = []
  private cursor = 0
  private waiting: (() => void) | undefined

  constructor(private readonly socket: Socket) {
    this.socket.on('data', (chunk: Buffer) => {
      this.received.push(...chunk)
      this.waiting?.()
    })
  }

  get pending(): number {
    return this.received.length - this.cursor
  }

  send(data: number[] | Uint8Array): void {
    this.socket.write(Buffer.from(data))
  }

  /** One byte per write, the way a client that is timing its frames would send them. */
  async drip(data: number[], delayMs = 1): Promise<void> {
    for (const byte of data) {
      this.send([byte])
      await sleep(delayMs)
    }
  }

  /** The next `count` bytes received, once they have all arrived. */
  async read(count: number): Promise<number[]> {
    const target = this.cursor + count
    await until(
      () =>
        this.received.length >= target
          ? true
          : undefined,
      `${count} bytes from the desk, saw ${this.received.length - this.cursor}`
    )
    const data = this.received.slice(this.cursor, target)
    this.cursor = target
    return data
  }

  close(): void {
    this.socket.destroy()
  }
}

async function connect(port: number): Promise<DeskClient> {
  const socket = createConnection({ host: '127.0.0.1', port })
  const client = new DeskClient(socket)
  await once(socket, 'connect')
  return client
}

/** A peer with one client attached, both closed whatever the test does. */
async function desk(
  options: DeskPeerOptions,
  run: (peer: DeskPeer, client: DeskClient) => Promise<void>
): Promise<void> {
  const peer = await startDeskPeer(options)
  const client = await connect(peer.port)
  try {
    await run(peer, client)
  } finally {
    client.close()
    await peer.close()
  }
}

test.describe('the SQ profile', () => {
  test('recalls a scene with the bank and program change the document gives', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      const before = Date.now()
      client.send(bytes('B0 00 00 C0 06')) // Scene 7, Ch1
      const [scene] = await take(peer, 1)
      expect(scene).toMatchObject({ kind: 'scene', bank: 0x00, program: 0x06, scene: 7 })
      expect(scene.bytes).toEqual(bytes('B0 00 00 C0 06'))
      expect(scene.at).toBeGreaterThanOrEqual(before)
      expect(scene.at).toBeLessThanOrEqual(Date.now())
      expect(peer.state.scene).toBe(7)

      // The desk transmits the same message when a scene is recalled on its own screen.
      peer.recallScene(7)
      expect(await client.read(5)).toEqual(bytes('B0 00 00 C0 06'))

      peer.recallScene(156) // Scene 156, Ch1
      expect(await client.read(5)).toEqual(bytes('B0 00 01 C0 1B'))

      // There is no scene 301 to recall, so nothing is recalled and nothing is sent.
      peer.recallScene(301)
      await sleep(30)
      expect(client.pending).toBe(0)
      expect(peer.state.scene).toBe(156)
    })
  })

  test('walks the scene banks the document gives, on whatever channel the desk is set to', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      client.send(bytes('B0 00 02 C0 2B')) // Scene 300, Ch1
      const [scene] = await take(peer, 1)
      expect(scene).toMatchObject({ kind: 'scene', bank: 0x02, program: 0x2b, scene: 300 })

      peer.recallScene(300)
      expect(await client.read(5)).toEqual(bytes('B0 00 02 C0 2B'))
      peer.recallScene(129)
      expect(await client.read(5)).toEqual(bytes('B0 00 01 C0 00'))
    })

    await desk({ profile: 'sq', midiChannel: 3 }, async (peer, client) => {
      // The option is the channel the desk is set to, 1..16, not the nibble in the status byte.
      expect(peer.midiChannel).toBe(3)
      client.send(bytes('B2 00 01 C2 1B')) // Scene 156, Ch3
      const [scene] = await take(peer, 1)
      expect(scene).toMatchObject({ kind: 'scene', channel: 2, bank: 0x01, program: 0x1b, scene: 156 })
      expect(peer.state.scene).toBe(156)

      peer.recallScene(156)
      expect(await client.read(5)).toEqual(bytes('B2 00 01 C2 1B'))
    })
  })

  test('mutes with the NRPN pair, and toggles and reads back with the same parameter', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      client.send(bytes('B0 63 00 B0 62 00 B0 06 00 B0 26 01')) // Ip1, Mute On
      const [on] = await take(peer, 1)
      expect(on).toMatchObject({ kind: 'mute', channel: 0, note: 0x00, page: 0x00, on: true, label: 'Ip1' })
      // The log carries the whole parameter message, not just its last MIDI message.
      expect(on.bytes).toEqual(bytes('B0 63 00 B0 62 00 B0 06 00 B0 26 01'))
      expect(peer.state.mutes['00:00']).toEqual({ on: true, label: 'Ip1' })

      client.send(bytes('B0 63 00 B0 62 00 B0 06 00 B0 26 00')) // Ip1, Mute Off
      await take(peer, 1)
      expect(peer.state.mutes['00:00']).toEqual({ on: false, label: 'Ip1' })

      client.send(bytes('B0 63 00 B0 62 00 B0 60 00')) // Ip1, Mute Toggle
      await take(peer, 1)
      expect(peer.state.mutes['00:00']?.on).toBe(true)

      client.send(bytes('B0 63 00 B0 62 00 B0 60 7F')) // get Ip1's mute
      expect(await client.read(12)).toEqual(bytes('B0 63 00 B0 62 00 B0 06 00 B0 26 01'))

      peer.setMute(0, 0x00, false) // the desk's own mute key
      expect(await client.read(12)).toEqual(bytes('B0 63 00 B0 62 00 B0 06 00 B0 26 00'))
      expect(peer.state.mutes['00:00']).toEqual({ on: false, label: 'Ip1' })
    })
  })

  test('addresses a mute group on parameter page 04, on the desk MIDI channel', async () => {
    await desk({ profile: 'sq', midiChannel: 7 }, async (peer, client) => {
      peer.setMute(6, 0x03, true, 0x04) // Mute Grp 4, Mute On, Ch7
      expect(await client.read(12)).toEqual(bytes('B6 63 04 B6 62 03 B6 06 00 B6 26 01'))

      client.send(bytes('B6 63 04 B6 62 03 B6 06 00 B6 26 00'))
      const [off] = await take(peer, 1)
      expect(off).toMatchObject({ kind: 'mute', page: 0x04, note: 0x03, label: 'Mute Grp4', on: false })
      expect(peer.state.mutes['04:03']).toEqual({ on: false, label: 'Mute Grp4' })

      // DCAs have a page of their own, so the same LSB is a different parameter.
      client.send(bytes('B6 63 02 B6 62 03 B6 06 00 B6 26 01'))
      const [dca] = await take(peer, 1)
      expect(dca).toMatchObject({ kind: 'mute', page: 0x02, note: 0x03, label: 'DCA4', on: true })
      expect(peer.state.mutes['02:03']).toEqual({ on: true, label: 'DCA4' })
    })
  })

  test('sends a level on the level page under the linear fader law', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      peer.moveFader(0, IP1_TO_LR_ZERO_DB) // Ip1 to LR, 0 dB
      expect(await client.read(12)).toEqual(bytes('B0 63 40 B0 62 00 B0 06 76 B0 26 5C'))
      expect(peer.state.faders['40:00']).toEqual({ value: IP1_TO_LR_ZERO_DB, label: 'Ip1 to LR' })

      client.send(bytes('B0 63 40 B0 62 00 B0 06 63 B0 26 49')) // Ip1 to LR, -20 dB
      const [level] = await take(peer, 1)
      // The same pair read back as a value: 0x63 coarse, 0x49 fine.
      expect(level).toMatchObject({ kind: 'fader', channel: 0, page: 0x40, note: 0x00, value: (0x63 << 7) | 0x49 })
      expect(level.bytes).toEqual(bytes('B0 63 40 B0 62 00 B0 06 63 B0 26 49'))

      // A get answers in the form that sets the parameter. The document describes the get
      // but not its reply, so this asserts the peer's own documented reading of it.
      client.send(bytes('B0 63 40 B0 62 00 B0 60 7F'))
      expect(await client.read(12)).toEqual(bytes('B0 63 40 B0 62 00 B0 06 63 B0 26 49'))
    })
  })

  test('carries the audio fader law as 255 steps over the same pair', async () => {
    await desk({ profile: 'sq', faderLaw: 'audio' }, async (peer, client) => {
      peer.moveFader(0, 196) // Ip1 to LR, 0 dB in the document's audio taper table
      expect(await client.read(12)).toEqual(bytes('B0 63 40 B0 62 00 B0 06 62 B0 26 00'))

      client.send(bytes('B0 63 40 B0 62 00 B0 06 2E B0 26 40')) // Ip1 to LR, -20 dB
      const [level] = await take(peer, 1)
      expect(level).toMatchObject({ kind: 'fader', value: 93 })
      expect(peer.state.faders['40:00']).toEqual({ value: 93, label: 'Ip1 to LR' })
    })
  })

  test('takes soft keys as note messages from C3', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      client.send(bytes('90 30 7F')) // Soft Key #1, press
      const [press] = await take(peer, 1)
      expect(press).toMatchObject({ kind: 'softkey', channel: 0, note: 0x30, on: true, label: 'SoftKey 1' })

      client.send(bytes('80 30 00')) // Soft Key #1, release
      const [release] = await take(peer, 1)
      expect(release).toMatchObject({ kind: 'softkey', channel: 0, note: 0x30, on: false, label: 'SoftKey 1' })

      // "The SQ will respond to both MIDI note off standards", so a note on at zero velocity
      // releases as well.
      client.send(bytes('90 30 00'))
      const [zero] = await take(peer, 1)
      expect(zero).toMatchObject({ kind: 'softkey', on: false, label: 'SoftKey 1' })

      client.send(bytes('94 36 7F')) // Soft Key #7, Ch5
      const [seventh] = await take(peer, 1)
      expect(seventh).toMatchObject({ kind: 'softkey', channel: 4, note: 0x36, label: 'SoftKey 7' })
    })
  })

  test('logs an unknown controller raw instead of guessing at it', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      client.send(bytes('B0 07 64')) // channel volume: not one of the desk's parameters
      const [unknown] = await take(peer, 1)
      expect(unknown).toEqual({ kind: 'raw', at: expect.any(Number), bytes: bytes('B0 07 64') })

      // 7F is past every mute, level and assign parameter on the page the desk was left on.
      client.send(bytes('B0 63 00 B0 62 7F B0 06 00 B0 26 01'))
      const [unmapped] = await take(peer, 1)
      expect(unmapped).toEqual({
        kind: 'raw',
        at: expect.any(Number),
        bytes: bytes('B0 63 00 B0 62 7F B0 06 00 B0 26 01')
      })
      expect(Object.keys(peer.state.mutes)).toHaveLength(0)
    })
  })
})

test.describe('the Avantis profile', () => {
  test('recalls scenes with the bank and program change in the desk MIDI channel', async () => {
    // The document writes the scene message `B N, 00, Bank, C N, SS`; a desk set to MIDI
    // channel 1 puts 0 in the nibble, which is the byte string the worked examples give.
    await desk({ profile: 'avantis', midiChannel: 1 }, async (peer, client) => {
      expect(peer.midiChannel).toBe(1)
      peer.recallScene(1)
      expect(await client.read(5)).toEqual(bytes('B0 00 00 C0 00'))
      peer.recallScene(129)
      expect(await client.read(5)).toEqual(bytes('B0 00 01 C0 00'))
      peer.recallScene(385)
      expect(await client.read(5)).toEqual(bytes('B0 00 03 C0 00'))
    })

    // On the desk's own default — base channel 12, which is why its mute example is `9B` —
    // the same scene carries B in the nibble.
    await desk({ profile: 'avantis' }, async (peer, client) => {
      peer.recallScene(129)
      expect(await client.read(5)).toEqual(bytes('BB 00 01 CB 00'))

      client.send(bytes('BB 00 01 CB 07'))
      const [scene] = await take(peer, 1)
      expect(scene).toMatchObject({ kind: 'scene', bank: 0x01, program: 0x07, scene: 136 })
      expect(peer.state.scene).toBe(136)
    })
  })

  test('mutes with a note on, and ignores velocity 00 and note off', async () => {
    await desk({ profile: 'avantis' }, async (peer, client) => {
      peer.setMute(0x0b, 0x00, true) // Mute on Input 1
      expect(await client.read(6)).toEqual(bytes('9B 00 7F 9B 00 00'))
      peer.setMute(0x0b, 0x00, false)
      expect(await client.read(6)).toEqual(bytes('9B 00 3F 9B 00 00'))

      // The pair is one mute. The desk ignores the trailing note on at velocity 00, and the
      // log shows the message arrived and was ignored rather than dropping it.
      client.send(bytes('9B 00 7F 9B 00 00'))
      const [mute, ignored] = await take(peer, 2)
      expect(mute).toMatchObject({ kind: 'mute', channel: 0x0b, note: 0x00, on: true, label: 'Input 1' })
      expect(ignored).toEqual({ kind: 'raw', at: expect.any(Number), bytes: bytes('9B 00 00') })
      expect(peer.state.mutes['0b:00']).toEqual({ on: true, label: 'Input 1' })

      client.send(bytes('8B 00 00'))
      const [noteOff] = await take(peer, 1)
      expect(noteOff).toEqual({ kind: 'raw', at: expect.any(Number), bytes: bytes('8B 00 00') })
      expect(peer.state.mutes['0b:00']?.on).toBe(true)

      // A DCA key being closed: the message reaches the desk and the desk does nothing.
      client.send(bytes('8F 24 00'))
      const [dcaOff] = await take(peer, 1)
      expect(dcaOff).toEqual({ kind: 'raw', at: expect.any(Number), bytes: bytes('8F 24 00') })
      expect(peer.state.mutes['0f:24']).toBeUndefined()

      // The velocity is the whole message: 3F is still off, 40 is on.
      client.send(bytes('9B 00 3F'))
      await take(peer, 1)
      expect(peer.state.mutes['0b:00']?.on).toBe(false)
      client.send(bytes('9B 00 40'))
      await take(peer, 1)
      expect(peer.state.mutes['0b:00']?.on).toBe(true)

      // A DCA is the same message four channels above the base: base 12, channel 16.
      client.send(bytes('9F 3F 7F'))
      const [dca] = await take(peer, 1)
      expect(dca).toMatchObject({ kind: 'mute', channel: 0x0f, note: 0x3f, on: true, label: 'DCA 10' })
      // Stereo groups are one channel above the base, not four: base 12, channel 13.
      client.send(bytes('9C 40 7F'))
      const [group] = await take(peer, 1)
      expect(group).toMatchObject({ kind: 'mute', channel: 0x0c, note: 0x40, label: 'Stereo Group 1' })
    })
  })

  test('takes a fader as parameter 17, and assignments as 18 and 40', async () => {
    await desk({ profile: 'avantis' }, async (peer, client) => {
      peer.moveFader(0x0b, 100) // Fader Input 1
      expect(await client.read(9)).toEqual(bytes('BB 63 00 BB 62 17 BB 06 64'))

      client.send(bytes('BB 63 00 BB 62 17 BB 06 7F'))
      const [fader] = await take(peer, 1)
      expect(fader).toMatchObject({ kind: 'fader', channel: 0x0b, note: 0x00, page: 0x00, value: 0x7f })
      expect(fader.bytes).toEqual(bytes('BB 63 00 BB 62 17 BB 06 7F'))
      expect(peer.state.faders['0b:00']).toEqual({ value: 0x7f, label: 'Input 1' })

      client.send(bytes('BB 63 00 BB 62 18 BB 06 7F')) // Input 1 to Main, on
      const [assigned] = await take(peer, 1)
      expect(assigned).toMatchObject({ kind: 'assign', parameter: 0x18, value: 0x7f, on: true, label: 'Main' })
      client.send(bytes('BB 63 00 BB 62 18 BB 06 3F'))
      const [unassigned] = await take(peer, 1)
      expect(unassigned).toMatchObject({ kind: 'assign', parameter: 0x18, on: false, label: 'Main' })

      client.send(bytes('BB 63 00 BB 62 40 BB 06 43')) // DCA 4 on
      const [dca] = await take(peer, 1)
      expect(dca).toMatchObject({ kind: 'assign', parameter: 0x40, on: true, label: 'DCA 4' })
      client.send(bytes('BB 63 00 BB 62 40 BB 06 03')) // DCA 4 off
      const [dcaOff] = await take(peer, 1)
      expect(dcaOff).toMatchObject({ kind: 'assign', parameter: 0x40, on: false, label: 'DCA 4' })

      client.send(bytes('BB 63 00 BB 62 40 BB 06 50')) // Mute Group 1 on
      const [group] = await take(peer, 1)
      expect(group).toMatchObject({ kind: 'assign', parameter: 0x40, on: true, label: 'Mute Group 1' })
    })
  })

  test('answers a name and colour request, and keeps both', async () => {
    await desk({ profile: 'avantis' }, async (peer, client) => {
      // Nothing has been set, so the name is empty but the reply is still a name reply. The
      // request is in the log too: the desk logs what it receives, decoded or raw.
      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 01 00 F7'))
      expect(await client.read(12)).toEqual(bytes('F0 00 00 1A 50 10 01 00 0B 02 00 F7'))
      const [request] = await take(peer, 1)
      expect(request).toMatchObject({ kind: 'sysex', data: bytes('F0 00 00 1A 50 10 01 00 0B 01 00 F7') })

      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 03 00 56 4F 43 41 4C F7')) // set "VOCAL"
      const [set] = await take(peer, 1)
      expect(set).toMatchObject({ kind: 'sysex', data: bytes('F0 00 00 1A 50 10 01 00 0B 03 00 56 4F 43 41 4C F7') })
      expect(peer.state.names['0b:00']).toBe('VOCAL')

      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 01 00 F7'))
      expect(await client.read(17)).toEqual(bytes('F0 00 00 1A 50 10 01 00 0B 02 00 56 4F 43 41 4C F7'))
      await take(peer, 1)

      // "up to 8 characters", so a longer name is cut where the strip LCD would cut it.
      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 03 01 49 4E 50 55 54 20 43 48 41 4E 4E 45 4C F7'))
      await take(peer, 1)
      expect(peer.state.names['0b:01']).toBe('INPUT CH')

      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 01 01 F7'))
      expect(await client.read(20)).toEqual(bytes('F0 00 00 1A 50 10 01 00 0B 02 01 49 4E 50 55 54 20 43 48 F7'))
      await take(peer, 1)

      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 06 00 01 F7')) // set Input 1 red
      await take(peer, 1)
      expect(peer.state.colours['0b:00']).toBe(1)

      client.send(bytes('F0 00 00 1A 50 10 01 00 0B 04 00 F7'))
      expect(await client.read(13)).toEqual(bytes('F0 00 00 1A 50 10 01 00 0B 05 00 01 F7'))
    })
  })
})

test.describe('the MIDI framing', () => {
  test('reassembles a message dripped in one byte at a time', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      await client.drip(bytes('B0 63 00 B0 62 00 B0 06 00 B0 26 01'))
      const [mute] = await take(peer, 1)
      expect(mute).toMatchObject({ kind: 'mute', note: 0x00, on: true, label: 'Ip1' })
      expect(peer.state.mutes['00:00']?.on).toBe(true)
    })
  })

  test('reads several messages out of one segment', async () => {
    await desk({ profile: 'sq' }, async (peer, client) => {
      client.send(bytes('B0 00 00 C0 06 90 30 7F'))
      const received = await take(peer, 2)
      expect(received[0]).toMatchObject({ kind: 'scene', scene: 7 })
      expect(received[1]).toMatchObject({ kind: 'softkey', note: 0x30, on: true })
    })
  })

  test('parses the running status the Avantis document shows, and emits it', async () => {
    await desk({ profile: 'avantis' }, async (peer, client) => {
      client.send(bytes('9B 00 7F 01 7F 02 7F')) // three mutes, status byte sent once
      const received = await take(peer, 3)
      expect(received.map((message) => (message.kind === 'mute' ? message.label : ''))).toEqual([
        'Input 1',
        'Input 2',
        'Input 3'
      ])
      expect(Object.keys(peer.state.mutes).sort()).toEqual(['0b:00', '0b:01', '0b:02'])

      // The document contrasts the two forms; a client has to read both, and the peer writes
      // the short one when it reports a run of its own.
      const three: number[][] = [
        [0x9b, 0x00, 0x7f],
        [0x9b, 0x01, 0x7f],
        [0x9b, 0x02, 0x7f]
      ]
      expect(encodeMessages(three)).toEqual(bytes('9B 00 7F 9B 01 7F 9B 02 7F'))
      peer.emit(encodeMessages(three, true))
      expect(await client.read(7)).toEqual(bytes('9B 00 7F 01 7F 02 7F'))
    })
  })

  test('reassembles a SysEx run split in the middle of it', async () => {
    await desk({ profile: 'avantis' }, async (peer, client) => {
      const name = bytes('F0 00 00 1A 50 10 01 00 0B 03 00 56 4F 43 41 4C F7')
      client.send(name.slice(0, 12))
      await sleep(20)
      expect(peer.received).toHaveLength(0)
      client.send(name.slice(12))
      await take(peer, 1)
      expect(peer.state.names['0b:00']).toBe('VOCAL')

      // A run a status byte interrupts never became a message, so it is the bytes it arrived as.
      client.send(bytes('F0 00 00 1A 50'))
      client.send(bytes('B0 07 64'))
      const interrupts = await take(peer, 2)
      expect(interrupts[0]).toEqual({ kind: 'raw', at: expect.any(Number), bytes: bytes('F0 00 00 1A 50') })
      expect(interrupts[1]).toEqual({ kind: 'raw', at: expect.any(Number), bytes: bytes('B0 07 64') })
    })
  })

  test('a burst of state is well-formed MIDI, and a client that drains it gets the desk', async () => {
    const sender = await startDeskPeer({ profile: 'sq' })
    const receiver = await startDeskPeer({ profile: 'sq' })
    const client = await connect(receiver.port)
    try {
      sender.recallScene(7)
      sender.setMute(0, 0x00, true)
      sender.moveFader(0, IP1_TO_LR_ZERO_DB)

      const drain = await connect(sender.port)
      sender.emitConnectBurst()
      const burst = await drain.read(22)
      drain.close()

      expect(burst).toEqual(bytes('B0 00 00 C0 06 B0 63 00 62 00 06 00 26 01 63 40 62 00 06 76 26 5C'))
      // Running status leaves the repeats out: one B0 covers every controller in the burst.
      expect(burst.filter((byte) => byte === 0xb0)).toHaveLength(2)

      client.send(burst)
      await take(receiver, 3)
      expect(receiver.state).toEqual(sender.state)
    } finally {
      client.close()
      await sender.close()
      await receiver.close()
    }
  })

  test('the Avantis burst is a state report one desk can read back', async () => {
    const sender = await startDeskPeer({ profile: 'avantis' })
    const receiver = await startDeskPeer({ profile: 'avantis' })
    const client = await connect(receiver.port)
    let drain: DeskClient | undefined
    try {
      sender.recallScene(129)
      sender.setMute(0x0b, 0x00, true)
      sender.moveFader(0x0b, 100)

      drain = await connect(sender.port)
      sender.emitConnectBurst()

      const burst = await drain.read(17)
      expect(burst).toEqual(bytes('BB 00 01 CB 00 9B 00 7F 00 00 BB 63 00 62 17 06 64'))

      client.send(burst)
      // Scene, mute, fader — and the mute's own trailing note on, which the desk ignores and
      // logs as raw.
      await take(receiver, 4)
      expect(receiver.state).toEqual(sender.state)
    } finally {
      drain?.close()
      client.close()
      await sender.close()
      await receiver.close()
    }
  })

  test('one desk is one desk, however many clients are connected', async () => {
    await desk({ profile: 'avantis' }, async (peer, first) => {
      first.send(bytes('B0 00 01 C0 07'))
      first.send(bytes('9B 02 7F'))
      await take(peer, 2)

      const second = await connect(peer.port)
      try {
        expect(peer.clients).toBe(2)
        expect(peer.state.scene).toBe(136)
        expect(peer.state.mutes['0b:02']?.on).toBe(true)
      } finally {
        second.close()
      }
    })
  })

  test('a stream the desk cannot make sense of does not take the desk down', async () => {
    await desk({ profile: 'avantis' }, async (peer, client) => {
      client.send([0xff, 0x00, 0x40, 0xf0, 0x7f, 0x7f, 0x06, 0x90, 0x36, 0x7f])
      await sleep(30)
      client.send(bytes('9B 00 7F'))
      const mute = await until(
        () => peer.received.find((message) => message.kind === 'mute' && message.label === 'Input 1'),
        'the mute after the garbage'
      )
      expect(mute).toMatchObject({ kind: 'mute', note: 0x00, on: true, label: 'Input 1' })
    })
  })
})

test('the peer serves its state as JSON for a human with curl', async () => {
  const peer = await startDeskPeer({ profile: 'avantis', controlPort: 0 })
  const client = await connect(peer.port)
  try {
    client.send(bytes('B0 00 01 C0 00'))
    client.send(bytes('9B 00 7F'))
    await take(peer, 2)

    const response = await fetch(`http://127.0.0.1:${peer.controlPort}/`)
    expect(response.status).toBe(200)
    const view = (await response.json()) as { profile: string; state: DeskPeer['state'] }
    expect(view.profile).toBe('avantis')
    expect(view.state.scene).toBe(129)
    expect(view.state.mutes['0b:00']).toEqual({ on: true, label: 'Input 1' })
  } finally {
    client.close()
    await peer.close()
  }
})
