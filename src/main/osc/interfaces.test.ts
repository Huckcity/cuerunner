// Which interface OSC listens and sends on: the machine's choice, kept in osc.json, found again
// by name or by the address it had, refused when it names an interface the machine has not got,
// and said when the one it names has gone.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMachineOsc } from './machine'
import { createOscInterfaces } from './interfaces'
import type { DmxInterface } from '../../shared/dmxWire'
import { Refusal } from '../ipc/refusal'

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'feat-control-osc-'))
  dirs.push(dir)
  return dir
}

const lan = (name: string, address: string): DmxInterface =>
  ({ name, address, netmask: '255.255.255.0', broadcast: address.replace(/\.\d+$/, '.255'), internal: false })

describe('this machine’s OSC interfaces', () => {
  it('starts unpinned, which listens and sends on any interface as it always did', () => {
    const interfaces = createOscInterfaces({
      machine: createMachineOsc(),
      read: () => [lan('eth0', '10.0.0.2')],
      restartInput: vi.fn(),
      rebindOutput: vi.fn()
    })
    expect(interfaces.input()).toEqual({ address: null, name: null, missing: false })
    expect(interfaces.outputAddress()).toBeNull()
    expect(interfaces.state().input).toEqual({ selected: null, boundAddress: null, missing: false })
  })

  it('pins each direction on its own, keeps it in osc.json, and rebinds what moved', async () => {
    const file = join(folder(), 'osc.json')
    const restartInput = vi.fn(async () => {})
    const rebindOutput = vi.fn()
    const interfaces = createOscInterfaces({
      machine: createMachineOsc({ filePath: file }),
      read: () => [lan('eth0', '10.0.0.2'), lan('eth1', '192.168.1.5')],
      restartInput,
      rebindOutput
    })
    await interfaces.set('in', 'eth1')
    expect(restartInput).toHaveBeenCalledTimes(1)
    expect(rebindOutput).not.toHaveBeenCalled()
    expect(interfaces.input()).toEqual({ address: '192.168.1.5', name: 'eth1', missing: false })
    expect(interfaces.outputAddress()).toBeNull()

    await interfaces.set('out', 'eth0')
    expect(rebindOutput).toHaveBeenCalledTimes(1)
    expect(interfaces.outputAddress()).toBe('10.0.0.2')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
      inputInterface: 'eth1', inputAddress: '192.168.1.5', outputInterface: 'eth0', outputAddress: '10.0.0.2'
    })

    // Read back by the next run of the app.
    const again = createMachineOsc({ filePath: file })
    expect(again.current().inputInterface).toBe('eth1')
  })

  it('refuses an interface this machine has not got, and changes nothing', async () => {
    const restartInput = vi.fn(async () => {})
    const interfaces = createOscInterfaces({
      machine: createMachineOsc(),
      read: () => [lan('eth0', '10.0.0.2')],
      restartInput,
      rebindOutput: vi.fn()
    })
    await expect(interfaces.set('in', 'wlan9')).rejects.toBeInstanceOf(Refusal)
    await expect(interfaces.set('in', 'wlan9')).rejects.toThrow('there is no network interface called “wlan9” on this machine')
    expect(restartInput).not.toHaveBeenCalled()
  })

  it('finds a renamed adapter by its address, and says when neither is here', async () => {
    let present = [lan('eth1', '192.168.1.5')]
    const interfaces = createOscInterfaces({
      machine: createMachineOsc(),
      read: () => present,
      restartInput: async () => {},
      rebindOutput: vi.fn()
    })
    await interfaces.set('in', 'eth1')
    present = [lan('enp3s0', '192.168.1.5')]
    expect(interfaces.input()).toEqual({ address: '192.168.1.5', name: 'eth1', missing: false })
    present = [lan('enp3s0', '10.9.9.9')]
    expect(interfaces.input()).toEqual({ address: null, name: 'eth1', missing: true })
    expect(interfaces.state().input).toEqual({ selected: 'eth1', boundAddress: null, missing: true })
  })

  it('reads a file that is not this machine’s as no choice at all', () => {
    const file = join(folder(), 'osc.json')
    writeFileSync(file, JSON.stringify({ inputInterface: 7, inputAddress: 'not an address', outputInterface: 'eth0', outputAddress: '999' }))
    // A name that is not text is no choice; an address that is not one is dropped, and the
    // name is still found by itself.
    expect(createMachineOsc({ filePath: file }).current()).toEqual({
      inputInterface: null, inputAddress: null, outputInterface: 'eth0', outputAddress: null
    })
    writeFileSync(file, 'not json')
    expect(createMachineOsc({ filePath: file }).current().inputInterface).toBeNull()
  })
})
