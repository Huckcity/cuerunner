// The one address the shop front publishes.
//
// Two pages speak for the seller — the price page and the support page — and both name the same
// inbox. A second copy is an address that drifts from the one being read: one that reaches
// nobody. It lives here, once, and the pages import it: `website/docs/pricing.mjs` takes it from
// this file, and `support.mjs` takes it too, so there is nothing on the site that types an
// address of its own.
//
// The reply time used to live here as well, as one phrase two pages promised. It is gone: a
// turnaround is a promise about how fast a person works, the site does not need one to answer
// "who do I write to", and a number that is on the site is a number a buyer holds the seller to.
// What the pages say instead is where to write.
//
// scripts/trial-page.test.ts and scripts/support-page.test.ts read the address as data and hold
// each rendered page to it — one live value, and no second address anywhere — so a page cannot
// ship an address that does not exist. scripts/pricing-page.test.ts reads ORDER_EMAIL here too,
// rather than from the page module it used to be declared in.

/**
 * The one inbox everything lands in: an order, a trial request, a support question, a refund.
 * One person answers it.
 *
 * Live: Cloudflare Email Routing on `cuerunner.app` forwards this address to the person who
 * answers it — the same route the price page published for purchase orders, which the trial
 * and support pages now name for what they are for. The guards hold it to one live address: an
 * empty value, a placeholder and a markup-bearing one all fail by name.
 */
export const ORDER_EMAIL = 'orders@cuerunner.app'
