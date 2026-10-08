// The remote's grammar: which addresses move the transport, in this app's namespace and in
// QLab's, and which senders the port hears at all. Pure, so it is pinned here without a
// socket — both processes read the same answers.
import { describe, it, expect } from 'vitest'
import { isAllowEntry, parseRemote, remoteEnabled, senderAllowed, senderHost } from './oscRemote'

describe('parseRemote', () => {
  it('reads the bare transport verbs QLab remotes send', () => {
    expect(parseRemote('/go')).toEqual({ kind: 'go' })
    expect(parseRemote('/stop')).toEqual({ kind: 'stop' })
    expect(parseRemote('/panic')).toEqual({ kind: 'panic' })
    // QLab's hard stop is this app's STOP: everything cut where it stands.
    expect(parseRemote('/hardStop')).toEqual({ kind: 'stop' })
  })

  it('reads pause, resume and the toggle in either dictionary’s spelling', () => {
    expect(parseRemote('/pause')).toEqual({ kind: 'pause' })
    expect(parseRemote('/resume')).toEqual({ kind: 'resume' })
    expect(parseRemote('/togglePause')).toEqual({ kind: 'toggle-pause' })
    expect(parseRemote('/cuerunner/pause_toggle')).toEqual({ kind: 'toggle-pause' })
    expect(parseRemote('/cue/7/pause')).toEqual({ kind: 'cue-pause', cue: { by: 'number', number: '7' } })
    expect(parseRemote('/cue/7/resume')).toEqual({ kind: 'cue-resume', cue: { by: 'number', number: '7' } })
    expect(parseRemote('/cue/selected/togglePause')).toEqual({ kind: 'cue-toggle-pause', cue: { by: 'selected' } })
  })

  it('reads the same verbs under Cuerunner’s own prefix', () => {
    expect(parseRemote('/cuerunner/go')).toEqual({ kind: 'go' })
    expect(parseRemote('/cuerunner/hardstop')).toEqual({ kind: 'stop' })
    expect(parseRemote('/cuerunner/hard_stop')).toEqual({ kind: 'stop' })
    expect(parseRemote('/cuerunner/panic')).toEqual({ kind: 'panic' })
  })

  it('strips the workspace prefix a QLab remote puts in front of every address', () => {
    expect(parseRemote('/workspace/9F2A-11/go')).toEqual({ kind: 'go' })
    expect(parseRemote('/workspace/abc/cue/12/start')).toEqual({
      kind: 'cue-start', cue: { by: 'number', number: '12' }
    })
  })

  it('walks the selection with next and previous, in either dictionary’s words', () => {
    expect(parseRemote('/select/next')).toEqual({ kind: 'select-next' })
    expect(parseRemote('/select/previous')).toEqual({ kind: 'select-previous' })
    expect(parseRemote('/playhead/next')).toEqual({ kind: 'select-next' })
    expect(parseRemote('/playhead/previous')).toEqual({ kind: 'select-previous' })
    expect(parseRemote('/cuerunner/select/prev')).toEqual({ kind: 'select-previous' })
  })

  it('reads QLab’s /select/{number} as standing on that cue', () => {
    expect(parseRemote('/select/4.5')).toEqual({ kind: 'cue-select', cue: { by: 'number', number: '4.5' } })
  })

  it('names a cue by its number, as the list shows it', () => {
    expect(parseRemote('/cue/12/go')).toEqual({ kind: 'cue-go', cue: { by: 'number', number: '12' } })
    expect(parseRemote('/cue/12/start')).toEqual({ kind: 'cue-start', cue: { by: 'number', number: '12' } })
    expect(parseRemote('/cue/1.5/stop')).toEqual({ kind: 'cue-stop', cue: { by: 'number', number: '1.5' } })
    expect(parseRemote('/cue/Intro/hardStop')).toEqual({ kind: 'cue-stop', cue: { by: 'number', number: 'Intro' } })
    expect(parseRemote('/cuerunner/cue/3/select')).toEqual({ kind: 'cue-select', cue: { by: 'number', number: '3' } })
  })

  it('reads selected and playhead as the cue the selection stands on', () => {
    expect(parseRemote('/cue/selected/start')).toEqual({ kind: 'cue-start', cue: { by: 'selected' } })
    expect(parseRemote('/cue/playhead/stop')).toEqual({ kind: 'cue-stop', cue: { by: 'selected' } })
  })

  it('takes a seek’s seconds from the first argument, as a number or as text', () => {
    expect(parseRemote('/cue/7/seek', [{ value: 12.5 }])).toEqual({
      kind: 'cue-seek', cue: { by: 'number', number: '7' }, seconds: 12.5
    })
    expect(parseRemote('/cue/7/seek', [{ value: '3' }])).toEqual({
      kind: 'cue-seek', cue: { by: 'number', number: '7' }, seconds: 3
    })
  })

  it('refuses a seek with no time, a time that is not a number, or one before the start', () => {
    expect(parseRemote('/cue/7/seek')).toBeNull()
    expect(parseRemote('/cue/7/seek', [{ value: 'soon' }])).toBeNull()
    expect(parseRemote('/cue/7/seek', [{ value: -1 }])).toBeNull()
  })

  it('leaves everything else to the triggers and the Monitor', () => {
    expect(parseRemote('/eos/out/active/cue')).toBeNull()
    expect(parseRemote('/dca/1/on')).toBeNull()
    expect(parseRemote('/cue/12/jog')).toBeNull()
    expect(parseRemote('/cue//start')).toBeNull()
    expect(parseRemote('go')).toBeNull()
    expect(parseRemote('/')).toBeNull()
    expect(parseRemote('/gone')).toBeNull()
  })
})

describe('remoteEnabled', () => {
  it('is on unless it was turned off, so a show saved before it existed answers', () => {
    expect(remoteEnabled({})).toBe(true)
    expect(remoteEnabled({ remote: true })).toBe(true)
    expect(remoteEnabled({ remote: false })).toBe(false)
  })
})

describe('senderAllowed', () => {
  it('hears everyone when there is no list', () => {
    expect(senderAllowed('10.0.0.5', undefined)).toBe(true)
    expect(senderAllowed('10.0.0.5', [])).toBe(true)
  })

  it('hears an address on the list and nobody else', () => {
    expect(senderAllowed('10.0.0.5', ['10.0.0.5'])).toBe(true)
    expect(senderAllowed('10.0.0.6', ['10.0.0.5'])).toBe(false)
  })

  it('reads a prefix as the range it writes', () => {
    expect(senderAllowed('192.168.1.200', ['192.168.1.0/24'])).toBe(true)
    expect(senderAllowed('192.168.2.1', ['192.168.1.0/24'])).toBe(false)
    expect(senderAllowed('8.8.8.8', ['0.0.0.0/0'])).toBe(true)
    expect(senderAllowed('10.0.0.5', ['10.0.0.5/32'])).toBe(true)
  })

  it('treats an IPv4 sender on a dual-stack socket as the address the operator typed', () => {
    expect(senderAllowed('::ffff:10.0.0.5', ['10.0.0.5'])).toBe(true)
    expect(senderHost('::FFFF:10.0.0.5')).toBe('10.0.0.5')
  })

  it('compares an IPv6 address as written, ignoring case', () => {
    expect(senderAllowed('fe80::1', ['FE80::1'])).toBe(true)
    expect(senderAllowed('::1', ['fe80::1'])).toBe(false)
  })
})

describe('isAllowEntry', () => {
  it('accepts addresses and IPv4 prefixes', () => {
    expect(isAllowEntry('10.0.0.5')).toBe(true)
    expect(isAllowEntry('10.0.0.0/24')).toBe(true)
    expect(isAllowEntry('::1')).toBe(true)
  })

  it('refuses what would quietly match nothing', () => {
    expect(isAllowEntry('')).toBe(false)
    expect(isAllowEntry('lighting-desk')).toBe(false)
    expect(isAllowEntry('10.0.0.256')).toBe(false)
    expect(isAllowEntry('10.0.0.0/33')).toBe(false)
    expect(isAllowEntry('10.0.0')).toBe(false)
  })
})
