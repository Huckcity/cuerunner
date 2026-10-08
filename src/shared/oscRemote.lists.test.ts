// The addresses that name a cue list: Cuerunner's own `/list/…`, QLab's `cueList` words, and
// QLab's `/cue_id/…`, which names a cue — or a list, which QLab counts as one — by its id.
import { describe, expect, it } from 'vitest'
import { parseRemote } from './oscRemote'

describe('parseRemote, for a show of several lists', () => {
  it('names a list by its name, id or place, under any of its words and either prefix', () => {
    expect(parseRemote('/list/Effects/go')).toEqual({ kind: 'list', list: 'Effects', verb: 'go' })
    expect(parseRemote('/cuerunner/list/2/stop')).toEqual({ kind: 'list', list: '2', verb: 'stop' })
    expect(parseRemote('/workspace/ABC/cueLists/fx-1/select')).toEqual({ kind: 'list', list: 'fx-1', verb: 'select' })
    expect(parseRemote('/cue_list/Pre-show/start')).toEqual({ kind: 'list', list: 'Pre-show', verb: 'go' })
  })

  it('reads every verb a list takes, and nothing else', () => {
    for (const [word, verb] of [
      ['go', 'go'], ['start', 'go'], ['stop', 'stop'], ['hardStop', 'stop'], ['select', 'select'],
      ['arm', 'arm'], ['disarm', 'disarm'], ['next', 'next'], ['previous', 'previous'], ['prev', 'previous']
    ]) {
      expect(parseRemote(`/list/fx/${word}`), word).toEqual({ kind: 'list', list: 'fx', verb })
    }
    expect(parseRemote('/list/fx/seek')).toBeNull()
    expect(parseRemote('/list/go')).toBeNull()
  })

  it('reads QLab’s /cue_id/{id}/… as a cue named by its id', () => {
    expect(parseRemote('/cue_id/7F3A-11/start')).toEqual({ kind: 'cue-start', cue: { by: 'id', id: '7F3A-11' } })
    expect(parseRemote('/workspace/W/cue_id/main/go')).toEqual({ kind: 'cue-go', cue: { by: 'id', id: 'main' } })
    expect(parseRemote('/cueId/x/stop')).toEqual({ kind: 'cue-stop', cue: { by: 'id', id: 'x' } })
  })

  it('still reads /go as the transport’s GO, which is the list on screen’s', () => {
    expect(parseRemote('/go')).toEqual({ kind: 'go' })
  })
})
