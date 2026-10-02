import { describe, it, expect } from 'vitest'
import { isAdded, labelFor, targetFor } from './ewdx'
import type { TelemetrySource } from '../../../shared/show'

const source = (target: string, kind: TelemetrySource['kind'] = 'ew-dx'): TelemetrySource => ({
  id: target,
  label: 'Rack',
  kind,
  target,
  pollMs: 2000,
  timeoutMs: 1500
})

const found = { address: '192.168.0.194', port: 443 }

describe('targetFor', () => {
  it('is the bare address on the usual port, and says the port when it is not', () => {
    expect(targetFor(found)).toBe('192.168.0.194')
    expect(targetFor({ address: '10.0.0.7', port: 8443 })).toBe('10.0.0.7:8443')
  })
})

describe('isAdded', () => {
  it('knows a receiver is added however its address was typed', () => {
    for (const typed of ['192.168.0.194', ' 192.168.0.194 ', 'https://192.168.0.194', 'https://192.168.0.194:443/api', '192.168.0.194:443']) {
      expect(isAdded([source(typed)], found), typed).toBe(true)
    }
  })

  it('is not fooled by another address, another port, or a source of another kind', () => {
    expect(isAdded([source('192.168.0.195')], found)).toBe(false)
    expect(isAdded([source('192.168.0.194:8443')], found)).toBe(false)
    expect(isAdded([source('192.168.0.194', 'http')], found)).toBe(false)
    expect(isAdded([source('')], found)).toBe(false)
    expect(isAdded([], found)).toBe(false)
  })
})

describe('labelFor', () => {
  const receiver = { model: 'EW-DX EM 4 Dante', name: 'EWDXEM4D-001B663BDD13' }

  it('is the model when nothing else has it', () => {
    expect(labelFor(receiver, ['Demo rack'])).toBe('EW-DX EM 4 Dante')
  })

  it('tells a second receiver of the same model apart by the end of its name', () => {
    expect(labelFor(receiver, ['EW-DX EM 4 Dante'])).toBe('EW-DX EM 4 Dante DD13')
  })

  it('does not hand out the same label twice even then', () => {
    expect(labelFor(receiver, ['EW-DX EM 4 Dante', 'EW-DX EM 4 Dante DD13'])).toBe('EW-DX EM 4 Dante DD13 (2)')
  })
})
