// The tests the suite reporter's run is held against: one per lane shape, tagged the way the
// integration specs tag theirs — `@vendor` ran and passed, `@ah` skipped with a reason of its
// own, and one untagged test for the peers lane. Nothing is asserted here on purpose: this file
// is the runner's own event surface, and `scripts/lane-status.test.ts` reads the report the
// reporter derives from it. It needs no browser.
import { test } from '@playwright/test'

test('the vendor half ran', { tag: '@vendor' }, () => {
  // A lane that ran: the reporter has to report every test of it, and `passed`.
})

test('the desk half skipped', { tag: '@ah' }, () => {
  test.skip(
    true,
    'no MIDI Control port named — set AH_MIDI_PORT to the virtual port A&H MIDI Control creates on this machine'
  )
})

test('the untagged case ran', () => {
  // Untagged, so the peers lane's own: the binding the record's lanes table holds.
})
