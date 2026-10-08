// The lighting service as the host addresses it: by id, over `show:command`, refused whole on a
// machine without a licence, and refusing a payload it cannot read with a sentence.
import { describe, expect, it, vi } from 'vitest'
import { DmxService } from './DmxService'
import { ServiceHost } from '../bus/ServiceHost'
import { ShowBus } from '../bus/ShowBus'
import { DmxLighting } from '../dmx/lighting'
import { DmxEngine } from '../dmx/engine'
import { createMachineDmx } from '../dmx/machine'
import { defaultShowSettings } from '../../shared/show'
import type { DmxGo, DmxMonitor } from '../../shared/dmxWire'

function service(now = 0): { service: DmxService; lighting: DmxLighting; engine: DmxEngine } {
  const engine = new DmxEngine()
  const lighting = new DmxLighting({
    engine,
    machine: createMachineDmx({ cid: '00000000-0000-4000-8000-000000000001' }),
    interfaces: () => [
      { name: 'eth0', address: '10.0.0.5', netmask: '255.255.255.0', broadcast: '10.0.0.255', internal: false }
    ],
    now: () => now
  })
  return { service: new DmxService(lighting), lighting, engine }
}

const GO: DmxGo = {
  cueId: 'cue-1',
  values: [{ u: 1, s: 0, f: null, i: true, h: 0, v: 1 }],
  fadeMs: 0,
  curve: 'linear',
  htp: false,
  effects: []
}

describe('the lighting service', () => {
  it('is Pro, reads no show settings, and is addressed as dmx', () => {
    const { service: dmx } = service()
    expect(dmx.id).toBe('dmx')
    expect(dmx.pro).toBe(true)
    expect(dmx.settingsSections).toEqual([])
  })

  it('takes a cue’s GO, and the monitor reads the level back', async () => {
    const { service: dmx } = service()
    await dmx.command('go', GO)
    const monitor = (await dmx.command('monitor', { universes: [1] })) as DmxMonitor
    expect(monitor.frames[0].output[0]).toBe(255)
    expect(monitor.holding).toEqual(['cue-1'])
    expect(monitor.universes).toEqual([1])
  })

  it('stops, releases and levels a cue by id', async () => {
    const { service: dmx, engine } = service()
    await dmx.command('go', GO)
    await dmx.command('level', { cueId: 'cue-1', level: 0.5, fadeMs: 0, curve: 'linear' })
    expect(engine.render(1, 0)[0]).toBe(128)
    await dmx.command('release', { cueId: 'cue-1', fadeMs: 0, curve: 'linear' })
    expect(engine.render(1, 0)[0]).toBe(0)
    await dmx.command('stop', { cueId: 'cue-1' })
  })

  it('refuses a payload it cannot read, naming what is wrong', async () => {
    const { service: dmx } = service()
    await expect(dmx.command('go', { ...GO, fadeMs: -1 })).rejects.toThrow(/fade/)
    await expect(dmx.command('go', { ...GO, values: [{ u: 1, s: 512, f: null, i: true, h: 0, v: 1 }] })).rejects.toThrow(
      /slot/
    )
    await expect(dmx.command('configure', { outputs: 'all' })).rejects.toThrow(/outputs/)
    await expect(dmx.command('launch')).rejects.toThrow(/no action "launch"/)
  })

  it('lists the machine’s interfaces and keeps the choice with the machine', async () => {
    const { service: dmx } = service()
    expect(await dmx.command('interfaces')).toMatchObject({ selected: null, missing: false })
    expect(await dmx.command('setInterface', { name: 'eth0' })).toMatchObject({ selected: 'eth0' })
    await expect(dmx.command('setInterface', { name: 'wlan9' })).rejects.toThrow(/no interface called wlan9/)
  })

  it('panics only while it is sending: an unlicensed machine has no lights of its own', async () => {
    const { service: dmx, engine } = service()
    await dmx.command('configure', { outputs: [], inputs: [], sync: false, syncUniverse: 63999, panic: 'blackout' })
    await dmx.command('go', GO)
    await dmx.command('panic')
    expect(engine.blackout).toBe(false)
  })
})

describe('the lighting behind the licence', () => {
  it('is refused by the host on a machine without a key, and taken with one', async () => {
    const bus = new ShowBus()
    let licensed = false
    const host = new ServiceHost(bus, () => licensed)
    const { service: dmx, lighting } = service()
    host.register(dmx)
    await host.startAll(defaultShowSettings())
    expect(lighting.running).toBe(false)
    expect(host.status('dmx')?.detail).toMatch(/part of Cuerunner Pro/)
    const refused = await host.command('dmx', 'go', GO)
    expect(refused).toEqual({ ok: false, error: 'Lighting (sACN / Art-Net) is part of Cuerunner Pro' })

    licensed = true
    await host.startAll(defaultShowSettings(), { entitlementOnly: true })
    expect(lighting.running).toBe(true)
    expect(await host.command('dmx', 'go', GO)).toEqual({ ok: true, result: null })
    // A configure reconfigures; it never restarts the stream.
    const stop = vi.spyOn(dmx, 'stop')
    await host.startChanged({ ...defaultShowSettings(), oscIn: { enabled: false, port: 1 } })
    expect(stop).not.toHaveBeenCalled()
    await host.stopAll()
    bus.close()
  })
})
