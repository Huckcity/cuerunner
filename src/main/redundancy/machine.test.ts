// A machine's own half of a pair: what it is called, which half it is, and where the
// other one is. The file is the machine's, not the show's — both machines run the same
// workspace — and a show must open whatever it says.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMachineRedundancy } from './machine'

function machineFile(text?: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'cuerunner-redundancy-'))
  const file = join(dir, 'redundancy.json')
  if (text !== undefined) writeFileSync(file, text)
  return file
}

describe('a machine’s redundancy settings', () => {
  it('starts off, called by its host name, with an id of its own', () => {
    const machine = createMachineRedundancy({ filePath: machineFile(), name: 'desk-a', id: 'id-a' })
    expect(machine.current()).toMatchObject({
      enabled: false,
      name: 'desk-a',
      id: 'id-a',
      role: 'live',
      peerHost: '',
      takeover: 'manual'
    })
  })

  it('keeps what the operator set when the machine next starts', async () => {
    const file = machineFile()
    const first = createMachineRedundancy({ filePath: file, name: 'desk-a', id: 'id-a' })
    await first.update({ enabled: true, role: 'standby', peerHost: '10.0.0.9', token: 'sekrit' })

    const second = createMachineRedundancy({ filePath: file, name: 'desk-a', id: 'id-a' })
    expect(second.current()).toMatchObject({
      enabled: true,
      role: 'standby',
      peerHost: '10.0.0.9',
      token: 'sekrit'
    })
    // The id is what the pair resolves its two sockets with, so the second run must not
    // mint a new one and become a stranger to the partner that was talking to it.
    expect(second.current().id).toBe('id-a')
  })

  it('writes down what it accepted rather than what it was handed', async () => {
    const file = machineFile()
    const machine = createMachineRedundancy({ filePath: file, name: 'desk-a', id: 'id-a' })
    await machine.update({ port: 999_999, timeoutMs: 10, name: '  ' })
    const written = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    expect(written.port).toBe(53110)
    expect(written.timeoutMs).toBe(1000)
    expect(written.name).toBe('desk-a')
  })

  it('opens a show on the defaults when its own file cannot be read', () => {
    const broken = createMachineRedundancy({ filePath: machineFile('{ not json'), name: 'desk-a', id: 'id-a' })
    expect(broken.current()).toMatchObject({ enabled: false, name: 'desk-a', id: 'id-a' })
    const array = createMachineRedundancy({ filePath: machineFile('[1,2,3]'), name: 'desk-a', id: 'id-a' })
    expect(array.current().enabled).toBe(false)
  })
})
