// The one address the shop front publishes, and the one reply it commits to.
//
// Three pages now speak for the seller — the price page, the trial page and the support page —
// and every one of them names the same inbox and, on two of them, the same turnaround. A
// second copy of either is a promise that drifts from the one being kept: an address that
// reaches nobody, or two pages promising two different answers. Both live here, once, and the
// pages import them: `website/docs/pricing.mjs` takes the address from this file, and
// `trial.mjs` and `support.mjs` take both, so there is nothing on the site that types an
// address or a reply of its own.
//
// scripts/trial-page.test.ts and scripts/support-page.test.ts read these declarations as data
// and hold each rendered page to them — the address to one live value, the reply to the one
// phrase — so a page cannot ship an address that does not exist, or a turnaround the seller
// never agreed to. scripts/pricing-page.test.ts reads ORDER_EMAIL here too, rather than from
// the page module it used to be declared in.

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

/**
 * The reply the seller commits to, as the phrase the sentences around it read with: "within
 * one business day", "answered within one business day". Declared once, as a phrase rather
 * than a sentence, so each page writes its own sentence around the same commitment and no page
 * can promise a turnaround of its own — the guards refuse any other reply time on either page.
 */
export const REPLY_WITHIN = 'one business day'
