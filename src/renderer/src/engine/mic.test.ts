// The bridge between a mic cue and the receiver. What matters here is that an `ok` means a mic that
// is closed — the receiver is asked afterwards, in main — and that every other outcome is an error
// with words, never a silent success.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendMic } from './mic'
import type { MicCue } from '../../../shared/cue'

const cue = (overrides: Partial<MicCue> = {}): MicCue => ({
  id: 'm1', number: '12', name: 'Mic Cue', type: 'mic',
  colorLabel: 'none', parentId: null, preWait: 0, postWait: 0, timelineOffset: 0, duration: 0,
  advance: 'none', isArmed: true, notes: '',
  channelId: 'ew-dx:5364000906:0', label: 'Aldonza (37)', action: 'mute',
  ...overrides
})

afterEach(() => vi.clearAllMocks())

describe('sendMic', () => {
  it('asks the wireless service to mute the channel, and says ok only when it did', async () => {
    vi.mocked(window.cuerunner.show.command).mockResolvedValue({ ok: true, result: {} })

    await expect(sendMic(cue())).resolves.toEqual({ ok: true })

    expect(window.cuerunner.show.command).toHaveBeenCalledWith('rf', 'mute', { channelId: 'ew-dx:5364000906:0', mute: true })
  })

  it('unmutes with the same command turned the other way, and never as a toggle', async () => {
    vi.mocked(window.cuerunner.show.command).mockResolvedValue({ ok: true })

    await sendMic(cue({ action: 'unmute' }))

    expect(window.cuerunner.show.command).toHaveBeenCalledWith('rf', 'mute', { channelId: 'ew-dx:5364000906:0', mute: false })
  })

  it('says what the service said when the mic was not muted', async () => {
    vi.mocked(window.cuerunner.show.command).mockResolvedValue({ ok: false, error: 'receiver said yes and is not muted' })

    await expect(sendMic(cue())).resolves.toEqual({ ok: false, error: 'receiver said yes and is not muted' })
  })

  it('says something even when the service said nothing', async () => {
    vi.mocked(window.cuerunner.show.command).mockResolvedValue({ ok: false })

    expect(await sendMic(cue())).toEqual({ ok: false, error: 'the receiver did not take it' })
  })

  it('turns a bridge that throws into the same thing: an error with words', async () => {
    vi.mocked(window.cuerunner.show.command).mockRejectedValue(new Error('the bridge fell over'))

    expect(await sendMic(cue())).toEqual({ ok: false, error: 'the bridge fell over' })
  })

  it('sends nothing for a cue aimed at no mic', async () => {
    expect(await sendMic(cue({ channelId: '' }))).toEqual({ ok: false, error: 'no mic chosen' })
    expect(window.cuerunner.show.command).not.toHaveBeenCalled()
  })
})
