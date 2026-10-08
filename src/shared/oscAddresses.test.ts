// One table of addresses: an address the show hears is the transport's (`parseRemote`), or a
// question the feedback answers (`parseFeedbackRequest`, `qlabReply`), and never both — a
// QLab remote's `/cue_id/{list}/go` starts a list and `/cue_id/{list}/playbackPosition` reads
// one, and neither half may take the other's.
import { describe, it, expect } from 'vitest'
import { parseRemote } from './oscRemote'
import { parseFeedbackRequest, qlabReply, type OscFeedbackSnapshot } from './oscFeedback'

const snapshot: OscFeedbackSnapshot = {
  workspaceId: 'WS',
  workspaceName: 'Show',
  activeListId: 'main',
  playhead: { id: 'c1', number: '1', name: 'Walk-in', type: 'audio' },
  lists: [
    { id: 'main', name: 'Main Cue List', playhead: { id: 'c1', number: '1', name: 'Walk-in', type: 'audio' }, cart: false, disarmed: false },
    { id: 'sfx', name: 'Effects', playhead: null, cart: true, disarmed: false }
  ],
  running: [],
  cues: [{ id: 'c1', number: '1', name: 'Walk-in', type: 'audio', parentId: null, listId: 'main', isArmed: true, colorName: 'none', notes: '' }]
}

const isQuery = (address: string): boolean =>
  parseFeedbackRequest(address, []) !== null || qlabReply(address, [], snapshot, '1') !== null

describe('the show’s OSC addresses', () => {
  const transport = [
    '/go', '/stop', '/panic', '/pause', '/resume', '/togglePause', '/select/next', '/select/1',
    '/cue/1/start', '/cue/1/stop', '/cue/selected/go', '/cue_id/c1/start', '/cue_id/sfx/go',
    '/list/Effects/go', '/list/2/stop', '/cueLists/sfx/select', '/cuerunner/go', '/workspace/WS/go'
  ]
  const queries = [
    '/thump', '/version', '/workspaces', '/updates', '/cueLists', '/runningCues', '/selectedCues',
    '/cue/selected/number', '/cue/1/name', '/cue_id/c1/actionElapsed', '/cue_id/sfx/playbackPosition',
    '/workspace/WS/cueLists', '/cuerunner/feedback/subscribe', '/cuerunner/feedback/request', '/cuerunner/cues/request'
  ]

  it('gives every transport address to the transport and none to the feedback', () => {
    for (const address of transport) {
      expect(parseRemote(address, []), address).not.toBeNull()
      expect(isQuery(address), address).toBe(false)
    }
  })

  it('gives every question to the feedback and none to the transport', () => {
    for (const address of queries) {
      expect(isQuery(address), address).toBe(true)
      expect(parseRemote(address, []), address).toBeNull()
    }
  })
})
