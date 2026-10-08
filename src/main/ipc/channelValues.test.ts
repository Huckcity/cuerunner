// The channel strings themselves, frozen as literals.
//
// Story 4.1 moved every channel into the declaration tables and the parity gate compares
// main's registrations against that declaration — but both sides read the same constants,
// so a value edited by accident (`midi:send-tcp` becoming `midi:sendtcp`) compiles
// everywhere and fails only against something that still speaks the old name: an engine
// process already running, a release the operator has not updated, a test one commit
// behind. The list below is the wire as it stands. Renaming a channel is then a deliberate
// edit here too, which is the whole point of freezing it.
//
// The event set is frozen beside it, because a push channel's name is the string a
// subscription is keyed by on both sides of the bridge.
import { describe, expect, it } from 'vitest'
import { CHANNEL_TABLES, EVENT_CHANNELS } from '../../shared/ipc'

/** Every declared channel, sorted: the invoke channels and the push channels together. */
const FROZEN_CHANNELS = [
  'app:close-requested',
  'app:compose-report',
  'app:confirm-close',
  'app:drainMainErrors',
  'app:email-report',
  'app:main-error',
  'app:menu-action',
  'app:open-logs',
  'app:renderer-crash',
  'app:save-report',
  'app:write-log',
  'audio:cancel',
  'audio:clock',
  'audio:configure',
  'audio:devices',
  'audio:events',
  'audio:fade',
  'audio:info',
  'audio:onsets',
  'audio:panic',
  'audio:pickFile',
  'audio:prepare',
  'audio:probe',
  'audio:progress',
  'audio:release',
  'audio:routing',
  'audio:seek',
  'audio:silence',
  'audio:start',
  'audio:stop',
  'audio:stopAll',
  'audio:waveform',
  'license:activate',
  'license:changed',
  'license:deactivate',
  'license:status',
  'midi:listInputPorts',
  'midi:listPorts',
  'midi:send',
  'midi:sendTcp',
  'midi:status',
  'network:cancel',
  'network:request',
  'osc:send',
  'playback:heartbeat',
  'playback:panic',
  'redundancy:configure',
  'redundancy:settings',
  'script:pickFile',
  'script:readDocument',
  'script:readFile',
  'script:shell',
  'show:command',
  'show:configure',
  'show:events',
  'show:ewdx-credentials',
  'show:ewdx-discover',
  'show:ewdx-forget',
  'show:ewdx-set-password',
  'show:ewdx-trust-again',
  'show:restart',
  'show:snapshot',
  'workspace:autosave',
  'workspace:clearRecovery',
  'workspace:compare',
  'workspace:confirmClose',
  'workspace:exportBundle',
  'workspace:importBundle',
  'workspace:merge',
  'workspace:open',
  'workspace:openDemo',
  'workspace:openPath',
  'workspace:recent',
  'workspace:recovery',
  'workspace:relink',
  'workspace:save',
  'workspace:saveAs',
  'workspace:setTitle'
] as const

/** The declared push set: the channels a window subscribes to. */
const FROZEN_EVENTS = [
  'app:close-requested',
  'app:main-error',
  'app:menu-action',
  'audio:events',
  'license:changed',
  'playback:panic',
  'show:events'
] as const

describe('the declared channel values', () => {
  it('are the strings this build has always spoken', () => {
    const declared = [...CHANNEL_TABLES.flatMap(table => Object.values(table))].sort()
    expect(declared).toEqual([...FROZEN_CHANNELS])
  })

  it('and the push set is the one the events list names', () => {
    expect([...EVENT_CHANNELS].sort()).toEqual([...FROZEN_EVENTS])
  })

  it('names every frozen channel exactly once', () => {
    // A duplicate would make the list look complete while a value it should hold is gone.
    expect(new Set(FROZEN_CHANNELS).size).toBe(FROZEN_CHANNELS.length)
    expect(new Set(FROZEN_EVENTS).size).toBe(FROZEN_EVENTS.length)
  })
})
