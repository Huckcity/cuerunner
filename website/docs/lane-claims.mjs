// The claims the served copy makes, and the lane each one stands on.
//
// `website/docs/pro.mjs` declares the buyer page's claims beside the record's own identifiers,
// and this module is the same declaration for the rest of the copy: the words the phrase must
// sit behind, the lane the claim belongs to, and the row of `quality-and-proof.md`'s claims
// table that states its status today. `scripts/lane-claims.test.ts` reads the declaration, the
// rendered page and the record together, so a claim and its status cannot drift apart — the
// phrase sits behind every claim no lane has carried, and behind none of the claims a lane has.
// `claim` and `lane` are the record's own cells: a renamed row, or a claim moved onto another
// lane, fails the guard naming both rather than this declaration passing against nothing.

/**
 * One claim the copy makes: the page it is written on, the row of the record's claims table
 * that states its status, the lane that carries it, and the words the phrase sits behind.
 *
 * The words are the page's own, read as a reader reads them — the markup off, the whitespace
 * collapsed, the entities written as the page writes them (`&amp;`, as `pro.mjs` declares its
 * claims too) — so adding markup inside a claim does not move it out from under the phrase.
 */
export const COPY_CLAIMS = [
  {
    page: 'interop.html',
    claim: 'Eos desk acceptance',
    lane: 'vendor',
    words: 'An ETC Eos desk'
  },
  {
    page: 'interop.html',
    claim: 'A&H desk acceptance',
    lane: 'hardware',
    words: 'an Allen &amp; Heath SQ or Avantis'
  },
  {
    page: 'interop.html',
    claim: 'The MSC end-to-end case',
    lane: 'hardware',
    words: 'Any console that speaks MSC takes show-control cues'
  },
  // The buyer page's four, each on the row that states its status in the record: the engine
  // row splits its sentence so the phrase sits behind the backends no lane runs and not behind
  // ASIO, which the `asio` lane hosts. The two rows no lane carries declare `—`, the record's
  // own mark for a claim with no lane behind it.
  {
    page: 'pro.html',
    claim: 'ASIO hosting',
    lane: 'asio',
    words: "ASIO, through the interface's own driver — proved in CI against a real driver"
  },
  {
    page: 'pro.html',
    claim: 'Hosting a real driver on the other backends',
    lane: '—',
    words: 'WASAPI shared and exclusive, Core Audio, ALSA and JACK'
  },
  {
    page: 'pro.html',
    claim: 'A&H desk acceptance',
    lane: 'hardware',
    words: 'an Allen &amp; Heath SQ or Avantis'
  },
  {
    page: 'pro.html',
    claim: 'The MSC end-to-end case',
    lane: 'hardware',
    words: 'show-control messages'
  },
  {
    page: 'pro.html',
    claim: 'Live discovery',
    lane: '—',
    words: 'the devices that announce themselves'
  }
]
