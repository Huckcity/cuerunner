import type { LicensePayload } from '../shared/license'

/**
 * A license for tests that need a Pro surface to be drawn or a Pro service to run.
 *
 * Nothing verifies it — the main process is the only thing that checks a signature, and
 * these tests never reach it. What they need is the fact the renderer acts on, so this
 * is the payload that would come back from `license:status` on a licensed machine.
 */
export const TEST_LICENSE: LicensePayload = {
  v: 1,
  id: 'CRN-TEST01',
  licensee: 'Test Machine',
  issued: '2026-01-01'
}