// A machine setting changed in the window shows at once, before main has written it and
// restarted the receiver: bound to main's answer instead, a control snapped back under the
// hand that changed it on a machine whose disk and sockets are slow (the Windows lane).
import { afterEach, describe, expect, it, vi } from 'vitest'
import { configureTimecode, setTimecodeSettings, timecodeSettings } from './timecodeStatus'
import { defaultTimecodeSettings } from '../../../shared/timecode'

afterEach(() => vi.clearAllMocks())

describe('configureTimecode', () => {
  it('shows the change before main answers, then keeps what main accepted', async () => {
    setTimecodeSettings(defaultTimecodeSettings())
    const answer = Promise.withResolvers<ReturnType<typeof defaultTimecodeSettings>>()
    vi.mocked(window.cuerunner.timecode.configure).mockReturnValueOnce(answer.promise)

    const pending = configureTimecode({ source: 'artnet', artnetPort: 70_000 })
    expect(timecodeSettings()).toMatchObject({ source: 'artnet', artnetPort: 70_000 })

    answer.resolve({ ...defaultTimecodeSettings(), source: 'artnet', artnetPort: 65535 })
    await pending
    expect(timecodeSettings()).toMatchObject({ source: 'artnet', artnetPort: 65535 })
  })

  it('puts the settings back when main could not take them', async () => {
    setTimecodeSettings(defaultTimecodeSettings())
    vi.mocked(window.cuerunner.timecode.configure).mockRejectedValueOnce(new Error('the disk is full'))

    await expect(configureTimecode({ source: 'mtc' })).rejects.toThrow('the disk is full')
    expect(timecodeSettings()).toEqual(defaultTimecodeSettings())
  })
})
