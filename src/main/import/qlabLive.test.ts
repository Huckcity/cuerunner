import { afterEach, describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { listQLabWorkspaces, readLiveWorkspace } from './qlabLive'
import { startFakeQLab, type FakeQLab, type FakeWorkspace } from './fakeQLab'

const WORKSPACE: FakeWorkspace = {
  id: 'WS-1',
  name: 'Press Night.qlab5',
  version: '5.4.1',
  lists: [{
    uniqueID: 'L1',
    name: 'Main Cue List',
    cues: [
      {
        uniqueID: 'A1', number: '1', name: 'Walk-in', type: 'Audio', colorName: 'green',
        values: {
          notes: 'House open', preWait: 0, postWait: 2, continueMode: 1, fileTarget: '/Users/sm/Show/audio/walk-in.wav',
          startTime: 1.5, endTime: 30, playCount: 2, infiniteLoop: false, rate: 1, sliderLevels: [-6.0206, 0, -60]
        }
      },
      {
        uniqueID: 'F2', number: '2', name: 'Fade out', type: 'Fade',
        values: { cueTargetID: 'A1', cueTargetNumber: '1', duration: 5, sliderLevels: [-120], stopTargetWhenDone: true }
      },
      {
        uniqueID: 'G3', number: '3', name: 'Stack', type: 'Group', values: { mode: 3 },
        cues: [
          { uniqueID: 'M31', number: '3.1', name: 'LX', type: 'MIDI', values: { messageType: 2, commandFormat: 1, command: 1, deviceID: 1, qNumber: '5', qList: '' } },
          { uniqueID: 'N32', number: '3.2', name: 'Ping', type: 'Network', values: { customString: '/ping 1', preWait: 0.5 } }
        ]
      },
      { uniqueID: 'V4', number: '4', name: 'Film', type: 'Video', armed: false, values: { fileTarget: '/Users/sm/Show/video/a.mov' } }
    ]
  }]
}

let qlab: FakeQLab | null = null

afterEach(async () => {
  await qlab?.close()
  qlab = null
})

describe('a running QLab, over OSC', () => {
  it('lists the workspaces it has open', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE, { ...WORKSPACE, id: 'WS-2', name: 'Locked.qlab5', passcode: '4321' }] })
    expect(await listQLabWorkspaces('127.0.0.1', qlab.port)).toEqual([
      { id: 'WS-1', name: 'Press Night.qlab5', hasPasscode: false, version: '5.4.1' },
      { id: 'WS-2', name: 'Locked.qlab5', hasPasscode: true, version: '5.4.1' }
    ])
  })

  it('reads every cue of a workspace, cue by cue, into the same record a file gives', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE] })
    const show = await readLiveWorkspace('127.0.0.1', qlab.port, 'WS-1', undefined)
    expect(show.name).toBe('Press Night')
    expect(show.baseDir).toBeNull()
    const [walkIn, fade, group, film] = show.lists[0].cues
    expect(walkIn).toMatchObject({
      kind: 'audio', uniqueID: 'A1', number: '1', name: 'Walk-in', colorName: 'green', notes: 'House open',
      postWait: 2, continueMode: 1, media: { relative: '', absolute: '/Users/sm/Show/audio/walk-in.wav' },
      startTime: 1.5, endTime: 30, playCount: 2
    })
    expect(walkIn.levels?.master).toBeCloseTo(0.5, 3)
    expect(walkIn.levels?.right).toBe(0)
    expect(fade).toMatchObject({ kind: 'fade', target: { uniqueID: 'A1', number: '1' }, duration: 5, fadeTo: { master: 0 }, stopTargetWhenDone: true })
    expect(group).toMatchObject({ kind: 'group', groupMode: 3 })
    expect(group.children?.[0].midi?.msc).toEqual({ format: 1, command: 1, deviceId: 1, cueNumber: '5', cueList: '' })
    expect(group.children?.[1]).toMatchObject({ kind: 'network', preWait: 0.5, network: { kind: 'osc', message: '/ping 1' } })
    expect(film).toMatchObject({ kind: 'video', armed: false })
    // One connection, asked in order: what is open, connect, the tree, then each cue.
    expect(qlab.requests.slice(0, 3)).toEqual(['/workspaces', '/workspace/WS-1/connect', '/workspace/WS-1/cueLists'])
    expect(qlab.requests.filter(address => address.endsWith('/valuesForKeys'))).toHaveLength(6)
  })

  it('matches replies whether or not QLab keeps the workspace in their address', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE], keepPrefix: true })
    const show = await readLiveWorkspace('127.0.0.1', qlab.port, 'WS-1', undefined)
    expect(show.lists[0].cues).toHaveLength(4)
  })

  it('asks again for what every cue has when QLab refuses a type’s keys, so the cue keeps its timing', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE], unknownKeys: ['sliderLevels'] })
    const show = await readLiveWorkspace('127.0.0.1', qlab.port, 'WS-1', undefined)
    const [walkIn] = show.lists[0].cues
    expect(walkIn).toMatchObject({ postWait: 2, continueMode: 1, notes: 'House open' })
    expect(walkIn.media).toBeUndefined()
    expect(qlab.requests.filter(address => address === '/workspace/WS-1/cue_id/A1/valuesForKeys')).toHaveLength(2)
  })

  it('sends a passcode, and says so when QLab refuses it', async () => {
    qlab = await startFakeQLab({ workspaces: [{ ...WORKSPACE, passcode: '4321' }] })
    await expect(readLiveWorkspace('127.0.0.1', qlab.port, 'WS-1', '0000'))
      .rejects.toThrow(`QLab at 127.0.0.1:${qlab.port} did not accept that passcode`)
    await expect(readLiveWorkspace('127.0.0.1', qlab.port, 'WS-1', undefined))
      .rejects.toThrow('that workspace has a passcode: type it in and import again')
    expect((await readLiveWorkspace('127.0.0.1', qlab.port, 'WS-1', '4321')).lists[0].cues).toHaveLength(4)
  })

  it('says when the workspace is no longer open', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE] })
    await expect(readLiveWorkspace('127.0.0.1', qlab.port, 'WS-GONE', undefined))
      .rejects.toThrow(`QLab at 127.0.0.1:${qlab.port} no longer has that workspace open`)
  })

  it('says nothing is listening when nothing is', async () => {
    // A port that was just free: bound, read, and released.
    const probe = createServer()
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve))
    const port = (probe.address() as { port: number }).port
    await new Promise<void>(resolve => probe.close(() => resolve()))
    await expect(listQLabWorkspaces('127.0.0.1', port)).rejects.toThrow(`no QLab answered at 127.0.0.1:${port}: nothing is listening there`)
  })

  it('gives up on a QLab that stops answering, with a sentence rather than a hang', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE], silent: true })
    await expect(listQLabWorkspaces('127.0.0.1', qlab.port, { replyTimeoutMs: 200 }))
      .rejects.toThrow(`QLab at 127.0.0.1:${qlab.port} stopped answering (/workspaces had no reply in 0.2 seconds)`)
  })

  it('refuses a reply larger than any QLab sends, before buffering the rest', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE], flood: 4096 })
    await expect(listQLabWorkspaces('127.0.0.1', qlab.port, { maxFrameBytes: 1024 }))
      .rejects.toThrow(/sent something that is not OSC: a packet is larger than a QLab reply is/)
  })

  it('stops reading a conversation that has gone past what an import reads', async () => {
    qlab = await startFakeQLab({ workspaces: [WORKSPACE], flood: 4096 })
    await expect(listQLabWorkspaces('127.0.0.1', qlab.port, { maxTotalBytes: 1000 }))
      .rejects.toThrow(/sent more than an import reads/)
  })
})
