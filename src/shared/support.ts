// Where a problem report is addressed. The support page names the same address from
// `website/docs/contact.mjs`, and `scripts/report-address.test.ts` holds the two equal, so
// a change to one is a failing test rather than a report that goes to a dead inbox.
export const SUPPORT_ADDRESS = 'orders@cuerunner.app'

// Where the app sends somebody who has met a Pro lock and has no key. The lock used to
// offer one thing — a field for a key — which is a dead end for the person most likely to
// be looking at it. `scripts/pricing-link.test.ts` holds this to the page the site serves.
export const PRICING_URL = 'https://cuerunner.app/pricing.html'
